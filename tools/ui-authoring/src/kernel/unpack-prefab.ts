import type { UiBindings, UiConcreteSource, UiNestedTarget, UiNode, UiPropertyOverride } from "../schema/ui-source-schema.js";
import { allocateNodeId, unityNodeName } from "./naming.js";
import { remapLocalNodeReferenceTargets } from "./node-references.js";
import { applyUseSiteOverridesAtCurrentArtifact, useSiteOverridesForChild } from "./override.js";
import { findNode, updateNode, walkNodes } from "./tree.js";
import { assertValidSource } from "./validation.js";

export interface UnpackPrefabResult {
  readonly source: UiConcreteSource;
  readonly rootId: string;
}

const useSiteLayoutComponentTypes = [
  "HorizontalLayoutGroup",
  "VerticalLayoutGroup",
  "AutoLayoutGroup",
  "ContentSizeFitter",
  "LayoutElement",
] as const;

export function unpackPrefabReason(useSite: UiNode, target: UiConcreteSource | undefined): string | undefined {
  if (!useSite.components?.PrefabRef) return "Selected node is not a PrefabRef";
  if (!useSite.components.PrefabRef.artifactKey) return "PrefabRef Artifact is required before unpacking";
  if (!target) return `Artifact '${useSite.components.PrefabRef.artifactKey}' is unavailable`;
  if (target.artifactType === "Widget") return "Widget PrefabRefs own a Binder and cannot be unpacked inline";
  if (target.artifactType !== "Fragment") return "Only Fragment Artifact PrefabRefs can be unpacked";
  return undefined;
}

export function unpackPrefab(source: UiConcreteSource, useSiteNodeId: string, target: UiConcreteSource): UnpackPrefabResult {
  const useSite = findNode(source, useSiteNodeId);
  if (!useSite) throw new Error(`Node '${useSiteNodeId}' does not exist in '${source.artifactKey}'`);
  const reason = unpackPrefabReason(useSite, target);
  if (reason) throw new Error(reason);
  const prefabRef = useSite.components!.PrefabRef!;
  if (prefabRef.artifactKey !== target.artifactKey) {
    throw new Error(`PrefabRef '${useSiteNodeId}' targets '${prefabRef.artifactKey}', not '${target.artifactKey}'`);
  }

  const materialized = applyUseSiteOverridesAtCurrentArtifact(target, prefabRef.overrides ?? []);
  let root = structuredClone(materialized.root);
  const displayNames = new Map(walkSubtree(root).map((node) => [node.id, unityNodeName(node)]));
  forwardNestedOverrides(root, prefabRef.overrides ?? []);

  const idMap = materializedNodeIds(source, useSiteNodeId, root);
  root = remapLocalNodeReferenceTargets(root, (nodeId) => idMap.get(nodeId) ?? nodeId);
  remapNodeIds(root, idMap);
  preserveDisplayNames(root, idMap, displayNames);
  preserveUseSiteRoot(root, useSite);

  const replaced = updateNode(source, useSiteNodeId, () => root);
  const bindings = remapUnpackedBindings(source.bindings, useSiteNodeId, idMap);
  const next = { ...replaced };
  if (bindings.length > 0) next.bindings = bindings;
  else delete next.bindings;
  assertValidSource(next);
  return { source: next, rootId: root.id };
}

function forwardNestedOverrides(root: UiNode, overrides: readonly UiPropertyOverride[]): void {
  const nested = overrides.filter((override) => (override.target.instancePath?.length ?? 0) > 0);
  const consumed = new Set<UiPropertyOverride>();
  for (const node of walkSubtree(root)) {
    const prefabRef = node.components?.PrefabRef;
    if (!prefabRef) continue;
    const forwarded = useSiteOverridesForChild(nested, node.id);
    if (forwarded.length === 0) continue;
    for (const override of nested) {
      if (override.target.instancePath?.[0] === node.id) consumed.add(override);
    }
    prefabRef.overrides = [...(prefabRef.overrides ?? []), ...forwarded];
  }
  const unresolved = nested.find((override) => !consumed.has(override));
  if (unresolved)
    throw new Error(`Nested override instance '${unresolved.target.instancePath?.[0]}' is not a PrefabRef in Fragment '${root.id}'`);
}

function remapUnpackedBindings(bindings: UiBindings | undefined, useSiteNodeId: string, idMap: ReadonlyMap<string, string>): UiBindings {
  return (bindings ?? []).map((declaration) => ({
    ...declaration,
    target: remapUnpackedBindingTarget(declaration.target, useSiteNodeId, idMap),
  }));
}

function remapUnpackedBindingTarget(target: UiNestedTarget, useSiteNodeId: string, idMap: ReadonlyMap<string, string>): UiNestedTarget {
  const path = target.instancePath ?? [];
  if (path[0] !== useSiteNodeId) return structuredClone(target);
  const remaining = path.slice(1);
  return {
    ...(remaining.length > 0 ? { instancePath: remaining.map((nodeId) => idMap.get(nodeId) ?? nodeId) } : {}),
    nodeId: remaining.length === 0 ? (idMap.get(target.nodeId) ?? target.nodeId) : target.nodeId,
    componentType: target.componentType,
  };
}

function materializedNodeIds(source: UiConcreteSource, useSiteNodeId: string, root: UiNode): ReadonlyMap<string, string> {
  const used = new Set(walkNodes(source).map(({ node }) => node.id));
  used.delete(useSiteNodeId);
  const result = new Map<string, string>();
  for (const [index, node] of walkSubtree(root).entries()) {
    if (index === 0) {
      result.set(node.id, useSiteNodeId);
      used.add(useSiteNodeId);
      continue;
    }
    const candidate = allocateNodeId(node.id, used);
    used.add(candidate);
    result.set(node.id, candidate);
  }
  return result;
}

function remapNodeIds(root: UiNode, idMap: ReadonlyMap<string, string>): void {
  for (const node of walkSubtree(root)) node.id = idMap.get(node.id) ?? node.id;
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

function preserveUseSiteRoot(root: UiNode, useSite: UiNode): void {
  root.id = useSite.id;
  root.rect = structuredClone(useSite.rect);
  if (useSite.name === undefined) delete root.name;
  else root.name = useSite.name;
  if (useSite.active === undefined) delete root.active;
  else root.active = useSite.active;
  const components = { ...(root.components ?? {}) } as Record<string, unknown>;
  for (const type of useSiteLayoutComponentTypes) {
    const value = useSite.components?.[type];
    if (value !== undefined) components[type] = structuredClone(value);
  }
  if (Object.keys(components).length > 0) root.components = components as NonNullable<UiNode["components"]>;
  else delete root.components;
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
