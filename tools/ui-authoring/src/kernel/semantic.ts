import { componentRegistry } from "../registry/component-registry.js";
import type { UiComponentType, UiConcreteSource, UiNode, UiSource } from "../schema/ui-source-schema.js";
import { collectBindings } from "./binding.js";
import { effectiveNodeIdMode, isDisplayNameAlignedNodeId, unityNodeName } from "./naming.js";
import { removeLocalNodeReferenceTargets } from "./node-references.js";
import { findNode, outermostNodeIds, walkNodes } from "./tree.js";
import { assertValidSource } from "./validation.js";

export interface SemanticQuery {
  readonly id?: string;
  readonly name?: string;
  readonly component?: UiComponentType;
  readonly binding?: string;
  readonly artifactReference?: string;
}

export interface SemanticNodeSummary {
  readonly id: string;
  readonly name?: string;
  readonly parentId: string | null;
  readonly path: readonly string[];
  readonly active: boolean;
  readonly components: readonly UiComponentType[];
  readonly childCount: number;
}

export type SemanticChange =
  | { readonly kind: "nodeAdded" | "nodeRemoved"; readonly nodeId: string; readonly parentId: string | null }
  | {
      readonly kind: "nodeMoved";
      readonly nodeId: string;
      readonly beforeParentId: string | null;
      readonly afterParentId: string | null;
      readonly beforeIndex: number;
      readonly afterIndex: number;
    }
  | { readonly kind: "nodeRenamed"; readonly beforeNodeId: string; readonly afterNodeId: string }
  | { readonly kind: "componentAdded" | "componentRemoved"; readonly nodeId: string; readonly componentType: UiComponentType }
  | { readonly kind: "fieldUpdated"; readonly nodeId: string; readonly field: string; readonly before: unknown; readonly after: unknown }
  | { readonly kind: "sourceFieldUpdated"; readonly field: string; readonly before: unknown; readonly after: unknown };

export interface SemanticDiff {
  readonly artifactKey: string;
  readonly changes: readonly SemanticChange[];
}

export function concreteSource(source: UiSource): UiConcreteSource {
  if (source.sourceKind !== "artifact")
    throw new Error(`Semantic structure editing requires a concrete Artifact, got '${source.sourceKind}'`);
  return source;
}

export function inspectSource(
  source: UiConcreteSource,
  nodeId?: string,
  depth = 1,
): {
  readonly artifactKey: string;
  readonly artifactType: UiConcreteSource["artifactType"];
  readonly nodeCount: number;
  readonly bindingCount: number;
  readonly selected: SemanticNodeSummary;
  readonly nodes: readonly SemanticNodeSummary[];
} {
  if (!Number.isInteger(depth) || depth < 0) throw new Error("Inspect depth must be a non-negative integer");
  const entries = walkNodes(source);
  const selectedEntry = nodeId ? entries.find(({ node }) => node.id === nodeId) : entries[0];
  if (!selectedEntry) throw new Error(`Node '${nodeId}' does not exist in '${source.artifactKey}'`);
  const selectedDepth = selectedEntry.path.length;
  const nodes = entries
    .filter(
      (entry) =>
        entry.path.length >= selectedDepth &&
        entry.path.length <= selectedDepth + depth &&
        selectedEntry.path.every((part, index) => entry.path[index] === part),
    )
    .map(summarizeNode);
  return {
    artifactKey: source.artifactKey,
    artifactType: source.artifactType,
    nodeCount: entries.length,
    bindingCount: collectBindings(source).length,
    selected: summarizeNode(selectedEntry),
    nodes,
  };
}

export function querySource(source: UiConcreteSource, query: SemanticQuery): SemanticNodeSummary[] {
  const bindings = collectBindings(source);
  const bindingNodeIds = query.binding
    ? new Set(bindings.filter((binding) => binding.fieldName === query.binding).map((binding) => binding.nodeId))
    : undefined;
  return walkNodes(source)
    .filter(({ node }) => query.id === undefined || node.id === query.id)
    .filter(({ node }) => query.name === undefined || node.name === query.name)
    .filter(({ node }) => query.component === undefined || node.components?.[query.component] !== undefined)
    .filter(({ node }) => bindingNodeIds === undefined || bindingNodeIds.has(node.id))
    .filter(({ node }) => query.artifactReference === undefined || node.components?.PrefabRef?.artifactKey === query.artifactReference)
    .map(summarizeNode);
}

export function insertNode(source: UiConcreteSource, parentId: string, node: UiNode, index?: number): UiConcreteSource {
  if (findNode(source, node.id)) throw new Error(`Node '${node.id}' already exists in '${source.artifactKey}'`);
  for (const inserted of walkNodeTree(node)) {
    if (effectiveNodeIdMode(inserted) === "auto" && !isDisplayNameAlignedNodeId(inserted.id, unityNodeName(inserted))) {
      throw new Error(
        `Auto node '${inserted.id}' is not aligned with GameObject name '${unityNodeName(inserted)}'; use an aligned id or set idMode to 'manual'`,
      );
    }
  }
  const result = structuredClone(source);
  const parent = findNode(result, parentId);
  if (!parent) throw new Error(`Parent node '${parentId}' does not exist in '${source.artifactKey}'`);
  parent.children ??= [];
  const children = parent.children;
  children.splice(resolveInsertIndex(index, children.length), 0, structuredClone(node));
  assertValidSource(result);
  return result;
}

export function moveNode(source: UiConcreteSource, nodeId: string, parentId: string, index?: number): UiConcreteSource {
  if (source.root.id === nodeId) throw new Error("Artifact root cannot be moved");
  const sourceNode = findNode(source, nodeId);
  if (!sourceNode) throw new Error(`Node '${nodeId}' does not exist in '${source.artifactKey}'`);
  if (!findNode(source, parentId)) throw new Error(`Parent node '${parentId}' does not exist in '${source.artifactKey}'`);
  if (walkNodeTree(sourceNode).some((node) => node.id === parentId))
    throw new Error(`Node '${nodeId}' cannot be moved into its own subtree`);

  const result = structuredClone(source);
  const detached = detachNode(result.root, nodeId);
  if (!detached) throw new Error(`Unable to detach node '${nodeId}'`);
  const parent = findNode(result, parentId);
  if (!parent) throw new Error(`Parent node '${parentId}' does not exist after detaching '${nodeId}'`);
  parent.children ??= [];
  const children = parent.children;
  children.splice(resolveInsertIndex(index, children.length), 0, detached);
  assertValidSource(result);
  return result;
}

export function removeNode(source: UiConcreteSource, nodeId: string): UiConcreteSource {
  if (source.root.id === nodeId) throw new Error("Artifact root cannot be removed");
  const target = findNode(source, nodeId);
  if (!target) throw new Error(`Node '${nodeId}' does not exist in '${source.artifactKey}'`);
  const removedIds = new Set(walkNodeTree(target).map((node) => node.id));
  const result = structuredClone(source);
  result.root = removeLocalNodeReferenceTargets(result.root, removedIds).root;
  if (!detachNode(result.root, nodeId)) throw new Error(`Unable to detach node '${nodeId}'`);
  assertValidSource(result);
  return result;
}

export function removeNodes(source: UiConcreteSource, nodeIds: readonly string[]): UiConcreteSource {
  for (const nodeId of new Set(nodeIds)) {
    if (!findNode(source, nodeId)) throw new Error(`Node '${nodeId}' does not exist in '${source.artifactKey}'`);
  }
  const roots = outermostNodeIds(source, nodeIds);
  if (roots.length === 0) throw new Error("At least one existing node must be selected");
  if (roots.includes(source.root.id)) throw new Error("Artifact root cannot be removed");
  const removedIds = new Set<string>();
  for (const nodeId of roots) {
    const target = findNode(source, nodeId)!;
    for (const node of walkNodeTree(target)) removedIds.add(node.id);
  }
  const result = structuredClone(source);
  result.root = removeLocalNodeReferenceTargets(result.root, removedIds).root;
  for (const nodeId of roots) {
    if (!detachNode(result.root, nodeId)) throw new Error(`Unable to detach node '${nodeId}'`);
  }
  assertValidSource(result);
  return result;
}

export function setNodeField(source: UiConcreteSource, nodeId: string, field: string, value: unknown, unset = false): UiConcreteSource {
  const segments = field.split(".");
  if (!isEditableFieldPath(segments)) throw new Error(`Unsupported Source field '${field}'`);
  const result = structuredClone(source);
  const node = findNode(result, nodeId);
  if (!node) throw new Error(`Node '${nodeId}' does not exist in '${source.artifactKey}'`);
  setNestedValue(node as unknown as Record<string, unknown>, segments, value, unset);
  assertValidSource(result);
  return result;
}

export function addNodeComponent(
  source: UiConcreteSource,
  nodeId: string,
  componentType: UiComponentType,
  value?: unknown,
): UiConcreteSource {
  const result = structuredClone(source);
  const node = findNode(result, nodeId);
  if (!node) throw new Error(`Node '${nodeId}' does not exist in '${source.artifactKey}'`);
  if (node.components?.[componentType] !== undefined) throw new Error(`Node '${nodeId}' already has component '${componentType}'`);
  const component = value === undefined ? structuredClone(componentRegistry[componentType].defaultValue) : value;
  node.components ??= {};
  const components = node.components as Record<string, unknown>;
  components[componentType] = structuredClone(component);
  assertValidSource(result);
  return result;
}

export function removeNodeComponent(source: UiConcreteSource, nodeId: string, componentType: UiComponentType): UiConcreteSource {
  const result = structuredClone(source);
  const node = findNode(result, nodeId);
  if (!node) throw new Error(`Node '${nodeId}' does not exist in '${source.artifactKey}'`);
  if (node.components?.[componentType] === undefined) throw new Error(`Node '${nodeId}' does not have component '${componentType}'`);
  delete (node.components as Record<string, unknown>)[componentType];
  if (Object.keys(node.components).length === 0) delete node.components;
  assertValidSource(result);
  return result;
}

export function createSemanticDiff(
  before: UiConcreteSource,
  after: UiConcreteSource,
  renames: readonly { readonly beforeNodeId: string; readonly afterNodeId: string }[] = [],
): SemanticDiff {
  if (before.artifactKey !== after.artifactKey) throw new Error("Semantic diff requires the same artifactKey");
  const renameBefore = new Map(renames.map((entry) => [entry.beforeNodeId, entry.afterNodeId]));
  const renameAfter = new Map(renames.map((entry) => [entry.afterNodeId, entry.beforeNodeId]));
  const beforeEntries = indexEntries(before);
  const afterEntries = indexEntries(after);
  const changes: SemanticChange[] = renames.map((entry) => ({ kind: "nodeRenamed", ...entry }));

  for (const [nodeId, entry] of beforeEntries) {
    if (renameBefore.has(nodeId)) continue;
    if (!afterEntries.has(nodeId)) changes.push({ kind: "nodeRemoved", nodeId, parentId: entry.parentId });
  }
  for (const [nodeId, entry] of afterEntries) {
    if (renameAfter.has(nodeId)) continue;
    if (!beforeEntries.has(nodeId)) changes.push({ kind: "nodeAdded", nodeId, parentId: entry.parentId });
  }

  const common = [...beforeEntries.keys()].filter((nodeId) => afterEntries.has(nodeId));
  for (const nodeId of common) compareNodeEntries(nodeId, beforeEntries.get(nodeId)!, afterEntries.get(nodeId)!, changes, renameBefore);
  for (const { beforeNodeId, afterNodeId } of renames) {
    const beforeEntry = beforeEntries.get(beforeNodeId);
    const afterEntry = afterEntries.get(afterNodeId);
    if (beforeEntry && afterEntry) compareNodeEntries(afterNodeId, beforeEntry, afterEntry, changes, renameBefore);
  }
  for (const field of ["initialSize", "bindings"] as const) {
    if (!sameValue(before[field], after[field])) {
      changes.push({
        kind: "sourceFieldUpdated",
        field,
        before: structuredClone(before[field]),
        after: structuredClone(after[field]),
      });
    }
  }
  return { artifactKey: before.artifactKey, changes };
}

function summarizeNode({ node, parent, path }: ReturnType<typeof walkNodes>[number]): SemanticNodeSummary {
  return {
    id: node.id,
    ...(node.name ? { name: node.name } : {}),
    parentId: parent?.id ?? null,
    path,
    active: node.active !== false,
    components: Object.keys(node.components ?? {}) as UiComponentType[],
    childCount: node.children?.length ?? 0,
  };
}

function walkNodeTree(root: UiNode): UiNode[] {
  const nodes: UiNode[] = [];
  const visit = (node: UiNode): void => {
    nodes.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return nodes;
}

function detachNode(root: UiNode, nodeId: string): UiNode | undefined {
  for (const node of walkNodeTree(root)) {
    const index = node.children?.findIndex((child) => child.id === nodeId) ?? -1;
    if (index >= 0) return node.children!.splice(index, 1)[0];
  }
  return undefined;
}

function resolveInsertIndex(index: number | undefined, length: number): number {
  if (index === undefined) return length;
  if (!Number.isInteger(index) || index < 0 || index > length) throw new Error(`Insert index must be an integer between 0 and ${length}`);
  return index;
}

function isEditableFieldPath(segments: readonly string[]): boolean {
  if (segments.length === 1) return segments[0] === "active";
  if (segments[0] === "rect") return segments.length === 2;
  return segments[0] === "components" && segments.length >= 3 && segments[1] !== undefined && segments[1] in componentRegistry;
}

function setNestedValue(target: Record<string, unknown>, segments: readonly string[], value: unknown, unset: boolean): void {
  let owner = target;
  for (const segment of segments.slice(0, -1)) {
    const next = owner[segment];
    if (!next || typeof next !== "object" || Array.isArray(next)) throw new Error(`Field owner '${segment}' does not exist`);
    owner = next as Record<string, unknown>;
  }
  const property = segments.at(-1)!;
  if (unset) delete owner[property];
  else owner[property] = structuredClone(value);
}

interface IndexedNodeEntry {
  readonly node: UiNode;
  readonly parentId: string | null;
  readonly index: number;
}

function indexEntries(source: UiConcreteSource): ReadonlyMap<string, IndexedNodeEntry> {
  return new Map(
    walkNodes(source).map(({ node, parent }) => [
      node.id,
      {
        node,
        parentId: parent?.id ?? null,
        index: parent?.children?.findIndex((child) => child.id === node.id) ?? 0,
      },
    ]),
  );
}

function compareNodeEntries(
  resultNodeId: string,
  before: IndexedNodeEntry,
  after: IndexedNodeEntry,
  changes: SemanticChange[],
  renamedNodeIds: ReadonlyMap<string, string>,
): void {
  const beforeParentId = before.parentId === null ? null : (renamedNodeIds.get(before.parentId) ?? before.parentId);
  if (beforeParentId !== after.parentId || before.index !== after.index) {
    changes.push({
      kind: "nodeMoved",
      nodeId: resultNodeId,
      beforeParentId,
      afterParentId: after.parentId,
      beforeIndex: before.index,
      afterIndex: after.index,
    });
  }
  compareValue(resultNodeId, "name", before.node.name, after.node.name, changes);
  compareValue(resultNodeId, "active", before.node.active ?? true, after.node.active ?? true, changes);
  compareRecord(
    resultNodeId,
    "rect",
    before.node.rect as unknown as Record<string, unknown>,
    after.node.rect as unknown as Record<string, unknown>,
    changes,
  );
  const beforeComponents = before.node.components ?? {};
  const afterComponents = after.node.components ?? {};
  const componentTypes = new Set([...Object.keys(beforeComponents), ...Object.keys(afterComponents)] as UiComponentType[]);
  for (const componentType of componentTypes) {
    const beforeComponent = beforeComponents[componentType];
    const afterComponent = afterComponents[componentType];
    if (beforeComponent === undefined && afterComponent !== undefined)
      changes.push({ kind: "componentAdded", nodeId: resultNodeId, componentType });
    else if (beforeComponent !== undefined && afterComponent === undefined)
      changes.push({ kind: "componentRemoved", nodeId: resultNodeId, componentType });
    else if (beforeComponent !== undefined && afterComponent !== undefined) {
      compareRecord(
        resultNodeId,
        `components.${componentType}`,
        beforeComponent as Record<string, unknown>,
        afterComponent as Record<string, unknown>,
        changes,
      );
    }
  }
}

function compareRecord(
  nodeId: string,
  prefix: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  changes: SemanticChange[],
): void {
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const field of fields) compareValue(nodeId, `${prefix}.${field}`, before[field], after[field], changes);
}

function compareValue(nodeId: string, field: string, before: unknown, after: unknown, changes: SemanticChange[]): void {
  if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ kind: "fieldUpdated", nodeId, field, before, after });
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
