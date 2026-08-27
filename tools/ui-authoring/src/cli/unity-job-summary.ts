import type { UiPublishTouchedPaths, UiUnityJobResult, UiUnityJobSnapshot } from "../schema/ui-unity-job.js";

export function summarizeUnityJob(job: UiUnityJobSnapshot): object {
  return {
    id: job.id,
    kind: job.kind,
    artifactKey: job.artifactKey,
    status: job.status,
    stage: job.stage,
    message: job.message,
    ...(job.result ? { result: summarizeResult(job.result) } : {}),
    ...(job.error ? { error: job.error } : {}),
    ...(job.residualPaths ? { residualPathCounts: touchedPathCounts(job.residualPaths) } : {}),
  };
}

function summarizeResult(result: UiUnityJobResult): object {
  switch (result.kind) {
    case "import":
      return {
        kind: result.kind,
        prefabPath: result.prefabPath,
        sourcePath: result.sourcePath,
        written: result.written,
        patchCount: result.patches.length,
        blockers: result.blockers,
        diagnostics: result.diagnostics,
        unityOnlyComponentCount: unityOnlyComponentCount(result.unityOnlyComponents),
        imports: result.imports.map((entry) => ({
          prefabPath: entry.prefabPath,
          sourcePath: entry.sourcePath,
          patchCount: entry.patches.length,
          blockers: entry.blockers,
          diagnostics: entry.diagnostics,
          unityOnlyComponentCount: unityOnlyComponentCount(entry.unityOnlyComponents),
        })),
      };
    case "reconcile":
      return {
        kind: result.kind,
        scope: result.scope,
        artifacts: result.artifacts,
        entries: result.entries.map((entry) => ({
          artifactKey: entry.artifactKey,
          state: entry.state.status,
          changeCount: entry.state.changes.length,
          patchCount: entry.patches.length,
          reviewPatchCount: entry.patches.filter((patch) => patch.risk === "review").length,
          issues: entry.issues,
          diagnostics: entry.diagnostics ?? [],
          unityOnlyComponentCount: unityOnlyComponentCount(entry.unityOnlyComponents),
        })),
      };
    case "sync":
      return {
        kind: result.kind,
        prefabPath: result.prefabPath,
        state: result.state.status,
        changeCount: result.state.changes.length,
        patchCount: result.patches.length,
        reviewPatchCount: result.patches.filter((patch) => patch.risk === "review").length,
        issues: result.issues,
        hasObservation: result.observation !== undefined,
        hasDeliveryState: result.deliveryState !== undefined,
      };
    case "publish":
      return {
        kind: result.kind,
        delivery: result.delivery,
        artifacts: result.artifacts,
        affectedCanvases: result.affectedCanvases,
        blockers: result.blockers,
        scaffoldPlan: result.scaffoldPlan,
        ...(result.noOp !== undefined ? { noOp: result.noOp } : {}),
        imports: (result.imports ?? []).map((entry) => ({
          prefabPath: entry.prefabPath,
          noOp: entry.noOp,
          nodeCount: entry.nodeCount,
          createdNodes: entry.createdNodes,
          reusedNodes: entry.reusedNodes,
          removedNodes: entry.removedNodes,
          bindingCount: entry.bindingCount,
          auditIssues: entry.auditIssues,
          baselineIssues: entry.baselineIssues,
        })),
        generatedInventoryCount: result.generatedInventory?.length ?? 0,
        ...(result.touchedPaths ? { touchedPathCounts: touchedPathCounts(result.touchedPaths) } : {}),
        deliveryStateCount: result.deliveryStates?.length ?? 0,
      };
  }
}

function unityOnlyComponentCount(entries: readonly { readonly componentTypes: readonly string[] }[]): number {
  return entries.reduce((count, entry) => count + entry.componentTypes.length, 0);
}

function touchedPathCounts(paths: UiPublishTouchedPaths): object {
  return {
    svnDeliverables: paths.svnDeliverables.length,
    gitDeliverables: paths.gitDeliverables.length,
    preExistingUnrelated: paths.preExistingUnrelated.length,
  };
}
