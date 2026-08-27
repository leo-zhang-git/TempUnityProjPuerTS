import { componentRegistry, isUseSiteAddable } from "../registry/component-registry.js";
import type {
  UiBindings,
  UiComponentType,
  UiNestedTarget,
  UiPropertyOverride,
  UiVariantComponentAddition,
  UiVariantNodeAddition,
  UiVariantSource,
} from "../schema/ui-source-schema.js";
import { canonicalSource } from "./canonical.js";
import { remapComponentNodeReferenceTargets, remapLocalNodeReferenceTargets } from "./node-references.js";
import type { PrefabObservation, PrefabObservationBinding, PrefabObservationNode } from "./prefab-observation.js";
import {
  collectSliderDrivenAxes,
  isUnityEmptyValue,
  normalizeAddedObservation,
  normalizeSliderDrivenRectField,
  observationNodeToSource,
  observedArtifactInitialSize,
  observedComponentFieldExpectation,
  sourceComponentFields,
} from "./prefab-observation.js";
import type { ProjectionBinding, ProjectionNode, UnityProjection } from "./projection.js";

interface NamedBinding {
  readonly fieldName: string;
  readonly target: UiNestedTarget;
}

type VariantPrefabChangeKind =
  | "overridden"
  | "reset"
  | "readonly"
  | "widget-identity"
  | "binding-overlay"
  | "binding-addition"
  | "local-structure"
  | "component-addition"
  | "rename"
  | "toolchain-change";

interface VariantPrefabReconcilePatch {
  readonly kind:
    | "property-override"
    | "artifact-size"
    | "widget-identity"
    | "binding-override"
    | "binding-addition"
    | "node-addition"
    | "component-addition";
  readonly risk: "safe" | "review";
  readonly change: VariantPrefabChangeKind;
  readonly nodeId: string;
  readonly field: string;
  readonly expected: unknown;
  readonly observed: unknown;
}

export interface VariantPrefabReconcileResult {
  readonly artifactKey: string;
  readonly prefabPath: string;
  readonly patches: readonly VariantPrefabReconcilePatch[];
  readonly issues: readonly string[];
  readonly diagnostics: NonNullable<PrefabObservation["diagnostics"]>;
  readonly unityOnlyComponents: readonly { readonly nodeId: string; readonly componentTypes: readonly string[] }[];
  readonly nodeAdditions: readonly UiVariantNodeAddition[];
  readonly componentAdditions: readonly UiVariantComponentAddition[];
  readonly overrides: readonly UiPropertyOverride[];
  readonly initialSize: readonly [number, number] | undefined;
  readonly widgetType: string;
  readonly bindings: readonly NamedBinding[];
}

export interface VariantPrefabReconcileOptions {
  readonly projectionChanged?: boolean;
  readonly artifactKeyByPrefabPath?: ReadonlyMap<string, string>;
}

interface ProjectionEntry {
  readonly node: ProjectionNode;
  readonly parentId: string | null;
  readonly siblingIndex: number;
}

const RECT_OVERRIDE_FIELDS = ["anchorMin", "anchorMax", "pivot", "anchoredPosition", "sizeDelta", "rotation", "scale"] as const;

export function reconcileVariantPrefabObservation(
  source: UiVariantSource,
  baseProjection: UnityProjection,
  variantProjection: UnityProjection,
  observation: PrefabObservation,
  options: VariantPrefabReconcileOptions = {},
): VariantPrefabReconcileResult {
  const diagnostics = [...(observation.diagnostics ?? [])];
  const issues = [...observation.issues, ...diagnostics.map((diagnostic) => diagnostic.message)];
  if (baseProjection.artifactKey !== source.variantOf)
    issues.push(`Variant base mismatch source=${source.variantOf} projection=${baseProjection.artifactKey}`);
  if (
    variantProjection.sourceKind !== "variant" ||
    variantProjection.artifactKey !== source.artifactKey ||
    observation.artifactKey !== source.artifactKey
  ) {
    issues.push(
      `Variant artifactKey mismatch source=${source.artifactKey} projection=${variantProjection.artifactKey} observation=${observation.artifactKey}`,
    );
  }
  if (variantProjection.prefabPath !== observation.prefabPath) {
    issues.push(`prefabPath mismatch projection=${variantProjection.prefabPath} observation=${observation.prefabPath}`);
  }
  if (options.projectionChanged) issues.push("Variant observation requires a stable component manifest before Source reconcile");

  const expectedEntries = flattenProjectionNodes(variantProjection.root);
  const baseEntries = flattenProjectionNodes(baseProjection.root);
  const sliderDrivenAxes = collectSliderDrivenAxes(variantProjection.root);
  const baseById = new Map(baseEntries.map((entry) => [entry.node.id, entry]));
  const observedById = new Map<string, PrefabObservationNode>();
  for (const node of observation.nodes) {
    if (observedById.has(node.id)) issues.push(`duplicate observed node '${node.id}'`);
    observedById.set(node.id, node);
  }
  const variantRootId = variantProjection.root.id;
  const baseRootId = baseProjection.root.id;
  const baseNodeId = (nodeId: string): string => (nodeId === variantRootId ? baseRootId : nodeId);

  const desiredOverrides: UiPropertyOverride[] = [];
  const desiredComponentAdditions: UiVariantComponentAddition[] = [];
  for (const entry of expectedEntries) {
    const observed = observedById.get(entry.node.id);
    const baseEntry = baseById.get(baseNodeId(entry.node.id));
    if (!observed && baseEntry) {
      issues.push(`Variant readonly structure change: node '${entry.node.id}' is missing`);
      continue;
    }
    if (!observed) continue;
    observedById.delete(entry.node.id);
    if (!baseEntry) continue;
    validateVariantStructure(entry, observed, issues);
    validateVariantPrefabRef(entry.node, observed, issues);
    collectNodeOverrides(
      baseEntry.node,
      observed,
      desiredOverrides,
      desiredComponentAdditions,
      issues,
      source.artifactType === "Canvas" && entry.node.id === variantRootId,
      sliderDrivenAxes.get(entry.node.id),
      baseNodeId,
      options.artifactKeyByPrefabPath,
    );
  }
  const desiredNodeAdditions = collectLocalNodeAdditions(
    observation.nodes,
    baseProjection,
    variantProjection,
    options.artifactKeyByPrefabPath,
    issues,
  );
  collectObservedVariantComponentAdditions(
    observation.componentAdditions ?? [],
    variantRootId,
    baseProjection,
    desiredComponentAdditions,
    issues,
  );

  const observedWidgetType = observation.localWidgetType === baseProjection.effectiveWidgetType ? "" : (observation.localWidgetType ?? "");
  if (source.artifactType === "Widget" && (observation.localWidgetType === undefined || observation.effectiveWidgetType === undefined)) {
    issues.push("Widget Variant observation is missing local/effective Widget identity");
  }
  const desiredBindings = reconcileVariantBindings(baseProjection.bindings, observation.bindings ?? [], issues);
  const observedRoot = observation.nodes.find((node) => node.id === variantProjection.root.id);
  const desiredEffectiveInitialSize =
    source.artifactType === "Canvas" || !observedRoot ? undefined : observedArtifactInitialSize(variantProjection.designSize, observedRoot);
  const desiredInitialSize =
    desiredEffectiveInitialSize && !valuesEqual(desiredEffectiveInitialSize, baseProjection.designSize)
      ? desiredEffectiveInitialSize
      : undefined;
  const baseBindingNames = new Set(baseProjection.bindings.map((binding) => binding.fieldName));
  if (
    source.artifactType === "Widget" &&
    !observedWidgetType &&
    desiredBindings.some((binding) => !baseBindingNames.has(binding.fieldName))
  ) {
    issues.push(`Widget Variant '${source.artifactKey}' cannot add Bindings while inheriting Widget identity`);
  }
  const patches = [
    ...(source.artifactType === "Widget" && (source.widgetType ?? "") !== observedWidgetType
      ? [
          {
            kind: "widget-identity" as const,
            risk: "review" as const,
            change: options.projectionChanged === true ? ("toolchain-change" as const) : ("widget-identity" as const),
            nodeId: variantProjection.root.id,
            field: "widgetType",
            expected: source.widgetType ?? "",
            observed: observedWidgetType,
          },
        ]
      : []),
    ...(!valuesEqual(source.initialSize, desiredInitialSize)
      ? [
          {
            kind: "artifact-size" as const,
            risk: "safe" as const,
            change:
              options.projectionChanged === true
                ? ("toolchain-change" as const)
                : desiredInitialSize
                  ? ("overridden" as const)
                  : ("reset" as const),
            nodeId: variantProjection.root.id,
            field: "initialSize",
            expected: source.initialSize,
            observed: desiredInitialSize,
          },
        ]
      : []),
    ...nodeAdditionPatches(source.nodeAdditions ?? [], desiredNodeAdditions, options.projectionChanged === true),
    ...componentAdditionPatches(source.componentAdditions ?? [], desiredComponentAdditions, options.projectionChanged === true),
    ...overridePatches(source.overrides, desiredOverrides, options.projectionChanged === true),
    ...bindingDeclarationPatches(namedBindings(source.bindings), desiredBindings, baseBindingNames, options.projectionChanged === true),
  ];
  const unityOnlyComponents = observation.nodes
    .filter((node) => node.unityOnlyComponents.length > 0)
    .map((node) => ({ nodeId: node.id, componentTypes: node.unityOnlyComponents }));
  return {
    artifactKey: source.artifactKey,
    prefabPath: variantProjection.prefabPath,
    patches,
    issues,
    diagnostics,
    unityOnlyComponents,
    nodeAdditions: desiredNodeAdditions,
    componentAdditions: desiredComponentAdditions,
    overrides: desiredOverrides,
    initialSize: desiredInitialSize,
    widgetType: observedWidgetType,
    bindings: desiredBindings,
  };
}

export function applyVariantPrefabReconcile(source: UiVariantSource, result: VariantPrefabReconcileResult): UiVariantSource {
  if (result.issues.length > 0) throw new Error(`Variant Prefab observation has blocking issues:\n${result.issues.join("\n")}`);
  const next: UiVariantSource = {
    ...structuredClone(source),
    overrides: structuredClone([...result.overrides]),
  };
  if (result.nodeAdditions.length > 0) next.nodeAdditions = structuredClone([...result.nodeAdditions]);
  else delete next.nodeAdditions;
  if (result.componentAdditions.length > 0) next.componentAdditions = structuredClone([...result.componentAdditions]);
  else delete next.componentAdditions;
  if (result.initialSize) next.initialSize = structuredClone(result.initialSize) as [number, number];
  else delete next.initialSize;
  if (source.artifactType === "Widget" && result.widgetType) next.widgetType = result.widgetType;
  else delete next.widgetType;
  if (result.bindings.length > 0) next.bindings = bindingDeclarations(result.bindings);
  else delete next.bindings;
  return next;
}

function collectNodeOverrides(
  base: ProjectionNode,
  observed: PrefabObservationNode,
  desired: UiPropertyOverride[],
  componentAdditions: UiVariantComponentAddition[],
  issues: string[],
  skipRect: boolean,
  sliderDrivenAxes?: ReadonlySet<0 | 1>,
  sourceNodeId: (nodeId: string) => string = (nodeId) => nodeId,
  artifactKeyByPrefabPath?: ReadonlyMap<string, string>,
): void {
  addDesiredOverride(desired, base.id, "Node", "active", base.active, observed.active);
  for (const field of skipRect ? [] : RECT_OVERRIDE_FIELDS) {
    if (!(field in observed.rect)) {
      issues.push(`Variant RectTransform field '${observed.id}.${field}' was not observed`);
      continue;
    }
    const observedValue = normalizeSliderDrivenRectField(field, base.rect[field], observed.rect[field], sliderDrivenAxes);
    addDesiredOverride(desired, base.id, "RectTransform", field, base.rect[field], observedValue);
  }

  for (const [componentType, observedFields] of Object.entries(observed.components)) {
    if (!(componentType in componentRegistry)) {
      issues.push(`Variant readonly component '${observed.id}.${componentType}' is not registered`);
      continue;
    }
    const type = componentType as UiComponentType;
    const sourceObservedFields = remapComponentNodeReferenceTargets(type, observedFields, sourceNodeId);
    const baseComponent = base.components[componentType];
    if (!baseComponent || typeof baseComponent !== "object") {
      if (
        !isUseSiteAddable(componentType) ||
        (isGraphicComponent(componentType) && Object.keys(base.components).some(isGraphicComponent))
      ) {
        issues.push(`Variant readonly component addition '${observed.id}.${componentType}'`);
        continue;
      }
      const additionType = componentType as UiVariantComponentAddition["componentType"];
      componentAdditions.push({
        target: { nodeId: base.id },
        componentType: additionType,
        value: sourceComponentFields(additionType, sourceObservedFields),
      } as UiVariantComponentAddition);
      continue;
    }
    const allowed = new Set(componentRegistry[type].overrideFields as readonly string[]);
    for (const [field, observedValue] of Object.entries(sourceObservedFields)) {
      const baseValue = observedComponentFieldExpectation(type, baseComponent as Record<string, unknown>, field).expected;
      if (baseValue === undefined && isUnityEmptyValue(observedValue)) continue;
      const normalizedBase = sourceOwnedValue(type, field, baseValue, artifactKeyByPrefabPath, issues, base.id);
      const normalizedObserved = sourceOwnedValue(type, field, observedValue, artifactKeyByPrefabPath, issues, observed.id);
      if (valuesEqual(normalizedBase, normalizedObserved)) continue;
      if (!allowed.has(field)) {
        issues.push(`Variant readonly field '${observed.id}.${componentType}.${field}' changed`);
        continue;
      }
      desired.push({ target: { nodeId: base.id, componentType: type, fieldPath: field }, value: normalizedObserved });
    }
  }

  if (observed.completeComponents) {
    for (const componentType of Object.keys(base.components)) {
      if (componentType === "GameObject" || componentType === "RectTransform" || componentType === "PrefabRef") continue;
      if (observed.components[componentType] === undefined)
        issues.push(`Variant readonly component removal '${observed.id}.${componentType}'`);
    }
  }
}

function isGraphicComponent(componentType: string): boolean {
  return componentType === "Image" || componentType === "Text" || componentType === "RoundedRect";
}

function collectObservedVariantComponentAdditions(
  observedAdditions: NonNullable<PrefabObservation["componentAdditions"]>,
  variantRootId: string,
  baseProjection: UnityProjection,
  desired: UiVariantComponentAddition[],
  issues: string[],
): void {
  const baseNodeIds = new Set(flattenProjectionNodes(baseProjection.root).map((entry) => entry.node.id));
  const sourceNodeId = (nodeId: string): string => (nodeId === variantRootId ? baseProjection.root.id : nodeId);
  const additionsByKey = new Map<string, UiVariantComponentAddition>(
    desired.map((addition) => [`${addition.target.nodeId}\0${addition.componentType}`, addition]),
  );
  for (const observed of observedAdditions) {
    if (observed.prefabRefNodeId !== variantRootId) {
      issues.push(`Variant nested PrefabRef component addition '${observed.prefabRefNodeId}' is not supported`);
      continue;
    }
    if ((observed.target.instancePath?.length ?? 0) > 0) {
      issues.push(`Variant component addition '${observed.target.nodeId}.${observed.componentType}' cannot traverse PrefabRef instances`);
      continue;
    }
    const targetNodeId = sourceNodeId(observed.target.nodeId);
    if (!baseNodeIds.has(targetNodeId)) {
      issues.push(`Variant component addition target '${observed.target.nodeId}' is not inherited from the base Artifact`);
      continue;
    }
    if (!isUseSiteAddable(observed.componentType)) {
      issues.push(`Variant cannot add ${observed.componentType} to an inherited node`);
      continue;
    }
    const componentType = observed.componentType as UiComponentType;
    const addition = {
      target: { nodeId: targetNodeId },
      componentType: observed.componentType,
      value: sourceComponentFields(observed.componentType, remapComponentNodeReferenceTargets(componentType, observed.value, sourceNodeId)),
    } as UiVariantComponentAddition;
    const key = `${addition.target.nodeId}\0${addition.componentType}`;
    const existing = additionsByKey.get(key);
    if (existing) {
      if (!valuesEqual(existing, addition)) {
        issues.push(`Variant component addition '${addition.target.nodeId}.${addition.componentType}' was observed twice`);
      }
      continue;
    }
    additionsByKey.set(key, addition);
    desired.push(addition);
  }
}

function collectLocalNodeAdditions(
  observedNodes: readonly PrefabObservationNode[],
  baseProjection: UnityProjection,
  variantProjection: UnityProjection,
  artifactKeyByPrefabPath: ReadonlyMap<string, string> | undefined,
  issues: string[],
): UiVariantNodeAddition[] {
  const baseIds = new Set(flattenProjectionNodes(baseProjection.root).map((entry) => entry.node.id));
  const variantRootId = variantProjection.root.id;
  const baseRootId = baseProjection.root.id;
  const sourceNodeId = (nodeId: string): string => (nodeId === variantRootId ? baseRootId : nodeId);
  const isInherited = (nodeId: string): boolean => nodeId === variantRootId || baseIds.has(nodeId);
  const local = new Map<string, PrefabObservationNode>();
  for (const observed of observedNodes) {
    if (isInherited(observed.id)) continue;
    const normalized = normalizeAddedObservation(observed, artifactKeyByPrefabPath, issues);
    if (normalized) local.set(normalized.id, normalized);
  }

  const children = new Map<string, PrefabObservationNode[]>();
  const roots = new Map<string, PrefabObservationNode[]>();
  for (const observed of local.values()) {
    if (observed.parentId === undefined || observed.parentId === null || observed.siblingIndex === undefined) {
      issues.push(`Variant local node '${observed.id}' has no stable parent or sibling index`);
      continue;
    }
    if (local.has(observed.parentId)) {
      const values = children.get(observed.parentId) ?? [];
      values.push(observed);
      children.set(observed.parentId, values);
      continue;
    }
    if (!isInherited(observed.parentId)) {
      issues.push(`Variant local node '${observed.id}' parent '${observed.parentId}' is neither inherited nor local`);
      continue;
    }
    const parentId = observed.parentId === variantRootId ? baseRootId : observed.parentId;
    const values = roots.get(parentId) ?? [];
    values.push(observed);
    roots.set(parentId, values);
  }

  const build = (observed: PrefabObservationNode, active: Set<string>): ReturnType<typeof observationNodeToSource> => {
    if (active.has(observed.id)) {
      issues.push(`Variant local node cycle includes '${observed.id}'`);
      return observationNodeToSource(observed);
    }
    active.add(observed.id);
    const node = observationNodeToSource(observed);
    const nested = [...(children.get(observed.id) ?? [])].sort(observationOrder).map((child) => build(child, active));
    active.delete(observed.id);
    if (nested.length > 0) node.children = nested;
    return node;
  };

  const result: UiVariantNodeAddition[] = [];
  for (const [parentId, values] of roots) {
    values.sort(observationOrder).forEach(
      (observed, siblingIndex) =>
        void result.push({
          parentId,
          siblingIndex,
          node: remapLocalNodeReferenceTargets(build(observed, new Set()), sourceNodeId),
        }),
    );
  }
  return result.sort(
    (left, right) =>
      left.parentId.localeCompare(right.parentId) || left.siblingIndex - right.siblingIndex || left.node.id.localeCompare(right.node.id),
  );
}

function observationOrder(left: PrefabObservationNode, right: PrefabObservationNode): number {
  return (left.siblingIndex ?? 0) - (right.siblingIndex ?? 0) || left.id.localeCompare(right.id);
}

function validateVariantPrefabRef(expected: ProjectionNode, observed: PrefabObservationNode, issues: string[]): void {
  const expectedRef = expected.components.PrefabRef as { readonly prefabPath?: unknown } | undefined;
  const expectedPath = typeof expectedRef?.prefabPath === "string" ? expectedRef.prefabPath : undefined;
  if (expectedPath === observed.prefabPath) return;
  if (expectedPath || observed.prefabPath) {
    issues.push(
      `Variant readonly PrefabRef change '${expected.id}' expected='${expectedPath ?? ""}' observed='${observed.prefabPath ?? ""}'`,
    );
  }
}

function validateVariantStructure(expected: ProjectionEntry, observed: PrefabObservationNode, issues: string[]): void {
  if (expected.node.name !== observed.name)
    issues.push(`Variant rename is readonly: '${expected.node.id}' expected='${expected.node.name}' observed='${observed.name}'`);
  if (observed.parentId !== undefined && expected.parentId !== observed.parentId) {
    issues.push(
      `Variant readonly node move '${expected.node.id}' expectedParent='${expected.parentId}' observedParent='${observed.parentId}'`,
    );
  }
  if (observed.siblingIndex !== undefined && expected.siblingIndex !== observed.siblingIndex) {
    issues.push(`Variant readonly node order '${expected.node.id}' expected=${expected.siblingIndex} observed=${observed.siblingIndex}`);
  }
}

function reconcileVariantBindings(
  _baseBindings: readonly ProjectionBinding[],
  observedBindings: readonly PrefabObservationBinding[],
  issues: string[],
): NamedBinding[] {
  const observedByName = new Map<string, PrefabObservationBinding>();
  for (const binding of observedBindings) {
    if (observedByName.has(binding.fieldName)) issues.push(`duplicate observed binding name '${binding.fieldName}'`);
    observedByName.set(binding.fieldName, binding);
  }
  const declarations: NamedBinding[] = [];
  for (const observed of observedByName.values()) {
    const target = observationBindingTarget(observed, (nodeId) => nodeId);
    declarations.push({ fieldName: observed.fieldName, target });
  }
  return declarations;
}

function observationBindingTarget(binding: PrefabObservationBinding, nodeId: (value: string) => string): UiNestedTarget {
  return {
    ...(binding.prefabRefNodeId ? { instancePath: [binding.prefabRefNodeId, ...(binding.instancePath ?? [])] } : {}),
    nodeId: nodeId(binding.nodeId),
    componentType: binding.componentType,
  };
}

function overridePatches(
  current: readonly UiPropertyOverride[],
  desired: readonly UiPropertyOverride[],
  projectionChanged: boolean,
): VariantPrefabReconcilePatch[] {
  const currentByKey = new Map(current.map((override) => [overrideKey(override), override]));
  const desiredByKey = new Map(desired.map((override) => [overrideKey(override), override]));
  const keys = new Set([...currentByKey.keys(), ...desiredByKey.keys()]);
  const result: VariantPrefabReconcilePatch[] = [];
  for (const key of keys) {
    const before = currentByKey.get(key);
    const after = desiredByKey.get(key);
    if (valuesEqual(before, after)) continue;
    const target = after?.target ?? before!.target;
    result.push({
      kind: "property-override",
      risk: "review",
      change: projectionChanged ? "toolchain-change" : after ? "overridden" : "reset",
      nodeId: target.nodeId,
      field: `${target.componentType}.${target.fieldPath}`,
      expected: before,
      observed: after,
    });
  }
  return result;
}

function nodeAdditionPatches(
  current: readonly UiVariantNodeAddition[],
  desired: readonly UiVariantNodeAddition[],
  projectionChanged: boolean,
): VariantPrefabReconcilePatch[] {
  const before = canonicalVariantStructure(current, []).nodeAdditions ?? [];
  const after = canonicalVariantStructure(desired, []).nodeAdditions ?? [];
  if (valuesEqual(before, after)) return [];
  return [
    {
      kind: "node-addition",
      risk: "review",
      change: projectionChanged ? "toolchain-change" : after.length > 0 ? "local-structure" : "reset",
      nodeId: after[0]?.node.id ?? before[0]?.node.id ?? "",
      field: "nodeAdditions",
      expected: before,
      observed: after,
    },
  ];
}

function componentAdditionPatches(
  current: readonly UiVariantComponentAddition[],
  desired: readonly UiVariantComponentAddition[],
  projectionChanged: boolean,
): VariantPrefabReconcilePatch[] {
  const before = canonicalVariantStructure([], current).componentAdditions ?? [];
  const after = canonicalVariantStructure([], desired).componentAdditions ?? [];
  if (valuesEqual(before, after)) return [];
  return [
    {
      kind: "component-addition",
      risk: "review",
      change: projectionChanged ? "toolchain-change" : after.length > 0 ? "component-addition" : "reset",
      nodeId: after[0]?.target.nodeId ?? before[0]?.target.nodeId ?? "",
      field: "componentAdditions",
      expected: before,
      observed: after,
    },
  ];
}

function canonicalVariantStructure(
  nodeAdditions: readonly UiVariantNodeAddition[],
  componentAdditions: readonly UiVariantComponentAddition[],
): UiVariantSource {
  return canonicalSource({
    sourceKind: "variant",
    artifactKey: "CanonicalVariant",
    artifactType: "Fragment",
    variantOf: "CanonicalBase",
    ...(nodeAdditions.length > 0 ? { nodeAdditions: structuredClone([...nodeAdditions]) } : {}),
    ...(componentAdditions.length > 0 ? { componentAdditions: structuredClone([...componentAdditions]) } : {}),
    overrides: [],
  });
}

function bindingDeclarationPatches(
  current: readonly NamedBinding[],
  desired: readonly NamedBinding[],
  baseNames: ReadonlySet<string>,
  projectionChanged: boolean,
): VariantPrefabReconcilePatch[] {
  if (valuesEqual(current, desired)) return [];
  const target = desired[0]?.target ?? current[0]?.target;
  const hasAddition = [...current, ...desired].some((binding) => !baseNames.has(binding.fieldName));
  const reset = desired.length === 0 && current.length > 0;
  return [
    {
      kind: hasAddition ? "binding-addition" : "binding-override",
      risk: "review",
      change: projectionChanged ? "toolchain-change" : reset ? "reset" : hasAddition ? "binding-addition" : "binding-overlay",
      nodeId: target?.nodeId ?? "",
      field: "bindings",
      expected: current,
      observed: desired,
    },
  ];
}

function namedBindings(bindings: UiBindings | undefined): NamedBinding[] {
  return (bindings ?? []).map((declaration) => ({ fieldName: declaration.name, target: declaration.target }));
}

function bindingDeclarations(bindings: readonly NamedBinding[]): UiBindings {
  return bindings.map((binding) => ({ name: binding.fieldName, target: structuredClone(binding.target) }));
}

function addDesiredOverride(
  desired: UiPropertyOverride[],
  nodeId: string,
  componentType: "Node" | "RectTransform",
  fieldPath: string,
  baseValue: unknown,
  observedValue: unknown,
): void {
  if (!valuesEqual(baseValue, observedValue))
    desired.push({ target: { nodeId, componentType, fieldPath }, value: structuredClone(observedValue) });
}

function sourceOwnedValue(
  componentType: UiComponentType,
  field: string,
  value: unknown,
  artifactKeyByPrefabPath: ReadonlyMap<string, string> | undefined,
  issues: string[],
  nodeId: string,
): unknown {
  return sourceComponentFields(componentType, { [field]: value }, artifactKeyByPrefabPath, issues, nodeId)[field];
}

function overrideKey(override: UiPropertyOverride): string {
  return `${override.target.nodeId}\0${override.target.componentType}\0${override.target.fieldPath}`;
}

function flattenProjectionNodes(root: ProjectionNode): ProjectionEntry[] {
  const result: ProjectionEntry[] = [];
  const visit = (node: ProjectionNode, parentId: string | null, siblingIndex: number): void => {
    result.push({ node, parentId, siblingIndex });
    node.children.forEach((child, index) => void visit(child, node.id, index));
  };
  visit(root, null, 0);
  return result;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (typeof left === "number" && typeof right === "number") return Math.abs(left - right) <= 0.0001;
  if (Array.isArray(left) && Array.isArray(right))
    return left.length === right.length && left.every((value, index) => valuesEqual(value, right[index]));
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => Object.hasOwn(right, key) && valuesEqual(left[key], right[key]));
  }
  return Object.is(left, right);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
