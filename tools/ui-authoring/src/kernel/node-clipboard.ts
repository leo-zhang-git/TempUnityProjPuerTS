import type { UiBindings, UiConcreteSource, UiNestedTarget, UiNode } from "../schema/ui-source-schema.js";
import { allocateDuplicateNodeId, unityNodeName } from "./naming.js";
import { collectLocalNodeReferences, remapLocalNodeReferenceTargets } from "./node-references.js";
import { removeNodes } from "./semantic.js";
import { findNode, outermostNodeIds, updateNode, walkNodes } from "./tree.js";
import { assertValidSource } from "./validation.js";

export interface UiNodeClipboard {
  readonly sourceArtifactKey: string;
  readonly roots: readonly UiNode[];
  readonly bindings?: UiBindings;
}

export interface PasteNodeResult {
  readonly source: UiConcreteSource;
  readonly rootId: string;
}

export interface DuplicateNodesResult {
  readonly source: UiConcreteSource;
  readonly rootIds: readonly string[];
}

export interface CutNodesResult {
  readonly source: UiConcreteSource;
  readonly clipboard: UiNodeClipboard;
}

export function copyNodeSubtree(source: UiConcreteSource, nodeId: string): UiNodeClipboard {
  return copyNodeSubtrees(source, [nodeId]);
}

export function copyNodeSubtrees(source: UiConcreteSource, nodeIds: readonly string[]): UiNodeClipboard {
  for (const nodeId of new Set(nodeIds)) {
    if (!findNode(source, nodeId)) throw new Error(`Node '${nodeId}' does not exist in '${source.artifactKey}'`);
  }
  const rootIds = outermostNodeIds(source, nodeIds);
  if (rootIds.length === 0) throw new Error("At least one existing node must be selected");
  const roots = rootIds.map((nodeId) => findNode(source, nodeId)!);
  assertSelfContainedSubtrees(roots);
  const copiedNodeIds = new Set(roots.flatMap(walkSubtree).map((node) => node.id));
  const bindings = bindingsForNodes(source.bindings, copiedNodeIds);
  return {
    sourceArtifactKey: source.artifactKey,
    roots: structuredClone(roots),
    ...(bindings.length > 0 ? { bindings } : {}),
  };
}

export function cutNodeSubtrees(source: UiConcreteSource, nodeIds: readonly string[]): CutNodesResult {
  const clipboard = copyNodeSubtrees(source, nodeIds);
  if (clipboard.roots.some((root) => root.id === source.root.id)) throw new Error("Artifact root cannot be cut");
  const removedIds = new Set(clipboard.roots.flatMap(walkSubtree).map((node) => node.id));
  const bindings = (source.bindings ?? []).filter(({ target }) => {
    const path = target.instancePath ?? [];
    return !removedIds.has(path.length > 0 ? path[0]! : target.nodeId);
  });
  const withoutBindings = structuredClone(source);
  if (bindings.length > 0) withoutBindings.bindings = bindings;
  else delete withoutBindings.bindings;
  return { source: removeNodes(withoutBindings, nodeIds), clipboard };
}

export function pasteNodeSubtree(
  source: UiConcreteSource,
  parentNodeId: string,
  clipboard: UiNodeClipboard,
  index?: number,
): PasteNodeResult {
  const result = pasteNodeSubtrees(source, parentNodeId, clipboard, index);
  const rootId = result.rootIds[0];
  if (!rootId) throw new Error("Node clipboard is empty");
  return { source: result.source, rootId };
}

export function pasteNodeSubtrees(
  source: UiConcreteSource,
  parentNodeId: string,
  clipboard: UiNodeClipboard,
  index?: number,
): DuplicateNodesResult {
  const parent = findNode(source, parentNodeId);
  if (!parent) throw new Error(`Paste target '${parentNodeId}' does not exist in '${source.artifactKey}'`);
  if (clipboard.roots.length === 0) throw new Error("Node clipboard is empty");
  const idMap = createPastedNodeIdsForRoots(source, clipboard.roots);
  const displayNames = new Map(clipboard.roots.flatMap((root) => [...displayNamesById(root)]));
  const roots = clipboard.roots.map((clipboardRoot) => {
    const root = remapLocalNodeReferenceTargets(clipboardRoot, (nodeId) => idMap.get(nodeId) ?? nodeId);
    remapNodeIds(root, idMap);
    preserveDisplayNames(root, idMap, displayNames);
    return root;
  });

  let next = updateNode(source, parentNodeId, (current) => {
    const children = [...(current.children ?? [])];
    const insertIndex = index ?? children.length;
    if (!Number.isInteger(insertIndex) || insertIndex < 0 || insertIndex > children.length) {
      throw new Error(`Paste index must be an integer between 0 and ${children.length}`);
    }
    children.splice(insertIndex, 0, ...roots);
    return { ...current, children };
  });
  if (source.artifactType !== "Fragment") next = appendRemappedBindings(next, clipboard.bindings, idMap);
  assertValidSource(next);
  return { source: next, rootIds: roots.map((root) => root.id) };
}

export function duplicateNodeSubtree(source: UiConcreteSource, nodeId: string): PasteNodeResult {
  const entry = walkNodes(source).find(({ node }) => node.id === nodeId);
  if (!entry) throw new Error(`Node '${nodeId}' does not exist in '${source.artifactKey}'`);
  if (!entry.parent) throw new Error("Artifact root cannot be duplicated");
  const index = entry.parent.children?.findIndex((child) => child.id === nodeId) ?? -1;
  if (index < 0) throw new Error(`Node '${nodeId}' is missing from parent '${entry.parent.id}'`);
  return pasteNodeSubtree(source, entry.parent.id, copyNodeSubtree(source, nodeId), index + 1);
}

export function duplicateNodeSubtrees(source: UiConcreteSource, nodeIds: readonly string[]): DuplicateNodesResult {
  for (const nodeId of new Set(nodeIds)) {
    if (!findNode(source, nodeId)) throw new Error(`Node '${nodeId}' does not exist in '${source.artifactKey}'`);
  }
  const roots = outermostNodeIds(source, nodeIds);
  if (roots.length === 0) throw new Error("At least one existing node must be selected");
  if (roots.includes(source.root.id)) throw new Error("Artifact root cannot be duplicated");
  const entries = walkNodes(source);
  const selectedRoots = roots.map((nodeId) => findNode(source, nodeId)!);
  const selectedIds = new Set(selectedRoots.flatMap(walkSubtree).map((node) => node.id));
  const external = selectedRoots.flatMap(collectLocalNodeReferences).find((reference) => !selectedIds.has(reference.targetNodeId));
  if (external)
    throw new Error(
      `Cannot duplicate selection: ${external.ownerNodeId}.${external.field} references external node '${external.targetNodeId}'`,
    );
  const idMap = createPastedNodeIdsForRoots(source, selectedRoots);
  const displayNames = new Map(selectedRoots.flatMap((root) => [...displayNamesById(root)]));
  let next = source;
  const duplicatedRootIds: string[] = [];

  for (const nodeId of roots) {
    const entry = entries.find((candidate) => candidate.node.id === nodeId)!;
    const parent = entry.parent!;
    let root = remapLocalNodeReferenceTargets(entry.node, (targetId) => idMap.get(targetId) ?? targetId);
    root = structuredClone(root);
    remapNodeIds(root, idMap);
    preserveDisplayNames(root, idMap, displayNames);
    const copy = root;
    next = updateNode(next, parent.id, (current) => {
      const children = [...(current.children ?? [])];
      const index = children.findIndex((child) => child.id === nodeId);
      if (index < 0) throw new Error(`Node '${nodeId}' is missing from parent '${parent.id}'`);
      children.splice(index + 1, 0, copy);
      return { ...current, children };
    });
    duplicatedRootIds.push(root.id);
  }
  if (source.artifactType !== "Fragment") next = appendRemappedBindings(next, bindingsForNodes(source.bindings, selectedIds), idMap);
  assertValidSource(next);
  return { source: next, rootIds: duplicatedRootIds };
}

export function assertSelfContainedSubtree(root: UiNode): void {
  assertSelfContainedSubtrees([root]);
}

function assertSelfContainedSubtrees(roots: readonly UiNode[]): void {
  const nodeIds = new Set(roots.flatMap(walkSubtree).map((node) => node.id));
  const external = roots.flatMap(collectLocalNodeReferences).find((reference) => !nodeIds.has(reference.targetNodeId));
  if (external) {
    throw new Error(`Cannot copy selection: ${external.ownerNodeId}.${external.field} references external node '${external.targetNodeId}'`);
  }
}

function bindingsForNodes(bindings: UiBindings | undefined, nodeIds: ReadonlySet<string>): UiBindings {
  return (bindings ?? []).filter(({ target }) => {
    const path = target.instancePath ?? [];
    return path.length > 0 ? nodeIds.has(path[0]!) : nodeIds.has(target.nodeId);
  });
}

function appendRemappedBindings(
  source: UiConcreteSource,
  bindings: UiBindings | undefined,
  idMap: ReadonlyMap<string, string>,
): UiConcreteSource {
  const used = new Set((source.bindings ?? []).map((declaration) => declaration.name));
  const additions: UiBindings = [];
  for (const declaration of bindings ?? []) {
    const name = uniqueBindingName(declaration.name, used);
    used.add(name);
    additions.push({ name, target: remapBindingTarget(declaration.target, idMap) });
  }
  if (additions.length === 0) return source;
  return { ...source, bindings: [...(source.bindings ?? []), ...additions] };
}

function remapBindingTarget(target: UiNestedTarget, idMap: ReadonlyMap<string, string>): UiNestedTarget {
  const path = target.instancePath ?? [];
  return {
    ...(path.length > 0 ? { instancePath: path.map((nodeId) => idMap.get(nodeId) ?? nodeId) } : {}),
    nodeId: path.length === 0 ? (idMap.get(target.nodeId) ?? target.nodeId) : target.nodeId,
    componentType: target.componentType,
  };
}

function createPastedNodeIdsForRoots(source: UiConcreteSource, roots: readonly UiNode[]): ReadonlyMap<string, string> {
  const used = new Set(walkNodes(source).map(({ node }) => node.id));
  const result = new Map<string, string>();
  for (const node of roots.flatMap(walkSubtree)) {
    const candidate = allocateDuplicateNodeId(node.id, used);
    used.add(candidate);
    result.set(node.id, candidate);
  }
  return result;
}

function remapNodeIds(root: UiNode, idMap: ReadonlyMap<string, string>): void {
  const visit = (node: UiNode): void => {
    node.id = idMap.get(node.id) ?? node.id;
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
}

function displayNamesById(root: UiNode): ReadonlyMap<string, string> {
  return new Map(walkSubtree(root).map((node) => [node.id, unityNodeName(node)]));
}

function preserveDisplayNames(root: UiNode, idMap: ReadonlyMap<string, string>, displayNames: ReadonlyMap<string, string>): void {
  const originalIdByNextId = new Map([...idMap].map(([originalId, nextId]) => [nextId, originalId]));
  for (const node of walkSubtree(root)) {
    const displayName = displayNames.get(originalIdByNextId.get(node.id) ?? node.id);
    if (displayName === undefined) continue;
    if (unityNodeName({ id: node.id }) === displayName) delete node.name;
    else node.name = displayName;
  }
}

function uniqueBindingName(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base;
  const stem = `${base}Copy`;
  let candidate = stem;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${stem}${suffix++}`;
  return candidate;
}

function walkSubtree(root: UiNode): UiNode[] {
  const result: UiNode[] = [];
  const visit = (node: UiNode): void => {
    result.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return result;
}
