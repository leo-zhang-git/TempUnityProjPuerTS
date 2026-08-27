import { isStateRootElementType, mapStateRootElementAssetValue } from "../components/state-root-elements.js";
import {
  componentArtifactReferenceFields,
  componentAssetFields,
  componentInspectorFields,
  componentRegistry,
  defaultComponent,
  type InspectorFieldDefinition,
  inspectorFieldDefaultValue,
  isBindingComponentType,
  type RoundtripHandlerId,
} from "../registry/component-registry.js";
import type {
  UiBindingComponentType,
  UiComponentAddition,
  UiComponentAdditionType,
  UiComponentType,
  UiConcreteSource,
  UiNestedTarget,
  UiNode,
  UiSource,
} from "../schema/ui-source-schema.js";
import { unityNodeName } from "./naming.js";
import type { ProjectionNode, UnityProjection } from "./projection.js";
import { findNode, walkNodes } from "./tree.js";
import { assertValidSource } from "./validation.js";

type PrefabObservationIdentity = "marker" | "projection" | "delivery-state" | "generated";

export interface PrefabObservationNode {
  readonly id: string;
  readonly identity: PrefabObservationIdentity;
  readonly name: string;
  readonly namePath: readonly string[];
  readonly siblingPath?: readonly number[];
  readonly parentId?: string | null;
  readonly siblingIndex?: number;
  readonly active: boolean;
  readonly rect: Readonly<Record<string, unknown>>;
  readonly components: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly completeComponents: boolean;
  readonly prefabPath?: string;
  readonly localFileId?: string;
  readonly useSiteIdentity?: string;
  readonly unityOnlyComponents: readonly string[];
  readonly unityOnlySnapshots?: readonly PrefabObservationUnityOnlySnapshot[];
}

interface PrefabObservationUnityOnlySnapshot {
  readonly componentType: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface PrefabObservationBinding {
  readonly fieldName: string;
  readonly nodeId: string;
  readonly componentType: UiBindingComponentType;
  readonly prefabRefNodeId?: string;
  readonly instancePath?: readonly string[];
}

interface PrefabObservationDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly nodeId?: string;
  readonly componentType?: string;
}

interface PrefabObservationComponentAddition {
  readonly prefabRefNodeId: string;
  readonly target: UiComponentAddition["target"];
  readonly componentType: UiComponentAdditionType;
  readonly value: Readonly<Record<string, unknown>>;
}

export interface PrefabObservation {
  readonly artifactKey: string;
  readonly artifactType?: UiSource["artifactType"];
  readonly prefabPath: string;
  readonly observedPrefabPath?: string;
  readonly basePrefabPath?: string;
  readonly suggestedDesignSize?: readonly [number, number];
  readonly prefabGuid?: string;
  readonly rawPrefabHash?: string;
  readonly localWidgetType?: string;
  readonly effectiveWidgetType?: string;
  readonly nodes: readonly PrefabObservationNode[];
  readonly bindings?: readonly PrefabObservationBinding[];
  readonly componentAdditions?: readonly PrefabObservationComponentAddition[];
  readonly diagnostics?: readonly PrefabObservationDiagnostic[];
  readonly issues: readonly string[];
}

type PrefabReconcilePatchKind =
  | "field"
  | "artifact-size"
  | "component"
  | "component-addition"
  | "binding"
  | "widget-identity"
  | "prefab-ref"
  | "node-add"
  | "node-remove"
  | "node-move"
  | "node-order"
  | "node-name";
type PrefabReconcilePatchRisk = "safe" | "review";

export interface PrefabReconcilePatch {
  readonly kind: PrefabReconcilePatchKind;
  readonly risk: PrefabReconcilePatchRisk;
  readonly nodeId: string;
  readonly field: string;
  readonly expected: unknown;
  readonly observed: unknown;
}

export interface PrefabReconcileResult {
  readonly artifactKey: string;
  readonly prefabPath: string;
  readonly patches: readonly PrefabReconcilePatch[];
  readonly issues: readonly string[];
  readonly diagnostics: readonly PrefabObservationDiagnostic[];
  readonly unityOnlyComponents: readonly { readonly nodeId: string; readonly componentTypes: readonly string[] }[];
}

export interface PrefabReconcileOptions {
  readonly artifactKeyByPrefabPath?: ReadonlyMap<string, string>;
  readonly projectionChanged?: boolean;
}

interface ReconcileComponentContext {
  readonly patches: PrefabReconcilePatch[];
  readonly issues: string[];
  readonly nodeId: string;
  readonly componentType: UiComponentType;
  readonly expectedFields: Readonly<Record<string, unknown>>;
  readonly observedFields: Readonly<Record<string, unknown>>;
  readonly artifactKeyByPrefabPath?: ReadonlyMap<string, string>;
}

type RoundtripHandler = (context: ReconcileComponentContext) => void;

export interface ObservedComponentFieldExpectation {
  readonly definition: InspectorFieldDefinition | undefined;
  readonly expected: unknown;
  readonly hasExpected: boolean;
  readonly hasDefault: boolean;
}

export function observedComponentFieldExpectation(
  componentType: UiComponentType,
  expectedFields: Readonly<Record<string, unknown>>,
  field: string,
): ObservedComponentFieldExpectation {
  const definition = componentInspectorFields(componentType).find((entry) => entry.property === field);
  const componentDefault = defaultComponent(componentType) as Record<string, unknown>;
  const inspectorDefault = definition
    ? inspectorFieldDefaultValue(definition, expectedFields, componentRegistry[componentType].inspector)
    : undefined;
  const hasExpected = field in expectedFields;
  const hasComponentDefault = field in componentDefault;
  return {
    definition,
    expected: hasExpected ? expectedFields[field] : hasComponentDefault ? componentDefault[field] : inspectorDefault,
    hasExpected,
    hasDefault: hasComponentDefault || inspectorDefault !== undefined,
  };
}

const roundtripHandlers = {
  bidirectional: ({ patches, issues, nodeId, componentType, expectedFields, observedFields, artifactKeyByPrefabPath }) => {
    const assetFields = new Set(componentAssetFields(componentType).map((field) => field.property));
    const artifactReferenceFields = new Set(componentArtifactReferenceFields(componentType));
    for (const [field, value] of Object.entries(observedFields)) {
      const { definition, expected, hasExpected, hasDefault } = observedComponentFieldExpectation(componentType, expectedFields, field);
      if (definition?.projectDisabledReason) continue;
      const stateRootAssets = componentType === "StateRoot" && field === "elements";
      if (assetFields.has(field) && assetValuesEqual(expected, value)) continue;
      if (artifactReferenceFields.has(field) && valuesEqual(expected, value)) continue;
      if (stateRootAssets && valuesEqual(normalizeStateRootElementAssets(expected), normalizeStateRootElementAssets(value))) continue;
      if (expected === undefined && isUnityEmptyValue(value)) continue;
      if (!hasExpected && !hasDefault && isUnityEmptyValue(value)) continue;
      if (!hasExpected && !hasDefault && !definition) {
        issues.push(`unexpected observed field '${nodeId}.${componentType}.${field}'`);
        continue;
      }
      const observed = stateRootAssets
        ? normalizeStateRootElementAssets(value)
        : assetFields.has(field)
          ? normalizeObservedAssetValue(value)
          : artifactReferenceFields.has(field)
            ? observedArtifactReference(value, artifactKeyByPrefabPath, issues, `${nodeId}.${componentType}.${field}`)
            : value;
      if (observed === undefined && value !== undefined) continue;
      addPatch(patches, "field", "safe", nodeId, `components.${componentType}.${field}`, expected, observed);
    }
  },
  "source-only": () => {},
} satisfies Record<RoundtripHandlerId, RoundtripHandler>;

export function parsePrefabObservation(value: unknown): PrefabObservation {
  if (!value || typeof value !== "object") throw new Error("Prefab observation must be an object");
  const input = value as Record<string, unknown>;
  if (typeof input.artifactKey !== "string" || typeof input.prefabPath !== "string")
    throw new Error("Prefab observation identity is invalid");
  if (
    input.artifactType !== undefined &&
    input.artifactType !== "Canvas" &&
    input.artifactType !== "Widget" &&
    input.artifactType !== "Fragment"
  ) {
    throw new Error("Prefab observation artifactType is invalid");
  }
  if (!Array.isArray(input.nodes) || !Array.isArray(input.issues) || input.issues.some((issue) => typeof issue !== "string")) {
    throw new Error("Prefab observation nodes or issues are invalid");
  }
  const nodes = input.nodes.map((node, index) => parseObservationNode(node, index));
  const bindings = input.bindings === undefined ? undefined : parseObservationBindings(input.bindings);
  const componentAdditions =
    input.componentAdditions === undefined ? undefined : parseObservationComponentAdditions(input.componentAdditions);
  const diagnostics = input.diagnostics === undefined ? undefined : parseObservationDiagnostics(input.diagnostics);
  return {
    artifactKey: input.artifactKey,
    ...(input.artifactType ? { artifactType: input.artifactType as UiSource["artifactType"] } : {}),
    prefabPath: input.prefabPath,
    ...(typeof input.observedPrefabPath === "string" ? { observedPrefabPath: input.observedPrefabPath } : {}),
    ...(typeof input.basePrefabPath === "string" ? { basePrefabPath: input.basePrefabPath } : {}),
    ...(isPositiveVector2(input.suggestedDesignSize) ? { suggestedDesignSize: input.suggestedDesignSize } : {}),
    ...(typeof input.prefabGuid === "string" ? { prefabGuid: input.prefabGuid } : {}),
    ...(typeof input.rawPrefabHash === "string" ? { rawPrefabHash: input.rawPrefabHash } : {}),
    ...(typeof input.localWidgetType === "string" ? { localWidgetType: input.localWidgetType } : {}),
    ...(typeof input.effectiveWidgetType === "string" ? { effectiveWidgetType: input.effectiveWidgetType } : {}),
    nodes,
    ...(bindings ? { bindings } : {}),
    ...(componentAdditions ? { componentAdditions } : {}),
    ...(diagnostics ? { diagnostics } : {}),
    issues: input.issues as string[],
  };
}

function isPositiveVector2(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) && value.length === 2 && value.every((entry) => typeof entry === "number" && Number.isFinite(entry) && entry > 0)
  );
}

export function reconcilePrefabObservation(
  source: UiConcreteSource,
  projection: UnityProjection,
  observation: PrefabObservation,
  options: PrefabReconcileOptions = {},
): PrefabReconcileResult {
  const diagnostics = [...(observation.diagnostics ?? [])];
  const issues = [...observation.issues, ...diagnostics.map((diagnostic) => diagnostic.message)];
  if (source.artifactKey !== projection.artifactKey || source.artifactKey !== observation.artifactKey) {
    issues.push(
      `artifactKey mismatch source=${source.artifactKey} projection=${projection.artifactKey} observation=${observation.artifactKey}`,
    );
  }
  if (projection.prefabPath !== observation.prefabPath) {
    issues.push(`prefabPath mismatch projection=${projection.prefabPath} observation=${observation.prefabPath}`);
  }
  if (options.projectionChanged) issues.push("Prefab observation requires a stable component manifest before Source reconcile");

  const expectedEntries = flattenProjectionNodes(projection.root);
  const expectedNodes = new Map(expectedEntries.map((entry) => [entry.node.id, entry]));
  const sliderDrivenAxes = collectSliderDrivenAxes(projection.root);
  const observedNodes = new Map<string, PrefabObservationNode>();
  for (const node of observation.nodes) {
    if (observedNodes.has(node.id)) issues.push(`duplicate observed node '${node.id}'`);
    observedNodes.set(node.id, node);
  }

  const patches: PrefabReconcilePatch[] = [];
  reconcileArtifactInitialSize(patches, source, observedNodes.get(source.root.id));
  if (source.artifactType === "Widget") {
    if (observation.localWidgetType === undefined || observation.effectiveWidgetType === undefined) {
      issues.push("Widget observation is missing local/effective Widget identity");
    } else {
      if (source.widgetType !== observation.localWidgetType) {
        addPatch(patches, "widget-identity", "review", source.root.id, "widgetType", source.widgetType, observation.localWidgetType);
      }
      if (observation.localWidgetType !== observation.effectiveWidgetType) {
        issues.push(`Base Widget identity differs local=${observation.localWidgetType} effective=${observation.effectiveWidgetType}`);
      }
    }
  }
  for (const entry of expectedEntries) {
    const nodeId = entry.node.id;
    const observed = observedNodes.get(nodeId);
    if (!observed) {
      addPatch(
        patches,
        "node-remove",
        "review",
        nodeId,
        "structure.node",
        nodeSummary(entry.node, entry.parentId, entry.siblingIndex),
        undefined,
      );
      continue;
    }
    reconcileStructure(patches, issues, entry, observed);
    reconcileNodeFields(
      patches,
      issues,
      entry.node,
      observed,
      source.artifactType === "Canvas" && entry.node.id === source.root.id,
      sliderDrivenAxes.get(entry.node.id),
      options.artifactKeyByPrefabPath,
    );
    reconcilePrefabRef(patches, issues, entry.node, observed, options.artifactKeyByPrefabPath);
  }
  for (const observed of observation.nodes) {
    if (expectedNodes.has(observed.id)) continue;
    if (observed.parentId === undefined || observed.siblingIndex === undefined) {
      issues.push(`unexpected observed node '${observed.id}'`);
      continue;
    }
    const normalized = normalizeAddedObservation(observed, options.artifactKeyByPrefabPath, issues);
    if (normalized) addPatch(patches, "node-add", "review", observed.id, "structure.node", undefined, normalized);
  }

  if (observation.componentAdditions) reconcileComponentAdditions(source, expectedNodes, observation.componentAdditions, patches, issues);
  if (observation.bindings) reconcileBindings(source, observation.nodes, observation.bindings, patches, issues);
  const unityOnlyComponents = observation.nodes
    .filter((node) => node.unityOnlyComponents.length > 0)
    .map((node) => ({ nodeId: node.id, componentTypes: node.unityOnlyComponents }));

  const result = { artifactKey: source.artifactKey, prefabPath: projection.prefabPath, patches, issues, diagnostics, unityOnlyComponents };
  if (issues.length === 0) {
    try {
      applyPrefabReconcilePatches(source, result);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }
  return result;
}

function reconcileArtifactInitialSize(
  patches: PrefabReconcilePatch[],
  source: UiConcreteSource,
  observedRoot: PrefabObservationNode | undefined,
): void {
  if (source.artifactType === "Canvas" || !observedRoot) return;
  const nextSize = observedArtifactInitialSize(source.initialSize, observedRoot);
  addPatch(patches, "artifact-size", "safe", source.root.id, "initialSize", source.initialSize, nextSize);
}

export function observedArtifactInitialSize(currentSize: readonly [number, number], observedRoot: PrefabObservationNode): [number, number] {
  const anchorMin = finiteVector2(observedRoot.rect.anchorMin);
  const anchorMax = finiteVector2(observedRoot.rect.anchorMax);
  const sizeDelta = finiteVector2(observedRoot.rect.sizeDelta);
  if (!anchorMin || !anchorMax || !sizeDelta) return [...currentSize];
  const nextSize: [number, number] = [currentSize[0], currentSize[1]];
  for (const axis of [0, 1] as const) {
    const fixed = anchorMin[axis] === anchorMax[axis];
    const size = sizeDelta[axis];
    if (fixed && Number.isFinite(size) && size > 0 && !rootSizeAxisDriven(observedRoot, axis)) nextSize[axis] = size;
  }
  return nextSize;
}

function finiteVector2(value: unknown): readonly [number, number] | undefined {
  return Array.isArray(value) && value.length === 2 && value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
    ? (value as [number, number])
    : undefined;
}

function rootSizeAxisDriven(root: PrefabObservationNode, axis: 0 | 1): boolean {
  const contentSizeFitter = root.components.ContentSizeFitter as Readonly<Record<string, unknown>> | undefined;
  const fit = axis === 0 ? contentSizeFitter?.horizontalFit : contentSizeFitter?.verticalFit;
  if (fit === "minSize" || fit === "preferredSize") return true;

  const aspectRatioFitter = root.components.AspectRatioFitter as Readonly<Record<string, unknown>> | undefined;
  if (!aspectRatioFitter) return false;
  const mode = aspectRatioFitter.aspectMode ?? "widthControlsHeight";
  if (mode === "fitInParent" || mode === "envelopeParent") return true;
  return (axis === 0 && mode === "heightControlsWidth") || (axis === 1 && mode === "widthControlsHeight");
}

export function applyPrefabReconcilePatches(
  source: UiConcreteSource,
  result: PrefabReconcileResult,
  options: { readonly skipNodeName?: boolean } = {},
): UiConcreteSource {
  if (result.issues.length > 0) throw new Error(`Prefab observation has blocking issues:\n${result.issues.join("\n")}`);
  const next = structuredClone(source);

  const additions = result.patches.filter((patch) => patch.kind === "node-add");
  const pending = [...additions];
  while (pending.length > 0) {
    const readyIndex = pending.findIndex((patch) => {
      const observed = patch.observed as PrefabObservationNode;
      return observed.parentId !== undefined && observed.parentId !== null && findNode(next, observed.parentId) !== undefined;
    });
    if (readyIndex < 0) throw new Error(`Unable to resolve parents for added nodes: ${pending.map((patch) => patch.nodeId).join(", ")}`);
    const [patch] = pending.splice(readyIndex, 1);
    const observed = patch!.observed as PrefabObservationNode;
    const parent = findNode(next, observed.parentId!);
    if (!parent) throw new Error(`Invalid observed parent '${observed.parentId}' for '${observed.id}'`);
    parent.children ??= [];
    const children = parent.children;
    children.splice(clampIndex(observed.siblingIndex ?? children.length, children.length), 0, observationNodeToSource(observed));
  }

  for (const patch of result.patches) {
    if (options.skipNodeName && patch.kind === "node-name") continue;
    applyValuePatch(next, patch);
  }

  const removed = new Set(result.patches.filter((patch) => patch.kind === "node-remove").map((patch) => patch.nodeId));
  for (const nodeId of outermostIds(next, removed)) {
    if (!detachNode(next.root, nodeId)) throw new Error(`Unable to remove observed-missing node '${nodeId}'`);
  }

  const moves = result.patches
    .filter((patch) => patch.kind === "node-move" || patch.kind === "node-order")
    .sort((left, right) => observedIndex(left) - observedIndex(right));
  for (const patch of moves) {
    const target = detachNode(next.root, patch.nodeId);
    const observed = patch.observed as { readonly parentId: string; readonly siblingIndex: number };
    const parent = findNode(next, observed.parentId);
    if (!target || !parent) throw new Error(`Unable to move '${patch.nodeId}' to '${observed.parentId}'`);
    parent.children ??= [];
    const children = parent.children;
    children.splice(clampIndex(observed.siblingIndex, children.length), 0, target);
  }

  assertValidSource(next);
  return next;
}

function reconcileStructure(
  patches: PrefabReconcilePatch[],
  issues: string[],
  expected: FlattenedProjectionNode,
  observed: PrefabObservationNode,
): void {
  if (observed.parentId === undefined || observed.siblingIndex === undefined) {
    if (!valuesEqual(expected.namePath, observed.namePath)) {
      issues.push(
        `namePath mismatch id=${expected.node.id} expected=${expected.namePath.join("/")} observed=${observed.namePath.join("/")}`,
      );
    }
    return;
  }
  const expectedName = expected.node.name;
  if (expectedName !== observed.name) {
    addPatch(
      patches,
      "node-name",
      "review",
      expected.node.id,
      "name",
      expectedName === expected.node.id ? undefined : expectedName,
      observed.name === expected.node.id ? undefined : observed.name,
    );
  }
  if (expected.parentId !== observed.parentId) {
    addPatch(
      patches,
      "node-move",
      "review",
      expected.node.id,
      "structure.parent",
      { parentId: expected.parentId, siblingIndex: expected.siblingIndex },
      { parentId: observed.parentId, siblingIndex: observed.siblingIndex },
    );
  } else if (expected.siblingIndex !== observed.siblingIndex) {
    addPatch(patches, "node-order", "review", expected.node.id, "structure.siblingIndex", expected.siblingIndex, {
      parentId: observed.parentId,
      siblingIndex: observed.siblingIndex,
    });
  }
}

function reconcileNodeFields(
  patches: PrefabReconcilePatch[],
  issues: string[],
  expected: ProjectionNode,
  observed: PrefabObservationNode,
  skipRect: boolean,
  sliderDrivenAxes?: ReadonlySet<0 | 1>,
  artifactKeyByPrefabPath?: ReadonlyMap<string, string>,
): void {
  addPatch(patches, "field", "safe", expected.id, "active", expected.active, observed.active);
  for (const [field, value] of skipRect ? [] : Object.entries(observed.rect)) {
    if (!(field in expected.rect)) {
      issues.push(`unsupported observed RectTransform field '${expected.id}.${field}'`);
      continue;
    }
    const expectedValue = expected.rect[field as keyof ProjectionNode["rect"]];
    const observedValue = normalizeSliderDrivenRectField(field, expectedValue, value, sliderDrivenAxes);
    addPatch(patches, "field", "safe", expected.id, `rect.${field}`, expectedValue, observedValue);
  }
  for (const [componentType, fields] of Object.entries(observed.components)) {
    if (componentType === "PrefabRef") continue;
    if (!(componentType in componentRegistry)) {
      issues.push(`unexpected observed component '${expected.id}.${componentType}'`);
      continue;
    }
    const expectedComponent = expected.components[componentType];
    if (!expectedComponent || typeof expectedComponent !== "object") {
      const typedComponent = componentType as UiComponentType;
      addPatch(patches, "component", "review", expected.id, `components.${componentType}`, undefined, {
        ...defaultComponent(typedComponent),
        ...sourceComponentFields(typedComponent, fields, artifactKeyByPrefabPath, issues, expected.id),
      });
      continue;
    }
    const typedComponent = componentType as UiComponentType;
    roundtripHandlers[componentRegistry[typedComponent].roundtrip]({
      patches,
      issues,
      nodeId: expected.id,
      componentType: typedComponent,
      expectedFields: expectedComponent as Record<string, unknown>,
      observedFields: fields,
      ...(artifactKeyByPrefabPath ? { artifactKeyByPrefabPath } : {}),
    });
  }
  if (!observed.completeComponents) return;
  for (const componentType of Object.keys(expected.components)) {
    if (componentType === "PrefabRef") continue;
    if (observed.components[componentType] !== undefined) continue;
    if (!(componentType in componentRegistry)) continue;
    addPatch(patches, "component", "review", expected.id, `components.${componentType}`, expected.components[componentType], undefined);
  }
}

export function collectSliderDrivenAxes(root: ProjectionNode): ReadonlyMap<string, ReadonlySet<0 | 1>> {
  const result = new Map<string, Set<0 | 1>>();
  const visit = (node: ProjectionNode): void => {
    const slider = node.components.Slider;
    if (slider && typeof slider === "object" && !Array.isArray(slider)) {
      const fields = slider as Readonly<Record<string, unknown>>;
      const axis: 0 | 1 = fields.direction === "bottomToTop" || fields.direction === "topToBottom" ? 1 : 0;
      for (const field of ["fillRect", "handleRect"] as const) {
        const targetId = fields[field];
        if (typeof targetId !== "string" || targetId.length === 0) continue;
        const axes = result.get(targetId) ?? new Set<0 | 1>();
        axes.add(axis);
        result.set(targetId, axes);
      }
    }
    node.children.forEach(visit);
  };
  visit(root);
  return result;
}

export function normalizeSliderDrivenRectField(
  field: string,
  expected: unknown,
  observed: unknown,
  drivenAxes?: ReadonlySet<0 | 1>,
): unknown {
  if ((field !== "anchorMin" && field !== "anchorMax") || !drivenAxes || !Array.isArray(expected) || !Array.isArray(observed))
    return observed;
  const normalized = [...observed];
  for (const axis of drivenAxes) normalized[axis] = expected[axis];
  return normalized;
}

function reconcilePrefabRef(
  patches: PrefabReconcilePatch[],
  issues: string[],
  expected: ProjectionNode,
  observed: PrefabObservationNode,
  artifactKeyByPrefabPath?: ReadonlyMap<string, string>,
): void {
  const expectedRef = expected.components.PrefabRef as Record<string, unknown> | undefined;
  if (!expectedRef && !observed.prefabPath) return;
  if (!expectedRef || !observed.prefabPath) {
    issues.push(`PrefabRef structure change for '${expected.id}' requires an explicit node replacement`);
    return;
  }
  const expectedPath = expectedRef.prefabPath;
  if (expectedPath !== observed.prefabPath) {
    const artifactKey = artifactKeyByPrefabPath?.get(observed.prefabPath);
    if (!artifactKey) {
      issues.push(`PrefabRef '${expected.id}' points to an unknown Prefab '${observed.prefabPath}'`);
      return;
    }
    addPatch(patches, "prefab-ref", "review", expected.id, "components.PrefabRef.artifactKey", expectedRef.artifactKey, artifactKey);
  }
}

function reconcileComponentAdditions(
  source: UiConcreteSource,
  projectedNodes: ReadonlyMap<string, FlattenedProjectionNode>,
  observedAdditions: readonly PrefabObservationComponentAddition[],
  patches: PrefabReconcilePatch[],
  issues: string[],
): void {
  const observedByOwner = new Map<string, PrefabObservationComponentAddition[]>();
  const observedKeys = new Set<string>();
  for (const addition of observedAdditions) {
    const owner = findNode(source, addition.prefabRefNodeId);
    if (!owner?.components?.PrefabRef) {
      issues.push(`observed component addition targets missing PrefabRef '${addition.prefabRefNodeId}'`);
      continue;
    }
    const key = `${addition.prefabRefNodeId}\0${componentAdditionTargetKey(addition)}`;
    if (observedKeys.has(key)) {
      issues.push(
        `duplicate observed component addition '${addition.prefabRefNodeId}/${addition.target.nodeId}.${addition.componentType}'`,
      );
      continue;
    }
    observedKeys.add(key);
    const ownerAdditions = observedByOwner.get(addition.prefabRefNodeId) ?? [];
    ownerAdditions.push(addition);
    observedByOwner.set(addition.prefabRefNodeId, ownerAdditions);
  }

  for (const { node } of walkNodes(source)) {
    const prefabRef = node.components?.PrefabRef;
    if (!prefabRef) continue;
    const current = prefabRef.componentAdditions ?? [];
    const projectedRef = projectedNodes.get(node.id)?.node.components.PrefabRef as
      | { readonly componentAdditions?: readonly ProjectedComponentAddition[] }
      | undefined;
    const projected = projectedRef?.componentAdditions ?? [];
    if (projected.length !== current.length) {
      issues.push(`Projection component addition identity mismatch on PrefabRef '${node.id}'`);
      continue;
    }
    const projectedByKey = new Map(current.map((addition, index) => [componentAdditionTargetKey(addition), projected[index]!]));
    const observed = observedByOwner.get(node.id) ?? [];
    const observedByKey = new Map(observed.map((addition) => [componentAdditionTargetKey(addition), addition]));
    const desired: UiComponentAddition[] = [];
    let changed = current.length !== observed.length;
    for (const addition of current) {
      const key = componentAdditionTargetKey(addition);
      const observedAddition = observedByKey.get(key);
      if (!observedAddition) {
        changed = true;
        continue;
      }
      const expectedProjection = projectedByKey.get(key)!;
      if (componentAdditionValuesEqual(addition.componentType, expectedProjection.value, observedAddition.value)) {
        desired.push(structuredClone(addition));
      } else {
        changed = true;
        desired.push(observationComponentAdditionToSource(observedAddition));
      }
      observedByKey.delete(key);
    }
    for (const addition of observedByKey.values()) {
      changed = true;
      desired.push(observationComponentAdditionToSource(addition));
    }
    if (!changed) continue;
    desired.sort(compareComponentAdditions);
    addPatch(
      patches,
      "component-addition",
      "review",
      node.id,
      "components.PrefabRef.componentAdditions",
      current.length > 0 ? current : undefined,
      desired.length > 0 ? desired : undefined,
    );
  }
}

interface ProjectedComponentAddition {
  readonly componentType: UiComponentAdditionType;
  readonly value: Readonly<Record<string, unknown>>;
}

function componentAdditionTargetKey(addition: Pick<UiComponentAddition, "target" | "componentType">): string {
  return `${(addition.target.instancePath ?? []).join("/")}\0${addition.target.nodeId}\0${addition.componentType}`;
}

function compareComponentAdditions(left: UiComponentAddition, right: UiComponentAddition): number {
  const pathOrder = (left.target.instancePath ?? []).join("/").localeCompare((right.target.instancePath ?? []).join("/"));
  if (pathOrder !== 0) return pathOrder;
  const nodeOrder = left.target.nodeId.localeCompare(right.target.nodeId);
  return nodeOrder !== 0 ? nodeOrder : left.componentType.localeCompare(right.componentType);
}

function observationComponentAdditionToSource(addition: PrefabObservationComponentAddition): UiComponentAddition {
  return {
    target: structuredClone(addition.target),
    componentType: addition.componentType,
    value: structuredClone(addition.value),
  } as UiComponentAddition;
}

function componentAdditionValuesEqual(
  componentType: UiComponentAdditionType,
  expected: Readonly<Record<string, unknown>>,
  observed: Readonly<Record<string, unknown>>,
): boolean {
  const assetFields = new Set(componentAssetFields(componentType).map((field) => field.property));
  const fields = new Set([...Object.keys(expected), ...Object.keys(observed)]);
  for (const field of fields) {
    if (assetFields.has(field) ? !assetValuesEqual(expected[field], observed[field]) : !valuesEqual(expected[field], observed[field]))
      return false;
  }
  return true;
}

function reconcileBindings(
  source: UiConcreteSource,
  observedNodes: readonly PrefabObservationNode[],
  bindings: readonly PrefabObservationBinding[],
  patches: PrefabReconcilePatch[],
  issues: string[],
): void {
  const observedByName = new Map<string, PrefabObservationBinding>();
  const observedTargets = new Set<string>();
  const desired = [] as NonNullable<UiConcreteSource["bindings"]>;
  for (const binding of bindings) {
    if (observedByName.has(binding.fieldName)) issues.push(`duplicate observed binding name '${binding.fieldName}'`);
    observedByName.set(binding.fieldName, binding);
    const target = observationBindingTarget(binding);
    const targetKey = JSON.stringify([target.instancePath ?? [], target.nodeId, target.componentType]);
    if (observedTargets.has(targetKey)) issues.push(`duplicate observed binding target '${binding.nodeId}.${binding.componentType}'`);
    observedTargets.add(targetKey);
    if (!validObservedBindingTarget(source, observedNodes, target)) {
      issues.push(
        `observed binding '${binding.fieldName}' targets unsupported Source component '${binding.nodeId}.${binding.componentType}'`,
      );
    }
    desired.push({ name: binding.fieldName, target });
  }
  if (!valuesEqual(source.bindings ?? [], desired))
    addPatch(patches, "binding", "review", source.root.id, "bindings", source.bindings ?? [], desired);
}

function observationBindingTarget(binding: PrefabObservationBinding): UiNestedTarget {
  return {
    ...(binding.prefabRefNodeId ? { instancePath: [binding.prefabRefNodeId, ...(binding.instancePath ?? [])] } : {}),
    nodeId: binding.nodeId,
    componentType: binding.componentType,
  };
}

function validObservedBindingTarget(
  source: UiConcreteSource,
  observedNodes: readonly PrefabObservationNode[],
  target: UiNestedTarget,
): boolean {
  const path = target.instancePath ?? [];
  if (path.length > 0) return findNode(source, path[0]!)?.components?.PrefabRef !== undefined;
  const node = observedNodes.find((entry) => entry.id === target.nodeId);
  if (!node) return false;
  return (
    target.componentType === "GameObject" ||
    target.componentType === "RectTransform" ||
    node.components[target.componentType] !== undefined ||
    (target.componentType === "PrefabRef" && node.prefabPath !== undefined)
  );
}

function parseObservationNode(value: unknown, index: number): PrefabObservationNode {
  if (!value || typeof value !== "object") throw new Error(`Prefab observation node ${index} is invalid`);
  const node = value as Record<string, unknown>;
  if (typeof node.id !== "string" || typeof node.active !== "boolean")
    throw new Error(`Prefab observation node ${index} identity is invalid`);
  if (!Array.isArray(node.namePath) || node.namePath.some((part) => typeof part !== "string"))
    throw new Error(`Prefab observation node ${index} namePath is invalid`);
  if (!node.rect || typeof node.rect !== "object" || Array.isArray(node.rect))
    throw new Error(`Prefab observation node ${index} rect is invalid`);
  if (!node.components || typeof node.components !== "object" || Array.isArray(node.components))
    throw new Error(`Prefab observation node ${index} components is invalid`);
  if (Object.values(node.components).some((fields) => !fields || typeof fields !== "object" || Array.isArray(fields))) {
    throw new Error(`Prefab observation node ${index} component fields are invalid`);
  }
  const identity =
    node.identity === "marker" || node.identity === "delivery-state" || node.identity === "generated" ? node.identity : "projection";
  const name = typeof node.name === "string" ? node.name : ((node.namePath as string[]).at(-1) ?? node.id);
  const parentId = node.parentId === null || typeof node.parentId === "string" ? node.parentId : undefined;
  const siblingIndex =
    typeof node.siblingIndex === "number" && Number.isInteger(node.siblingIndex) && node.siblingIndex >= 0 ? node.siblingIndex : undefined;
  const siblingPath =
    Array.isArray(node.siblingPath) && node.siblingPath.every((part) => typeof part === "number" && Number.isInteger(part) && part >= 0)
      ? (node.siblingPath as number[])
      : undefined;
  const unityOnlyComponents =
    Array.isArray(node.unityOnlyComponents) && node.unityOnlyComponents.every((entry) => typeof entry === "string")
      ? (node.unityOnlyComponents as string[])
      : [];
  const unityOnlySnapshots = Array.isArray(node.unityOnlySnapshots)
    ? node.unityOnlySnapshots.map((entry, snapshotIndex) => {
        if (!entry || typeof entry !== "object")
          throw new Error(`Prefab observation node ${index} Unity-only snapshot ${snapshotIndex} is invalid`);
        const snapshot = entry as Record<string, unknown>;
        if (
          typeof snapshot.componentType !== "string" ||
          !snapshot.fields ||
          typeof snapshot.fields !== "object" ||
          Array.isArray(snapshot.fields)
        ) {
          throw new Error(`Prefab observation node ${index} Unity-only snapshot ${snapshotIndex} fields are invalid`);
        }
        return { componentType: snapshot.componentType, fields: snapshot.fields as Record<string, unknown> };
      })
    : undefined;
  return {
    id: node.id,
    identity,
    name,
    namePath: node.namePath as string[],
    ...(siblingPath !== undefined ? { siblingPath } : {}),
    ...(parentId !== undefined ? { parentId } : {}),
    ...(siblingIndex !== undefined ? { siblingIndex } : {}),
    active: node.active,
    rect: node.rect as Record<string, unknown>,
    components: node.components as Record<string, Record<string, unknown>>,
    completeComponents: node.completeComponents === true,
    ...(typeof node.prefabPath === "string" ? { prefabPath: node.prefabPath } : {}),
    ...(typeof node.localFileId === "string" ? { localFileId: node.localFileId } : {}),
    ...(typeof node.useSiteIdentity === "string" ? { useSiteIdentity: node.useSiteIdentity } : {}),
    unityOnlyComponents,
    ...(unityOnlySnapshots ? { unityOnlySnapshots } : {}),
  };
}

function parseObservationBindings(value: unknown): PrefabObservationBinding[] {
  if (!Array.isArray(value)) throw new Error("Prefab observation bindings are invalid");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`Prefab observation binding ${index} is invalid`);
    const binding = entry as Record<string, unknown>;
    if (
      typeof binding.fieldName !== "string" ||
      typeof binding.nodeId !== "string" ||
      typeof binding.componentType !== "string" ||
      !isBindingComponentType(binding.componentType)
    ) {
      throw new Error(`Prefab observation binding ${index} identity is invalid`);
    }
    const prefabRefNodeId = typeof binding.prefabRefNodeId === "string" ? binding.prefabRefNodeId : undefined;
    const instancePath =
      binding.instancePath === undefined
        ? []
        : Array.isArray(binding.instancePath) && binding.instancePath.every((nodeId) => typeof nodeId === "string")
          ? (binding.instancePath as string[])
          : undefined;
    if (instancePath === undefined || (!prefabRefNodeId && instancePath.length > 0))
      throw new Error(`Prefab observation binding ${index} nested identity is invalid`);
    return {
      fieldName: binding.fieldName,
      nodeId: binding.nodeId,
      componentType: binding.componentType,
      ...(prefabRefNodeId ? { prefabRefNodeId, instancePath } : {}),
    };
  });
}

const componentAdditionTypes = new Set<UiComponentAdditionType>([
  "Image",
  "Text",
  "RoundedRect",
  "LayoutSettings",
  "RectMask2D",
  "ShapeSoftMask",
  "HorizontalLayoutGroup",
  "VerticalLayoutGroup",
  "GridLayoutGroup",
  "ContentSizeFitter",
  "LayoutElement",
  "AspectRatioFitter",
]);

function parseObservationComponentAdditions(value: unknown): PrefabObservationComponentAddition[] {
  if (!Array.isArray(value)) throw new Error("Prefab observation componentAdditions are invalid");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`Prefab observation component addition ${index} is invalid`);
    const addition = entry as Record<string, unknown>;
    const target = addition.target as Record<string, unknown> | undefined;
    const instancePath =
      target?.instancePath === undefined
        ? []
        : Array.isArray(target.instancePath) && target.instancePath.every((nodeId) => typeof nodeId === "string")
          ? (target.instancePath as string[])
          : undefined;
    if (
      typeof addition.prefabRefNodeId !== "string" ||
      typeof addition.componentType !== "string" ||
      !componentAdditionTypes.has(addition.componentType as UiComponentAdditionType) ||
      !target ||
      typeof target.nodeId !== "string" ||
      instancePath === undefined ||
      !addition.value ||
      typeof addition.value !== "object" ||
      Array.isArray(addition.value)
    ) {
      throw new Error(`Prefab observation component addition ${index} identity is invalid`);
    }
    return {
      prefabRefNodeId: addition.prefabRefNodeId,
      target: { ...(instancePath.length > 0 ? { instancePath } : {}), nodeId: target.nodeId },
      componentType: addition.componentType as UiComponentAdditionType,
      value: addition.value as Record<string, unknown>,
    };
  });
}

function parseObservationDiagnostics(value: unknown): PrefabObservationDiagnostic[] {
  if (!Array.isArray(value)) throw new Error("Prefab observation diagnostics are invalid");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`Prefab observation diagnostic ${index} is invalid`);
    const diagnostic = entry as Record<string, unknown>;
    if (typeof diagnostic.code !== "string" || typeof diagnostic.message !== "string") {
      throw new Error(`Prefab observation diagnostic ${index} identity is invalid`);
    }
    for (const field of ["path", "nodeId", "componentType"] as const) {
      if (diagnostic[field] !== undefined && diagnostic[field] !== null && typeof diagnostic[field] !== "string") {
        throw new Error(`Prefab observation diagnostic ${index} ${field} is invalid`);
      }
    }
    return {
      code: diagnostic.code,
      message: diagnostic.message,
      ...(typeof diagnostic.path === "string" ? { path: diagnostic.path } : {}),
      ...(typeof diagnostic.nodeId === "string" ? { nodeId: diagnostic.nodeId } : {}),
      ...(typeof diagnostic.componentType === "string" ? { componentType: diagnostic.componentType } : {}),
    };
  });
}

interface FlattenedProjectionNode {
  readonly node: ProjectionNode;
  readonly namePath: readonly string[];
  readonly parentId: string | null;
  readonly siblingIndex: number;
}

function flattenProjectionNodes(root: ProjectionNode): FlattenedProjectionNode[] {
  const nodes: FlattenedProjectionNode[] = [];
  const visit = (node: ProjectionNode, parentPath: readonly string[], parentId: string | null, siblingIndex: number): void => {
    const namePath = [...parentPath, node.name];
    nodes.push({ node, namePath, parentId, siblingIndex });
    node.children.forEach((child, index) => void visit(child, namePath, node.id, index));
  };
  visit(root, [], null, 0);
  return nodes;
}

export function observationNodeToSource(
  observed: PrefabObservationNode,
  artifactKeyByPrefabPath?: ReadonlyMap<string, string>,
  issues: string[] = [],
): UiNode {
  const components = Object.fromEntries(
    Object.entries(observed.components).map(([type, value]) => [
      type,
      type in componentRegistry
        ? {
            ...defaultComponent(type as UiComponentType),
            ...sourceComponentFields(type as UiComponentType, value, artifactKeyByPrefabPath, issues, observed.id),
          }
        : structuredClone(value),
    ]),
  ) as NonNullable<UiNode["components"]>;
  return {
    id: observed.id,
    ...(observed.name === unityNodeName({ id: observed.id }) ? {} : { name: observed.name }),
    ...(observed.active ? {} : { active: false }),
    rect: structuredClone(observed.rect) as UiNode["rect"],
    ...(Object.keys(observed.components).length > 0 ? { components } : {}),
  };
}

export function sourceComponentFields(
  componentType: UiComponentType,
  fields: Readonly<Record<string, unknown>>,
  artifactKeyByPrefabPath?: ReadonlyMap<string, string>,
  issues: string[] = [],
  nodeId = "observed",
): Record<string, unknown> {
  const artifactReferenceFields = new Set(componentArtifactReferenceFields(componentType));
  const assetFields = new Set(componentAssetFields(componentType).map((entry) => entry.property));
  const inspectorFields = new Map(componentInspectorFields(componentType).map((entry) => [entry.property, entry]));
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([field, value]) => {
        const definition = inspectorFields.get(field);
        if (definition?.projectDisabledReason) return false;
        const assetField = assetFields.has(field);
        if (artifactReferenceFields.has(field) && (value === "" || value === null)) return false;
        if (assetField && value === "") return false;
        if (value !== null) return true;
        return definition !== undefined && "nullable" in definition && definition.nullable === true;
      })
      .map(([field, value]) => {
        const assetField = assetFields.has(field);
        const normalized =
          componentType === "StateRoot" && field === "elements"
            ? normalizeStateRootElementAssets(value)
            : assetField
              ? normalizeObservedAssetValue(value)
              : artifactReferenceFields.has(field)
                ? observedArtifactReference(value, artifactKeyByPrefabPath, issues, `${nodeId}.${componentType}.${field}`)
                : value;
        return [field, structuredClone(normalized)];
      })
      .filter(([, value]) => value !== undefined),
  );
}

function observedArtifactReference(
  value: unknown,
  artifactKeyByPrefabPath: ReadonlyMap<string, string> | undefined,
  issues: string[],
  owner: string,
): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  if (!artifactKeyByPrefabPath) return value;
  const artifactKey = artifactKeyByPrefabPath?.get(value);
  if (!artifactKey) {
    issues.push(`Artifact reference '${owner}' points to an unknown Prefab '${value}'`);
    return undefined;
  }
  return artifactKey;
}

function normalizeStateRootElementAssets(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((rawElement) => {
    if (!isPlainObject(rawElement) || !isStateRootElementType(rawElement.elementType) || !isPlainObject(rawElement.values))
      return rawElement;
    const elementType = rawElement.elementType;
    return {
      ...rawElement,
      values: Object.fromEntries(
        Object.entries(rawElement.values).map(([stateName, elementValue]) => [
          stateName,
          mapStateRootElementAssetValue(elementType, elementValue, (path) => String(normalizeObservedAssetValue(path))),
        ]),
      ),
    };
  });
}

export function normalizeAddedObservation(
  observed: PrefabObservationNode,
  artifactKeyByPrefabPath: ReadonlyMap<string, string> | undefined,
  issues: string[],
): PrefabObservationNode | undefined {
  const normalizedComponents = Object.fromEntries(
    Object.entries(observed.components).map(([componentType, fields]) => [
      componentType,
      componentType in componentRegistry
        ? sourceComponentFields(componentType as UiComponentType, fields, artifactKeyByPrefabPath, issues, observed.id)
        : fields,
    ]),
  );
  if (!observed.prefabPath) return { ...observed, components: normalizedComponents };
  const artifactKey = artifactKeyByPrefabPath?.get(observed.prefabPath);
  if (!artifactKey) {
    issues.push(`Added PrefabRef '${observed.id}' points to an unknown Prefab '${observed.prefabPath}'`);
    return undefined;
  }
  return { ...observed, components: { ...normalizedComponents, PrefabRef: { artifactKey } } };
}

function applyValuePatch(source: UiConcreteSource, patch: PrefabReconcilePatch): void {
  if (patch.kind === "node-add" || patch.kind === "node-remove" || patch.kind === "node-move" || patch.kind === "node-order") return;
  if (patch.kind === "artifact-size") {
    if (source.artifactType === "Canvas") throw new Error("Canvas cannot apply an Artifact initialSize patch");
    source.initialSize = structuredClone(patch.observed) as [number, number];
    return;
  }
  if (patch.kind === "binding") {
    const bindings = structuredClone(patch.observed) as UiConcreteSource["bindings"];
    if (bindings && bindings.length > 0) source.bindings = bindings;
    else delete source.bindings;
    return;
  }
  if (patch.kind === "widget-identity") {
    source.widgetType = String(patch.observed ?? "");
    return;
  }
  const node = findNode(source, patch.nodeId);
  if (!node) throw new Error(`Observed patch target '${patch.nodeId}' is missing`);
  if (patch.kind === "node-name") {
    if (patch.observed === undefined) delete node.name;
    else node.name = String(patch.observed);
    return;
  }
  setNestedValue(node as unknown as Record<string, unknown>, patch.field.split("."), patch.observed);
}

function setNestedValue(target: Record<string, unknown>, segments: readonly string[], value: unknown): void {
  let current = target;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (!next || typeof next !== "object" || Array.isArray(next)) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  const leaf = segments.at(-1)!;
  if (value === undefined) delete current[leaf];
  else current[leaf] = structuredClone(value);
}

function detachNode(root: UiNode, nodeId: string): UiNode | undefined {
  const children = root.children ?? [];
  const index = children.findIndex((child) => child.id === nodeId);
  if (index >= 0) return children.splice(index, 1)[0];
  for (const child of children) {
    const result = detachNode(child, nodeId);
    if (result) return result;
  }
  return undefined;
}

function outermostIds(source: UiConcreteSource, ids: ReadonlySet<string>): string[] {
  return walkNodes(source)
    .filter((entry) => ids.has(entry.node.id) && !entry.path.slice(0, -1).some((id) => ids.has(id)))
    .map((entry) => entry.node.id);
}

function nodeSummary(node: ProjectionNode, parentId: string | null, siblingIndex: number): unknown {
  return { id: node.id, name: node.name, parentId, siblingIndex };
}

function addPatch(
  patches: PrefabReconcilePatch[],
  kind: PrefabReconcilePatchKind,
  risk: PrefabReconcilePatchRisk,
  nodeId: string,
  field: string,
  expected: unknown,
  observed: unknown,
): void {
  if (!valuesEqual(expected, observed)) patches.push({ kind, risk, nodeId, field, expected, observed });
}

function observedIndex(patch: PrefabReconcilePatch): number {
  return typeof patch.observed === "object" && patch.observed !== null && "siblingIndex" in patch.observed
    ? Number((patch.observed as { readonly siblingIndex: number }).siblingIndex)
    : Number.MAX_SAFE_INTEGER;
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, length));
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left === "number" && typeof right === "number") return Math.abs(left - right) <= 0.0001;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => valuesEqual(value, right[index]));
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => Object.hasOwn(right, key) && valuesEqual(left[key], right[key]));
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isUnityEmptyValue(value: unknown): boolean {
  return value === null || value === "" || value === undefined;
}

function normalizeObservedAssetValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeObservedAssetValue);
  return typeof value === "string" ? value.replaceAll("\\", "/").replace(/^Assets\/Resources\/UI\//, "") : value;
}

function assetValuesEqual(left: unknown, right: unknown): boolean {
  return valuesEqual(normalizeObservedAssetValue(left), normalizeObservedAssetValue(right));
}
