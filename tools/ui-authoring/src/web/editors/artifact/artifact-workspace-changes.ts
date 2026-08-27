import { createSemanticDiff, type SemanticChange } from "../../../kernel/semantic.js";
import type { WorkspaceArtifactMap } from "./artifact-workspace-state.js";

export function artifactNodeChangeKinds(
  saved: WorkspaceArtifactMap,
  current: WorkspaceArtifactMap,
  artifactKey: string,
): ReadonlyMap<string, "added" | "modified"> {
  const previous = saved.get(artifactKey)?.source;
  const next = current.get(artifactKey)?.source;
  if (!previous || !next || previous.sourceKind !== "artifact" || next.sourceKind !== "artifact") return new Map();
  const result = new Map<string, "added" | "modified">();
  for (const change of createSemanticDiff(previous, next).changes) {
    if (change.kind === "nodeRemoved") continue;
    const nodeId = semanticNodeId(change);
    if (!nodeId) continue;
    result.set(nodeId, change.kind === "nodeAdded" ? "added" : "modified");
  }
  return result;
}

function semanticNodeId(change: SemanticChange): string | undefined {
  if (change.kind === "sourceFieldUpdated") return undefined;
  return change.kind === "nodeRenamed" ? change.afterNodeId : change.nodeId;
}
