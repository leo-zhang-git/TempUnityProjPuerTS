import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { deliveryStatePath, formatDeliveryState, parseDeliveryState } from "../../kernel/delivery-state.js";
import { createDeliveryState } from "../../kernel/formal-sync.js";
import { parsePrefabObservation } from "../../kernel/prefab-observation.js";
import { artifactPrefabPath, artifactSourceIdentity } from "../../kernel/prefab-path.js";
import { createUnityProjectionGraph } from "../../kernel/projection-graph.js";
import { publishCapabilityDiagnostics } from "../../kernel/publish-capability.js";
import type { SourceCatalog, SourceCatalogEntry } from "../../kernel/source-catalog.js";
import type {
  UiPublishArtifactsRequest,
  UiPublishBlocker,
  UiPublishExecutionOptions,
  UiPublishRequest,
  UiPublishSelection,
  UiPublishTouchedPaths,
  UiUnityPublishJobResult,
} from "../../schema/ui-unity-job.js";
import { acquireWorkspaceLock } from "../artifact-transaction.js";
import { inspectProgramUiContract } from "../program-ui-contract.js";
import { applyProgramUiScaffold } from "../program-ui-scaffold.js";
import { selectPublishEntries } from "../publish-selection.js";
import { loadSourceCatalog } from "../source-catalog.js";
import type { WorkspacePaths } from "../workspace.js";
import type { UnityBridgeResponse, UnityPublishPlan } from "./contracts.js";
import { atomicWrite } from "./executor.js";
import type { MutableUnityJob, PreparedProjectionGraph, UnityJobOperationContext } from "./operation-context.js";
import { prefabExists, repoRelative, workspaceChangePaths } from "./operation-support.js";
import { initializeProgress } from "./progress.js";
import {
  importArray,
  mergeActualPublishTouchedPaths,
  observationArray,
  publishBlockerArray,
  publishPayload,
  publishTouchedPaths,
  reconcileProjectionObservation,
  stringArray,
} from "./result-parsing.js";

export class PublishOperation {
  constructor(readonly context: UnityJobOperationContext) {}

  async run(job: MutableUnityJob, request: UiPublishRequest): Promise<void> {
    this.#progress(job, "publish.selection", "确定发布范围", "running", 0, 1);
    const catalog = await this.context.repository.scopedSourceCatalog([request.source.artifactKey], { source: request.source });
    const entries = selectPublishEntries(catalog, [request.source.artifactKey], request.selection);
    const artifactKeys = entries.map((entry) => entry.source.artifactKey);
    this.context.update(job, {
      progress: initializeProgress(job, publishProgressPlan(entries.length, entries.length, request.runClientTypecheck === true), [
        "publish.selection",
      ]),
    });
    this.#progress(job, "publish.selection", "确定发布范围", "succeeded", 1, 1);
    const inspectProgram = () =>
      inspectSelectedProgramUiContract(this.context.paths.repoRoot, catalog, artifactKeys, [request.source.artifactKey], request.selection);
    this.#progress(job, "publish.program-contract", "检查程序接入", "running", 0, 1);
    const program = await inspectProgram();
    this.#progress(job, "publish.program-contract", "检查程序接入", "succeeded", 1, 1);
    const formal = await this.context.preparePublishEntries(job.snapshot.id, catalog, entries, (completed, total, artifactKey) =>
      this.#progress(
        job,
        "publish.projection",
        "生成 Unity Projection",
        completed >= total ? "succeeded" : "running",
        completed,
        total,
        artifactKey,
      ),
    );
    await this.#runPreparedPublish(job, request, formal, catalog, program, {
      allowScaffold: true,
      reloadProgram: inspectProgram,
    });
  }
  async runArtifacts(job: MutableUnityJob, request: UiPublishArtifactsRequest): Promise<void> {
    try {
      this.#progress(job, "publish.selection", "确定发布范围", "running", 0, 1);
      this.context.update(job, { status: "running", stage: "projection", message: "正在写入选定范围的 Unity 投影工作区" });
      const catalog = await this.context.repository.scopedSourceCatalog(request.artifactKeys);
      const entries = selectPublishEntries(catalog, request.artifactKeys, request.selection);
      const artifactKeys = entries.map((entry) => entry.source.artifactKey);
      this.context.update(job, {
        progress: initializeProgress(job, publishProgressPlan(entries.length, entries.length, request.runClientTypecheck === true), [
          "publish.selection",
        ]),
      });
      this.#progress(job, "publish.selection", "确定发布范围", "succeeded", 1, 1);
      const inspectProgram = () =>
        inspectSelectedProgramUiContract(this.context.paths.repoRoot, catalog, artifactKeys, request.artifactKeys, request.selection);
      this.#progress(job, "publish.program-contract", "检查程序接入", "running", 0, 1);
      const program = await inspectProgram();
      this.#progress(job, "publish.program-contract", "检查程序接入", "succeeded", 1, 1);
      const formal = await this.context.preparePublishEntries(job.snapshot.id, catalog, entries, (completed, total, artifactKey) =>
        this.#progress(
          job,
          "publish.projection",
          "生成 Unity Projection",
          completed >= total ? "succeeded" : "running",
          completed,
          total,
          artifactKey,
        ),
      );
      await this.#runPreparedPublish(job, request, formal, catalog, program, {
        allowScaffold: true,
        reloadProgram: inspectProgram,
      });
    } catch (error) {
      this.context.update(job, {
        status: "failed",
        stage: "failed",
        message: "Unity 任务失败",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async runAll(job: MutableUnityJob, request: UiPublishExecutionOptions): Promise<void> {
    try {
      this.#progress(job, "publish.selection", "确定发布范围", "running", 0, 1);
      this.context.update(job, { status: "running", stage: "projection", message: "正在写入已交付 UI 的 Unity 投影工作区" });
      const formal = await this.context.prepareAllProjections(job.snapshot.id, (completed, total, artifactKey) =>
        this.#progress(
          job,
          "publish.projection",
          "生成 Unity Projection",
          completed >= total ? "succeeded" : "running",
          completed,
          total,
          artifactKey,
        ),
      );
      this.context.update(job, {
        progress: initializeProgress(
          job,
          publishProgressPlan(formal.sources.length, formal.contextSources.length, request.runClientTypecheck === true),
          ["publish.selection", "publish.projection"],
        ),
      });
      this.#progress(job, "publish.selection", "确定发布范围", "succeeded", 1, 1);
      if (formal.sources.length === 0) {
        this.context.update(job, {
          status: "succeeded",
          stage: "complete",
          message: "没有已交付的 UI Source 文档",
          result: {
            kind: "publish",
            delivery: "delivered",
            artifacts: [],
            affectedCanvases: [],
            blockers: [],
            scaffoldPlan: [],
            noOp: true,
            imports: [],
            generatedInventory: [],
            touchedPaths: { svnDeliverables: [], gitDeliverables: [], preExistingUnrelated: [] },
          },
        });
        return;
      }
      const catalog = await this.context.repository.strictSourceCatalog();
      const entries = selectPublishEntries(
        catalog,
        formal.sources.map((entry) => entry.source.artifactKey),
        { dependencyMode: "declared" },
      );
      const artifactKeys = entries.map((entry) => entry.source.artifactKey);
      const selection = { dependencyMode: "declared" } as const;
      const inspectProgram = () =>
        inspectSelectedProgramUiContract(this.context.paths.repoRoot, catalog, artifactKeys, artifactKeys, selection);
      this.#progress(job, "publish.program-contract", "检查程序接入", "running", 0, 1);
      const program = await inspectProgram();
      this.#progress(job, "publish.program-contract", "检查程序接入", "succeeded", 1, 1);
      await this.#runPreparedPublish(job, request, formal, catalog, program, {
        allowScaffold: true,
        reloadProgram: inspectProgram,
      });
    } catch (error) {
      this.context.update(job, {
        status: "failed",
        stage: "failed",
        message: "Unity 任务失败",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async #runPreparedPublish(
    job: MutableUnityJob,
    request: Omit<UiPublishRequest, "source">,
    formal: PreparedProjectionGraph,
    catalog: Awaited<ReturnType<typeof loadSourceCatalog>>,
    program: Awaited<ReturnType<typeof inspectProgramUiContract>>,
    options: {
      readonly allowScaffold: boolean;
      readonly reloadProgram?: () => Promise<Awaited<ReturnType<typeof inspectProgramUiContract>>>;
    },
  ): Promise<void> {
    const runClientTypecheck = request.runClientTypecheck === true;
    const baseProjections = formal.sources.map((entry) =>
      entry.source.sourceKind === "variant" ? createUnityProjectionGraph(catalog, entry.source.variantOf).at(-1)?.projection : undefined,
    );
    for (let index = 0; index < formal.sources.length; index += 1) {
      const entry = formal.sources[index]!;
      if (entry.source.sourceKind === "variant" && !baseProjections[index]) {
        throw new Error(`Variant base Projection for '${entry.source.variantOf}' is empty`);
      }
    }
    let currentProgram = program;
    const reloadProgram = options.reloadProgram;
    const touchedPaths = publishTouchedPaths(
      formal.sources,
      currentProgram.expectedBindings,
      currentProgram.scaffoldPlan.map((entry) => entry.path),
    );
    const changeScopePaths = [...touchedPaths.svnDeliverables, ...touchedPaths.gitDeliverables];
    const preExisting = await workspaceChangePaths(this.context.paths.repoRoot, changeScopePaths);
    const touched = new Set([...touchedPaths.svnDeliverables, ...touchedPaths.gitDeliverables]);
    let preExistingUnrelated = preExisting.filter((path) => !touched.has(path));
    const initialBlockers = [...currentProgram.blockers];
    for (let index = 0; index < formal.sources.length; index += 1) {
      const entry = formal.sources[index]!;
      this.#progress(job, "publish.capability", "检查 Source 发布能力", "running", index, formal.sources.length, entry.source.artifactKey);
      for (const diagnostic of publishCapabilityDiagnostics(entry.source))
        initialBlockers.push({
          code: diagnostic.code,
          message: diagnostic.message,
          artifactKey: diagnostic.artifactKey,
          ...(diagnostic.path ? { path: diagnostic.path } : {}),
        });
      this.#progress(
        job,
        "publish.capability",
        "检查 Source 发布能力",
        index + 1 >= formal.sources.length ? "succeeded" : "running",
        index + 1,
        formal.sources.length,
        entry.source.artifactKey,
      );
    }
    const blockers: UiPublishBlocker[] = [...initialBlockers];
    const remainingBlockers = blockers.filter(
      (blocker) => blocker.code !== "publish.programScaffoldRequired" || request.confirmScaffold !== true || !options.allowScaffold,
    );
    if (remainingBlockers.length > 0) {
      this.#completePublish(job, currentProgram, blockers, { ...touchedPaths, preExistingUnrelated });
      return;
    }
    try {
      if (currentProgram.scaffoldPlan.length > 0) {
        if (!options.allowScaffold || !reloadProgram)
          throw new Error("Formal Publish cannot apply program scaffold without an explicit reload contract");
        this.context.update(job, { status: "running", stage: "scaffold", message: "正在应用已确认的程序 UI 脚手架" });
        this.#progress(job, "publish.program-prepare", "准备程序 UI 接入", "running", 0, 1);
        await applyProgramUiScaffold(this.context.paths.repoRoot, currentProgram.scaffoldPlan);
      }
      const requiresProgramPreparation = runClientTypecheck || currentProgram.scaffoldPlan.length > 0;
      if (requiresProgramPreparation) {
        const prepareProgram = this.context.programGate.prepareClientTypecheck;
        if (!prepareProgram) throw new Error("Formal Publish cannot refresh the client UI module registry");
        this.context.update(job, { status: "running", stage: "preflight", message: "正在刷新客户端 UI 模块表" });
        await prepareProgram.call(this.context.programGate, this.context.signal);
        const preparedChanges = await workspaceChangePaths(this.context.paths.repoRoot, changeScopePaths);
        preExistingUnrelated = preparedChanges.filter((path) => !touched.has(path));
      }
      this.#progress(job, "publish.program-prepare", "准备程序 UI 接入", "succeeded", 1, 1);
      if (currentProgram.scaffoldPlan.length > 0) {
        currentProgram = await reloadProgram!();
        if (currentProgram.blockers.length > 0)
          throw new Error(
            `Confirmed program UI scaffold did not satisfy the delivery contract: ${currentProgram.blockers.map((blocker) => blocker.message).join("; ")}`,
          );
      }
      this.context.update(job, { status: "running", stage: "formal", message: "正在检查并应用正式 Prefab 计划" });
      const appliedBridge = await this.#callPublishPlan(
        job.snapshot.id,
        {
          artifacts: formal.sources.map((entry) => entry.source.artifactKey),
        },
        job,
      );
      const appliedPayload = publishPayload(appliedBridge);
      if (appliedPayload.delivery === "blocked") {
        // Unity 已写入正式产物后才发现 blocker，落盘现场交给人工确认。
        const planBlockers = publishBlockerArray(appliedPayload.blockers);
        this.context.update(job, { residualPaths: await this.#publishResidualPaths(preExistingUnrelated, changeScopePaths) });
        this.#completePublish(job, currentProgram, planBlockers, { ...touchedPaths, preExistingUnrelated });
        return;
      }
      if (appliedPayload.delivery !== "applied") throw new Error("Unity Publish Plan returned an invalid delivery state");
      const formalObservations = observationArray(appliedPayload.formalObservations, formal.sources.length, false);
      const generatedInventory = stringArray(appliedPayload.generatedInventory, "generatedInventory");
      for (let index = 0; index < formalObservations.length; index += 1) {
        const source = formal.sources[index]!.source;
        this.#progress(job, "publish.verify", "验证 Prefab 收敛结果", "running", index, formalObservations.length, source.artifactKey);
        const observation = formalObservations[index]!;
        const capabilityDiagnostics = publishCapabilityDiagnostics(source, observation);
        if (capabilityDiagnostics.length > 0) {
          throw new Error(
            `Applied Formal Prefab '${source.artifactKey}' contains ${capabilityDiagnostics.length} unsupported component diagnostics`,
          );
        }
        const reconcile = reconcileProjectionObservation(
          source,
          formal.projections[index]!,
          baseProjections[index],
          { ...observation, diagnostics: [] },
          formal.artifactKeyByPrefabPath,
        );
        if (reconcile.issues.length > 0 || reconcile.patches.length > 0) {
          throw new Error(
            `Formal Projection did not converge for '${formal.sources[index]!.source.artifactKey}' (${reconcile.issues.length} issues, ${reconcile.patches.length} patches)`,
          );
        }
        this.#progress(
          job,
          "publish.verify",
          "验证 Prefab 收敛结果",
          index + 1 >= formalObservations.length ? "succeeded" : "running",
          index + 1,
          formalObservations.length,
          source.artifactKey,
        );
      }
      const missingBindings = currentProgram.expectedBindings.filter((path) => !generatedInventory.includes(path));
      if (missingBindings.length > 0) throw new Error(`Full binding inventory is missing expected outputs: ${missingBindings.join(", ")}`);

      if (runClientTypecheck) {
        this.context.update(job, { status: "running", stage: "program", message: "正在执行客户端 UI 契约类型检查" });
        this.#progress(job, "publish.typecheck", "检查客户端 UI 类型", "running", 0, 1);
        await this.context.programGate.runClientTypecheck(this.context.signal);
        this.#progress(job, "publish.typecheck", "检查客户端 UI 类型", "succeeded", 1, 1);
      } else {
        this.context.update(job, { status: "running", stage: "program", message: "正在提交发布元数据" });
      }
      const deliveryStates = await writePublishMetadata(
        this.context.paths,
        formal.sources,
        formalObservations,
        (completed, total, artifactKey) =>
          this.#progress(
            job,
            "publish.metadata",
            "提交发布元数据",
            completed >= total ? "succeeded" : "running",
            completed,
            total,
            artifactKey,
          ),
      );
      const actualTouchedPaths = mergeActualPublishTouchedPaths(
        touchedPaths,
        await workspaceChangePaths(this.context.paths.repoRoot, changeScopePaths),
        preExistingUnrelated,
      );
      const result: UiUnityPublishJobResult = {
        kind: "publish",
        delivery: "delivered",
        artifacts: currentProgram.artifacts,
        affectedCanvases: currentProgram.affectedCanvases,
        blockers: [],
        scaffoldPlan: [],
        noOp: importArray(appliedPayload.imports).every((entry) => entry.noOp),
        imports: importArray(appliedPayload.imports),
        generatedInventory,
        deliveryStates: formal.sources.map((entry, index) => ({
          artifactKey: entry.source.artifactKey,
          state: deliveryStates[index]!,
          observation: formalObservations[index]!,
        })),
        touchedPaths: {
          ...actualTouchedPaths,
          gitDeliverables: [...new Set([...actualTouchedPaths.gitDeliverables, ...generatedInventory])].sort(),
          preExistingUnrelated,
        },
      };
      this.context.update(job, {
        status: "succeeded",
        stage: "complete",
        message: `已发布 ${currentProgram.artifacts.length} 个正式 Prefab`,
        result,
      });
    } catch (error) {
      this.context.update(job, { residualPaths: await this.#publishResidualPaths(preExistingUnrelated, changeScopePaths) });
      throw error;
    }
  }

  /** 发布失败时把已落盘的工作区改动按 VCS 归属分组，交给人工确认和处置。 */
  async #publishResidualPaths(
    preExistingUnrelated: readonly string[],
    changeScopePaths: readonly string[],
  ): Promise<UiPublishTouchedPaths> {
    const unrelated = new Set(preExistingUnrelated);
    const residual = (await workspaceChangePaths(this.context.paths.repoRoot, changeScopePaths)).filter((path) => !unrelated.has(path));
    return {
      svnDeliverables: residual.filter((path) => path.startsWith("My project/")),
      gitDeliverables: residual.filter((path) => !path.startsWith("My project/")),
      preExistingUnrelated: [...preExistingUnrelated],
    };
  }

  #completePublish(
    job: MutableUnityJob,
    program: Awaited<ReturnType<typeof inspectProgramUiContract>>,
    blockers: readonly UiPublishBlocker[],
    touchedPaths: NonNullable<UiUnityPublishJobResult["touchedPaths"]>,
  ): void {
    const result: UiUnityPublishJobResult = {
      kind: "publish",
      delivery: "blocked",
      artifacts: program.artifacts,
      affectedCanvases: program.affectedCanvases,
      blockers,
      scaffoldPlan: program.scaffoldPlan,
      touchedPaths,
    };
    this.context.update(job, { status: "succeeded", stage: "blocked", message: `正式发布被 ${blockers.length} 个问题阻断`, result });
  }

  async #callPublishPlan(jobId: string, plan: UnityPublishPlan, job: MutableUnityJob): Promise<UnityBridgeResponse> {
    const directory = join(this.context.jobDirectory(jobId), "publish-plan");
    const requestPath = join(directory, "request.json");
    const resultPath = join(directory, "result.json");
    const logPath = join(directory, "unity.log");
    await atomicWrite(requestPath, `${JSON.stringify(plan, null, 2)}\n`);
    const bridge = await this.context.executor.execute(
      repoRelative(this.context.paths.repoRoot, requestPath),
      repoRelative(this.context.paths.repoRoot, resultPath),
      logPath,
      this.context.signal,
      (progress) => this.context.reportProgress(job, progress),
    );
    if (!bridge.ok) throw new Error(bridge.error || "Unity Publish Plan failed");
    return bridge;
  }

  #progress(
    job: MutableUnityJob,
    id: string,
    label: string,
    status: "running" | "succeeded",
    completed: number,
    total: number,
    currentItem?: string,
  ): void {
    this.context.reportProgress(job, { id, label, status, completed, total, ...(currentItem ? { currentItem } : {}) });
  }
}

async function writePublishMetadata(
  paths: WorkspacePaths,
  sources: readonly SourceCatalogEntry[],
  formalObservations: readonly ReturnType<typeof parsePrefabObservation>[],
  onProgress?: (completed: number, total: number, artifactKey: string) => void,
): Promise<readonly ReturnType<typeof parseDeliveryState>[]> {
  const release = await acquireWorkspaceLock(paths);
  try {
    const nextStates = sources.map((entry, index) => createDeliveryState(entry.source, formalObservations[index]!));
    for (let index = 0; index < sources.length; index += 1) {
      onProgress?.(index, sources.length, sources[index]!.source.artifactKey);
      const relativePath = deliveryStatePath(sources[index]!.source.artifactKey);
      const path = join(paths.repoRoot, ...relativePath.split("/"));
      const content = formatDeliveryState(nextStates[index]!);
      if ((await readFile(path, "utf8").catch(() => undefined)) !== content) await atomicWrite(path, content);
      onProgress?.(index + 1, sources.length, sources[index]!.source.artifactKey);
    }
    return nextStates;
  } finally {
    await release();
  }
}

function publishProgressPlan(
  artifactCount: number,
  projectionCount: number,
  runClientTypecheck: boolean,
): readonly { readonly id: string; readonly label: string; readonly total?: number }[] {
  const artifacts = Math.max(1, artifactCount);
  return [
    { id: "publish.selection", label: "确定发布范围" },
    { id: "publish.program-contract", label: "检查程序接入" },
    { id: "publish.projection", label: "生成 Unity Projection", total: Math.max(1, projectionCount) },
    { id: "publish.capability", label: "检查 Source 发布能力", total: artifacts },
    { id: "publish.program-prepare", label: "准备程序 UI 接入" },
    { id: "publish.unity-validate", label: "检查 Unity Projection", total: artifacts },
    { id: "publish.unity-import", label: "发布正式 Prefab", total: artifacts },
    { id: "publish.unity-bindings", label: "生成 UI Binding" },
    { id: "publish.unity-save", label: "保存 Unity 资源" },
    { id: "publish.unity-observe", label: "回读正式 Prefab", total: artifacts },
    { id: "publish.unity-audit", label: "检查发布结果", total: artifacts },
    { id: "publish.verify", label: "验证 Prefab 收敛结果", total: artifacts },
    ...(runClientTypecheck ? [{ id: "publish.typecheck", label: "检查客户端 UI 类型" }] : []),
    { id: "publish.metadata", label: "提交发布元数据", total: artifacts },
  ];
}

async function inspectSelectedProgramUiContract(
  repoRoot: string,
  catalog: SourceCatalog,
  artifactKeys: readonly string[],
  declaredArtifactKeys: readonly string[],
  selection: UiPublishSelection | undefined,
): Promise<Awaited<ReturnType<typeof inspectProgramUiContract>>> {
  const program = await inspectProgramUiContract(repoRoot, catalog, artifactKeys);
  if (selection?.dependencyMode !== "declared") return program;
  const selected = new Set(artifactKeys);
  const dependencies = selectPublishEntries(catalog, declaredArtifactKeys, { dependencyMode: "dependencies" }).filter(
    (entry) => !selected.has(entry.source.artifactKey),
  );
  const blockers = await dependencyDeliveryBlockers(repoRoot, dependencies);
  return blockers.length === 0 ? program : { ...program, blockers: [...program.blockers, ...blockers] };
}

async function dependencyDeliveryBlockers(repoRoot: string, dependencies: readonly SourceCatalogEntry[]): Promise<UiPublishBlocker[]> {
  const blockers: UiPublishBlocker[] = [];
  for (const dependency of dependencies) {
    const source = dependency.source;
    const statePath = deliveryStatePath(source.artifactKey);
    let state: ReturnType<typeof parseDeliveryState> | undefined;
    try {
      state = parseDeliveryState(JSON.parse(await readFile(join(repoRoot, ...statePath.split("/")), "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    let reason: string | undefined;
    if (!state) reason = "没有 DeliveryState";
    else {
      const prefabPath = artifactPrefabPath(artifactSourceIdentity(dependency));
      if (!(await prefabExists(repoRoot, prefabPath))) reason = "缺少正式 Prefab";
    }
    if (reason)
      blockers.push({
        code: "publish.dependencyNotDelivered",
        artifactKey: source.artifactKey,
        message: `依赖 '${source.artifactKey}' ${reason}；请发布当前声明的 Artifact 及其依赖`,
      });
  }
  return blockers;
}
