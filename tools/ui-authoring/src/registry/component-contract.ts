import type { TObject, TSchema } from "@sinclair/typebox";
import type { AuthoringAssetKind } from "../schema/asset-catalog.js";

export type CustomInspectorControl = "stateName" | "stateMap" | "stateElements" | "templateMap" | "crosshairEdges" | "crosshairPunch";

export type InspectorControl =
  | "text"
  | "multiline"
  | "number"
  | "optionalNumber"
  | "boolean"
  | "enum"
  | "segmented"
  | "vector2"
  | "vector4"
  | "color"
  | "imageAsset"
  | "fontAsset"
  | "animationClipAsset"
  | "animationClipList"
  | "animatorControllerAsset"
  | "nodeReference"
  | "nodeReferenceList"
  | "artifactReference"
  | "textAlignment"
  | CustomInspectorControl;

export type NodeReferenceFilter =
  | "any"
  | "graphic"
  | "image"
  | "text"
  | "prefabRef"
  | "stateRoot"
  | { readonly componentTypes: readonly string[]; readonly match?: "any" | "exactlyOne" };

interface InspectorIndexedSelection {
  readonly selectionProperty: string;
  readonly multipleProperty: string;
  readonly allowEmptyProperty: string;
}

export interface InspectorOption {
  readonly value: string;
  readonly label: string;
}

export type InspectorVisibilityCondition =
  | { readonly property: string; readonly equals: unknown }
  | { readonly property: string; readonly oneOf: readonly unknown[] }
  | { readonly property: string; readonly present: true }
  | { readonly assetProperty: string; readonly metric: "hasBorder"; readonly equals: boolean }
  | { readonly all: readonly InspectorVisibilityCondition[] };

interface InspectorDependentOptions {
  readonly property: string;
  readonly values: Readonly<Record<string, readonly InspectorOption[]>>;
}

export interface InspectorFieldDefinition {
  readonly property: string;
  readonly label: string;
  readonly control: InspectorControl;
  readonly projectDisabledReason?: string;
  readonly defaultValue?: unknown;
  readonly suggestedValue?: number;
  readonly options?: readonly InspectorOption[];
  readonly optionsBy?: InspectorDependentOptions;
  readonly resetPropertiesOnChange?: readonly string[];
  readonly labels?: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly step?: number;
  readonly numericKind?: "float" | "integer";
  readonly referenceFilter?: NodeReferenceFilter;
  readonly nullable?: boolean;
  readonly required?: true;
  readonly visibleWhen?: InspectorVisibilityCondition;
  readonly requiresUniformProperty?: string;
  readonly indexedSelection?: InspectorIndexedSelection;
}

export interface InspectorActionDefinition {
  readonly action: "setImageNativeSize";
  readonly label: string;
  readonly visibleWhen?: InspectorVisibilityCondition;
}

export type InspectorEntryDefinition = InspectorFieldDefinition | InspectorActionDefinition;

type InspectorComponentValue = Readonly<Record<string, unknown>>;

export function inspectorFieldValue(
  property: string,
  component: InspectorComponentValue,
  entries: readonly InspectorEntryDefinition[],
): unknown {
  if (component[property] !== undefined) return component[property];
  const definition = entries.find((entry): entry is InspectorFieldDefinition => "property" in entry && entry.property === property);
  return definition ? inspectorFieldDefaultValue(definition, component, entries) : undefined;
}

export function inspectorFieldOptions(
  entry: InspectorFieldDefinition,
  component: InspectorComponentValue,
  entries: readonly InspectorEntryDefinition[],
): readonly InspectorOption[] {
  if (!entry.optionsBy) return entry.options ?? [];
  return entry.optionsBy.values[String(inspectorFieldValue(entry.optionsBy.property, component, entries) ?? "")] ?? [];
}

export function inspectorFieldDefaultValue(
  entry: InspectorFieldDefinition,
  component: InspectorComponentValue,
  entries: readonly InspectorEntryDefinition[],
): unknown {
  if (entry.defaultValue !== undefined) return entry.defaultValue;
  return inspectorFieldOptions(entry, component, entries)[0]?.value;
}

export type PreviewRendererId = "none" | "image" | "text" | "roundedRect" | "prefabRef";
export type ProjectionHandlerId = "copy" | "prefabRef" | "stateRoot";
export type RoundtripHandlerId = "bidirectional" | "source-only";

export type ComponentPreviewHandlerId = "componentField" | "stateRootState" | "tmpInputFieldText";

export interface ComponentPreviewFieldDefinition {
  readonly schema: TSchema;
  readonly handler: ComponentPreviewHandlerId;
  readonly sourceProperty?: string;
  readonly asset?: AuthoringAssetKind;
  readonly defaultValue?: unknown;
}

export interface ComponentPreviewDefinition {
  readonly schema: TObject;
  readonly fields: Readonly<Record<string, ComponentPreviewFieldDefinition>>;
}

interface InspectorFieldMutationContext {
  readonly property: string;
  readonly value: unknown;
  readonly previous: Readonly<Record<string, unknown>>;
}

type InspectorFieldMutationHook = (
  component: Readonly<Record<string, unknown>>,
  context: InspectorFieldMutationContext,
) => Readonly<Record<string, unknown>>;

export type UnityPropertyCodec =
  | "artifactReference"
  | "asset"
  | "assetArray"
  | "boolean"
  | "color"
  | "enum"
  | "float"
  | "integer"
  | "nodeReference"
  | "nodeReferenceArray"
  | "optionalFloat"
  | "rectOffset"
  | "string"
  | "stringLines"
  | "vector2"
  | "vector4";

export interface UnityFieldDefinition {
  readonly path?: string;
  readonly codec?: UnityPropertyCodec;
  readonly referenceType?: string;
  readonly enumValues?: Readonly<Record<string, number>>;
  readonly capability?: string;
}

interface UnityComponentDefinition {
  readonly type: string;
  readonly exactType?: true;
  readonly pathConvention?: "exact" | "mPascal";
  readonly capability?: string;
}

export interface ComponentDefinition {
  readonly label: string;
  readonly bindingSuffix: string;
  readonly previewRenderer: PreviewRendererId;
  readonly projectionHandler: ProjectionHandlerId;
  readonly roundtrip: RoundtripHandlerId;
  readonly overrideFields: readonly string[];
  readonly useSiteAddable?: true;
  readonly multiEdit?: false;
  readonly exclusiveGroup?: string;
  readonly mutateInspectorField?: InspectorFieldMutationHook;
  readonly defaultValue: Readonly<Record<string, unknown>>;
  readonly inspector: readonly InspectorEntryDefinition[];
  readonly assetFields?: readonly ComponentAssetFieldDefinition[];
  readonly artifactReferenceFields?: readonly string[];
  readonly customInspectorFields?: readonly string[];
  readonly preview?: ComponentPreviewDefinition;
  readonly previewCollectionOwner?: true;
  readonly unity?: UnityComponentDefinition;
}

export interface ComponentAssetFieldDefinition {
  readonly property: string;
  readonly kind: AuthoringAssetKind;
}

export const DEFAULT_UI_FONT_ASSET = "Font/alipuhui SDF.asset";
