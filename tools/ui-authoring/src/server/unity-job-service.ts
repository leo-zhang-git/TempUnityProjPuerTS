import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { deliveryStatePath, parseDeliveryState } from "../kernel/delivery-state.js";
import { deriveFormalSyncState } from "../kernel/formal-sync.js";
import {
  artifactPrefabPath,
  artifactSourceIdentity,
  artifactSourceIdentityFromPath,
  assertArtifactPrefabPath,
} from "../kernel/prefab-path.js";
import type { UnityProjection } from "../kernel/projection.js";
import { formatProjection } from "../kernel/projection.js";
import { createUnityProjectionGraph } from "../kernel/projection-graph.js";
import type { SourceCatalogEntry } from "../kernel/source-catalog.js";
import type { UiSource } from "../schema/ui-source-schema.js";
import type {
  UiPrefabImportRequest,
  UiPublishArtifactsRequest,
  UiPublishExecutionOptions,
  UiPublishRequest,
  UiReconcileRequest,
  UiUnityJobKind,
  UiUnityJobResult,
  UiUnityJobSnapshot,
} from "../schema/ui-unity-job.js";
import { loadSourceCatalog } from "./source-catalog.js";
import { svnModifiedSourcePaths } from "./svn-local-changes.js";
import type {
  ProgramGateRunner,
  UnityBridgeRequest,
  UnityJobApiService,
  UnityJobExecutor,
  UnityJobServiceOptions,
} from "./unity-job/contracts.js";
import { atomicWrite, WorkspaceUnityJobExecutor } from "./unity-job/executor.js";
import { ImportOperation } from "./unity-job/import-operation.js";
import type { MutableUnityJob, PreparedProjectionGraph, UnityJobOperationContext } from "./unity-job/operation-context.js";
import { prefabExists, repoRelative } from "./unity-job/operation-support.js";
import { WorkspaceProgramGateRunner } from "./unity-job/program-gate.js";
import { completeUnityJobProgress, createUnityJobProgress, failRunningProgress, mergeUnityJobProgress } from "./unity-job/progress.js";
import { PublishOperation } from "./unity-job/publish-operation.js";
import { runReconcileOperation } from "./unity-job/reconcile-operation.js";
import { syncMessage, syncResult } from "./unity-job/result-parsing.js";
import { isTerminalJob, UnityJobRetention } from "./unity-job/retention.js";
import type { WorkspacePaths } from "./workspace.js";
import { WorkspaceRepository } from "./workspace-repository.js";

export type { ProgramGateRunner, UnityJobApiService, UnityJobExecutor, UnityJobServiceOptions } from "./unity-job/contracts.js";
export {
  BATCH_TIMEOUT_MS,
  EDITOR_CLAIM_TIMEOUT_MS,
  MAX_BATCH_TIMEOUT_MS,
  unityBatchTimeoutMs,
  WorkspaceUnityJobExecutor,
} from "./unity-job/executor.js";
export {
  CLIENT_TYPECHECK_TIMEOUT_MS,
  PROGRAM_PREPARATION_STEP_TIMEOUT_MS,
  programPreparationInvocations,
  programTypecheckInvocation,
} from "./unity-job/program-gate.js";

function emptyPreparedProjectionGraph(): PreparedProjectionGraph {
  return {
    root: {} as UnityProjection,
    projections: [],
    paths: [],
    artifactKeyByPrefabPath: new Map(),
    sources: [],
    contextProjections: [],
    contextPaths: [],
    contextSources: [],
  };
}

export class UnityJobService implements UnityJobApiService {
  readonly #jobs = new Map<string, MutableUnityJob>();
  readonly #executor: UnityJobExecutor;
  readonly #programGate: ProgramGateRunner;
  readonly #repository: WorkspaceRepository;
  readonly #retention: UnityJobRetention;
  readonly #abortController = new AbortController();
  #jobQueue: Promise<void> = Promise.resolve();
  #cleanupQueue: Promise<void> = Promise.resolve();
  readonly #localSourceChanges: (sourceRoot: string) => Promise<readonly string[]>;
  #closed = false;

  constructor(
    readonly paths: WorkspacePaths,
    executor: UnityJobExecutor = new WorkspaceUnityJobExecutor(paths),
    programGate: ProgramGateRunner = new WorkspaceProgramGateRunner(paths),
    repository: WorkspaceRepository = new WorkspaceRepository(paths.sourceRoot),
    localSourceChanges: (sourceRoot: string) => Promise<readonly string[]> = svnModifiedSourcePaths,
    options: UnityJobServiceOptions = {},
  ) {
    this.#executor = executor;
    this.#programGate = programGate;
    this.#repository = repository;
    this.#localSourceChanges = localSourceChanges;
    this.#retention = new UnityJobRetention(this.#jobs, paths.runtimeRoot, options);
    this.#scheduleCleanup();
  }

  async startReconcile(request: UiReconcileRequest): Promise<UiUnityJobSnapshot> {
    if (this.#closed) throw new Error("Unity job service is closed");
    if (request.scope && request.selection) throw new Error("Unity reconcile request cannot combine scope and selection");
    this.#repository.invalidate();
    const scope = request.scope ?? (request.selection?.dependencyMode === "dependencies" ? "dependencies" : "current");
    const id = randomUUID();
    const now = Date.now();
    const mutable: MutableUnityJob = {
      snapshot: {
        id,
        kind: "reconcile",
        artifactKey: scope === "all" ? "__all__" : request.source.artifactKey,
        status: "queued",
        stage: "projection",
        message: "正在准备正式 Prefab 回写范围",
        createdAt: now,
        updatedAt: now,
        progress: createUnityJobProgress([{ id: "reconcile.prepare", label: "确定回写范围" }]),
      },
    };
    this.#jobs.set(id, mutable);
    this.#enqueue(mutable, () => runReconcileOperation(this.#operationContext(), mutable, request, scope));
    return mutable.snapshot;
  }

  async startImport(request: UiPrefabImportRequest): Promise<UiUnityJobSnapshot> {
    if (this.#closed) throw new Error("Unity job service is closed");
    this.#repository.invalidate();
    const identity = artifactSourceIdentityFromPath(request.sourcePath);
    assertArtifactPrefabPath(request.prefabPath.replaceAll("\\", "/"), identity);
    const id = randomUUID();
    const now = Date.now();
    const mutable: MutableUnityJob = {
      snapshot: {
        id,
        kind: "import",
        artifactKey: identity.artifactKey,
        status: "queued",
        stage: "projection",
        message: "正在准备 Prefab 导入观察数据",
        createdAt: now,
        updatedAt: now,
        progress: createUnityJobProgress([
          { id: "import.prepare", label: "检查导入目标" },
          { id: "import.unity-observe", label: "读取现有 Prefab" },
          { id: "import.analyze", label: "生成 Source 候选" },
          { id: "import.write", label: "写入 Source" },
        ]),
      },
    };
    this.#jobs.set(id, mutable);
    this.#enqueue(mutable, () => new ImportOperation(this.#operationContext()).run(mutable, request));
    return mutable.snapshot;
  }

  async startSync(source: UiSource): Promise<UiUnityJobSnapshot> {
    return await this.#start("sync", source);
  }

  async startPublish(request: UiPublishRequest): Promise<UiUnityJobSnapshot> {
    if (this.#closed) throw new Error("Unity job service is closed");
    if (request.scope && request.selection) throw new Error("Formal Publish request cannot combine scope and selection");
    if (request.scope === "all") {
      return await this.startPublishAll(publishExecutionOptions(request));
    }
    if (request.scope === "changes") {
      return await this.startPublishChanges(publishExecutionOptions(request));
    }
    const selection = request.selection ?? {
      dependencyMode: request.scope === "dependencies" ? ("dependencies" as const) : ("declared" as const),
    };
    return await this.#start("publish", request.source, { ...request, selection });
  }

  async startPublishChanges(request: UiPublishExecutionOptions = {}): Promise<UiUnityJobSnapshot> {
    if (this.#closed) throw new Error("Unity job service is closed");
    this.#repository.invalidate();
    const [catalog, changedPaths] = await Promise.all([
      this.#repository.strictSourceCatalog(),
      this.#localSourceChanges(this.paths.sourceRoot),
    ]);
    if (this.#closed) throw new Error("Unity job service is closed");
    const artifactKeyByPath = new Map([...catalog.entries.values()].map((entry) => [sourcePathKey(entry.path), entry.source.artifactKey]));
    const missing = changedPaths.filter((path) => !artifactKeyByPath.has(sourcePathKey(path)));
    if (missing.length > 0) throw new Error(`SVN 本地修改无法映射为有效 UI Source：${missing.join(", ")}`);
    const artifactKeys = changedPaths.flatMap((path) => {
      const artifactKey = artifactKeyByPath.get(sourcePathKey(path));
      return artifactKey ? [artifactKey] : [];
    });
    if (artifactKeys.length === 0) return this.#completeEmptyPublish();
    return await this.startPublishArtifacts({
      ...request,
      artifactKeys,
      selection: { dependencyMode: "dependencies" },
    });
  }

  #completeEmptyPublish(): UiUnityJobSnapshot {
    const id = randomUUID();
    const now = Date.now();
    const snapshot: UiUnityJobSnapshot = {
      id,
      kind: "publish",
      artifactKey: "__changes__",
      status: "succeeded",
      stage: "complete",
      message: "没有可发布的本地 Source 改动",
      createdAt: now,
      updatedAt: now,
      result: {
        kind: "publish",
        delivery: "delivered",
        artifacts: [],
        affectedCanvases: [],
        blockers: [],
        scaffoldPlan: [],
        noOp: true,
      },
    };
    this.#jobs.set(id, { snapshot });
    this.#scheduleCleanup();
    return snapshot;
  }

  async startPublishArtifacts(request: UiPublishArtifactsRequest): Promise<UiUnityJobSnapshot> {
    if (this.#closed) throw new Error("Unity job service is closed");
    this.#repository.invalidate();
    const id = randomUUID();
    const now = Date.now();
    const mutable: MutableUnityJob = {
      snapshot: {
        id,
        kind: "publish",
        artifactKey: request.artifactKeys.join(","),
        status: "queued",
        stage: "projection",
        message: "正在准备选定范围的 Unity 投影工作区",
        createdAt: now,
        updatedAt: now,
        progress: createUnityJobProgress([{ id: "publish.selection", label: "确定发布范围" }]),
      },
    };
    this.#jobs.set(id, mutable);
    this.#enqueue(mutable, () => new PublishOperation(this.#operationContext()).runArtifacts(mutable, request));
    return mutable.snapshot;
  }

  async startPublishAll(request: UiPublishExecutionOptions = {}): Promise<UiUnityJobSnapshot> {
    if (this.#closed) throw new Error("Unity job service is closed");
    this.#repository.invalidate();
    const id = randomUUID();
    const now = Date.now();
    const mutable: MutableUnityJob = {
      snapshot: {
        id,
        kind: "publish",
        artifactKey: "__all__",
        status: "queued",
        stage: "projection",
        message: "正在准备已交付 UI 的 Unity 投影工作区",
        createdAt: now,
        updatedAt: now,
        progress: createUnityJobProgress([{ id: "publish.selection", label: "确定发布范围" }]),
      },
    };
    this.#jobs.set(id, mutable);
    this.#enqueue(mutable, () => new PublishOperation(this.#operationContext()).runAll(mutable, request));
    return mutable.snapshot;
  }

  job(id: string): UiUnityJobSnapshot | undefined {
    return this.#jobs.get(id)?.snapshot;
  }

  async close(): Promise<void> {
    if (!this.#closed) {
      this.#closed = true;
      this.#abortController.abort();
    }
    await this.#jobQueue;
    await this.#cleanupQueue;
  }

  async #start(kind: UiUnityJobKind, source: UiSource, publishRequest?: UiPublishRequest): Promise<UiUnityJobSnapshot> {
    if (this.#closed) throw new Error("Unity job service is closed");
    this.#repository.invalidate();
    const id = randomUUID();
    const now = Date.now();
    const mutable: MutableUnityJob = {
      snapshot: {
        id,
        kind,
        artifactKey: source.artifactKey,
        status: "queued",
        stage: "projection",
        message: "正在准备 Unity 投影",
        createdAt: now,
        updatedAt: now,
        progress: createUnityJobProgress([
          { id: `${kind}.projection`, label: "生成 Unity Projection" },
          { id: "unity.observe", label: "读取正式 Prefab" },
          { id: `${kind}.analyze`, label: "分析 Prefab 差异" },
        ]),
      },
    };
    this.#jobs.set(id, mutable);
    this.#enqueue(mutable, () => this.#run(mutable, source, publishRequest));
    return mutable.snapshot;
  }

  #enqueue(job: MutableUnityJob, operation: () => Promise<void>): void {
    const scheduled = this.#jobQueue.then(async () => {
      if (this.#closed) {
        this.#update(job, {
          status: "failed",
          stage: "failed",
          message: "Unity 任务失败",
          error: "Unity job service closed before the queued job started",
        });
        return;
      }
      await operation();
    });
    this.#jobQueue = scheduled.catch((error: unknown) => {
      this.#update(job, {
        status: "failed",
        stage: "failed",
        message: "Unity 任务失败",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  async #run(job: MutableUnityJob, source: UiSource, publishRequest?: UiPublishRequest): Promise<void> {
    try {
      this.#update(job, { status: "running", stage: "projection", message: "正在写入投影图" });
      if (job.snapshot.kind === "publish") {
        await new PublishOperation(this.#operationContext()).run(job, publishRequest ?? { source });
        return;
      }
      if (job.snapshot.kind !== "sync") throw new Error(`Unsupported single-artifact Unity job '${job.snapshot.kind}'`);
      const prepared = await this.#prepareProjections(job.snapshot.id, source);
      this.#reportProgress(job, {
        id: "sync.projection",
        label: "生成 Unity Projection",
        status: "succeeded",
        completed: 1,
        total: 1,
      });
      const directory = this.#jobDirectory(job.snapshot.id);
      const requestPath = join(directory, "request.json");
      const resultPath = join(directory, "result.json");
      const logPath = join(directory, "unity.log");
      if (!(await prefabExists(this.paths.repoRoot, prepared.root.prefabPath))) {
        const result: UiUnityJobResult = {
          kind: "sync",
          prefabPath: prepared.root.prefabPath,
          state: deriveFormalSyncState(source),
          patches: [],
          issues: [],
        };
        this.#update(job, { status: "succeeded", stage: "complete", message: "正式 Prefab 不存在", result });
        return;
      }
      const request: UnityBridgeRequest = {
        jobId: job.snapshot.id,
        kind: "observe",
        projectionPaths: prepared.paths,
        deliveryStatePaths: await this.#deliveryStatePaths(prepared.sources),
        resultPath: repoRelative(this.paths.repoRoot, resultPath),
      };
      await atomicWrite(requestPath, `${JSON.stringify(request, null, 2)}\n`);
      this.#update(job, {
        status: "running",
        stage: "unity",
        message: "正在读取正式 Prefab",
      });
      const bridge = await this.#executor.execute(
        repoRelative(this.paths.repoRoot, requestPath),
        repoRelative(this.paths.repoRoot, resultPath),
        logPath,
        this.#abortController.signal,
        (progress) => this.#reportProgress(job, progress),
      );
      if (!bridge.ok) throw new Error(bridge.error || "Unity job failed");
      this.#reportProgress(job, {
        id: "sync.analyze",
        label: "分析 Prefab 差异",
        status: "running",
        completed: 0,
        total: 1,
      });
      const result = syncResult(source, prepared.root, prepared.base, bridge, prepared.artifactKeyByPrefabPath);
      this.#reportProgress(job, {
        id: "sync.analyze",
        label: "分析 Prefab 差异",
        status: "succeeded",
        completed: 1,
        total: 1,
      });
      this.#update(job, {
        status: "succeeded",
        stage: "complete",
        message: syncMessage(result),
        result,
      });
    } catch (error) {
      this.#update(job, {
        status: "failed",
        stage: "failed",
        message: "Unity 任务失败",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async #deliveryStatePaths(sources: readonly SourceCatalogEntry[]): Promise<readonly (string | null)[]> {
    return await Promise.all(
      sources.map(async (entry) => {
        const path = deliveryStatePath(entry.source.artifactKey);
        try {
          parseDeliveryState(JSON.parse(await readFile(join(this.paths.repoRoot, ...path.split("/")), "utf8")));
          return path;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw error;
        }
      }),
    );
  }

  async #loadDeliveryState(artifactKey: string) {
    const path = deliveryStatePath(artifactKey);
    try {
      return parseDeliveryState(JSON.parse(await readFile(join(this.paths.repoRoot, ...path.split("/")), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async #prepareProjections(jobId: string, source: UiSource): Promise<PreparedProjectionGraph> {
    const catalog = await this.#repository.strictSourceCatalog({ source });
    return this.#prepareProjectionBatch(jobId, source, catalog, []);
  }

  async #preparePublishEntries(
    jobId: string,
    catalog: Awaited<ReturnType<typeof loadSourceCatalog>>,
    entries: readonly SourceCatalogEntry[],
    onProgress?: (completed: number, total: number, artifactKey: string) => void,
  ): Promise<PreparedProjectionGraph> {
    if (entries.length === 0) throw new Error("Formal Publish selection is empty");
    const projections = entries.map((entry) => {
      const projection = createUnityProjectionGraph(catalog, entry.source.artifactKey).at(-1)?.projection;
      if (!projection) throw new Error(`Projection graph for '${entry.source.artifactKey}' is empty`);
      return projection;
    });
    const contextProjections = new Map<string, UnityProjection>();
    for (const entry of entries) {
      for (const graphEntry of createUnityProjectionGraph(catalog, entry.source.artifactKey)) {
        contextProjections.set(graphEntry.projection.artifactKey, graphEntry.projection);
      }
    }
    const outputDirectory = join(this.#jobDirectory(jobId), "projection");
    await mkdir(outputDirectory, { recursive: true });
    let completed = 0;
    for (const projection of contextProjections.values()) {
      onProgress?.(completed, contextProjections.size, projection.artifactKey);
      assertArtifactPrefabPath(projection.prefabPath, { path: projection.sourcePath, artifactKey: projection.artifactKey });
      const outputPath = join(outputDirectory, `${projection.artifactKey}.projection.json`);
      await atomicWrite(outputPath, formatProjection(projection));
      completed += 1;
      onProgress?.(completed, contextProjections.size, projection.artifactKey);
    }
    const paths = projections.map((projection) =>
      repoRelative(this.paths.repoRoot, join(outputDirectory, `${projection.artifactKey}.projection.json`)),
    );
    const contextPaths = [...contextProjections.values()].map((projection) =>
      repoRelative(this.paths.repoRoot, join(outputDirectory, `${projection.artifactKey}.projection.json`)),
    );
    const contextSources = [...contextProjections.keys()].map((artifactKey) => catalog.entries.get(artifactKey)!).filter(Boolean);
    return {
      root: projections.at(-1)!,
      projections,
      paths,
      artifactKeyByPrefabPath: new Map(
        [...catalog.entries.values()].map((entry) => [artifactPrefabPath(artifactSourceIdentity(entry)), entry.source.artifactKey]),
      ),
      sources: [...entries],
      contextProjections: [...contextProjections.values()],
      contextPaths,
      contextSources,
    };
  }

  async #prepareProjectionBatch(
    jobId: string,
    source: UiSource,
    catalog: Awaited<ReturnType<typeof loadSourceCatalog>>,
    additionalRootArtifactKeys: readonly string[],
  ): Promise<PreparedProjectionGraph> {
    const rootGraph = createUnityProjectionGraph(catalog, source.artifactKey);
    const root = rootGraph.at(-1)?.projection;
    if (!root) throw new Error(`Projection graph for '${source.artifactKey}' is empty`);
    const projections = new Map<string, UnityProjection>();
    for (const artifactKey of [source.artifactKey, ...additionalRootArtifactKeys]) {
      for (const entry of createUnityProjectionGraph(catalog, artifactKey)) projections.set(entry.projection.artifactKey, entry.projection);
    }
    const outputDirectory = join(this.#jobDirectory(jobId), "projection");
    await mkdir(outputDirectory, { recursive: true });
    const projectionPaths: string[] = [];
    for (const projection of projections.values()) {
      assertArtifactPrefabPath(projection.prefabPath, { path: projection.sourcePath, artifactKey: projection.artifactKey });
      const outputPath = join(outputDirectory, `${projection.artifactKey}.projection.json`);
      await atomicWrite(outputPath, formatProjection(projection));
      projectionPaths.push(repoRelative(this.paths.repoRoot, outputPath));
    }
    const artifactKeyByPrefabPath = new Map(
      [...catalog.entries.values()].map((entry) => [artifactPrefabPath(artifactSourceIdentity(entry)), entry.source.artifactKey]),
    );
    const base = source.sourceKind === "variant" ? createUnityProjectionGraph(catalog, source.variantOf).at(-1)?.projection : undefined;
    if (source.sourceKind === "variant" && !base) throw new Error(`Variant base Projection for '${source.variantOf}' is empty`);
    return {
      root,
      ...(base ? { base } : {}),
      projections: [...projections.values()],
      paths: projectionPaths,
      artifactKeyByPrefabPath,
      sources: [...projections.keys()].map((artifactKey) => catalog.entries.get(artifactKey)!).filter(Boolean),
      contextProjections: [...projections.values()],
      contextPaths: projectionPaths,
      contextSources: [...projections.keys()].map((artifactKey) => catalog.entries.get(artifactKey)!).filter(Boolean),
    };
  }

  async #prepareAllProjections(
    jobId: string,
    onProgress?: (completed: number, total: number, artifactKey: string) => void,
  ): Promise<PreparedProjectionGraph> {
    const catalog = await this.#repository.strictSourceCatalog();
    const entries = [...catalog.entries.values()].sort((left, right) => left.path.localeCompare(right.path));
    if (entries.length === 0) return emptyPreparedProjectionGraph();
    const deliveredEntries = (
      await Promise.all(entries.map(async (entry) => ((await this.#loadDeliveryState(entry.source.artifactKey)) ? entry : undefined)))
    ).filter((entry): entry is SourceCatalogEntry => entry !== undefined);
    if (deliveredEntries.length === 0) return emptyPreparedProjectionGraph();
    return this.#preparePublishEntries(jobId, catalog, deliveredEntries, onProgress);
  }

  #jobDirectory(id: string): string {
    return join(this.paths.runtimeRoot, "unity-jobs", id);
  }

  #operationContext(): UnityJobOperationContext {
    return {
      paths: this.paths,
      executor: this.#executor,
      programGate: this.#programGate,
      repository: this.#repository,
      signal: this.#abortController.signal,
      update: (job, patch) => this.#update(job, patch),
      reportProgress: (job, progress) => this.#reportProgress(job, progress),
      jobDirectory: (id) => this.#jobDirectory(id),
      deliveryStatePaths: (sources) => this.#deliveryStatePaths(sources),
      preparePublishEntries: (jobId, catalog, entries, onProgress) => this.#preparePublishEntries(jobId, catalog, entries, onProgress),
      prepareAllProjections: (jobId, onProgress) => this.#prepareAllProjections(jobId, onProgress),
    };
  }

  #reportProgress(job: MutableUnityJob, progress: Parameters<typeof mergeUnityJobProgress>[1]): void {
    this.#update(job, { progress: mergeUnityJobProgress(job.snapshot.progress, progress) });
  }

  #update(job: MutableUnityJob, patch: Partial<UiUnityJobSnapshot>): void {
    const status = patch.status ?? job.snapshot.status;
    const nextProgress = patch.progress ?? job.snapshot.progress;
    const progress =
      status === "succeeded" && patch.stage === "complete"
        ? completeUnityJobProgress(nextProgress)
        : status === "failed"
          ? failRunningProgress(nextProgress)
          : nextProgress;
    job.snapshot = { ...job.snapshot, ...patch, ...(progress ? { progress } : {}), updatedAt: Date.now() };
    if (isTerminalJob(job.snapshot)) this.#scheduleCleanup();
  }

  #scheduleCleanup(): void {
    this.#cleanupQueue = this.#cleanupQueue
      .then(async () => {
        this.#retention.pruneSnapshots();
        await this.#retention.pruneDirectories();
      })
      .catch(() => undefined);
  }
}

function publishExecutionOptions(request: UiPublishExecutionOptions): UiPublishExecutionOptions {
  return {
    ...(request.confirmScaffold === true ? { confirmScaffold: true } : {}),
    ...(typeof request.runClientTypecheck === "boolean" ? { runClientTypecheck: request.runClientTypecheck } : {}),
  };
}

function sourcePathKey(path: string): string {
  return path.replaceAll("\\", "/").toLocaleLowerCase("en-US");
}
