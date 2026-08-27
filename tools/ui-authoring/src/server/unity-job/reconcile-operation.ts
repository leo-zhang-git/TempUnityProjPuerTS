import { join } from "node:path";
import { deriveFormalSyncState } from "../../kernel/formal-sync.js";
import type { PrefabObservation } from "../../kernel/prefab-observation.js";
import { parsePrefabObservation } from "../../kernel/prefab-observation.js";
import { artifactPrefabPath, artifactSourceIdentity } from "../../kernel/prefab-path.js";
import { createUnityProjectionGraph } from "../../kernel/projection-graph.js";
import type { SourceCatalogEntry } from "../../kernel/source-catalog.js";
import { createSourceCatalog } from "../../kernel/source-catalog.js";
import type { UiReconcileRequest, UiReconcileScope, UiUnityReconcileEntry, UiUnityReconcileJobResult } from "../../schema/ui-unity-job.js";
import { selectArtifactEntries } from "../artifact-selection.js";
import type { UnityBridgeRequest } from "./contracts.js";
import { atomicWrite } from "./executor.js";
import type { MutableUnityJob, PreparedProjectionGraph, UnityJobOperationContext } from "./operation-context.js";
import { prefabExists, repoRelative } from "./operation-support.js";
import { initializeProgress } from "./progress.js";
import { reconcileEntryResult } from "./result-parsing.js";

export async function runReconcileOperation(
  context: UnityJobOperationContext,
  job: MutableUnityJob,
  request: UiReconcileRequest,
  scope: UiReconcileScope,
): Promise<void> {
  try {
    report(context, job, "reconcile.prepare", "确定回写范围", "running", 0, 1);
    context.update(job, { status: "running", stage: "projection", message: "正在生成回写范围的 Unity 投影" });
    const catalog = await context.repository.strictSourceCatalog({ source: request.source });
    const selectedEntries =
      scope === "all"
        ? [...catalog.entries.values()].sort((left, right) => left.path.localeCompare(right.path))
        : selectArtifactEntries(
            catalog,
            [request.source.artifactKey],
            request.selection ?? {
              dependencyMode: scope === "dependencies" ? "dependencies" : "declared",
            },
            "Prefab 回写",
          );
    context.update(job, {
      progress: initializeProgress(
        job,
        [
          { id: "reconcile.prepare", label: "检查回写目标", total: Math.max(1, selectedEntries.length) },
          { id: "reconcile.projection", label: "生成 Unity Projection", total: Math.max(1, selectedEntries.length) },
          { id: "reconcile.unity-observe", label: "读取正式 Prefab", total: Math.max(1, selectedEntries.length) },
          { id: "reconcile.analyze", label: "分析 Unity 改动", total: Math.max(1, selectedEntries.length) },
        ],
        ["reconcile.prepare"],
      ),
    });
    const available: SourceCatalogEntry[] = [];
    const missing = new Set<string>();
    for (let index = 0; index < selectedEntries.length; index += 1) {
      const entry = selectedEntries[index]!;
      report(context, job, "reconcile.prepare", "检查回写目标", "running", index, selectedEntries.length, entry.source.artifactKey);
      const prefabPath = artifactPrefabPath(artifactSourceIdentity(entry));
      if (await prefabExists(context.paths.repoRoot, prefabPath)) available.push(entry);
      else missing.add(entry.source.artifactKey);
      report(
        context,
        job,
        "reconcile.prepare",
        "检查回写目标",
        index + 1 >= selectedEntries.length ? "succeeded" : "running",
        index + 1,
        selectedEntries.length,
        entry.source.artifactKey,
      );
    }
    const entries = scope === "all" ? available : selectedEntries;
    if (scope === "all") {
      context.update(job, {
        progress: initializeProgress(
          job,
          [
            { id: "reconcile.prepare", label: "检查回写目标", total: Math.max(1, selectedEntries.length) },
            { id: "reconcile.projection", label: "生成 Unity Projection", total: Math.max(1, entries.length) },
            { id: "reconcile.unity-observe", label: "读取正式 Prefab", total: Math.max(1, entries.length) },
            { id: "reconcile.analyze", label: "分析 Unity 改动", total: Math.max(1, entries.length) },
          ],
          ["reconcile.prepare"],
        ),
      });
    }

    const observations = new Map<string, PrefabObservation>();
    let prepared: PreparedProjectionGraph | undefined;
    if (available.length > 0) {
      prepared = await context.preparePublishEntries(job.snapshot.id, catalog, available, (completed, total, artifactKey) =>
        report(
          context,
          job,
          "reconcile.projection",
          "生成 Unity Projection",
          completed >= total ? "succeeded" : "running",
          completed,
          total,
          artifactKey,
        ),
      );
      const directory = context.jobDirectory(job.snapshot.id);
      const requestPath = join(directory, "request.json");
      const resultPath = join(directory, "result.json");
      const logPath = join(directory, "unity.log");
      const bridgeRequest: UnityBridgeRequest = {
        jobId: job.snapshot.id,
        kind: "observe-plan",
        projectionPaths: prepared.contextPaths,
        deliveryStatePaths: await context.deliveryStatePaths(prepared.contextSources),
        artifactKeys: available.map((entry) => entry.source.artifactKey),
        resultPath: repoRelative(context.paths.repoRoot, resultPath),
      };
      await atomicWrite(requestPath, `${JSON.stringify(bridgeRequest, null, 2)}\n`);
      context.update(job, { status: "running", stage: "unity", message: `正在读取 ${available.length} 个正式 Prefab` });
      const bridge = await context.executor.execute(
        repoRelative(context.paths.repoRoot, requestPath),
        repoRelative(context.paths.repoRoot, resultPath),
        logPath,
        context.signal,
        (progress) => context.reportProgress(job, progress),
      );
      if (!bridge.ok) throw new Error(bridge.error || "Unity reconcile plan failed");
      for (const raw of bridge.observations ?? []) {
        const observation = parsePrefabObservation(raw);
        if (observations.has(observation.artifactKey))
          throw new Error(`Unity reconcile returned duplicate observation '${observation.artifactKey}'`);
        observations.set(observation.artifactKey, observation);
      }
    } else {
      report(context, job, "reconcile.projection", "生成 Unity Projection", "succeeded", 1, 1);
      report(context, job, "reconcile.unity-observe", "读取正式 Prefab", "succeeded", 1, 1);
    }

    const results: UiUnityReconcileEntry[] = [];
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex]!;
      const source = entry.source;
      report(context, job, "reconcile.analyze", "分析 Unity 改动", "running", entryIndex, entries.length, source.artifactKey);
      const prefabPath = artifactPrefabPath(artifactSourceIdentity(entry));
      if (missing.has(source.artifactKey)) {
        results.push({
          artifactKey: source.artifactKey,
          sourcePath: entry.path,
          prefabPath,
          state: deriveFormalSyncState(source),
          patches: [],
          issues: [`正式 Prefab '${prefabPath}' 不存在；请先发布，再拉取 Unity 改动`],
          unityOnlyComponents: [],
          beforeSource: source,
          source,
        });
        report(
          context,
          job,
          "reconcile.analyze",
          "分析 Unity 改动",
          entryIndex + 1 >= entries.length ? "succeeded" : "running",
          entryIndex + 1,
          entries.length,
          source.artifactKey,
        );
        continue;
      }
      const observation = observations.get(source.artifactKey);
      const projection = prepared?.projections.find((item) => item.artifactKey === source.artifactKey);
      if (!observation || !projection) throw new Error(`Unity reconcile did not return observation '${source.artifactKey}'`);
      const baseProjection =
        source.sourceKind === "variant" ? createUnityProjectionGraph(catalog, source.variantOf).at(-1)?.projection : undefined;
      results.push(reconcileEntryResult(entry, projection, baseProjection, observation, prepared!.artifactKeyByPrefabPath));
      report(
        context,
        job,
        "reconcile.analyze",
        "分析 Unity 改动",
        entryIndex + 1 >= entries.length ? "succeeded" : "running",
        entryIndex + 1,
        entries.length,
        source.artifactKey,
      );
    }

    const replacements = new Map(results.filter((entry) => entry.issues.length === 0).map((entry) => [entry.artifactKey, entry.source]));
    try {
      createSourceCatalog(
        [...catalog.entries.values()].map((entry) => ({
          path: entry.path,
          source: replacements.get(entry.source.artifactKey) ?? entry.source,
        })),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (let index = 0; index < results.length; index += 1) {
        const entry = results[index]!;
        if (entry.patches.length > 0 && entry.issues.length === 0)
          results[index] = { ...entry, issues: [message], source: entry.beforeSource };
      }
    }

    const result: UiUnityReconcileJobResult = {
      kind: "reconcile",
      scope,
      artifacts: results.map((entry) => entry.artifactKey),
      entries: results,
    };
    const issueCount = results.reduce((count, entry) => count + entry.issues.length, 0);
    const patchCount = results.reduce((count, entry) => count + entry.patches.length, 0);
    context.update(job, {
      status: "succeeded",
      stage: issueCount > 0 ? "blocked" : "complete",
      message: issueCount > 0 ? `Prefab 回写被 ${issueCount} 个问题阻断` : `发现 ${patchCount} 项 Unity 改动`,
      result,
    });
  } catch (error) {
    context.update(job, {
      status: "failed",
      stage: "failed",
      message: "Prefab 回写失败",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function report(
  context: UnityJobOperationContext,
  job: MutableUnityJob,
  id: string,
  label: string,
  status: "running" | "succeeded",
  completed: number,
  total: number,
  currentItem?: string,
): void {
  context.reportProgress(job, { id, label, status, completed, total, ...(currentItem ? { currentItem } : {}) });
}
