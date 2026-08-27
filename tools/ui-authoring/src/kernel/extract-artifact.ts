import type { UiConcreteSource, UiNestedTarget, UiNode } from "../schema/ui-source-schema.js";
import { collectBindings } from "./binding.js";
import type { EvaluatedNode } from "./layout.js";
import { evaluateLayout } from "./layout.js";
import { assertSelfContainedSubtree } from "./node-clipboard.js";
import { collectLocalNodeReferences, remapLocalNodeReferenceTargets } from "./node-references.js";
import { updateNode, walkNodes } from "./tree.js";
import { assertValidSource } from "./validation.js";

export interface ExtractArtifactIdentity {
  readonly artifactKey: string;
}

export interface ExtractWidgetResult {
  readonly parentSource: UiConcreteSource;
  readonly widgetSource: UiConcreteSource;
  readonly replacementNodeId: string;
}

export interface ExtractFragmentOptions extends ExtractArtifactIdentity {
  readonly artifactTypeOf: (artifactKey: string) => UiConcreteSource["artifactType"] | undefined;
}

export interface ExtractFragmentResult {
  readonly parentSource: UiConcreteSource;
  readonly fragmentSource: UiConcreteSource;
  readonly replacementNodeId: string;
}

interface PreparedExtraction {
  readonly selected: UiNode;
  readonly selectedIds: ReadonlySet<string>;
  readonly initialSize: [number, number];
  readonly extractedRoot: UiNode;
  readonly replacement: UiNode;
}

export function extractWidget(source: UiConcreteSource, selectedNodeId: string, identity: ExtractArtifactIdentity): ExtractWidgetResult {
  if (source.artifactType === "Fragment") throw new Error("Fragment cannot extract a child Widget");
  const prepared = prepareExtraction(source, selectedNodeId, identity, "Widget");
  const movedBindings = (source.bindings ?? [])
    .filter((declaration) => bindingTargetsSubtree(declaration.target, prepared.selectedIds))
    .map((declaration) => ({
      ...declaration,
      target:
        declaration.target.nodeId === prepared.selected.id && (declaration.target.instancePath?.length ?? 0) === 0
          ? { ...declaration.target, nodeId: identity.artifactKey }
          : structuredClone(declaration.target),
    }));
  const widgetSource: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: identity.artifactKey,
    artifactType: "Widget",
    widgetType: identity.artifactKey,
    initialSize: prepared.initialSize,
    ...(movedBindings.length > 0 ? { bindings: movedBindings } : {}),
    root: prepared.extractedRoot,
  };
  assertValidSource(widgetSource);

  const remainingBindings = (source.bindings ?? []).filter(
    (declaration) => !bindingTargetsSubtree(declaration.target, prepared.selectedIds),
  );
  const sourceWithoutMovedBindings = { ...source };
  if (remainingBindings.length > 0) sourceWithoutMovedBindings.bindings = remainingBindings;
  else delete sourceWithoutMovedBindings.bindings;
  const usedBindings = new Set(collectBindings(sourceWithoutMovedBindings).map((binding) => binding.fieldName));
  const bindingName = usedBindings.has(prepared.selected.id)
    ? uniqueWidgetBindingName(prepared.selected.id, usedBindings)
    : prepared.selected.id;
  const replaced = updateNode(sourceWithoutMovedBindings, prepared.selected.id, () => prepared.replacement);
  const parentSource = {
    ...replaced,
    bindings: [
      ...(replaced.bindings ?? []),
      { name: bindingName, target: { nodeId: prepared.replacement.id, componentType: "PrefabRef" as const } },
    ],
  };
  assertValidSource(parentSource);
  return { parentSource, widgetSource, replacementNodeId: prepared.replacement.id };
}

export function extractFragment(source: UiConcreteSource, selectedNodeId: string, options: ExtractFragmentOptions): ExtractFragmentResult {
  const prepared = prepareExtraction(source, selectedNodeId, options, "Fragment");
  assertFragmentDependencies(prepared.selected, options.artifactTypeOf);
  const fragmentSource: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: options.artifactKey,
    artifactType: "Fragment",
    initialSize: prepared.initialSize,
    root: prepared.extractedRoot,
  };
  assertValidSource(fragmentSource);

  const replaced = updateNode(source, prepared.selected.id, () => prepared.replacement);
  const rewrittenBindings = (source.bindings ?? []).map((declaration) =>
    bindingTargetsSubtree(declaration.target, prepared.selectedIds)
      ? {
          ...declaration,
          target: fragmentBindingTarget(declaration.target, prepared.selected.id, prepared.replacement.id, options.artifactKey),
        }
      : declaration,
  );
  const parentSource: UiConcreteSource = {
    ...replaced,
    ...(rewrittenBindings.length > 0 ? { bindings: rewrittenBindings } : {}),
  };
  assertValidSource(parentSource);
  return { parentSource, fragmentSource, replacementNodeId: prepared.replacement.id };
}

function prepareExtraction(
  source: UiConcreteSource,
  selectedNodeId: string,
  identity: ExtractArtifactIdentity,
  artifactType: "Widget" | "Fragment",
): PreparedExtraction {
  const entries = walkNodes(source);
  const selectedEntry = entries.find(({ node }) => node.id === selectedNodeId);
  if (!selectedEntry) throw new Error(`Node '${selectedNodeId}' does not exist in '${source.artifactKey}'`);
  if (!selectedEntry.parent) throw new Error(`Artifact root cannot be extracted as a ${artifactType}`);
  if (selectedEntry.node.components?.PrefabRef) throw new Error(`A PrefabRef node cannot be extracted as another ${artifactType}`);

  const selected = selectedEntry.node;
  assertSelfContainedSubtree(selected);
  assertNoInboundOwnerReferences(source, selected, artifactType);

  const evaluated = findEvaluatedNode(evaluateLayout(source), selected.id);
  if (!evaluated) throw new Error(`Cannot evaluate selected node '${selected.id}'`);
  const initialSize: [number, number] = [Math.max(1, evaluated.rect.width), Math.max(1, evaluated.rect.height)];
  return {
    selected,
    selectedIds: new Set(walkSubtree(selected).map((node) => node.id)),
    initialSize,
    extractedRoot: createExtractedRoot(selected, identity.artifactKey, initialSize),
    replacement: createArtifactReference(selected, identity.artifactKey),
  };
}

function createExtractedRoot(selected: UiNode, artifactKey: string, initialSize: readonly [number, number]): UiNode {
  const root = remapLocalNodeReferenceTargets(selected, (nodeId) => (nodeId === selected.id ? artifactKey : nodeId));
  root.id = artifactKey;
  root.name = artifactKey;
  delete root.active;
  root.rect = {
    anchorMin: [0.5, 0.5],
    anchorMax: [0.5, 0.5],
    pivot: structuredClone(selected.rect.pivot),
    anchoredPosition: [0, 0],
    sizeDelta: [...initialSize],
  };
  return root;
}

function createArtifactReference(selected: UiNode, artifactKey: string): UiNode {
  return {
    id: selected.id,
    ...(selected.name ? { name: selected.name } : {}),
    ...(selected.active !== undefined ? { active: selected.active } : {}),
    rect: structuredClone(selected.rect),
    components: {
      PrefabRef: { artifactKey },
    },
  };
}

function fragmentBindingTarget(
  target: UiNestedTarget,
  selectedNodeId: string,
  replacementNodeId: string,
  artifactKey: string,
): UiNestedTarget {
  const instancePath = target.instancePath ?? [];
  return {
    ...structuredClone(target),
    instancePath: [replacementNodeId, ...instancePath],
    nodeId: instancePath.length === 0 && target.nodeId === selectedNodeId ? artifactKey : target.nodeId,
  };
}

function bindingTargetsSubtree(target: UiNestedTarget, nodeIds: ReadonlySet<string>): boolean {
  const instancePath = target.instancePath ?? [];
  return instancePath.length > 0 ? nodeIds.has(instancePath[0]!) : nodeIds.has(target.nodeId);
}

function assertNoInboundOwnerReferences(source: UiConcreteSource, selected: UiNode, artifactType: "Widget" | "Fragment"): void {
  const selectedIds = new Set(walkSubtree(selected).map((node) => node.id));
  for (const reference of collectLocalNodeReferences(source.root)) {
    if (selectedIds.has(reference.ownerNodeId) || !selectedIds.has(reference.targetNodeId)) continue;
    if (reference.targetNodeId === selected.id && reference.field.startsWith("StateRoot.states.")) continue;
    throw new Error(
      `Cannot extract '${selected.id}': ${reference.ownerNodeId}.${reference.field} references '${reference.targetNodeId}' across the new ${artifactType} owner`,
    );
  }
}

function assertFragmentDependencies(selected: UiNode, artifactTypeOf: ExtractFragmentOptions["artifactTypeOf"]): void {
  for (const node of walkSubtree(selected)) {
    const artifactKey = node.components?.PrefabRef?.artifactKey;
    if (!artifactKey) continue;
    const artifactType = artifactTypeOf(artifactKey);
    if (artifactType === "Fragment") continue;
    if (!artifactType) throw new Error(`Cannot extract '${selected.id}' as a Fragment: dependency '${artifactKey}' does not exist`);
    throw new Error(
      `Cannot extract '${selected.id}' as a Fragment: dependency '${artifactKey}' is a ${artifactType}; Fragment can only depend on Fragment`,
    );
  }
}

function uniqueWidgetBindingName(nodeId: string, used: ReadonlySet<string>): string {
  const base = `${nodeId}Widget`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}${suffix++}`;
  return candidate;
}

function findEvaluatedNode(root: EvaluatedNode, nodeId: string): EvaluatedNode | undefined {
  if (root.node.id === nodeId) return root;
  for (const child of root.children) {
    const result = findEvaluatedNode(child, nodeId);
    if (result) return result;
  }
  return undefined;
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
