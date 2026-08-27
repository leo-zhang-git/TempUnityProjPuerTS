import { nonPrefabComponentModules } from "../components/component-list.js";
import type { ComponentAvailabilityHook, ComponentInitializationHook, ComponentValidationNode } from "../components/component-module.js";
import { prefabRefComponent } from "../components/prefab-ref.js";
import type { AuthoringAssetKind } from "../schema/asset-catalog.js";
import type { UiBindingComponentType, UiComponents, UiComponentType } from "../schema/ui-source-schema.js";
import type {
  ComponentAssetFieldDefinition,
  ComponentDefinition,
  ComponentPreviewDefinition,
  ComponentPreviewFieldDefinition,
  InspectorEntryDefinition,
  InspectorFieldDefinition,
} from "./component-contract.js";

export * from "./component-contract.js";

export const componentRegistry = {
  ...nonPrefabComponentModules,
  PrefabRef: prefabRefComponent,
} as const;

export function isBindingComponentType(type: string): type is UiBindingComponentType {
  return type === "GameObject" || type === "RectTransform" || type in componentRegistry;
}

export function defaultComponent<T extends UiComponentType>(type: T): NonNullable<UiComponents[T]> {
  return structuredClone(componentRegistry[type].defaultValue) as NonNullable<UiComponents[T]>;
}

export function initialComponent<T extends UiComponentType>(
  type: T,
  node: ComponentValidationNode,
  nodes: readonly ComponentValidationNode[],
): NonNullable<UiComponents[T]> {
  const value = defaultComponent(type);
  const initialize = (
    componentRegistry[type] as (typeof componentRegistry)[UiComponentType] & { readonly initialize?: ComponentInitializationHook }
  ).initialize;
  return structuredClone(initialize?.(value as Readonly<Record<string, unknown>>, { node, nodes }) ?? value) as NonNullable<
    UiComponents[T]
  >;
}

export function isInspectorFieldEntry(entry: InspectorEntryDefinition): entry is InspectorFieldDefinition {
  return "property" in entry;
}

export function componentInspectorFields(type: UiComponentType): readonly InspectorFieldDefinition[] {
  return (componentRegistry[type] as ComponentDefinition).inspector.filter(isInspectorFieldEntry);
}

export function componentAvailabilityReason(
  type: UiComponentType,
  node: ComponentValidationNode,
  nodes: readonly ComponentValidationNode[],
): string | undefined {
  const canAdd = (componentRegistry[type] as (typeof componentRegistry)[UiComponentType] & { readonly canAdd?: ComponentAvailabilityHook })
    .canAdd;
  return canAdd?.({ node, nodes });
}

export function isPreviewCollectionOwner(type: string): type is UiComponentType {
  if (!(type in componentRegistry)) return false;
  return (componentRegistry[type as UiComponentType] as ComponentDefinition).previewCollectionOwner === true;
}

export function isUseSiteAddable(type: string): type is UiComponentType {
  if (!(type in componentRegistry)) return false;
  return (componentRegistry[type as UiComponentType] as ComponentDefinition).useSiteAddable === true;
}

export function componentAssetFields(type: UiComponentType): readonly ComponentAssetFieldDefinition[] {
  return (componentRegistry[type] as ComponentDefinition).assetFields ?? [];
}

export function componentAssetKind(type: string, property: string): AuthoringAssetKind | undefined {
  if (!(type in componentRegistry)) return undefined;
  return componentAssetFields(type as UiComponentType).find((field) => field.property === property)?.kind;
}

export function componentArtifactReferenceFields(type: UiComponentType): readonly string[] {
  return (componentRegistry[type] as ComponentDefinition).artifactReferenceFields ?? [];
}

export function isComponentArtifactReference(type: string, property: string): boolean {
  return type in componentRegistry && componentArtifactReferenceFields(type as UiComponentType).includes(property);
}

export function componentPreview(type: string): ComponentPreviewDefinition | undefined {
  if (!(type in componentRegistry)) return undefined;
  return (componentRegistry[type as UiComponentType] as ComponentDefinition).preview;
}

export function componentPreviewField(type: string, capability: string): ComponentPreviewFieldDefinition | undefined {
  return componentPreview(type)?.fields[capability];
}

export function previewCapabilityComponentTypes(capability: string): readonly UiComponentType[] {
  return (Object.entries(componentRegistry) as [UiComponentType, (typeof componentRegistry)[UiComponentType]][])
    .filter(([, definition]) => capability in (definition.preview?.fields ?? {}))
    .map(([componentType]) => componentType);
}
