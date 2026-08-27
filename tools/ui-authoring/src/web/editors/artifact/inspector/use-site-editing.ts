import { applyUseSiteOverridesAtCurrentArtifact, overrideTargetKey, useSiteOverridesForChild } from "../../../../kernel/override.js";
import { findNode, updateNode } from "../../../../kernel/tree.js";
import {
  applyUseSiteComponentAdditionsAtCurrentArtifact,
  componentAdditionTargetKey,
  useSiteComponentAdditionsForChild,
} from "../../../../kernel/use-site-components.js";
import { componentRegistry, defaultComponent, isUseSiteAddable } from "../../../../registry/component-registry.js";
import type {
  UiComponentType,
  UiConcreteSource,
  UiNode,
  UiPropertyOverride,
  UiUseSiteComponentAddition,
} from "../../../../schema/ui-source-schema.js";
import { type SelectionAddress, selectionAddressesShareScope } from "../../../rendering/selection.js";
import type { ArtifactDocument } from "../../../shared/types.js";

const RECT_FIELDS = ["anchorMin", "anchorMax", "pivot", "anchoredPosition", "sizeDelta", "rotation", "scale"] as const;

interface UseSiteContext {
  readonly topNode: UiNode;
  readonly ownerSource: UiConcreteSource;
  readonly rawNode: UiNode;
  readonly relativeInstancePath: readonly string[];
  readonly ownsInstanceRoot: boolean;
}

export interface UseSiteSelectionState {
  readonly source: UiConcreteSource;
  readonly node: UiNode;
  readonly componentState: (componentType: UiComponentType) => "inherited" | "added";
  readonly fieldState: (
    componentType: "Node" | "RectTransform" | UiComponentType,
    fieldPath: string,
  ) => "inherited" | "overridden" | "added";
}

export function resolveUseSiteSelection(
  source: UiConcreteSource,
  address: SelectionAddress,
  artifacts: ReadonlyMap<string, ArtifactDocument>,
): UseSiteSelectionState {
  const context = useSiteContext(source, address, artifacts);
  const prefabRef = context.topNode.components!.PrefabRef!;
  let overrides = [...(prefabRef.overrides ?? [])];
  let additions = [...(prefabRef.componentAdditions ?? [])];
  for (const instanceId of context.relativeInstancePath) {
    overrides = useSiteOverridesForChild(overrides, instanceId);
    additions = useSiteComponentAdditionsForChild(additions, instanceId);
  }
  const effectiveSource = applyUseSiteOverridesAtCurrentArtifact(
    applyUseSiteComponentAdditionsAtCurrentArtifact(context.ownerSource, additions),
    overrides,
  );
  let node = findNode(effectiveSource, address.nodeId) ?? context.rawNode;
  if (context.ownsInstanceRoot) {
    const rootComponents = Object.fromEntries(Object.entries(context.topNode.components ?? {}).filter(([type]) => type !== "PrefabRef"));
    node = {
      ...node,
      active: context.topNode.active ?? true,
      rect: structuredClone(context.topNode.rect),
      components: { ...node.components, ...rootComponents },
    };
  }
  const exactTarget = target(address);
  const componentState = (componentType: UiComponentType): "inherited" | "added" => {
    if (context.ownsInstanceRoot && context.topNode.components?.[componentType] && componentType !== "PrefabRef") return "added";
    return (prefabRef.componentAdditions ?? []).some(
      (addition) =>
        componentAdditionTargetKey(addition) ===
        componentAdditionTargetKey({ target: exactTarget, componentType, value: {} } as UiUseSiteComponentAddition),
    )
      ? "added"
      : "inherited";
  };
  const fieldState = (
    componentType: "Node" | "RectTransform" | UiComponentType,
    fieldPath: string,
  ): "inherited" | "overridden" | "added" => {
    if (componentType !== "Node" && componentType !== "RectTransform" && componentState(componentType) === "added") return "added";
    if (context.ownsInstanceRoot && componentType === "Node") {
      return sameValue(context.topNode.active ?? true, context.rawNode.active ?? true) ? "inherited" : "overridden";
    }
    if (context.ownsInstanceRoot && componentType === "RectTransform") {
      return sameValue(
        rectValue(context.topNode, fieldPath as (typeof RECT_FIELDS)[number]),
        rectValue(context.rawNode, fieldPath as (typeof RECT_FIELDS)[number]),
      )
        ? "inherited"
        : "overridden";
    }
    const key = overrideTargetKey({ target: { ...exactTarget, componentType, fieldPath }, value: null });
    return (prefabRef.overrides ?? []).some((override) => overrideTargetKey(override) === key) ? "overridden" : "inherited";
  };
  return { source: effectiveSource, node, componentState, fieldState };
}

export function updateUseSiteSelection(
  source: UiConcreteSource,
  address: SelectionAddress,
  artifacts: ReadonlyMap<string, ArtifactDocument>,
  updater: (node: UiNode) => UiNode,
): UiConcreteSource {
  const context = useSiteContext(source, address, artifacts);
  const state = resolveUseSiteSelection(source, address, artifacts);
  const current = state.node;
  const next = updater(structuredClone(current));
  if (next.id !== current.id || next.name !== current.name) throw new Error("继承节点不能重命名");
  if (!sameValue(next.children ?? [], current.children ?? [])) throw new Error("继承节点不能移动、删除或修改子节点结构");

  const topNode = structuredClone(context.topNode);
  const prefabRef = topNode.components!.PrefabRef!;
  const exactTarget = target(address);
  const overrides = [...(prefabRef.overrides ?? [])];
  const additions = [...(prefabRef.componentAdditions ?? [])];
  const setOverride = (
    componentType: UiPropertyOverride["target"]["componentType"],
    fieldPath: string,
    inherited: unknown,
    value: unknown,
  ): void => {
    const candidate: UiPropertyOverride = { target: { ...exactTarget, componentType, fieldPath }, value: structuredClone(value) };
    const key = overrideTargetKey(candidate);
    const retained = overrides.filter((override) => overrideTargetKey(override) !== key);
    overrides.splice(0, overrides.length, ...retained);
    if (!sameValue(inherited, value)) overrides.push(candidate);
  };

  if (context.ownsInstanceRoot) {
    if (next.active === false) topNode.active = false;
    else delete topNode.active;
    topNode.rect = structuredClone(next.rect);
  } else {
    setOverride("Node", "active", context.rawNode.active ?? true, next.active ?? true);
    for (const field of RECT_FIELDS) setOverride("RectTransform", field, rectValue(context.rawNode, field), rectValue(next, field));
  }

  const componentTypes = new Set<UiComponentType>([
    ...(Object.keys(context.rawNode.components ?? {}) as UiComponentType[]),
    ...(Object.keys(current.components ?? {}) as UiComponentType[]),
    ...(Object.keys(next.components ?? {}) as UiComponentType[]),
  ]);
  for (const componentType of componentTypes) {
    const inherited = context.rawNode.components?.[componentType] as Record<string, unknown> | undefined;
    const currentValue = current.components?.[componentType] as Record<string, unknown> | undefined;
    const nextValue = next.components?.[componentType] as Record<string, unknown> | undefined;
    const added = !inherited && currentValue !== undefined;
    if (inherited) {
      if (!nextValue) throw new Error(`继承组件 ${componentType} 不能删除`);
      const definition = defaultComponent(componentType) as Record<string, unknown>;
      const fields = new Set([...Object.keys(inherited), ...Object.keys(nextValue)]);
      for (const field of fields) {
        const before = inherited[field] ?? definition[field];
        const after = nextValue[field] ?? definition[field];
        if (sameValue(before, after)) {
          if (componentType !== "PrefabRef") setOverride(componentType, field, before, after);
          continue;
        }
        if (componentType === "PrefabRef" || !isOverrideField(componentType, field)) {
          throw new Error(`继承字段 ${componentType}.${field} 不允许在当前使用位置修改`);
        }
        setOverride(componentType, field, before, after);
      }
      continue;
    }
    if (!added && !nextValue) continue;
    if (componentType === "PrefabRef" || !isUseSiteAddable(componentType)) {
      throw new Error(`当前使用位置不能新增 ${componentType}；只能新增允许的视觉和布局 Component`);
    }
    if (
      nextValue &&
      isGraphic(componentType) &&
      (Object.keys(next.components ?? {}) as UiComponentType[]).some((type) => type !== componentType && isGraphic(type))
    ) {
      throw new Error("同一使用位置节点只能新增一个 Graphic Component");
    }
    if (context.ownsInstanceRoot) {
      const components = { ...topNode.components };
      if (nextValue) components[componentType] = structuredClone(nextValue) as never;
      else delete components[componentType];
      topNode.components = components;
      continue;
    }
    const key = componentAdditionTargetKey({ target: exactTarget, componentType, value: {} } as UiUseSiteComponentAddition);
    const retained = additions.filter((addition) => componentAdditionTargetKey(addition) !== key);
    additions.splice(0, additions.length, ...retained);
    if (nextValue) additions.push({ target: exactTarget, componentType, value: structuredClone(nextValue) } as UiUseSiteComponentAddition);
  }

  if (overrides.length > 0) prefabRef.overrides = overrides;
  else delete prefabRef.overrides;
  if (additions.length > 0) prefabRef.componentAdditions = additions;
  else delete prefabRef.componentAdditions;
  topNode.components = { ...topNode.components, PrefabRef: prefabRef };
  return updateNode(source, topNode.id, () => topNode);
}

export function updateUseSiteSelections(
  source: UiConcreteSource,
  addresses: readonly SelectionAddress[],
  artifacts: ReadonlyMap<string, ArtifactDocument>,
  updater: (node: UiNode) => UiNode,
): UiConcreteSource {
  if (!selectionAddressesShareScope(addresses)) throw new Error("批量使用位置更新只能包含同一 PrefabRef 实例内的引用节点");
  return addresses.reduce((current, address) => updateUseSiteSelection(current, address, artifacts, updater), source);
}

function isGraphic(componentType: UiComponentType): boolean {
  return componentType === "Image" || componentType === "Text" || componentType === "RoundedRect";
}

export function resetUseSiteField(
  source: UiConcreteSource,
  address: SelectionAddress,
  artifacts: ReadonlyMap<string, ArtifactDocument>,
  componentType: UiPropertyOverride["target"]["componentType"],
  fieldPath: string,
): UiConcreteSource {
  const context = useSiteContext(source, address, artifacts);
  if (context.ownsInstanceRoot && componentType === "Node") {
    return updateNode(source, context.topNode.id, (node) => {
      if (context.rawNode.active === false) return { ...node, active: false };
      const next = { ...node };
      delete next.active;
      return next;
    });
  }
  if (context.ownsInstanceRoot && componentType === "RectTransform") {
    if (!RECT_FIELDS.includes(fieldPath as (typeof RECT_FIELDS)[number])) throw new Error(`RectTransform.${fieldPath} 不是可重置字段`);
    const inherited = rectValue(context.rawNode, fieldPath as (typeof RECT_FIELDS)[number]);
    return updateNode(source, context.topNode.id, (node) => {
      const rect = { ...node.rect } as UiNode["rect"];
      if ((fieldPath === "rotation" && inherited === 0) || (fieldPath === "scale" && sameValue(inherited, [1, 1])))
        delete (rect as Record<string, unknown>)[fieldPath];
      else (rect as Record<string, unknown>)[fieldPath] = structuredClone(inherited);
      return { ...node, rect };
    });
  }
  const topNodeId = address.instancePath[0];
  if (!topNodeId) throw new Error("当前选择不是 PrefabRef 继承节点");
  const exactTarget = target(address);
  const key = overrideTargetKey({ target: { ...exactTarget, componentType, fieldPath }, value: null });
  return updateNode(source, topNodeId, (node) => {
    const prefabRef = node.components?.PrefabRef;
    if (!prefabRef) throw new Error(`PrefabRef '${topNodeId}' 不存在`);
    const overrides = (prefabRef.overrides ?? []).filter((override) => overrideTargetKey(override) !== key);
    const next = { ...prefabRef };
    if (overrides.length > 0) next.overrides = overrides;
    else delete next.overrides;
    return { ...node, components: { ...node.components, PrefabRef: next } };
  });
}

function useSiteContext(
  source: UiConcreteSource,
  address: SelectionAddress,
  artifacts: ReadonlyMap<string, ArtifactDocument>,
): UseSiteContext {
  const topNodeId = address.instancePath[0];
  if (!topNodeId) throw new Error("当前选择不是 PrefabRef 继承节点");
  const topNode = findNode(source, topNodeId);
  const firstArtifactKey = topNode?.components?.PrefabRef?.artifactKey;
  if (!topNode || !firstArtifactKey) throw new Error(`PrefabRef '${topNodeId}' 不存在`);
  let ownerSource = artifacts.get(firstArtifactKey)?.resolvedSource;
  for (const instanceId of address.instancePath.slice(1)) {
    const nextArtifactKey: string | undefined = ownerSource
      ? findNode(ownerSource, instanceId)?.components?.PrefabRef?.artifactKey
      : undefined;
    ownerSource = nextArtifactKey ? artifacts.get(nextArtifactKey)?.resolvedSource : undefined;
  }
  if (!ownerSource || ownerSource.artifactKey !== address.ownerArtifactKey)
    throw new Error(`无法解析继承节点 owner '${address.ownerArtifactKey}'`);
  const rawNode = findNode(ownerSource, address.nodeId);
  if (!rawNode) throw new Error(`继承节点 '${address.nodeId}' 不存在`);
  const relativeInstancePath = address.instancePath.slice(1);
  return {
    topNode,
    ownerSource,
    rawNode,
    relativeInstancePath,
    ownsInstanceRoot: relativeInstancePath.length === 0 && rawNode.id === ownerSource.root.id,
  };
}

function target(address: SelectionAddress): UiUseSiteComponentAddition["target"] {
  const instancePath = address.instancePath.slice(1);
  return { ...(instancePath.length > 0 ? { instancePath } : {}), nodeId: address.nodeId };
}

function rectValue(node: UiNode, field: (typeof RECT_FIELDS)[number]): unknown {
  if (field === "rotation") return node.rect.rotation ?? 0;
  if (field === "scale") return node.rect.scale ?? [1, 1];
  return node.rect[field];
}

function isOverrideField(componentType: UiComponentType, field: string): boolean {
  return (componentRegistry[componentType].overrideFields as readonly string[]).includes(field);
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
