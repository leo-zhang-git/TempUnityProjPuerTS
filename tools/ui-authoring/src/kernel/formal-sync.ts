import type { UiSource } from "../schema/ui-source-schema.js";
import { type DeliveryState, parseDeliveryState } from "./delivery-state.js";
import type { PrefabObservation, PrefabReconcilePatch, PrefabReconcileResult } from "./prefab-observation.js";

type FormalSyncStatus = "matches" | "differs" | "missing";
type FormalDiffCategory = "safe" | "review" | "unity-only";

interface FormalSyncDiffEntry {
  readonly category: FormalDiffCategory;
  readonly path: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly message?: string;
}

export interface FormalSyncState {
  readonly artifactKey: string;
  readonly status: FormalSyncStatus;
  readonly changes: readonly FormalSyncDiffEntry[];
}

export function deriveFormalSyncState(
  source: UiSource,
  formalObservation?: PrefabObservation,
  reconcile?: PrefabReconcileResult,
): FormalSyncState {
  if (!formalObservation) return { artifactKey: source.artifactKey, status: "missing", changes: [] };
  const changes = classifyChanges(reconcile, formalObservation);
  const differs = changes.length > 0 || formalObservation.issues.length > 0 || (reconcile?.issues.length ?? 0) > 0;
  return {
    artifactKey: source.artifactKey,
    status: differs ? "differs" : "matches",
    changes,
  };
}

export function createDeliveryState(source: UiSource, formal: PrefabObservation): DeliveryState {
  if (source.artifactKey !== formal.artifactKey) throw new Error("DeliveryState Artifact identity mismatch");
  if (!formal.prefabGuid) throw new Error("Formal observation is missing prefabGuid");
  return parseDeliveryState({
    prefabGuid: formal.prefabGuid,
    nodes: Object.fromEntries(
      formal.nodes.map((node) => {
        if (!node.localFileId) throw new Error(`Formal observation node '${node.id}' is missing localFileId`);
        return [node.id, node.localFileId];
      }),
    ),
  });
}

function classifyChanges(reconcile: PrefabReconcileResult | undefined, observation: PrefabObservation): FormalSyncDiffEntry[] {
  const result = (reconcile?.patches ?? []).map(patchEntry);
  for (const node of observation.nodes) {
    if (node.unityOnlyComponents.length === 0) continue;
    result.push({
      category: "unity-only",
      path: `/nodes/${node.id}`,
      after: node.unityOnlyComponents,
      message: "Unity-owned components are outside Source semantics",
    });
  }
  return result;
}

function patchEntry(patch: PrefabReconcilePatch): FormalSyncDiffEntry {
  return {
    category: patch.risk,
    path: `/nodes/${patch.nodeId}/${patch.field.replaceAll(".", "/")}`,
    before: patch.expected,
    after: patch.observed,
  };
}
