import {
  isStateRootElementType,
  mapStateRootElementAssetValue,
  stateRootElementAssetPath,
  stateRootElementDescriptor,
} from "../components/state-root-elements.js";
import {
  componentAssetFields,
  componentAssetKind,
  componentPreviewField,
  componentRegistry,
  previewCapabilityComponentTypes,
} from "../registry/component-registry.js";
import type { AuthoringAssetKind } from "../schema/asset-catalog.js";
import type { UiPrototype, UiReference } from "../schema/ui-prototype-schema.js";
import type { UiComponentAddition, UiComponentType, UiPropertyOverride, UiSource } from "../schema/ui-source-schema.js";
import type { PreviewValues } from "./preview-values.js";
import type { ReferenceCatalog } from "./prototype.js";
import type { SourceCatalog } from "./source-catalog.js";
import { walkNodes } from "./tree.js";

type AssetReferenceLocation =
  | "component"
  | "variant-node"
  | "variant-component-addition"
  | "variant-override"
  | "prefab-ref-override"
  | "prefab-ref-component-addition"
  | "reference-values"
  | "reference-collection"
  | "reference-mount"
  | "prototype-session";

export interface UiAssetReference {
  readonly kind: AuthoringAssetKind;
  readonly path: string;
  readonly documentKind: "artifact" | "reference" | "prototype";
  readonly documentKey: string;
  readonly documentPath: string;
  readonly fieldPath: string;
  readonly location: AssetReferenceLocation;
  readonly nodeId?: string;
  readonly sourceArtifactKey?: string;
  readonly referenceKey?: string;
}

export interface SourceAssetDocument {
  readonly path: string;
  readonly source: UiSource;
}

export interface ReferenceAssetDocument {
  readonly path: string;
  readonly reference: UiReference;
}

export interface PrototypeAssetDocument {
  readonly path: string;
  readonly prototype: UiPrototype;
}

function normalizedAssetPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^Assets\/UI\//i, "");
}

export function assetPathsEqual(left: string, right: string): boolean {
  return normalizedAssetPath(left).toLocaleLowerCase("en-US") === normalizedAssetPath(right).toLocaleLowerCase("en-US");
}

function registeredAssetKind(componentType: string, fieldPath: string): AuthoringAssetKind | undefined {
  return componentAssetKind(componentType, fieldPath);
}

function componentAssetValue(componentType: UiComponentType, component: Record<string, unknown>, property: string): unknown {
  const value = component[property];
  return value === undefined ? (componentRegistry[componentType].defaultValue as Readonly<Record<string, unknown>>)[property] : value;
}

function append(
  result: UiAssetReference[],
  value: unknown,
  kind: AuthoringAssetKind | undefined,
  reference: Omit<UiAssetReference, "kind" | "path">,
): void {
  if (!kind) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => void append(result, entry, kind, { ...reference, fieldPath: `${reference.fieldPath}/${index}` }));
    return;
  }
  if (typeof value === "string" && value.length > 0) result.push({ ...reference, kind, path: normalizedAssetPath(value) });
}

function collectStateRootElementAssetReferences(
  result: UiAssetReference[],
  component: Readonly<Record<string, unknown>>,
  reference: Omit<UiAssetReference, "kind" | "path">,
): void {
  if (!Array.isArray(component.elements)) return;
  component.elements.forEach((rawElement, elementIndex) => {
    if (!rawElement || typeof rawElement !== "object" || Array.isArray(rawElement)) return;
    const element = rawElement as Readonly<Record<string, unknown>>;
    if (
      !isStateRootElementType(element.elementType) ||
      !element.values ||
      typeof element.values !== "object" ||
      Array.isArray(element.values)
    )
      return;
    const descriptor = stateRootElementDescriptor(element.elementType);
    if (!descriptor.assetKind) return;
    for (const [stateName, value] of Object.entries(element.values as Readonly<Record<string, unknown>>)) {
      const path = stateRootElementAssetPath(element.elementType, value);
      append(result, path, descriptor.assetKind, {
        ...reference,
        fieldPath: `${reference.fieldPath}/elements/${elementIndex}/values/${stateName}${element.elementType === "USprite" ? "/sprite" : ""}`,
      });
    }
  });
}

function collectOverride(
  result: UiAssetReference[],
  override: UiPropertyOverride,
  reference: Omit<UiAssetReference, "kind" | "path" | "nodeId">,
): void {
  append(result, override.value, registeredAssetKind(override.target.componentType, override.target.fieldPath), {
    ...reference,
    nodeId: override.target.nodeId,
  });
}

function collectComponentAddition(
  result: UiAssetReference[],
  addition: UiComponentAddition,
  reference: Omit<UiAssetReference, "kind" | "path" | "nodeId">,
): void {
  for (const field of componentAssetFields(addition.componentType)) {
    append(result, componentAssetValue(addition.componentType, addition.value as Record<string, unknown>, field.property), field.kind, {
      ...reference,
      nodeId: addition.target.nodeId,
      fieldPath: `${reference.fieldPath}/${field.property}`,
    });
  }
}

export function collectSourceAssetReferences(document: SourceAssetDocument, _catalog: SourceCatalog): UiAssetReference[] {
  const { source } = document;
  const result: UiAssetReference[] = [];
  const base = {
    documentKind: "artifact" as const,
    documentKey: source.artifactKey,
    documentPath: document.path,
    sourceArtifactKey: source.artifactKey,
  };
  if (source.sourceKind === "variant") {
    source.overrides.forEach(
      (override, index) =>
        void collectOverride(result, override, {
          ...base,
          fieldPath: `overrides/${index}/value`,
          location: "variant-override",
        }),
    );
    source.componentAdditions?.forEach(
      (addition, index) =>
        void collectComponentAddition(result, addition, {
          ...base,
          fieldPath: `componentAdditions/${index}/value`,
          location: "variant-component-addition",
        }),
    );
    source.nodeAdditions?.forEach((addition, additionIndex) => {
      for (const node of localNodes(addition.node))
        collectNodeAssetReferences(result, node, {
          ...base,
          fieldPath: `nodeAdditions/${additionIndex}/node`,
          location: "variant-node",
        });
    });
    return result;
  }

  for (const { node } of walkNodes(source)) {
    for (const [componentType, component] of Object.entries(node.components ?? {})) {
      if (!component || !(componentType in componentRegistry)) continue;
      for (const field of componentAssetFields(componentType as UiComponentType)) {
        append(
          result,
          componentAssetValue(componentType as UiComponentType, component as Record<string, unknown>, field.property),
          field.kind,
          {
            ...base,
            fieldPath: `components.${componentType}.${field.property}`,
            location: "component",
            nodeId: node.id,
          },
        );
      }
      if (componentType === "StateRoot") {
        collectStateRootElementAssetReferences(result, component as Readonly<Record<string, unknown>>, {
          ...base,
          fieldPath: "components.StateRoot",
          location: "component",
          nodeId: node.id,
        });
      }
    }
    node.components?.PrefabRef?.overrides?.forEach(
      (override, index) =>
        void collectOverride(result, override, {
          ...base,
          fieldPath: `components.PrefabRef.overrides/${index}/value`,
          location: "prefab-ref-override",
        }),
    );
    node.components?.PrefabRef?.componentAdditions?.forEach(
      (addition, index) =>
        void collectComponentAddition(result, addition, {
          ...base,
          fieldPath: `components.PrefabRef.componentAdditions/${index}/value`,
          location: "prefab-ref-component-addition",
        }),
    );
  }
  return result;
}

function localNodes(root: import("../schema/ui-source-schema.js").UiNode): import("../schema/ui-source-schema.js").UiNode[] {
  const result: import("../schema/ui-source-schema.js").UiNode[] = [];
  const visit = (node: import("../schema/ui-source-schema.js").UiNode): void => {
    result.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return result;
}

function collectNodeAssetReferences(
  result: UiAssetReference[],
  node: import("../schema/ui-source-schema.js").UiNode,
  reference: Omit<UiAssetReference, "kind" | "path" | "nodeId">,
): void {
  for (const [componentType, component] of Object.entries(node.components ?? {})) {
    if (!component || !(componentType in componentRegistry)) continue;
    for (const field of componentAssetFields(componentType as UiComponentType)) {
      append(
        result,
        componentAssetValue(componentType as UiComponentType, component as Record<string, unknown>, field.property),
        field.kind,
        {
          ...reference,
          nodeId: node.id,
          fieldPath: `${reference.fieldPath}/components/${componentType}/${field.property}`,
        },
      );
    }
    if (componentType === "StateRoot") {
      collectStateRootElementAssetReferences(result, component as Readonly<Record<string, unknown>>, {
        ...reference,
        nodeId: node.id,
        fieldPath: `${reference.fieldPath}/components/StateRoot`,
      });
    }
  }
  node.components?.PrefabRef?.overrides?.forEach(
    (override, index) =>
      void collectOverride(result, override, {
        ...reference,
        fieldPath: `${reference.fieldPath}/components/PrefabRef/overrides/${index}/value`,
      }),
  );
  node.components?.PrefabRef?.componentAdditions?.forEach(
    (addition, index) =>
      void collectComponentAddition(result, addition, {
        ...reference,
        fieldPath: `${reference.fieldPath}/components/PrefabRef/componentAdditions/${index}/value`,
      }),
  );
}

function previewCapabilityAssetKind(capability: string): AuthoringAssetKind | undefined {
  const kinds = new Set(
    previewCapabilityComponentTypes(capability)
      .map((componentType) => componentPreviewField(componentType, capability)?.asset)
      .filter((kind): kind is AuthoringAssetKind => kind !== undefined),
  );
  return kinds.size === 1 ? [...kinds][0] : undefined;
}

function collectPreviewValueAssetReferences(
  result: UiAssetReference[],
  values: PreviewValues | undefined,
  reference: Omit<UiAssetReference, "kind" | "path">,
): void {
  for (const [fieldName, patch] of Object.entries(values ?? {})) {
    for (const [capability, value] of Object.entries(patch)) {
      append(result, value, previewCapabilityAssetKind(capability), {
        ...reference,
        fieldPath: `${reference.fieldPath}/${fieldName}/${capability}`,
      });
    }
  }
}

export function collectReferenceAssetReferences(document: ReferenceAssetDocument, _catalog: SourceCatalog): UiAssetReference[] {
  const { reference } = document;
  const result: UiAssetReference[] = [];
  const base = {
    documentKind: "reference" as const,
    documentKey: reference.referenceKey,
    documentPath: document.path,
    referenceKey: reference.referenceKey,
  };
  collectPreviewValueAssetReferences(result, reference.values, {
    ...base,
    fieldPath: "values",
    location: "reference-values",
    sourceArtifactKey: reference.subjectArtifactKey,
  });
  reference.instanceValues?.forEach((entry, index) => {
    collectPreviewValueAssetReferences(result, entry.values, {
      ...base,
      fieldPath: `instanceValues/${index}/values`,
      location: "reference-values",
    });
  });
  collectPreviewValueAssetReferences(result, reference.context?.values, {
    ...base,
    fieldPath: "context/values",
    location: "reference-values",
    ...(reference.context ? { sourceArtifactKey: reference.context.parentArtifactKey } : {}),
  });
  reference.collections?.forEach((collection, collectionIndex) => {
    collection.groups.forEach((group, groupIndex) => {
      collectPreviewValueAssetReferences(result, group.values, {
        ...base,
        fieldPath: `collections/${collectionIndex}/groups/${groupIndex}/values`,
        location: "reference-collection",
      });
      if ("items" in group)
        group.items.forEach((item, itemIndex) => {
          collectPreviewValueAssetReferences(result, item.values, {
            ...base,
            fieldPath: `collections/${collectionIndex}/groups/${groupIndex}/items/${itemIndex}/values`,
            location: "reference-collection",
          });
        });
    });
  });
  reference.mounts?.forEach((mount, mountIndex) => {
    collectPreviewValueAssetReferences(result, mount.values, {
      ...base,
      fieldPath: `mounts/${mountIndex}/values`,
      location: "reference-mount",
      sourceArtifactKey: mount.artifactKey,
    });
  });
  return result;
}

function prototypeReferenceKeys(prototype: UiPrototype): string[] {
  const keys = new Set<string>([prototype.startReferenceKey]);
  for (const interaction of prototype.interactions) {
    keys.add(interaction.referenceKey);
    for (const action of interaction.actions) if (action.kind === "Navigate") keys.add(action.referenceKey);
  }
  return [...keys].sort();
}

export function collectPrototypeSessionAssetReferences(
  document: PrototypeAssetDocument,
  references: ReferenceCatalog,
  catalog: SourceCatalog,
): UiAssetReference[] {
  const result: UiAssetReference[] = [];
  for (const referenceKey of prototypeReferenceKeys(document.prototype)) {
    const entry = references.entries.get(referenceKey);
    if (!entry) continue;
    for (const asset of collectReferenceAssetReferences({ path: entry.path, reference: entry.reference }, catalog)) {
      result.push({
        ...asset,
        documentKind: "prototype",
        documentKey: document.prototype.prototypeKey,
        documentPath: document.path,
        fieldPath: `session/${referenceKey}/${asset.fieldPath}`,
        location: "prototype-session",
      });
    }
  }
  return result;
}

function replaceValue(value: unknown, before: string, after: string): unknown {
  if (Array.isArray(value)) return value.map((entry) => replaceValue(entry, before, after));
  return typeof value === "string" && assetPathsEqual(value, before) ? normalizedAssetPath(after) : value;
}

function replaceStateRootElementAssets(component: Record<string, unknown>, before: string, after: string): void {
  if (!Array.isArray(component.elements)) return;
  for (const rawElement of component.elements) {
    if (!rawElement || typeof rawElement !== "object" || Array.isArray(rawElement)) continue;
    const element = rawElement as Record<string, unknown>;
    if (
      !isStateRootElementType(element.elementType) ||
      !element.values ||
      typeof element.values !== "object" ||
      Array.isArray(element.values)
    )
      continue;
    const values = element.values as Record<string, unknown>;
    for (const [stateName, value] of Object.entries(values)) {
      values[stateName] = mapStateRootElementAssetValue(element.elementType, value, (path) =>
        assetPathsEqual(path, before) ? normalizedAssetPath(after) : path,
      );
    }
  }
}

function replaceOverride(override: UiPropertyOverride, before: string, after: string): void {
  if (!registeredAssetKind(override.target.componentType, override.target.fieldPath)) return;
  override.value = replaceValue(override.value, before, after);
}

function replaceComponentAddition(addition: UiComponentAddition, before: string, after: string): void {
  const values = addition.value as Record<string, unknown>;
  for (const field of componentAssetFields(addition.componentType)) {
    values[field.property] = replaceValue(values[field.property], before, after);
  }
}

function replacePreviewValueAssets(values: Record<string, Record<string, unknown>> | undefined, before: string, after: string): void {
  for (const patch of Object.values(values ?? {})) {
    for (const [capability, value] of Object.entries(patch)) {
      if (previewCapabilityAssetKind(capability)) patch[capability] = replaceValue(value, before, after);
    }
  }
}

export function replaceAssetPathInSource(source: UiSource, _catalog: SourceCatalog, before: string, after: string): UiSource {
  const result = structuredClone(source);
  if (result.sourceKind === "variant") {
    for (const override of result.overrides) replaceOverride(override, before, after);
    for (const addition of result.componentAdditions ?? []) replaceComponentAddition(addition, before, after);
    for (const root of result.nodeAdditions ?? []) {
      for (const node of localNodes(root.node)) {
        for (const [componentType, component] of Object.entries(node.components ?? {})) {
          if (!component || !(componentType in componentRegistry)) continue;
          for (const field of componentAssetFields(componentType as UiComponentType)) {
            const values = component as Record<string, unknown>;
            values[field.property] = replaceValue(values[field.property], before, after);
          }
          if (componentType === "StateRoot") replaceStateRootElementAssets(component as Record<string, unknown>, before, after);
        }
        for (const override of node.components?.PrefabRef?.overrides ?? []) replaceOverride(override, before, after);
        for (const addition of node.components?.PrefabRef?.componentAdditions ?? []) replaceComponentAddition(addition, before, after);
      }
    }
    return result;
  }
  for (const { node } of walkNodes(result)) {
    for (const [componentType, component] of Object.entries(node.components ?? {})) {
      if (!component || !(componentType in componentRegistry)) continue;
      for (const field of componentAssetFields(componentType as UiComponentType)) {
        const values = component as Record<string, unknown>;
        values[field.property] = replaceValue(values[field.property], before, after);
      }
      if (componentType === "StateRoot") replaceStateRootElementAssets(component as Record<string, unknown>, before, after);
    }
    for (const override of node.components?.PrefabRef?.overrides ?? []) replaceOverride(override, before, after);
    for (const addition of node.components?.PrefabRef?.componentAdditions ?? []) replaceComponentAddition(addition, before, after);
  }
  return result;
}

export function replaceAssetPathInReference(reference: UiReference, _catalog: SourceCatalog, before: string, after: string): UiReference {
  const result = structuredClone(reference);
  replacePreviewValueAssets(result.values, before, after);
  for (const entry of result.instanceValues ?? []) replacePreviewValueAssets(entry.values, before, after);
  replacePreviewValueAssets(result.context?.values, before, after);
  for (const collection of result.collections ?? []) {
    for (const group of collection.groups) {
      replacePreviewValueAssets(group.values, before, after);
      if ("items" in group) for (const item of group.items) replacePreviewValueAssets(item.values, before, after);
    }
  }
  for (const mount of result.mounts ?? []) replacePreviewValueAssets(mount.values, before, after);
  return result;
}
