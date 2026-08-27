import { applyAuthoringStructureOperation } from "../../../../kernel/authoring.js";
import { outermostNodeIds, walkNodes } from "../../../../kernel/tree.js";
import type { UiConcreteSource } from "../../../../schema/ui-source-schema.js";
import type { HierarchyDropPosition } from "../../shared/editor-hierarchy.js";

export function moveHierarchyNode(
  source: UiConcreteSource,
  nodeId: string,
  targetId: string,
  position: HierarchyDropPosition,
): UiConcreteSource {
  if (nodeId === targetId) return source;
  const entries = walkNodes(source);
  const sourceEntry = entries.find(({ node }) => node.id === nodeId);
  const targetEntry = entries.find(({ node }) => node.id === targetId);
  if (!sourceEntry) throw new Error(`Artifact '${source.artifactKey}' 中不存在节点 '${nodeId}'`);
  if (!targetEntry) throw new Error(`Artifact '${source.artifactKey}' 中不存在拖放目标 '${targetId}'`);
  if (!sourceEntry.parent) throw new Error("不能移动 Artifact 根节点");

  if (position === "inside") return applyAuthoringStructureOperation(source, { kind: "move", nodeId, parentId: targetId }).source;
  if (!targetEntry.parent) throw new Error("节点不能与 Artifact 根节点并列");
  const targetIndex = targetEntry.parent.children?.findIndex((child) => child.id === targetId) ?? -1;
  const sourceIndex = sourceEntry.parent.children?.findIndex((child) => child.id === nodeId) ?? -1;
  if (targetIndex < 0 || sourceIndex < 0) throw new Error("Hierarchy 同级位置无效");
  let insertIndex = targetIndex + (position === "after" ? 1 : 0);
  if (sourceEntry.parent.id === targetEntry.parent.id && sourceIndex < insertIndex) insertIndex -= 1;
  return applyAuthoringStructureOperation(source, { kind: "move", nodeId, parentId: targetEntry.parent.id, index: insertIndex }).source;
}

export function moveHierarchyNodes(
  source: UiConcreteSource,
  nodeIds: readonly string[],
  targetId: string,
  position: HierarchyDropPosition,
): UiConcreteSource {
  const entries = walkNodes(source);
  for (const nodeId of new Set(nodeIds)) {
    if (!entries.some(({ node }) => node.id === nodeId)) throw new Error(`Artifact '${source.artifactKey}' 中不存在节点 '${nodeId}'`);
  }
  const roots = outermostNodeIds(source, nodeIds);
  if (roots.length === 0) throw new Error("至少选择一个可移动节点");
  const targetEntry = entries.find(({ node }) => node.id === targetId);
  if (!targetEntry) throw new Error(`Artifact '${source.artifactKey}' 中不存在拖放目标 '${targetId}'`);
  const movedRoots = new Set(roots);
  if (roots.includes(source.root.id)) throw new Error("不能移动 Artifact 根节点");
  if (roots.length === 1 && roots[0] === targetId) return source;
  if (targetEntry.path.some((nodeId) => movedRoots.has(nodeId))) throw new Error("不能将选中节点移动到自身或其子树");

  const orderedRoots = position === "after" ? [...roots].reverse() : roots;
  return orderedRoots.reduce((current, nodeId) => moveHierarchyNode(current, nodeId, targetId, position), source);
}
