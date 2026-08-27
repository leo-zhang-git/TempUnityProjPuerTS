import { deliveryStatePath } from "../../kernel/delivery-state.js";
import { createDeliveryState, deriveFormalSyncState } from "../../kernel/formal-sync.js";
import type { PrefabObservation } from "../../kernel/prefab-observation.js";
import { applyPrefabReconcilePatches, parsePrefabObservation, reconcilePrefabObservation } from "../../kernel/prefab-observation.js";
import { artifactPrefabPath, artifactSourceIdentity } from "../../kernel/prefab-path.js";
import type { UnityProjection } from "../../kernel/projection.js";
import type { SourceCatalogEntry } from "../../kernel/source-catalog.js";
import { applyVariantPrefabReconcile, reconcileVariantPrefabObservation } from "../../kernel/variant-prefab-observation.js";
import type { UiSource } from "../../schema/ui-source-schema.js";
import type {
  UiPublishBlocker,
  UiUnityImportResult,
  UiUnityJobResult,
  UiUnityPublishJobResult,
  UiUnityReconcileEntry,
} from "../../schema/ui-unity-job.js";
import type { UnityBridgeResponse } from "./contracts.js";

export function reconcileProjectionObservation(
  source: UiSource,
  projection: UnityProjection,
  baseProjection: UnityProjection | undefined,
  observation: ReturnType<typeof parsePrefabObservation>,
  artifactKeyByPrefabPath: ReadonlyMap<string, string>,
) {
  return source.sourceKind === "variant"
    ? reconcileVariantPrefabObservation(source, baseProjection!, projection, observation, { artifactKeyByPrefabPath })
    : reconcilePrefabObservation(source, projection, observation, { artifactKeyByPrefabPath });
}

export function reconcileEntryResult(
  entry: SourceCatalogEntry,
  projection: UnityProjection,
  baseProjection: UnityProjection | undefined,
  observation: PrefabObservation,
  artifactKeyByPrefabPath: ReadonlyMap<string, string>,
): UiUnityReconcileEntry {
  const source = entry.source;
  const reconcile = reconcileProjectionObservation(source, projection, baseProjection, observation, artifactKeyByPrefabPath);
  const issues = [...reconcile.issues];
  const state = deriveFormalSyncState(source, observation, reconcile as ReturnType<typeof reconcilePrefabObservation>);
  let next: UiSource = source;
  if (issues.length === 0) {
    next =
      source.sourceKind === "variant"
        ? applyVariantPrefabReconcile(source, reconcile as ReturnType<typeof reconcileVariantPrefabObservation>)
        : applyPrefabReconcilePatches(source, reconcile as ReturnType<typeof reconcilePrefabObservation>);
  }
  return {
    artifactKey: source.artifactKey,
    sourcePath: entry.path,
    prefabPath: projection.prefabPath,
    state,
    patches: reconcile.patches,
    issues,
    diagnostics: reconcile.diagnostics,
    unityOnlyComponents: reconcile.unityOnlyComponents,
    beforeSource: source,
    source: issues.length === 0 ? next : source,
  };
}

export function syncResult(
  source: UiSource,
  projection: UnityProjection,
  baseProjection: UnityProjection | undefined,
  response: UnityBridgeResponse,
  artifactKeyByPrefabPath: ReadonlyMap<string, string>,
): UiUnityJobResult {
  const observation = parsePrefabObservation(response.observation);
  const reconcile = reconcileProjectionObservation(source, projection, baseProjection, observation, artifactKeyByPrefabPath);
  let observedDeliveryState: ReturnType<typeof createDeliveryState> | undefined;
  try {
    observedDeliveryState = createDeliveryState(source, observation);
  } catch {
    observedDeliveryState = undefined;
  }
  return {
    kind: "sync",
    prefabPath: projection.prefabPath,
    state: deriveFormalSyncState(source, observation, reconcile as ReturnType<typeof reconcilePrefabObservation>),
    patches: reconcile.patches,
    issues: reconcile.issues,
    observation,
    ...(observedDeliveryState ? { deliveryState: observedDeliveryState } : {}),
  };
}

export function syncMessage(result: UiUnityJobResult): string {
  if (result.kind !== "sync") return "Formal sync check complete";
  return `Formal sync: ${result.state.status}`;
}

export function publishPayload(response: UnityBridgeResponse): Record<string, unknown> {
  if (!response.publish || typeof response.publish !== "object" || Array.isArray(response.publish))
    throw new Error("Unity Publish response is missing its payload");
  return response.publish as Record<string, unknown>;
}

export function publishBlockerArray(value: unknown): UiPublishBlocker[] {
  if (!Array.isArray(value)) throw new Error("Unity Publish blockers must be an array");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`Unity Publish blocker ${index} is invalid`);
    const blocker = entry as Record<string, unknown>;
    if (typeof blocker.code !== "string" || typeof blocker.message !== "string")
      throw new Error(`Unity Publish blocker ${index} is missing code or message`);
    return {
      code: blocker.code,
      message: blocker.message,
      ...(typeof blocker.artifactKey === "string" ? { artifactKey: blocker.artifactKey } : {}),
      ...(typeof blocker.path === "string" ? { path: blocker.path } : {}),
    };
  });
}

export function observationArray(value: unknown, count: number, allowNull: false): ReturnType<typeof parsePrefabObservation>[];
export function observationArray(value: unknown, count: number, allowNull: true): (ReturnType<typeof parsePrefabObservation> | undefined)[];
export function observationArray(
  value: unknown,
  count: number,
  allowNull: boolean,
): (ReturnType<typeof parsePrefabObservation> | undefined)[] {
  if (!Array.isArray(value) || value.length !== count)
    throw new Error(`Unity Publish returned ${Array.isArray(value) ? value.length : 0} observations; expected ${count}`);
  return value.map((entry, index) => {
    if (entry === null && allowNull) return undefined;
    try {
      return parsePrefabObservation(entry);
    } catch (error) {
      throw new Error(`Unity Publish observation ${index} is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

export function stringArray(value: unknown, owner: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    throw new Error(`Unity Publish ${owner} must be a string array`);
  return [...new Set(value)].sort();
}

export function importArray(value: unknown): UiUnityImportResult[] {
  if (!Array.isArray(value)) throw new Error("Unity Publish imports must be an array");
  return value as UiUnityImportResult[];
}

export function publishTouchedPaths(
  sources: readonly SourceCatalogEntry[],
  expectedBindings: readonly string[],
  scaffoldPaths: readonly string[] = [],
): NonNullable<UiUnityPublishJobResult["touchedPaths"]> {
  const svnDeliverables = sources.flatMap((entry) => {
    const prefab = artifactPrefabPath(artifactSourceIdentity(entry));
    return [
      `My project/UIAuthoring/Sources/${entry.path}`,
      deliveryStatePath(entry.source.artifactKey),
      `My project/${prefab}`,
      `My project/${prefab}.meta`,
      ...formalParentDirectoryMetaPaths(prefab),
    ];
  });
  return {
    svnDeliverables: [...new Set(svnDeliverables)].sort(),
    gitDeliverables: [...new Set([...expectedBindings, ...scaffoldPaths])].sort(),
    preExistingUnrelated: [],
  };
}

export function mergeActualPublishTouchedPaths(
  predicted: NonNullable<UiUnityPublishJobResult["touchedPaths"]>,
  workspaceChanges: readonly string[],
  preExistingUnrelated: readonly string[],
): NonNullable<UiUnityPublishJobResult["touchedPaths"]> {
  const unrelated = new Set(preExistingUnrelated);
  const attributable = workspaceChanges.filter((path) => !unrelated.has(path));
  return {
    svnDeliverables: [
      ...new Set([...predicted.svnDeliverables, ...attributable.filter((path) => path.startsWith("My project/"))]),
    ].sort(),
    gitDeliverables: [
      ...new Set([...predicted.gitDeliverables, ...attributable.filter((path) => !path.startsWith("My project/"))]),
    ].sort(),
    preExistingUnrelated,
  };
}

function formalParentDirectoryMetaPaths(prefabPath: string): string[] {
  const result: string[] = [];
  let directory = prefabPath.slice(0, prefabPath.lastIndexOf("/"));
  while (directory !== "Assets/Resources/UI/Prefab") {
    result.push(`My project/${directory}.meta`);
    directory = directory.slice(0, directory.lastIndexOf("/"));
  }
  return result;
}
