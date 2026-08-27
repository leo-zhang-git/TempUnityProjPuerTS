import { Value } from "@sinclair/typebox/value";
import { type StateRootElementType, type StateRootElementValue, stateRootElementDescriptor } from "../components/state-root-elements.js";
import {
  type ComponentPreviewFieldDefinition,
  componentPreviewField,
  previewCapabilityComponentTypes,
} from "../registry/component-registry.js";
import type { AuthoringAssetCatalog, AuthoringAssetKind } from "../schema/asset-catalog.js";
import type { UiBindingComponentType, UiComponentType, UiConcreteSource, UiNode, UiPropertyOverride } from "../schema/ui-source-schema.js";
import { resolveBinderBindings } from "./binder.js";
import { type EvaluatedNode, evaluateLayout } from "./layout.js";
import { applyUseSiteOverridesAtCurrentArtifact } from "./override.js";
import type { SourceCatalog } from "./source-catalog.js";
import { findNode, updateNode, walkNodes } from "./tree.js";

type PreviewValuesOwnerKind = "reference" | "context" | "collectionItem" | "mount" | "prototypeSession";

interface PreviewValuesOwner {
  readonly kind: PreviewValuesOwnerKind;
  readonly artifactKey: string;
  readonly path?: string;
}

export type PreviewValues = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

type PreviewValuesDiagnosticCategory =
  | "invalidOwner"
  | "missingBinder"
  | "wrongComponent"
  | "wrongValueType"
  | "invalidValue"
  | "unsupportedCapability"
  | "activeConflict"
  | "assetIssue";

export interface PreviewValuesDiagnostic {
  readonly category: PreviewValuesDiagnosticCategory;
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly fieldName?: string;
  readonly capability?: string;
  readonly componentType?: UiBindingComponentType;
  readonly nodeId?: string;
}

export interface ResolvedPreviewValuePatch {
  readonly owner: PreviewValuesOwner;
  readonly fieldName: string;
  readonly capability: string;
  readonly value: unknown;
  readonly baselineValue?: unknown;
  readonly componentType: UiBindingComponentType;
  readonly nodeId: string;
  readonly targetArtifactKey: string;
  readonly instancePath: readonly string[];
  readonly definition?: ComponentPreviewFieldDefinition;
}

export interface ResolvedPreviewValues {
  readonly valid: boolean;
  readonly patches: readonly ResolvedPreviewValuePatch[];
  readonly diagnostics: readonly PreviewValuesDiagnostic[];
}

export interface ResolvePreviewValuesInput {
  readonly catalog: SourceCatalog;
  readonly owner: PreviewValuesOwner;
  readonly values: Readonly<Record<string, unknown>>;
  readonly assetCatalog?: AuthoringAssetCatalog;
}

function pointerToken(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function valuePath(owner: PreviewValuesOwner, fieldName?: string, capability?: string): string {
  const base = owner.path ?? "/values";
  return [
    base.replace(/\/$/, ""),
    fieldName === undefined ? undefined : pointerToken(fieldName),
    capability === undefined ? undefined : pointerToken(capability),
  ]
    .filter((part): part is string => part !== undefined)
    .join("/");
}

function diagnostic(
  owner: PreviewValuesOwner,
  category: PreviewValuesDiagnosticCategory,
  code: string,
  message: string,
  target: Omit<PreviewValuesDiagnostic, "category" | "code" | "path" | "message"> = {},
): PreviewValuesDiagnostic {
  return {
    category,
    code,
    path: valuePath(owner, target.fieldName, target.capability),
    message,
    ...target,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function targetIdentity(patch: Pick<ResolvedPreviewValuePatch, "instancePath" | "nodeId">): string {
  return `${patch.instancePath.join("/")}\0${patch.nodeId}`;
}

function normalizedAssetPath(path: string): string {
  return path
    .replaceAll("\\", "/")
    .replace(/^Assets\/UI\//i, "")
    .toLocaleLowerCase("en-US");
}

function validateAsset(
  catalog: AuthoringAssetCatalog,
  path: string,
  expectedKind: AuthoringAssetKind,
): { readonly code: string; readonly message: string } | undefined {
  const normalized = normalizedAssetPath(path);
  const asset = catalog.assets.find((candidate) => normalizedAssetPath(candidate.path) === normalized);
  if (asset && asset.kind !== expectedKind) {
    return { code: "previewValues.asset.kind", message: `Asset '${path}' is ${asset.kind}, expected ${expectedKind}` };
  }
  if (asset) return undefined;
  const catalogIssue = catalog.issues.find((candidate) => normalizedAssetPath(candidate.path) === normalized);
  if (catalogIssue) return { code: "previewValues.asset.catalog", message: catalogIssue.message };
  return { code: "previewValues.asset.missing", message: `Asset '${path}' is missing from the Asset Catalog` };
}

function componentValue(
  source: UiConcreteSource,
  node: UiNode,
  componentType: UiBindingComponentType,
  definition: ComponentPreviewFieldDefinition,
): unknown {
  if (definition.handler === "stateRootState") return node.components?.StateRoot?.currentState;
  if (definition.handler === "tmpInputFieldText") {
    const textNodeId = node.components?.TMPInputField?.textComponent;
    return textNodeId ? (findNode(source, textNodeId)?.components?.Text?.text ?? definition.defaultValue) : definition.defaultValue;
  }
  if (!definition.sourceProperty || componentType === "GameObject" || componentType === "RectTransform") return definition.defaultValue;
  const value = (node.components?.[componentType as UiComponentType] as Readonly<Record<string, unknown>> | undefined)?.[
    definition.sourceProperty
  ];
  return value === undefined ? definition.defaultValue : value;
}

function componentTargetDiagnostic(
  owner: PreviewValuesOwner,
  fieldName: string,
  componentType: UiBindingComponentType,
  node: UiNode,
): PreviewValuesDiagnostic | undefined {
  if (componentType === "GameObject" || componentType === "RectTransform") return undefined;
  if (node.components?.[componentType]) return undefined;
  return diagnostic(
    owner,
    "wrongComponent",
    "previewValues.binder.component",
    `Binder '${fieldName}' target '${node.id}' has no ${componentType} component`,
    { fieldName, componentType, nodeId: node.id },
  );
}

function capabilityDiagnostic(
  owner: PreviewValuesOwner,
  fieldName: string,
  componentType: UiBindingComponentType,
  nodeId: string,
  capability: string,
): PreviewValuesDiagnostic {
  const owners = previewCapabilityComponentTypes(capability);
  if (owners.length > 0) {
    return diagnostic(
      owner,
      "wrongComponent",
      "previewValues.capability.component",
      `Capability '${capability}' belongs to ${owners.join(", ")}, but Binder '${fieldName}' targets ${componentType}`,
      { fieldName, capability, componentType, nodeId },
    );
  }
  return diagnostic(
    owner,
    "unsupportedCapability",
    "previewValues.capability.unsupported",
    `Binder '${fieldName}' target ${componentType} does not support Preview capability '${capability}'`,
    { fieldName, capability, componentType, nodeId },
  );
}

export function resolvePreviewValues(input: ResolvePreviewValuesInput): ResolvedPreviewValues {
  const { catalog, owner, assetCatalog } = input;
  const ownerEntry = catalog.entries.get(owner.artifactKey);
  if (!ownerEntry) {
    const invalidOwner = diagnostic(
      owner,
      "invalidOwner",
      "previewValues.owner.missing",
      `Preview Values owner '${owner.artifactKey}' is missing from the Source Catalog`,
    );
    return { valid: false, patches: [], diagnostics: [invalidOwner] };
  }
  if (ownerEntry.source.artifactType === "Fragment") {
    const invalidOwner = diagnostic(
      owner,
      "invalidOwner",
      "previewValues.owner.fragment",
      `Fragment '${owner.artifactKey}' cannot own Preview Values`,
    );
    return { valid: false, patches: [], diagnostics: [invalidOwner] };
  }
  if ((owner.kind === "collectionItem" || owner.kind === "mount") && ownerEntry.source.artifactType !== "Widget") {
    const invalidOwner = diagnostic(
      owner,
      "invalidOwner",
      "previewValues.owner.widget",
      `${owner.kind} Preview Values owner '${owner.artifactKey}' must be a Widget`,
    );
    return { valid: false, patches: [], diagnostics: [invalidOwner] };
  }

  const bindings = new Map(resolveBinderBindings(catalog, owner.artifactKey).map((binding) => [binding.fieldName, binding]));
  const diagnostics: PreviewValuesDiagnostic[] = [];
  const patches: ResolvedPreviewValuePatch[] = [];

  for (const [fieldName, rawPatch] of Object.entries(input.values)) {
    const binding = bindings.get(fieldName);
    if (!binding) {
      diagnostics.push(
        diagnostic(
          owner,
          "missingBinder",
          "previewValues.binder.missing",
          `Preview Values owner '${owner.artifactKey}' has no Binder field '${fieldName}'`,
          { fieldName },
        ),
      );
      continue;
    }
    if (!isRecord(rawPatch) || Object.keys(rawPatch).length === 0) {
      diagnostics.push(
        diagnostic(owner, "wrongValueType", "previewValues.patch.type", `Binder '${fieldName}' Preview patch must be a non-empty object`, {
          fieldName,
          componentType: binding.componentType,
          nodeId: binding.target.nodeId,
        }),
      );
      continue;
    }

    const targetEntry = catalog.entries.get(binding.targetOwnerArtifactKey);
    const node = targetEntry ? findNode(targetEntry.resolvedSource, binding.target.nodeId) : undefined;
    if (!targetEntry || !node) {
      diagnostics.push(
        diagnostic(
          owner,
          "wrongComponent",
          "previewValues.binder.target",
          `Binder '${fieldName}' target '${binding.target.nodeId}' cannot be resolved`,
          { fieldName, componentType: binding.componentType, nodeId: binding.target.nodeId },
        ),
      );
      continue;
    }
    const targetIssue = componentTargetDiagnostic(owner, fieldName, binding.componentType, node);
    if (targetIssue) {
      diagnostics.push(targetIssue);
      continue;
    }

    for (const [capability, value] of Object.entries(rawPatch)) {
      const common = {
        owner,
        fieldName,
        capability,
        value,
        componentType: binding.componentType,
        nodeId: binding.target.nodeId,
        targetArtifactKey: binding.targetOwnerArtifactKey,
        instancePath: binding.target.instancePath ?? [],
      } satisfies Omit<ResolvedPreviewValuePatch, "baselineValue" | "definition">;
      if (capability === "active") {
        if (typeof value !== "boolean") {
          diagnostics.push(
            diagnostic(
              owner,
              "wrongValueType",
              "previewValues.value.type",
              `Preview capability '${fieldName}.active' requires a boolean value`,
              { fieldName, capability, componentType: binding.componentType, nodeId: node.id },
            ),
          );
          continue;
        }
        patches.push({ ...common, baselineValue: node.active ?? true });
        continue;
      }

      const definition = componentPreviewField(binding.componentType, capability);
      if (!definition) {
        diagnostics.push(capabilityDiagnostic(owner, fieldName, binding.componentType, node.id, capability));
        continue;
      }
      if (value === undefined || !Value.Check(definition.schema, value)) {
        diagnostics.push(
          diagnostic(
            owner,
            "wrongValueType",
            "previewValues.value.type",
            `Preview capability '${fieldName}.${capability}' has an invalid value type`,
            { fieldName, capability, componentType: binding.componentType, nodeId: node.id },
          ),
        );
        continue;
      }
      if (definition.handler === "stateRootState" && !node.components?.StateRoot?.states[String(value)]) {
        diagnostics.push(
          diagnostic(
            owner,
            "invalidValue",
            "previewValues.state.missing",
            `StateRoot '${node.id}' does not declare state '${String(value)}'`,
            { fieldName, capability, componentType: binding.componentType, nodeId: node.id },
          ),
        );
        continue;
      }
      if (definition.handler === "tmpInputFieldText") {
        const textNodeId = node.components?.TMPInputField?.textComponent;
        const textNode = textNodeId ? findNode(targetEntry.resolvedSource, textNodeId) : undefined;
        if (!textNode?.components?.Text) {
          diagnostics.push(
            diagnostic(
              owner,
              "wrongComponent",
              "previewValues.tmpInputField.textComponent",
              `TMPInputField '${node.id}' does not resolve a Text component`,
              { fieldName, capability, componentType: binding.componentType, nodeId: node.id },
            ),
          );
          continue;
        }
      }
      if (definition.asset && assetCatalog && typeof value === "string") {
        const assetIssue = validateAsset(assetCatalog, value, definition.asset);
        if (assetIssue) {
          diagnostics.push(
            diagnostic(owner, "assetIssue", assetIssue.code, assetIssue.message, {
              fieldName,
              capability,
              componentType: binding.componentType,
              nodeId: node.id,
            }),
          );
          continue;
        }
      }
      const baselineValue = componentValue(targetEntry.resolvedSource, node, binding.componentType, definition);
      patches.push({
        ...common,
        definition,
        ...(baselineValue !== undefined ? { baselineValue: structuredClone(baselineValue) } : {}),
      });
    }
  }

  const activeByTarget = new Map<string, ResolvedPreviewValuePatch>();
  const conflictingActiveTargets = new Set<string>();
  for (const patch of patches) {
    if (patch.capability !== "active") continue;
    const key = targetIdentity(patch);
    const existing = activeByTarget.get(key);
    if (!existing) {
      activeByTarget.set(key, patch);
      continue;
    }
    if (existing.value === patch.value) continue;
    conflictingActiveTargets.add(key);
    diagnostics.push(
      diagnostic(
        owner,
        "activeConflict",
        "previewValues.active.conflict",
        `Binder fields '${existing.fieldName}' and '${patch.fieldName}' assign conflicting active values to '${patch.nodeId}'`,
        { fieldName: patch.fieldName, capability: "active", componentType: patch.componentType, nodeId: patch.nodeId },
      ),
    );
  }
  const resolvedPatches = patches.filter((patch) => patch.capability !== "active" || !conflictingActiveTargets.has(targetIdentity(patch)));
  return { valid: diagnostics.length === 0, patches: resolvedPatches, diagnostics };
}

export interface StateRootPreviewDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly stateRootNodeId: string;
  readonly targetNodeId: string;
  readonly elementType: StateRootElementType;
}

export interface StateRootPreviewOptions {
  readonly spriteMetrics?: ((path: string) => import("./image-intrinsic.js").UnitySpriteMetrics | undefined) | undefined;
  readonly report?: ((diagnostic: StateRootPreviewDiagnostic) => void) | undefined;
}

export type StateRootPreviewOverrides = Readonly<Record<string, string>>;

function findEvaluatedNode(root: EvaluatedNode, nodeId: string): EvaluatedNode | undefined {
  if (root.node.id === nodeId) return root;
  for (const child of root.children) {
    const found = findEvaluatedNode(child, nodeId);
    if (found) return found;
  }
  return undefined;
}

function parentSizeAtElement(source: UiConcreteSource, targetNodeId: string): readonly [number, number] | undefined {
  const parent = walkNodes(source).find((entry) => entry.node.id === targetNodeId)?.parent;
  if (!parent) return undefined;
  const evaluated = findEvaluatedNode(evaluateLayout(source), parent.id);
  return evaluated ? [evaluated.rect.width, evaluated.rect.height] : undefined;
}

function applyArtifactRootSizePreview(
  source: UiConcreteSource,
  targetNodeId: string,
  elementType: StateRootElementType,
  value: StateRootElementValue,
): UiConcreteSource {
  if (source.artifactType === "Canvas" || source.root.id !== targetNodeId) return source;
  if (elementType !== "UWidth" && elementType !== "UHeight") return source;
  const nextSize: [number, number] = [...source.initialSize];
  nextSize[elementType === "UWidth" ? 0 : 1] = Number(value);
  return { ...source, initialSize: nextSize };
}

export function applyStateRootPreviewState(
  source: UiConcreteSource,
  nodeId: string,
  stateName: string,
  options: StateRootPreviewOptions = {},
): UiConcreteSource {
  const stateRoot = findNode(source, nodeId)?.components?.StateRoot;
  const state = stateRoot?.states[stateName];
  if (!stateRoot || !state) return source;
  let result = updateNode(source, nodeId, (node) => ({
    ...node,
    components: { ...node.components, StateRoot: { ...node.components!.StateRoot!, currentState: stateName } },
  }));
  for (const [targetId, active] of Object.entries(state)) {
    result = updateNode(result, targetId, (target) => ({ ...target, active }));
  }
  for (const element of stateRoot.elements ?? []) {
    const value = element.values[stateName];
    if (value === undefined) continue;
    const descriptor = stateRootElementDescriptor(element.elementType);
    const parentSize =
      element.elementType === "UWidth" || element.elementType === "UHeight" ? parentSizeAtElement(result, element.targetNodeId) : undefined;
    result = updateNode(result, element.targetNodeId, (target) => {
      return descriptor.applyPreview(target, value as StateRootElementValue, {
        ...(parentSize ? { parentSize } : {}),
        ...(options.spriteMetrics ? { spriteMetrics: options.spriteMetrics } : {}),
        ...(options.report
          ? {
              report: (diagnostic) =>
                options.report?.({
                  ...diagnostic,
                  stateRootNodeId: nodeId,
                  targetNodeId: element.targetNodeId,
                  elementType: element.elementType,
                }),
            }
          : {}),
      });
    });
    result = applyArtifactRootSizePreview(result, element.targetNodeId, element.elementType, value as StateRootElementValue);
  }
  return result;
}

export function applyCurrentStateRootStates(source: UiConcreteSource, options: StateRootPreviewOptions = {}): UiConcreteSource {
  const currentStates = walkNodes(source).flatMap(({ node }) => {
    const stateRoot = node.components?.StateRoot;
    return stateRoot ? [{ nodeId: node.id, stateName: stateRoot.currentState }] : [];
  });
  let result = source;
  for (const { nodeId, stateName } of currentStates) result = applyStateRootPreviewState(result, nodeId, stateName, options);
  return result;
}

export function applyStateRootPreviewOverrides(
  source: UiConcreteSource,
  overrides: StateRootPreviewOverrides,
  options: StateRootPreviewOptions = {},
): UiConcreteSource {
  let result = applyCurrentStateRootStates(source, options);
  for (const [nodeId, stateName] of Object.entries(overrides)) {
    result = applyStateRootPreviewState(result, nodeId, stateName, options);
  }
  return result;
}

export function stateRootPreviewPatches(
  source: UiConcreteSource,
  overrides: StateRootPreviewOverrides,
): readonly ResolvedPreviewValuePatch[] {
  const definition = componentPreviewField("StateRoot", "state");
  return Object.entries(overrides).map(([nodeId, value]) => ({
    owner: { kind: "prototypeSession", artifactKey: source.artifactKey },
    fieldName: nodeId,
    capability: "state",
    value,
    componentType: "StateRoot",
    nodeId,
    targetArtifactKey: source.artifactKey,
    instancePath: [],
    ...(definition ? { definition } : {}),
  }));
}

export function applyCurrentStateRootStatesWithUseSiteOverrides(
  source: UiConcreteSource,
  overrides: readonly UiPropertyOverride[],
  options: StateRootPreviewOptions = {},
): UiConcreteSource {
  // The first pass selects an overridden StateRoot state; the second preserves Unity instance overrides as the final layer.
  const effective = applyUseSiteOverridesAtCurrentArtifact(source, overrides);
  const statePreview = applyCurrentStateRootStates(effective, options);
  return applyUseSiteOverridesAtCurrentArtifact(statePreview, overrides);
}

function applyComponentField(source: UiConcreteSource, patch: ResolvedPreviewValuePatch): UiConcreteSource {
  const sourceProperty = patch.definition?.sourceProperty;
  if (!sourceProperty || patch.componentType === "GameObject" || patch.componentType === "RectTransform") return source;
  return updateNode(source, patch.nodeId, (node) => {
    const component = node.components?.[patch.componentType as UiComponentType] as Readonly<Record<string, unknown>> | undefined;
    if (!component) return node;
    const components = { ...node.components } as Record<string, unknown>;
    components[patch.componentType] = { ...component, [sourceProperty]: structuredClone(patch.value) };
    return { ...node, components: components as NonNullable<UiNode["components"]> };
  });
}

function patchOrder(patch: ResolvedPreviewValuePatch): number {
  if (patch.definition?.handler === "stateRootState") return 0;
  if (patch.capability === "active") return 2;
  return 1;
}

function instancePathsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function applyPreviewValuePatches(
  source: UiConcreteSource,
  patches: readonly ResolvedPreviewValuePatch[],
  instancePath: readonly string[] = [],
): UiConcreteSource {
  const relevant = patches
    .filter((patch) => patch.targetArtifactKey === source.artifactKey && instancePathsEqual(patch.instancePath, instancePath))
    .sort(
      (left, right) =>
        patchOrder(left) - patchOrder(right) ||
        left.fieldName.localeCompare(right.fieldName, "en-US") ||
        left.capability.localeCompare(right.capability, "en-US"),
    );
  if (relevant.length === 0) return source;
  let result = structuredClone(source);
  for (const patch of relevant) {
    if (patch.capability === "active") {
      result = updateNode(result, patch.nodeId, (node) => ({ ...node, active: patch.value as boolean }));
      continue;
    }
    if (patch.definition?.handler === "stateRootState") {
      result = applyStateRootPreviewState(result, patch.nodeId, String(patch.value));
      continue;
    }
    if (patch.definition?.handler === "tmpInputFieldText") {
      const textNodeId = findNode(result, patch.nodeId)?.components?.TMPInputField?.textComponent;
      if (textNodeId) {
        result = updateNode(result, textNodeId, (node) =>
          node.components?.Text
            ? { ...node, components: { ...node.components, Text: { ...node.components.Text, text: String(patch.value) } } }
            : node,
        );
      }
      continue;
    }
    result = applyComponentField(result, patch);
  }
  return result;
}

export function applyResolvedPreviewValues(
  source: UiConcreteSource,
  resolved: ResolvedPreviewValues,
  instancePath: readonly string[] = [],
): UiConcreteSource {
  if (!resolved.valid) {
    throw new Error(resolved.diagnostics.map((entry) => `${entry.path} [${entry.code}] ${entry.message}`).join("\n"));
  }
  return applyPreviewValuePatches(source, resolved.patches, instancePath);
}
