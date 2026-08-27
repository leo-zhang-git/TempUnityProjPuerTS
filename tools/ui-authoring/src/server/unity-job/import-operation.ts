import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createArtifactSource } from "../../kernel/authoring.js";
import { importPrefabObservation } from "../../kernel/prefab-import.js";
import type { PrefabObservation } from "../../kernel/prefab-observation.js";
import { parsePrefabObservation } from "../../kernel/prefab-observation.js";
import {
  type ArtifactSourceIdentity,
  artifactPrefabPath,
  artifactSourceIdentity,
  artifactSourceIdentityFromPath,
  assertArtifactPrefabPath,
} from "../../kernel/prefab-path.js";
import { createUnityProjection, formatProjection } from "../../kernel/projection.js";
import type { SourceCatalog } from "../../kernel/source-catalog.js";
import { createSourceCatalog } from "../../kernel/source-catalog.js";
import type { UiSource } from "../../schema/ui-source-schema.js";
import type { UiPrefabImportEntry, UiPrefabImportJobResult, UiPrefabImportRequest } from "../../schema/ui-unity-job.js";
import { writeArtifactTransaction } from "../artifact-transaction.js";
import { loadSourceCatalogInputs } from "../source-catalog.js";
import type { UnityBridgeRequest } from "./contracts.js";
import { atomicWrite, pathExists, repositoryPath } from "./executor.js";
import type { MutableUnityJob, UnityJobOperationContext } from "./operation-context.js";
import { repoRelative } from "./operation-support.js";

export class ImportOperation {
  constructor(readonly context: UnityJobOperationContext) {}

  async run(job: MutableUnityJob, request: UiPrefabImportRequest): Promise<void> {
    try {
      this.#progress(job, "import.prepare", "检查导入目标", "running", 0, 1);
      this.context.update(job, { status: "running", stage: "projection", message: "正在准备 Prefab 导入观察数据" });
      const prefabPath = normalizePrefabImportPath(request.prefabPath);
      const identity = artifactSourceIdentityFromPath(request.sourcePath);
      const sourcePath = identity.path;
      assertArtifactPrefabPath(prefabPath, identity);
      const sourceFile = join(this.context.paths.sourceRoot, ...sourcePath.split("/"));
      if (await pathExists(sourceFile)) throw new Error(`Prefab Import Source '${sourcePath}' already exists; use Pull Unity Changes`);

      const initialCatalog = await this.context.repository.strictSourceCatalog();
      if (initialCatalog.entries.has(identity.artifactKey))
        throw new Error(`Prefab Import artifact '${identity.artifactKey}' already has Source; use Pull Unity Changes`);
      this.#progress(job, "import.prepare", "检查导入目标", "succeeded", 1, 1, identity.artifactKey);
      const existingArtifactKeyByPrefabPath = new Map(
        [...initialCatalog.entries.values()].map(
          (entry) => [artifactPrefabPath(artifactSourceIdentity(entry)), entry.source.artifactKey] as const,
        ),
      );
      const observations: PrefabObservation[] = [];
      const visitState = new Map<string, "visiting" | "done">();
      const active: string[] = [];
      let observationSequence = 0;
      const collect = async (currentPrefabPath: string, currentSourceIdentity: ArtifactSourceIdentity): Promise<void> => {
        if (existingArtifactKeyByPrefabPath.has(currentPrefabPath)) return;
        const state = visitState.get(currentPrefabPath);
        if (state === "done") return;
        if (state === "visiting") {
          const cycleStart = active.indexOf(currentPrefabPath);
          throw new Error(
            `Circular Prefab Variant base chain: ${[...active.slice(Math.max(cycleStart, 0)), currentPrefabPath].join(" -> ")}`,
          );
        }
        visitState.set(currentPrefabPath, "visiting");
        active.push(currentPrefabPath);
        this.#progress(
          job,
          "import.unity-observe",
          "读取现有 Prefab",
          "running",
          observationSequence,
          observationSequence + 1,
          currentSourceIdentity.artifactKey,
        );
        const observation = await this.#observeImportPrefab(
          job,
          currentPrefabPath,
          currentSourceIdentity,
          initialCatalog,
          observationSequence++,
        );
        this.#progress(
          job,
          "import.unity-observe",
          "读取现有 Prefab",
          "succeeded",
          observationSequence,
          observationSequence,
          currentSourceIdentity.artifactKey,
        );
        if (observation.prefabPath !== currentPrefabPath) {
          throw new Error(`Prefab Import observation path mismatch expected=${currentPrefabPath} observed=${observation.prefabPath}`);
        }
        if (observation.basePrefabPath && !existingArtifactKeyByPrefabPath.has(observation.basePrefabPath)) {
          const baseKey = prefabArtifactKey(observation.basePrefabPath);
          const baseSourceIdentity = artifactSourceIdentityFromPath(siblingImportSourcePath(sourcePath, baseKey));
          assertArtifactPrefabPath(observation.basePrefabPath, baseSourceIdentity);
          await collect(observation.basePrefabPath, baseSourceIdentity);
        }
        active.pop();
        visitState.set(currentPrefabPath, "done");
        observations.push(observation);
      };
      await collect(prefabPath, identity);

      let catalog = initialCatalog;
      const pendingInputs: Array<{ readonly path: string; readonly source: UiSource }> = [];
      const imports: UiPrefabImportEntry[] = [];
      for (let observationIndex = 0; observationIndex < observations.length; observationIndex += 1) {
        const observation = observations[observationIndex]!;
        this.#progress(
          job,
          "import.analyze",
          "生成 Source 候选",
          "running",
          observationIndex,
          observations.length,
          observation.artifactKey,
        );
        const currentSourcePath =
          observation.prefabPath === prefabPath ? sourcePath : siblingImportSourcePath(sourcePath, observation.artifactKey);
        const artifactKeyByPrefabPath = new Map(
          [...catalog.entries.values()].map(
            (entry) => [artifactPrefabPath(artifactSourceIdentity(entry)), entry.source.artifactKey] as const,
          ),
        );
        const imported = importPrefabObservation(observation, {
          sourceIdentity: artifactSourceIdentityFromPath(currentSourcePath),
          ...(observation.prefabPath === prefabPath && request.initialSize ? { initialSize: request.initialSize } : {}),
          catalog,
          artifactKeyByPrefabPath,
        });
        const targetExists = await pathExists(join(this.context.paths.sourceRoot, ...currentSourcePath.split("/")));
        const blockers = uniqueStrings([
          ...imported.blockers,
          ...(targetExists ? [`Prefab Import Source '${currentSourcePath}' already exists and is not the imported base Source`] : []),
          ...(!imported.observationHash ? [`Prefab Import observation for '${observation.prefabPath}' did not include rawPrefabHash`] : []),
        ]);
        const entry: UiPrefabImportEntry = {
          prefabPath: observation.prefabPath,
          sourcePath: currentSourcePath,
          source: imported.source,
          ...(imported.observationHash ? { observationHash: imported.observationHash } : {}),
          patches: imported.reconcile.patches,
          blockers,
          diagnostics: imported.diagnostics,
          unityOnlyComponents: imported.unityOnlyComponents,
        };
        imports.push(entry);
        if (blockers.length === 0) {
          pendingInputs.push({ path: currentSourcePath, source: imported.source });
          catalog = createSourceCatalog([
            ...[...initialCatalog.entries.values()].map((catalogEntry) => ({ path: catalogEntry.path, source: catalogEntry.source })),
            ...pendingInputs,
          ]);
        }
        this.#progress(
          job,
          "import.analyze",
          "生成 Source 候选",
          observationIndex + 1 >= observations.length ? "succeeded" : "running",
          observationIndex + 1,
          observations.length,
          observation.artifactKey,
        );
      }
      const root = imports.at(-1);
      if (!root || root.prefabPath !== prefabPath) throw new Error("Prefab Import did not produce the requested root Source");
      const blockers = uniqueStrings(imports.flatMap((entry) => entry.blockers));
      let written = false;
      if (request.write && blockers.length === 0) {
        this.#progress(job, "import.write", "写入 Source", "running", 0, imports.length, root.source.artifactKey);
        await writeArtifactTransaction(
          this.context.paths,
          imports.map((entry) => ({ path: entry.sourcePath, source: entry.source, expectedContent: null })),
          [],
          {
            validate: async () => {
              for (const entry of imports) {
                const prefabFile = repositoryPath(this.context.paths.repoRoot, `My project/${entry.prefabPath}`);
                if ((await fileDigest(prefabFile)) !== entry.observationHash) {
                  throw new Error(`Prefab Import target '${entry.prefabPath}' changed after observation; run Import again`);
                }
              }
              const currentInputs = await loadSourceCatalogInputs(this.context.paths.sourceRoot);
              createSourceCatalog([...currentInputs, ...imports.map((entry) => ({ path: entry.sourcePath, source: entry.source }))]);
            },
          },
        );
        written = true;
        this.#progress(job, "import.write", "写入 Source", "succeeded", imports.length, imports.length, root.source.artifactKey);
      } else {
        this.#progress(job, "import.write", "完成导入预览", "succeeded", 1, 1, root.source.artifactKey);
      }
      const result: UiPrefabImportJobResult = {
        kind: "import",
        prefabPath,
        sourcePath,
        source: root.source,
        ...(root.observationHash ? { observationHash: root.observationHash } : {}),
        patches: root.patches,
        blockers,
        diagnostics: imports.flatMap((entry) => entry.diagnostics),
        unityOnlyComponents: imports.flatMap((entry) => entry.unityOnlyComponents),
        imports,
        written,
      };
      this.context.update(job, {
        status: "succeeded",
        stage: blockers.length > 0 ? "blocked" : "complete",
        message:
          blockers.length > 0
            ? `Prefab Import blocked by ${blockers.length} issue(s)`
            : written
              ? `${imports.length} Prefab Source(s) imported`
              : `${imports.length} Prefab Import preview(s) ready`,
        result,
      });
    } catch (error) {
      this.context.update(job, {
        status: "failed",
        stage: "failed",
        message: "Prefab 导入失败",
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
    this.context.reportProgress(job, {
      id,
      label,
      status,
      completed,
      total: Math.max(1, total),
      ...(currentItem ? { currentItem } : {}),
    });
  }

  async #observeImportPrefab(
    job: MutableUnityJob,
    prefabPath: string,
    sourceIdentity: ArtifactSourceIdentity,
    catalog: SourceCatalog,
    observationIndex: number,
  ): Promise<PrefabObservation> {
    const prefabFile = repositoryPath(this.context.paths.repoRoot, `My project/${prefabPath}`);
    if (!(await pathExists(prefabFile))) throw new Error(`Prefab Import target '${prefabPath}' does not exist`);
    assertArtifactPrefabPath(prefabPath, sourceIdentity);
    const bootstrap = createArtifactSource({ artifactKey: sourceIdentity.artifactKey, artifactType: "Fragment", initialSize: [100, 100] });
    const bootstrapCatalog = createSourceCatalog([
      ...[...catalog.entries.values()].map((entry) => ({ path: entry.path, source: entry.source })),
      { path: sourceIdentity.path, source: bootstrap },
    ]);
    const projections = [
      ...[...catalog.entries.values()].map((entry) => createUnityProjection(entry, catalog)),
      createUnityProjection(bootstrapCatalog.entries.get(sourceIdentity.artifactKey)!, bootstrapCatalog),
    ];
    const directory = join(this.context.jobDirectory(job.snapshot.id), `observe-${observationIndex}`);
    const outputDirectory = join(directory, "projection");
    await mkdir(outputDirectory, { recursive: true });
    const projectionPaths: string[] = [];
    for (const projection of projections) {
      const outputPath = join(outputDirectory, `${projection.artifactKey}.projection.json`);
      await atomicWrite(outputPath, formatProjection(projection));
      projectionPaths.push(repoRelative(this.context.paths.repoRoot, outputPath));
    }
    const requestPath = join(directory, "request.json");
    const resultPath = join(directory, "result.json");
    const logPath = join(directory, "unity.log");
    const bridgeRequest: UnityBridgeRequest = {
      jobId: `${job.snapshot.id}:${observationIndex}`,
      kind: "observe",
      projectionPaths,
      deliveryStatePaths: projectionPaths.map(() => null),
      resultPath: repoRelative(this.context.paths.repoRoot, resultPath),
    };
    await atomicWrite(requestPath, `${JSON.stringify(bridgeRequest, null, 2)}\n`);
    this.context.update(job, { status: "running", stage: "unity", message: `正在读取现有 Prefab '${sourceIdentity.artifactKey}'` });
    const bridge = await this.context.executor.execute(
      repoRelative(this.context.paths.repoRoot, requestPath),
      repoRelative(this.context.paths.repoRoot, resultPath),
      logPath,
      this.context.signal,
    );
    if (!bridge.ok) throw new Error(bridge.error || "Unity Prefab Import observation failed");
    return parsePrefabObservation(bridge.observation);
  }
}

function normalizePrefabImportPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (
    !normalized.startsWith("Assets/Resources/UI/Prefab/") ||
    !normalized.endsWith(".prefab") ||
    normalized.includes("..") ||
    normalized.includes("//")
  ) {
  throw new Error(`Invalid Prefab Import path '${path}'`);
  }
  return normalized;
}

function prefabArtifactKey(prefabPath: string): string {
  const fileName = prefabPath.replaceAll("\\", "/").split("/").at(-1) ?? "";
  if (!fileName.endsWith(".prefab")) throw new Error(`Invalid Prefab Import path '${prefabPath}'`);
  return artifactSourceIdentityFromPath(`${fileName.slice(0, -".prefab".length)}.ui.json`).artifactKey;
}

function siblingImportSourcePath(rootSourcePath: string, artifactKey: string): string {
  const slash = rootSourcePath.lastIndexOf("/");
  return `${slash >= 0 ? rootSourcePath.slice(0, slash + 1) : ""}${artifactKey}.ui.json`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

async function fileDigest(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}
