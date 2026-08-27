import type { EvaluatedNode } from "../../../kernel/layout.js";
import type { ResolvedPreviewInstance } from "../../../kernel/preview-reference-resolver.js";

export type RenderOrderInstance = Pick<ResolvedPreviewInstance, "instanceKey" | "instancePath" | "placement">;

export type ResolvedInstanceRenderOrderEntry<T extends RenderOrderInstance> =
  | { readonly kind: "node"; readonly nodeId: string }
  | { readonly kind: "instance"; readonly instance: T; readonly layoutNodeId?: string };

interface VisibleNodeEntry {
  readonly node: { readonly id: string };
}

function generatedLayoutNodeId(instance: RenderOrderInstance): string | undefined {
  if (instance.placement.kind === "collection") return instance.instancePath.at(-1);
  if (instance.placement.kind === "mount") return `__mountLayout_${encodeURIComponent(instance.placement.mountKey)}`;
  return undefined;
}

function isGeneratedLayoutNode(nodeId: string): boolean {
  return nodeId.startsWith("__collection_") || nodeId.startsWith("__mountLayout_");
}

function subtreeEndIndices(root: EvaluatedNode, visibleIndexByNodeId: ReadonlyMap<string, number>): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  const visit = (node: EvaluatedNode): number | undefined => {
    let end = visibleIndexByNodeId.get(node.node.id);
    for (const child of node.children) {
      const childEnd = visit(child);
      if (childEnd !== undefined && (end === undefined || childEnd > end)) end = childEnd;
    }
    if (end !== undefined) result.set(node.node.id, end);
    return end;
  };
  visit(root);
  return result;
}

export function resolvedInstanceRenderOrder<T extends RenderOrderInstance>(
  evaluated: EvaluatedNode,
  visibleNodes: readonly VisibleNodeEntry[],
  instances: readonly T[],
): readonly ResolvedInstanceRenderOrderEntry<T>[] {
  const visibleIndexByNodeId = new Map(visibleNodes.map((entry, index) => [entry.node.id, index]));
  const endIndexByNodeId = subtreeEndIndices(evaluated, visibleIndexByNodeId);
  const instancesByLayoutNodeId = new Map<string, T[]>();
  const instancesByAnchorIndex = new Map<number, T[]>();

  for (const instance of instances) {
    if (instance.placement.kind === "root" || instance.placement.kind === "prefabRef") continue;
    const layoutNodeId = generatedLayoutNodeId(instance);
    if (layoutNodeId && visibleIndexByNodeId.has(layoutNodeId)) {
      const entries = instancesByLayoutNodeId.get(layoutNodeId) ?? [];
      entries.push(instance);
      instancesByLayoutNodeId.set(layoutNodeId, entries);
      continue;
    }
    const anchorIndex = endIndexByNodeId.get(instance.placement.nodeId);
    if (anchorIndex === undefined) continue;
    const entries = instancesByAnchorIndex.get(anchorIndex) ?? [];
    entries.push(instance);
    instancesByAnchorIndex.set(anchorIndex, entries);
  }

  const result: ResolvedInstanceRenderOrderEntry<T>[] = [];
  visibleNodes.forEach((entry, index) => {
    const layoutInstances = instancesByLayoutNodeId.get(entry.node.id);
    if (layoutInstances) {
      for (const instance of layoutInstances) result.push({ kind: "instance", instance, layoutNodeId: entry.node.id });
    } else if (!isGeneratedLayoutNode(entry.node.id)) {
      result.push({ kind: "node", nodeId: entry.node.id });
    }
    for (const instance of instancesByAnchorIndex.get(index) ?? []) result.push({ kind: "instance", instance });
  });
  return result;
}
