import { isStateRootElementType, mapStateRootElementAssetValue } from "../components/state-root-elements.js";
import { componentManifest, type UnityComponentManifest } from "../registry/component-manifest.js";
import {
  componentArtifactReferenceFields,
  componentAssetFields,
  componentAssetKind,
  componentRegistry,
  isComponentArtifactReference,
  type ProjectionHandlerId,
} from "../registry/component-registry.js";
import type {
  UiBindingComponentType,
  UiComponentAddition,
  UiComponentType,
  UiConcreteSource,
  UiNode,
  UiOverrideComponentType,
  UiPropertyOverride,
  UiSource,
  UiVariantNodeAddition,
} from "../schema/ui-source-schema.js";
import { artifactInitialSize } from "./artifact-size.js";
import { collectBindings, type DerivedBinding, derivedBinding } from "./binding.js";
import { canonicalSource, resolveDefaults } from "./canonical.js";
import { unityNodeName } from "./naming.js";
import { artifactPrefabPath, artifactSourceIdentity } from "./prefab-path.js";
import type { SourceCatalog, SourceCatalogEntry } from "./source-catalog.js";
import { findNode, walkNodes } from "./tree.js";
import { assertSourceReady } from "./validation.js";

export interface ProjectionBinding {
  readonly fieldName: string;
  readonly nodeId: string;
  readonly componentType: UiBindingComponentType;
  readonly target: ProjectionTargetAddress;
  readonly prefabRefNodeId?: string;
  readonly instancePath?: readonly string[];
}

interface ProjectionPropertyOverride {
  readonly nodeId: string;
  readonly componentType: UiOverrideComponentType;
  readonly fieldPath: string;
  readonly target: ProjectionTargetAddress;
  readonly value: unknown;
}

interface ProjectionComponentAddition {
  readonly nodeId: string;
  readonly componentType: UiComponentAddition["componentType"];
  readonly target: ProjectionTargetAddress;
  readonly value: Readonly<Record<string, unknown>>;
}

interface ProjectionVariantNodeAddition {
  readonly parentId: string;
  readonly parent: ProjectionTargetAddress;
  readonly siblingIndex: number;
  readonly node: ProjectionNode;
}

interface ProjectionTargetAddress {
  readonly instancePath: readonly string[];
  readonly nodeId: string;
  readonly nodePath: readonly string[];
  readonly siblingPath: readonly number[];
}

export interface ProjectionNode {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  readonly rect: {
    readonly anchorMin: readonly [number, number];
    readonly anchorMax: readonly [number, number];
    readonly pivot: readonly [number, number];
    readonly anchoredPosition: readonly [number, number];
    readonly sizeDelta: readonly [number, number];
    readonly rotation: number;
    readonly scale: readonly [number, number];
  };
  readonly components: Readonly<Record<string, unknown>>;
  readonly children: readonly ProjectionNode[];
}

export interface UnityProjection {
  readonly componentManifest: UnityComponentManifest;
  readonly sourceKind: UiSource["sourceKind"];
  readonly artifactKey: string;
  readonly artifactType: UiSource["artifactType"];
  readonly sourcePath: string;
  readonly localWidgetType?: string;
  readonly effectiveWidgetType?: string;
  readonly prefabPath: string;
  readonly baseArtifactKey?: string;
  readonly baseSourcePath?: string;
  readonly basePrefabPath?: string;
  readonly designSize: readonly [number, number];
  readonly bindings: readonly ProjectionBinding[];
  readonly localBindings: readonly ProjectionBinding[];
  readonly localNodeAdditions: readonly ProjectionVariantNodeAddition[];
  readonly localComponentAdditions: readonly ProjectionComponentAddition[];
  readonly propertyOverrides: readonly ProjectionPropertyOverride[];
  readonly root: ProjectionNode;
}

function fullAssetPath(path: string): string {
  return path.startsWith("Assets/") ? path : `Assets/Resources/UI/${path}`;
}

function projectAssetValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectAssetValue);
  return typeof value === "string" ? fullAssetPath(value) : value;
}

interface ProjectionComponentContext {
  readonly node: UiNode;
  readonly type: UiComponentType;
  readonly value: Readonly<Record<string, unknown>>;
  readonly catalog: SourceCatalog | undefined;
}

type ProjectionComponentHandler = (context: ProjectionComponentContext) => Readonly<Record<string, unknown>> | undefined;

function copyProjectionComponent({ type, value, catalog }: ProjectionComponentContext): Record<string, unknown> {
  const component = structuredClone(value) as Record<string, unknown>;
  for (const field of componentAssetFields(type)) {
    if (!(field.property in component)) continue;
    component[field.property] = projectAssetValue(component[field.property]);
  }
  for (const field of componentArtifactReferenceFields(type)) {
    const artifactKey = component[field];
    if (artifactKey === undefined) continue;
    if (typeof artifactKey !== "string" || !catalog) throw new Error(`${type}.${field} requires graph Projection`);
    component[field] = artifactPrefabPath(artifactSourceIdentity(requireEntry(catalog, artifactKey)));
  }
  return component;
}

function stateRootProjectionComponent(context: ProjectionComponentContext): Record<string, unknown> {
  const component = copyProjectionComponent(context);
  if (!Array.isArray(component.elements)) return component;
  component.elements = component.elements.map((rawElement) => {
    const element = rawElement as Record<string, unknown>;
    if (
      !isStateRootElementType(element.elementType) ||
      !element.values ||
      typeof element.values !== "object" ||
      Array.isArray(element.values)
    )
      return element;
    const elementType = element.elementType;
    return {
      ...element,
      values: Object.fromEntries(
        Object.entries(element.values as Record<string, unknown>).map(([stateName, value]) => [
          stateName,
          mapStateRootElementAssetValue(elementType, value, fullAssetPath),
        ]),
      ),
    };
  });
  return component;
}

const projectionHandlers = {
  copy: copyProjectionComponent,
  stateRoot: stateRootProjectionComponent,
  prefabRef: (context) => {
    const component = copyProjectionComponent(context);
    const artifactKey = component.artifactKey;
    const catalog = context.catalog;
    if (typeof artifactKey !== "string" || !catalog) throw new Error(`PrefabRef '${context.node.id}' requires graph Projection`);
    const target = requireEntry(catalog, artifactKey);
    component.sourcePath = target.path;
    component.prefabPath = artifactPrefabPath(artifactSourceIdentity(target));
    component.artifactType = target.source.artifactType;
    const prefabRef = context.value as NonNullable<UiNode["components"]>["PrefabRef"];
    component.overrides = (prefabRef?.overrides ?? []).map((override) => projectUseSiteOverride(catalog, target, override));
    component.componentAdditions = (prefabRef?.componentAdditions ?? []).map((addition) =>
      projectUseSiteComponentAddition(context, catalog, target, addition),
    );
    return component;
  },
} satisfies Record<ProjectionHandlerId, ProjectionComponentHandler>;

function projectComponents(node: UiNode, catalog?: SourceCatalog): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const [type, value] of Object.entries(node.components ?? {}) as [UiComponentType, Readonly<Record<string, unknown>> | undefined][]) {
    if (!value) continue;
    const handler = projectionHandlers[componentRegistry[type].projectionHandler];
    const projected = handler({ node, type, value, catalog });
    if (projected !== undefined) result[type] = projected;
  }
  return result;
}

function projectNode(node: UiNode, catalog?: SourceCatalog): ProjectionNode {
  return {
    id: node.id,
    name: unityNodeName(node),
    active: node.active ?? true,
    rect: {
      anchorMin: node.rect.anchorMin,
      anchorMax: node.rect.anchorMax,
      pivot: node.rect.pivot,
      anchoredPosition: node.rect.anchoredPosition,
      sizeDelta: node.rect.sizeDelta,
      rotation: node.rect.rotation ?? 0,
      scale: node.rect.scale ?? [1, 1],
    },
    components: projectComponents(node, catalog),
    children: (node.children ?? []).map((child) => projectNode(child, catalog)),
  };
}

function applyRequiredRaycastTargets(root: ProjectionNode): ProjectionNode {
  const required = new Set<string>();
  const collect = (node: ProjectionNode): void => {
    const button = node.components.ButtonEx as { readonly targetGraphic?: unknown } | undefined;
    const toggle = node.components.Toggle as { readonly targetGraphic?: unknown } | undefined;
    const slider = node.components.Slider as { readonly targetGraphic?: unknown } | undefined;
    const scrollbar = node.components.Scrollbar as { readonly targetGraphic?: unknown } | undefined;
    const input = node.components.TMPInputField as { readonly targetGraphic?: unknown } | undefined;
    const dropdown = node.components.TMPDropdown as { readonly targetGraphic?: unknown } | undefined;
    const virtualJoystick = node.components.VirtualJoystick as { readonly area?: unknown } | undefined;
    for (const value of [
      button?.targetGraphic,
      toggle?.targetGraphic,
      slider?.targetGraphic,
      scrollbar?.targetGraphic,
      input?.targetGraphic,
      dropdown?.targetGraphic,
      virtualJoystick?.area,
    ]) {
      if (typeof value === "string" && value) required.add(value);
    }
    for (const child of node.children) collect(child);
  };
  collect(root);

  const visit = (node: ProjectionNode): ProjectionNode => {
    const components = { ...node.components };
    if (required.has(node.id)) {
      for (const type of ["Image", "RoundedRect"] as const) {
        const value = components[type];
        if (value && typeof value === "object") components[type] = { ...(value as Record<string, unknown>), raycastTarget: true };
      }
    }
    return { ...node, components, children: node.children.map(visit) };
  };
  return visit(root);
}

export function createUnityProjection(input: UiConcreteSource): UnityProjection;
export function createUnityProjection(input: SourceCatalogEntry, catalog: SourceCatalog): UnityProjection;
export function createUnityProjection(input: UiConcreteSource | SourceCatalogEntry, catalog?: SourceCatalog): UnityProjection {
  if ("resolvedSource" in input) return projectCatalogEntry(input, catalog!);
  assertSourceReady(input);
  const source = resolveDefaults(canonicalSource(input));
  const sourcePath = `${source.artifactKey}.ui.json`;
  const bindings = collectBindings(source).map((binding) => projectBinding(undefined, { source, resolvedSource: source }, binding));
  return {
    componentManifest,
    sourceKind: "artifact",
    artifactKey: source.artifactKey,
    artifactType: source.artifactType,
    sourcePath,
    ...(source.artifactType === "Widget" ? { localWidgetType: source.widgetType, effectiveWidgetType: source.widgetType } : {}),
    prefabPath: artifactPrefabPath({ path: sourcePath, artifactKey: source.artifactKey }),
    designSize: artifactInitialSize(source),
    bindings,
    localBindings: bindings,
    localNodeAdditions: [],
    localComponentAdditions: [],
    propertyOverrides: [],
    root: applyRequiredRaycastTargets(projectNode(source.root)),
  };
}

function projectCatalogEntry(entry: SourceCatalogEntry, catalog: SourceCatalog): UnityProjection {
  if (!entry.bindings) {
    const details = [
      ...entry.bindingIssues.map((issue) => `binding[${issue.declarationIndex}] ${issue.message}`),
      ...(entry.widgetTypeError ? [entry.widgetTypeError] : []),
    ];
    throw new Error(`Artifact '${entry.source.artifactKey}' Binder is not ready:\n${details.join("\n")}`);
  }
  assertSourceReady(entry.resolvedSource);
  const source = resolveDefaults(canonicalSource(entry.resolvedSource));
  const bindings = entry.bindings.map((binding) => projectBinding(catalog, entry, binding));
  const variant = entry.source.sourceKind === "variant" ? entry.source : undefined;
  const localBindings = entry.localBindingDeclarations.map((declaration) =>
    projectBinding(catalog, entry, {
      ...derivedBinding(declaration.name, declaration.target),
      declaredComponentType: declaration.declaredComponentType,
    }),
  );
  const base = entry.baseArtifactKey ? requireEntry(catalog, entry.baseArtifactKey) : undefined;
  const root = applyRequiredRaycastTargets(projectNode(source.root, catalog));
  return {
    componentManifest,
    sourceKind: entry.source.sourceKind,
    artifactKey: source.artifactKey,
    artifactType: source.artifactType,
    sourcePath: entry.path,
    ...(source.artifactType === "Widget" ? { localWidgetType: entry.localWidgetType, effectiveWidgetType: entry.effectiveWidgetType } : {}),
    prefabPath: artifactPrefabPath(artifactSourceIdentity(entry)),
    ...(base
      ? {
          baseArtifactKey: base.source.artifactKey,
          baseSourcePath: base.path,
          basePrefabPath: artifactPrefabPath(artifactSourceIdentity(base)),
        }
      : {}),
    designSize: artifactInitialSize(source),
    bindings,
    localBindings: variant ? localBindings : bindings,
    localNodeAdditions:
      variant && base ? (variant.nodeAdditions ?? []).map((addition) => projectVariantNodeAddition(base, root, addition)) : [],
    localComponentAdditions:
      variant && base
        ? (variant.componentAdditions ?? []).map((addition) => {
            const projectedNodeId = addition.target.nodeId === base.resolvedSource.root.id ? root.id : addition.target.nodeId;
            const projected = findProjectionNode(root, projectedNodeId)?.components[addition.componentType];
            if (!projected || typeof projected !== "object")
              throw new Error(
                `Variant component addition projection target '${addition.target.nodeId}.${addition.componentType}' is missing`,
              );
            return {
              nodeId: addition.target.nodeId,
              componentType: addition.componentType,
              target: targetAddress(base.resolvedSource, [], addition.target.nodeId),
              value: structuredClone(projected as Readonly<Record<string, unknown>>),
            };
          })
        : [],
    propertyOverrides: variant && base ? variant.overrides.map((override) => projectVariantOverride(catalog, base, entry, override)) : [],
    root,
  };
}

function projectVariantNodeAddition(
  base: SourceCatalogEntry,
  root: ProjectionNode,
  addition: UiVariantNodeAddition,
): ProjectionVariantNodeAddition {
  const node = findProjectionNode(root, addition.node.id);
  if (!node) throw new Error(`Variant node addition projection '${addition.node.id}' is missing from the resolved tree`);
  return {
    parentId: addition.parentId,
    parent: targetAddress(base.resolvedSource, [], addition.parentId),
    siblingIndex: addition.siblingIndex,
    node,
  };
}

function findProjectionNode(root: ProjectionNode, nodeId: string): ProjectionNode | undefined {
  if (root.id === nodeId) return root;
  for (const child of root.children) {
    const found = findProjectionNode(child, nodeId);
    if (found) return found;
  }
  return undefined;
}

function projectBinding(
  catalog: SourceCatalog | undefined,
  owner: Pick<SourceCatalogEntry, "resolvedSource" | "source">,
  binding: DerivedBinding,
): ProjectionBinding {
  let target: ProjectionTargetAddress;
  if (!binding.prefabRefNodeId) {
    target = targetAddress(owner.resolvedSource, [], binding.nodeId);
  } else {
    if (!catalog) throw new Error(`Nested binding '${binding.fieldName}' requires Source Catalog`);
    target = nestedTargetAddress(
      catalog,
      { resolvedSource: owner.resolvedSource },
      [binding.prefabRefNodeId, ...(binding.instancePath ?? [])],
      binding.nodeId,
    );
  }
  return {
    fieldName: binding.fieldName,
    nodeId: binding.nodeId,
    componentType: binding.componentType,
    target,
    ...(binding.prefabRefNodeId ? { prefabRefNodeId: binding.prefabRefNodeId, instancePath: binding.instancePath ?? [] } : {}),
  };
}

function projectVariantOverride(
  catalog: SourceCatalog,
  base: SourceCatalogEntry,
  resolved: SourceCatalogEntry,
  override: UiPropertyOverride,
): ProjectionPropertyOverride {
  return {
    nodeId: override.target.nodeId,
    componentType: override.target.componentType,
    fieldPath: override.target.fieldPath,
    target: targetAddress(base.resolvedSource, [], override.target.nodeId),
    value: projectVariantOverrideValue(catalog, resolved, override),
  };
}

function projectUseSiteOverride(
  catalog: SourceCatalog,
  target: SourceCatalogEntry,
  override: UiPropertyOverride,
): ProjectionPropertyOverride {
  return {
    nodeId: override.target.nodeId,
    componentType: override.target.componentType,
    fieldPath: override.target.fieldPath,
    target: nestedTargetAddress(catalog, target, override.target.instancePath ?? [], override.target.nodeId),
    value: projectUseSiteOverrideValue(catalog, target, override),
  };
}

function projectUseSiteComponentAddition(
  context: ProjectionComponentContext,
  catalog: SourceCatalog,
  target: SourceCatalogEntry,
  addition: UiComponentAddition,
): ProjectionComponentAddition {
  const value = copyProjectionComponent({
    ...context,
    type: addition.componentType,
    value: addition.value as Readonly<Record<string, unknown>>,
  });
  return {
    nodeId: addition.target.nodeId,
    componentType: addition.componentType,
    target: nestedTargetAddress(catalog, target, addition.target.instancePath ?? [], addition.target.nodeId),
    value,
  };
}

const nodeReferenceOverrideFields: Readonly<Record<string, ReadonlySet<string>>> = {
  ButtonEx: new Set(["pressFeedbackScaleTarget", "pressFeedbackActiveTarget"]),
  ScrollRect: new Set(["horizontalScrollbar", "verticalScrollbar"]),
  TMPDropdown: new Set(["captionImage", "itemImage"]),
  ScrollRectEx: new Set(["horizontalScrollbar", "verticalScrollbar", "emptyDefaultTarget", "emptyDefaultStateRoot"]),
};

function isNodeReferenceOverride(override: UiPropertyOverride): boolean {
  return nodeReferenceOverrideFields[override.target.componentType]?.has(override.target.fieldPath) ?? false;
}

function projectVariantOverrideValue(catalog: SourceCatalog, base: SourceCatalogEntry, override: UiPropertyOverride): unknown {
  if (isComponentArtifactReference(override.target.componentType, override.target.fieldPath)) {
    if (typeof override.value !== "string") return structuredClone(override.value);
    return artifactPrefabPath(artifactSourceIdentity(requireEntry(catalog, override.value)));
  }
  if (isAssetPathOverride(override)) return projectAssetValue(override.value);
  if (!isNodeReferenceOverride(override) || typeof override.value !== "string") return structuredClone(override.value);
  return targetAddress(base.resolvedSource, [], override.value);
}

function projectUseSiteOverrideValue(catalog: SourceCatalog, target: SourceCatalogEntry, override: UiPropertyOverride): unknown {
  if (isComponentArtifactReference(override.target.componentType, override.target.fieldPath)) {
    if (typeof override.value !== "string") return structuredClone(override.value);
    return artifactPrefabPath(artifactSourceIdentity(requireEntry(catalog, override.value)));
  }
  if (isAssetPathOverride(override)) return projectAssetValue(override.value);
  if (!isNodeReferenceOverride(override) || typeof override.value !== "string") return structuredClone(override.value);
  return nestedTargetAddress(catalog, target, override.target.instancePath ?? [], override.value);
}

function isAssetPathOverride(override: UiPropertyOverride): boolean {
  return componentAssetKind(override.target.componentType, override.target.fieldPath) !== undefined;
}

function nestedTargetAddress(
  catalog: SourceCatalog,
  start: Pick<SourceCatalogEntry, "resolvedSource">,
  instancePath: readonly string[],
  targetNodeId: string,
): ProjectionTargetAddress {
  let current = start;
  const nodePath: string[] = [];
  const siblingPath: number[] = [];
  for (const instanceId of instancePath) {
    const path = structuralPathToNode(current.resolvedSource, instanceId);
    nodePath.push(...path.nodePath);
    siblingPath.push(...path.siblingPath);
    const instance = findNode(current.resolvedSource, instanceId);
    const nextKey = instance?.components?.PrefabRef?.artifactKey;
    if (!nextKey) throw new Error(`Nested target instance '${instanceId}' is not a PrefabRef`);
    current = requireEntry(catalog, nextKey);
  }
  const targetPath = structuralPathToNode(current.resolvedSource, targetNodeId);
  nodePath.push(...targetPath.nodePath);
  siblingPath.push(...targetPath.siblingPath);
  return { instancePath: [...instancePath], nodeId: targetNodeId, nodePath, siblingPath };
}

function targetAddress(source: UiConcreteSource, instancePath: readonly string[], nodeId: string): ProjectionTargetAddress {
  return { instancePath: [...instancePath], nodeId, ...structuralPathToNode(source, nodeId) };
}

function structuralPathToNode(
  source: UiConcreteSource,
  nodeId: string,
): { readonly nodePath: readonly string[]; readonly siblingPath: readonly number[] } {
  const entry = walkNodes(source).find(({ node }) => node.id === nodeId);
  if (!entry) throw new Error(`Projection target node '${nodeId}' does not exist in '${source.artifactKey}'`);
  const nodePath = entry.path.slice(1);
  const result: number[] = [];
  let parent = source.root;
  for (const id of nodePath) {
    const index = (parent.children ?? []).findIndex((child) => child.id === id);
    if (index < 0) throw new Error(`Projection target node '${nodeId}' has an invalid structural path in '${source.artifactKey}'`);
    result.push(index);
    parent = parent.children![index]!;
  }
  return { nodePath, siblingPath: result };
}

function requireEntry(catalog: SourceCatalog, artifactKey: string): SourceCatalogEntry {
  const entry = catalog.entries.get(artifactKey);
  if (!entry) throw new Error(`Artifact '${artifactKey}' is missing from Source Catalog`);
  return entry;
}

export function formatProjection(projection: UnityProjection): string {
  return `${JSON.stringify(projection, null, 2)}\n`;
}
