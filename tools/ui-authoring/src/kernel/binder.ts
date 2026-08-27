import { componentRegistry } from "../registry/component-registry.js";
import type { UiBindingComponentType, UiNestedTarget, UiNode, UiSource } from "../schema/ui-source-schema.js";
import { bindingTarget, type DerivedBinding, derivedBinding } from "./binding.js";
import { bindingNamePrefix, hasConfirmedBindingNamingRule, isLowerSnakeCase } from "./binding-naming.js";
import { isBindingTargetAssignable, isSupportedBindingComponentType } from "./binding-contract.js";
import { unityNodeName } from "./naming.js";
import type { SourceCatalog, SourceCatalogEntry } from "./source-catalog.js";
import { findNode } from "./tree.js";

type BinderBindingOrigin = "local" | "inherited" | "variantAddition" | "variantOverride";

export interface ResolvedBinderBinding {
  readonly rowKey: string;
  readonly fieldName: string;
  readonly componentType: UiBindingComponentType;
  readonly declaredComponentType: UiBindingComponentType;
  readonly target: UiNestedTarget;
  readonly targetOwnerArtifactKey: string;
  readonly origin: BinderBindingOrigin;
  readonly editable: boolean;
  readonly targetEditable: boolean;
  readonly localIndex?: number;
  readonly error?: string;
  readonly externalTarget?: {
    readonly artifactKey: string;
    readonly nodeId: string;
  };
}

export interface BinderBindingCandidate {
  readonly key: string;
  readonly objectKey: string;
  readonly objectName: string;
  readonly objectLabel: string;
  readonly objectIdPath: string;
  readonly label: string;
  readonly idLabel: string;
  readonly target: UiNestedTarget;
  readonly targetOwnerArtifactKey: string;
}

const AUTO_BINDING_COMPONENT_PRIORITY: readonly UiBindingComponentType[] = [
  "PrefabRef",
  "ScrollRectEx",
  "ScrollRect",
  "ButtonEx",
  "Toggle",
  "Slider",
  "Scrollbar",
  "CustomDropDown",
  "CustomDropDownOption",
  "TMPDropdown",
  "TMPInputField",
  "Text",
  "StateRoot",
  "StateToggle",
  "Image",
  "RoundedRect",
];

function requireEntry(catalog: SourceCatalog, artifactKey: string): SourceCatalogEntry {
  const entry = catalog.entries.get(artifactKey);
  if (!entry) throw new Error(`Artifact '${artifactKey}' is missing from Source Catalog`);
  return entry;
}

function bindingTargetPath(binding: DerivedBinding): readonly string[] {
  return binding.prefabRefNodeId ? [binding.prefabRefNodeId, ...(binding.instancePath ?? [])] : [];
}

function ownerAtPath(
  catalog: SourceCatalog,
  root: SourceCatalogEntry,
  instancePath: readonly string[],
  fieldName: string,
): SourceCatalogEntry {
  let current = root;
  for (const instanceId of instancePath) {
    const instance = findNode(current.resolvedSource, instanceId);
    const artifactKey = instance?.components?.PrefabRef?.artifactKey;
    if (!artifactKey) throw new Error(`Binding '${fieldName}' instance path '${instanceId}' is not a PrefabRef`);
    current = requireEntry(catalog, artifactKey);
  }
  return current;
}

function externalTarget(
  catalog: SourceCatalog,
  root: SourceCatalogEntry,
  binding: DerivedBinding,
  targetOwner: SourceCatalogEntry,
): ResolvedBinderBinding["externalTarget"] {
  if (binding.prefabRefNodeId) return { artifactKey: targetOwner.source.artifactKey, nodeId: binding.nodeId };
  if (binding.componentType !== "PrefabRef") return undefined;
  const node = findNode(root.resolvedSource, binding.nodeId);
  const artifactKey = node?.components?.PrefabRef?.artifactKey;
  if (!artifactKey) return undefined;
  const target = requireEntry(catalog, artifactKey);
  return { artifactKey, nodeId: target.resolvedSource.root.id };
}

export function resolveBinderBindings(catalog: SourceCatalog, artifactKey: string): readonly ResolvedBinderBinding[] {
  const root = requireEntry(catalog, artifactKey);
  if (root.source.artifactType === "Fragment") return [];
  const base = root.baseArtifactKey ? requireEntry(catalog, root.baseArtifactKey) : undefined;
  const inherited = (base?.analyzedBindings ?? []).map((binding) =>
    binding.nodeId === base?.resolvedSource.root.id && !binding.prefabRefNodeId
      ? { ...binding, nodeId: root.resolvedSource.root.id }
      : binding,
  );
  const toRow = (
    binding: DerivedBinding,
    values: {
      readonly rowKey: string;
      readonly origin: BinderBindingOrigin;
      readonly editable: boolean;
      readonly localIndex?: number;
      readonly error?: string;
    },
  ): ResolvedBinderBinding => {
    const instancePath = bindingTargetPath(binding);
    let targetOwner = root;
    try {
      targetOwner = ownerAtPath(catalog, root, instancePath, binding.fieldName);
    } catch {
      // Invalid raw targets remain visible on their owning local declaration.
    }
    const external = values.error ? undefined : externalTarget(catalog, root, binding, targetOwner);
    return {
      rowKey: values.rowKey,
      fieldName: binding.fieldName,
      componentType: binding.componentType,
      declaredComponentType: binding.declaredComponentType,
      target: bindingTarget(binding),
      targetOwnerArtifactKey: targetOwner.source.artifactKey,
      origin: values.origin,
      editable: values.editable,
      targetEditable: values.editable,
      ...(values.localIndex === undefined ? {} : { localIndex: values.localIndex }),
      ...(values.error ? { error: values.error } : {}),
      ...(external ? { externalTarget: external } : {}),
    };
  };
  const rows = inherited.map((binding) =>
    toRow(binding, {
      rowKey: `inherited:${binding.fieldName}`,
      origin: "inherited",
      editable: false,
    }),
  );
  for (const declaration of root.localBindingDeclarations) {
    const binding = { ...derivedBinding(declaration.name, declaration.target), declaredComponentType: declaration.declaredComponentType };
    const row = toRow(binding, {
      rowKey: `local:${declaration.declarationIndex}`,
      origin: root.source.sourceKind === "variant" ? (declaration.isOverride ? "variantOverride" : "variantAddition") : "local",
      editable: true,
      localIndex: declaration.declarationIndex,
      ...(declaration.error ? { error: declaration.error } : {}),
    });
    const inheritedIndex = declaration.isOverride
      ? rows.findIndex((candidate) => candidate.origin === "inherited" && candidate.fieldName === declaration.name)
      : -1;
    if (!declaration.error && inheritedIndex >= 0) rows[inheritedIndex] = row;
    else rows.push(row);
  }
  return rows;
}

function candidateKey(target: UiNestedTarget): string {
  return JSON.stringify([target.instancePath ?? [], target.nodeId, target.componentType]);
}

function candidateObjectKey(target: UiNestedTarget): string {
  return JSON.stringify([target.instancePath ?? [], target.nodeId]);
}

function nodeBindingComponentTypes(node: UiNode): readonly UiBindingComponentType[] {
  const types = new Set<UiBindingComponentType>(["GameObject", "RectTransform"]);
  for (const componentType of Object.keys(node.components ?? {})) {
    if (
      componentType !== "PrefabRef" &&
      componentType in componentRegistry &&
      isSupportedBindingComponentType(componentType as UiBindingComponentType) &&
      hasConfirmedBindingNamingRule(componentType as UiBindingComponentType)
    )
      types.add(componentType as UiBindingComponentType);
  }
  return [...types];
}

export function collectBinderBindingCandidates(catalog: SourceCatalog, artifactKey: string): readonly BinderBindingCandidate[] {
  const root = requireEntry(catalog, artifactKey);
  if (root.source.artifactType === "Fragment") return [];
  const result: BinderBindingCandidate[] = [];
  const add = (
    instancePath: readonly string[],
    instanceNamePath: readonly string[],
    owner: SourceCatalogEntry,
    node: UiNode,
    componentType: UiBindingComponentType,
  ): void => {
    const target: UiNestedTarget = {
      ...(instancePath.length > 0 ? { instancePath: [...instancePath] } : {}),
      nodeId: node.id,
      componentType,
    };
    const objectName = unityNodeName(node);
    const objectLabel = [...instanceNamePath, objectName].join(" / ");
    const objectIdPath = [...instancePath, node.id].join("/");
    result.push({
      key: candidateKey(target),
      objectKey: candidateObjectKey(target),
      objectName,
      objectLabel,
      objectIdPath,
      label: `${objectLabel} · ${componentType}`,
      idLabel: `${objectIdPath} · ${componentType}`,
      target,
      targetOwnerArtifactKey: owner.source.artifactKey,
    });
  };
  const visit = (
    owner: SourceCatalogEntry,
    node: UiNode,
    instancePath: readonly string[],
    instanceNamePath: readonly string[],
    activeArtifacts: ReadonlySet<string>,
  ): void => {
    for (const componentType of nodeBindingComponentTypes(node)) add(instancePath, instanceNamePath, owner, node, componentType);
    const prefabRef = node.components?.PrefabRef;
    if (prefabRef?.artifactKey) {
      const target = requireEntry(catalog, prefabRef.artifactKey);
      if (target.source.artifactType === "Widget") add(instancePath, instanceNamePath, owner, node, "PrefabRef");
      else if (target.source.artifactType === "Fragment" && !activeArtifacts.has(target.source.artifactKey)) {
        visit(
          target,
          target.resolvedSource.root,
          [...instancePath, node.id],
          [...instanceNamePath, unityNodeName(node)],
          new Set([...activeArtifacts, target.source.artifactKey]),
        );
      }
      return;
    }
    for (const child of node.children ?? []) visit(owner, child, instancePath, instanceNamePath, activeArtifacts);
  };
  visit(root, root.resolvedSource.root, [], [], new Set([root.source.artifactKey]));
  return result;
}

function autoBindingPriority(componentType: UiBindingComponentType): number {
  const priority = AUTO_BINDING_COMPONENT_PRIORITY.indexOf(componentType);
  if (priority >= 0) return priority;
  if (componentType === "RectTransform") return 1_000;
  if (componentType === "GameObject") return 1_001;
  return 500;
}

export function preferredBinderBindingCandidate(candidates: readonly BinderBindingCandidate[]): BinderBindingCandidate | undefined {
  return candidates.reduce<BinderBindingCandidate | undefined>((preferred, candidate) => {
    if (!preferred) return candidate;
    return autoBindingPriority(candidate.target.componentType) < autoBindingPriority(preferred.target.componentType)
      ? candidate
      : preferred;
  }, undefined);
}

export function binderCandidateMatchesContract(binding: ResolvedBinderBinding, candidate: BinderBindingCandidate): boolean {
  return isBindingTargetAssignable(binding.declaredComponentType, candidate.target.componentType);
}

export function defaultBinderBindingFieldName(nodeName: string, componentType: UiBindingComponentType): string {
  if (componentType === "PrefabRef") return nodeName;
  const prefix = bindingNamePrefix(componentType);
  if (!prefix) throw new Error(`Binding type '${componentType}' has no confirmed naming prefix`);
  if (isLowerSnakeCase(nodeName)) return nodeName.startsWith(prefix) ? nodeName : `${prefix}${nodeName}`;
  const semanticName = nodeName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return `${prefix}${semanticName || "node"}`;
}

function withBinding(source: UiSource, fieldName: string, target: UiNestedTarget): UiSource {
  return { ...source, bindings: [...(source.bindings ?? []), { name: fieldName, target: structuredClone(target) }] };
}

export function addBinderBinding(source: UiSource, target: UiNestedTarget, fieldName: string): UiSource {
  if (source.artifactType === "Fragment") throw new Error("Fragment 没有 Binder");
  if (source.sourceKind !== "artifact" || (target.instancePath?.length ?? 0) > 0) return withBinding(source, fieldName, target);
  const prefix = bindingNamePrefix(target.componentType);
  const hasExistingTarget = (source.bindings ?? []).some(
    (binding) => (binding.target.instancePath?.length ?? 0) === 0 && binding.target.nodeId === target.nodeId,
  );
  const renameTarget = (node: UiNode): UiNode => {
    const nodeName = unityNodeName(node);
    const shouldRename =
      target.componentType === "PrefabRef"
        ? !hasExistingTarget || fieldName !== nodeName
        : !hasExistingTarget ||
          !isLowerSnakeCase(nodeName) ||
          fieldName === nodeName ||
          (prefix !== undefined && fieldName !== `${prefix}${nodeName}`);
    return {
      ...node,
      ...(node.id === target.nodeId && shouldRename ? { name: fieldName } : {}),
      ...(node.children ? { children: node.children.map(renameTarget) } : {}),
    };
  };
  return withBinding({ ...source, root: renameTarget(source.root) }, fieldName, target);
}

function updateLocalBinding(source: UiSource, localIndex: number, nextFieldName?: string): UiSource {
  if (localIndex < 0 || localIndex >= (source.bindings?.length ?? 0)) throw new Error("Binding declaration index is out of range");
  const entries = (source.bindings ?? []).flatMap((declaration, declarationIndex) => {
    if (declarationIndex !== localIndex) return [declaration];
    return nextFieldName === undefined ? [] : [{ ...declaration, name: nextFieldName }];
  });
  const next = { ...source };
  if (entries.length > 0) next.bindings = entries;
  else delete next.bindings;
  return next;
}

export function removeBinderBinding(source: UiSource, localIndex: number): UiSource {
  return updateLocalBinding(source, localIndex);
}

export function renameBinderBinding(source: UiSource, localIndex: number, nextFieldName: string): UiSource {
  if (source.bindings?.[localIndex]?.name === nextFieldName) return source;
  const declaration = source.bindings?.[localIndex];
  const updated = updateLocalBinding(source, localIndex, nextFieldName);
  if (!declaration || source.sourceKind !== "artifact" || (declaration.target.instancePath?.length ?? 0) > 0) return updated;
  const renameTarget = (node: UiNode): UiNode => ({
    ...node,
    ...(node.id === declaration.target.nodeId && unityNodeName(node) === declaration.name ? { name: nextFieldName } : {}),
    ...(node.children ? { children: node.children.map(renameTarget) } : {}),
  });
  return { ...source, bindings: updated.bindings!, root: renameTarget(source.root) };
}

export function retargetBinderBinding(source: UiSource, localIndex: number, target: UiNestedTarget): UiSource {
  if (localIndex < 0 || localIndex >= (source.bindings?.length ?? 0)) throw new Error("Binding declaration index is out of range");
  return {
    ...source,
    bindings: source.bindings!.map((declaration, declarationIndex) =>
      declarationIndex === localIndex ? { ...declaration, target: structuredClone(target) } : declaration,
    ),
  };
}

export function overrideBinderBindingTarget(source: UiSource, fieldName: string, target: UiNestedTarget): UiSource {
  if (source.sourceKind !== "variant") throw new Error("只有 Variant 可以重定向继承 Binding");
  return withBinding(source, fieldName, target);
}

export function resetBinderBindingTarget(source: UiSource, localIndex: number): UiSource {
  if (source.sourceKind !== "variant") throw new Error("只有 Variant 可以恢复继承 Binding");
  return updateLocalBinding(source, localIndex);
}

export function reorderBinderBinding(source: UiSource, fromIndex: number, toIndex: number): UiSource {
  const bindings = [...(source.bindings ?? [])];
  if (fromIndex < 0 || fromIndex >= bindings.length || toIndex < 0 || toIndex >= bindings.length)
    throw new Error("Binding reorder index is out of range");
  const [declaration] = bindings.splice(fromIndex, 1);
  bindings.splice(toIndex, 0, declaration!);
  return { ...source, bindings };
}
