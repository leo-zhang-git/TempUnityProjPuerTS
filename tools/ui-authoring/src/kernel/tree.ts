import type { UiConcreteSource, UiNode } from "../schema/ui-source-schema.js";

export interface NodeEntry {
  readonly node: UiNode;
  readonly parent: UiNode | null;
  readonly path: readonly string[];
}

export function walkNodes(source: UiConcreteSource): NodeEntry[] {
  const result: NodeEntry[] = [];

  const visit = (node: UiNode, parent: UiNode | null, path: readonly string[]): void => {
    const nextPath = [...path, node.id];
    result.push({ node, parent, path: nextPath });
    for (const child of node.children ?? []) visit(child, node, nextPath);
  };

  visit(source.root, null, []);
  return result;
}

export function findNode(source: UiConcreteSource, id: string): UiNode | undefined {
  return walkNodes(source).find((entry) => entry.node.id === id)?.node;
}

export function outermostNodeIds(source: UiConcreteSource, nodeIds: readonly string[]): string[] {
  const selected = new Set(nodeIds);
  return walkNodes(source)
    .filter((entry) => selected.has(entry.node.id))
    .filter((entry) => !entry.path.slice(0, -1).some((ancestorId) => selected.has(ancestorId)))
    .map((entry) => entry.node.id);
}

export function updateNode(source: UiConcreteSource, id: string, updater: (node: UiNode) => UiNode): UiConcreteSource {
  const visit = (node: UiNode): UiNode => {
    if (node.id === id) return updater(node);
    if (!node.children) return node;
    let changed = false;
    const children = node.children.map((child) => {
      const next = visit(child);
      if (next !== child) changed = true;
      return next;
    });
    return changed ? { ...node, children } : node;
  };
  return { ...source, root: visit(source.root) };
}
