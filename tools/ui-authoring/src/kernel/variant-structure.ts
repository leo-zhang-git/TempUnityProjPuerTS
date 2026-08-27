import { isUseSiteAddable } from "../registry/component-registry.js";
import type { UiConcreteSource, UiNode, UiVariantComponentAddition, UiVariantNodeAddition } from "../schema/ui-source-schema.js";
import { findNode, walkNodes } from "./tree.js";
import { applyUseSiteComponentAdditionsAtCurrentArtifact, componentAdditionTargetKey } from "./use-site-components.js";

export function applyVariantStructure(
  base: UiConcreteSource,
  nodeAdditions: readonly UiVariantNodeAddition[],
  componentAdditions: readonly UiVariantComponentAddition[],
): UiConcreteSource {
  const inheritedIds = new Set(walkNodes(base).map(({ node }) => node.id));
  validateVariantComponentAdditions(base, componentAdditions, inheritedIds);
  let result = applyUseSiteComponentAdditionsAtCurrentArtifact(base, componentAdditions);

  const localIds = new Set<string>();
  for (const addition of nodeAdditions) {
    if (!inheritedIds.has(addition.parentId)) {
      throw new Error(`Variant node addition '${addition.node.id}' parent '${addition.parentId}' is not inherited from the base Artifact`);
    }
    for (const { node } of walkNode(addition.node)) {
      if (inheritedIds.has(node.id) || localIds.has(node.id)) {
        throw new Error(`Variant node addition id '${node.id}' conflicts with an inherited or local node`);
      }
      localIds.add(node.id);
    }
  }

  const siblingKeys = new Set<string>();
  const grouped = new Map<string, UiVariantNodeAddition[]>();
  for (const addition of nodeAdditions) {
    const key = `${addition.parentId}\0${addition.siblingIndex}`;
    if (siblingKeys.has(key)) {
      throw new Error(`Variant node additions under '${addition.parentId}' have duplicate siblingIndex ${addition.siblingIndex}`);
    }
    siblingKeys.add(key);
    const values = grouped.get(addition.parentId) ?? [];
    values.push(addition);
    grouped.set(addition.parentId, values);
  }

  result = structuredClone(result);
  for (const [parentId, additions] of grouped) {
    const parent = findNode(result, parentId);
    if (!parent) throw new Error(`Variant node addition parent '${parentId}' does not exist`);
    parent.children ??= [];
    const children = parent.children;
    for (const addition of additions.sort(
      (left, right) => left.siblingIndex - right.siblingIndex || left.node.id.localeCompare(right.node.id),
    )) {
      children.push(structuredClone(addition.node));
    }
  }
  return result;
}

function validateVariantComponentAdditions(
  base: UiConcreteSource,
  additions: readonly UiVariantComponentAddition[],
  inheritedIds: ReadonlySet<string>,
): void {
  const keys = new Set<string>();
  for (const addition of additions) {
    if ((addition.target.instancePath?.length ?? 0) > 0) {
      throw new Error(
        `Variant component addition '${addition.target.nodeId}.${addition.componentType}' cannot traverse PrefabRef instances`,
      );
    }
    if (!inheritedIds.has(addition.target.nodeId)) {
      throw new Error(`Variant component addition target '${addition.target.nodeId}' is not inherited from the base Artifact`);
    }
    if (!isUseSiteAddable(addition.componentType)) {
      throw new Error(`Variant cannot add ${addition.componentType} to an inherited node`);
    }
    const key = componentAdditionTargetKey(addition);
    if (keys.has(key)) throw new Error(`Variant has duplicate ${addition.componentType} addition on '${addition.target.nodeId}'`);
    keys.add(key);
    const node = findNode(base, addition.target.nodeId)!;
    if (node.components?.[addition.componentType]) {
      throw new Error(`Variant component addition target '${addition.target.nodeId}' already inherits ${addition.componentType}`);
    }
    if (isGraphicComponent(addition.componentType) && Object.keys(node.components ?? {}).some(isGraphicComponent)) {
      throw new Error(
        `Variant cannot add ${addition.componentType} to '${addition.target.nodeId}' because it already inherits a Graphic component`,
      );
    }
  }
}

function isGraphicComponent(componentType: string): boolean {
  return componentType === "Image" || componentType === "Text" || componentType === "RoundedRect";
}

function walkNode(root: UiNode): { readonly node: UiNode }[] {
  return walkNodes({
    sourceKind: "artifact",
    artifactKey: "VariantLocal",
    artifactType: "Fragment",
    initialSize: [1, 1],
    root,
  });
}
