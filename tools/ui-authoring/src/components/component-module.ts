import { OptionalKind, type TObject, type TProperties, type TSchema, Type } from "@sinclair/typebox";
import type {
  ComponentDefinition,
  ComponentPreviewFieldDefinition,
  ComponentPreviewHandlerId,
  InspectorActionDefinition,
  InspectorEntryDefinition,
  InspectorFieldDefinition,
  UnityFieldDefinition,
} from "../registry/component-contract.js";
import type { AuthoringAssetKind } from "../schema/asset-catalog.js";

type InspectorFieldInput = Omit<InspectorFieldDefinition, "property" | "required">;

export interface ComponentFieldDefinition<T extends TSchema = TSchema> {
  readonly schema: T;
  readonly inspector?: InspectorFieldInput;
  readonly inspectorOrder?: number;
  readonly override?: true;
  readonly asset?: AuthoringAssetKind;
  readonly artifactReference?: true;
  readonly materializeDefault?: true;
  readonly componentDefault?: unknown;
  readonly inheritSchemaDefault?: false;
  readonly customInspector?: true;
  readonly preview?:
    | true
    | {
        readonly name?: string;
        readonly handler?: ComponentPreviewHandlerId;
      };
  readonly unity?: UnityFieldDefinition;
}

export type ComponentFieldMap = Readonly<Record<string, ComponentFieldDefinition>>;

type ComponentFieldSchemas<TFields extends ComponentFieldMap> = {
  -readonly [TKey in keyof TFields]: TFields[TKey]["schema"];
};

export interface ComponentValidationNode {
  readonly id: string;
  readonly components?: Readonly<Record<string, unknown>>;
}

interface ComponentValidationContext {
  readonly node: ComponentValidationNode;
  readonly value: Readonly<Record<string, unknown>>;
  readonly findNode: (nodeId: string) => ComponentValidationNode | undefined;
  readonly report: (
    relativePath: string,
    code: string,
    message: string,
    target?: { readonly fieldPath?: string; readonly readiness?: true },
  ) => void;
}

interface ComponentAvailabilityContext {
  readonly node: ComponentValidationNode;
  readonly nodes: readonly ComponentValidationNode[];
}

export type ComponentValidationHook = (context: ComponentValidationContext) => void;
export type ComponentAvailabilityHook = (context: ComponentAvailabilityContext) => string | undefined;
export type ComponentInitializationHook = (
  value: Readonly<Record<string, unknown>>,
  context: ComponentAvailabilityContext,
) => Readonly<Record<string, unknown>>;

export function nodesHaveAnyComponent(nodes: readonly ComponentValidationNode[], componentTypes: readonly string[]): boolean {
  return nodes.some((node) => componentTypes.some((componentType) => Boolean(node.components?.[componentType])));
}

interface ComponentNodeReference {
  readonly targetNodeId: string;
  readonly field: string;
}
interface ComponentNodeReferenceRemoval extends ComponentNodeReference {
  readonly requiresRepair: boolean;
}
interface ComponentNodeReferenceRemovalResult {
  readonly value: Readonly<Record<string, unknown>>;
  readonly removals: readonly ComponentNodeReferenceRemoval[];
}
export interface ComponentNodeReferenceOwner {
  readonly collect: (value: Readonly<Record<string, unknown>>) => readonly ComponentNodeReference[];
  readonly remap: (value: Readonly<Record<string, unknown>>, remap: (nodeId: string) => string) => Readonly<Record<string, unknown>>;
  readonly removeTargets: (
    value: Readonly<Record<string, unknown>>,
    removedNodeIds: ReadonlySet<string>,
  ) => ComponentNodeReferenceRemovalResult;
}

export interface ComponentPreviewFieldInput<T extends TSchema = TSchema> {
  readonly schema: T;
  readonly handler: ComponentPreviewHandlerId;
  readonly asset?: AuthoringAssetKind;
  readonly defaultValue?: unknown;
}

type ComponentPreviewFieldMap = Readonly<Record<string, ComponentPreviewFieldInput>>;

interface ComponentModuleInput<TKey extends string, TFields extends ComponentFieldMap>
  extends Omit<
    ComponentDefinition,
    "defaultValue" | "inspector" | "overrideFields" | "assetFields" | "artifactReferenceFields" | "customInspectorFields" | "preview"
  > {
  readonly key: TKey;
  readonly fields: TFields;
  readonly actions?: readonly InspectorActionDefinition[];
  readonly validate?: ComponentValidationHook;
  readonly canAdd?: ComponentAvailabilityHook;
  readonly initialize?: ComponentInitializationHook;
  readonly nodeReferences?: ComponentNodeReferenceOwner;
  readonly previewFields?: ComponentPreviewFieldMap;
}

export interface ComponentModule<TKey extends string, TFields extends ComponentFieldMap> extends ComponentDefinition {
  readonly key: TKey;
  readonly fields: TFields;
  readonly schema: TObject<ComponentFieldSchemas<TFields>>;
  readonly validate?: ComponentValidationHook;
  readonly canAdd?: ComponentAvailabilityHook;
  readonly initialize?: ComponentInitializationHook;
  readonly nodeReferences?: ComponentNodeReferenceOwner;
}

export function componentField<const TSchemaValue extends TSchema>(
  schema: TSchemaValue,
  definition: Omit<ComponentFieldDefinition<TSchemaValue>, "schema"> = {},
): ComponentFieldDefinition<TSchemaValue> {
  return { schema, ...definition };
}

export function previewField<const TSchemaValue extends TSchema>(
  schema: TSchemaValue,
  definition: Omit<ComponentPreviewFieldInput<TSchemaValue>, "schema">,
): ComponentPreviewFieldInput<TSchemaValue> {
  return { schema, ...definition };
}

export function defineComponent<const TKey extends string, const TFields extends ComponentFieldMap>(
  input: ComponentModuleInput<TKey, TFields>,
): ComponentModule<TKey, TFields> {
  const properties = Object.fromEntries(
    Object.entries(input.fields).map(([property, field]) => [property, field.schema]),
  ) as ComponentFieldSchemas<TFields>;
  const inspector = Object.entries(input.fields)
    .flatMap(([property, field], declarationOrder): { readonly order: number; readonly entry: InspectorEntryDefinition }[] => {
      if (!field.inspector) return [];
      const schemaDefault = (field.schema as TSchema & { readonly default?: unknown }).default;
      const required = (field.schema as TSchema & { readonly [OptionalKind]?: "Optional" })[OptionalKind] !== "Optional";
      return [
        {
          order: field.inspectorOrder ?? declarationOrder,
          entry: {
            property,
            ...field.inspector,
            ...(field.inspector.defaultValue !== undefined
              ? { defaultValue: structuredClone(field.inspector.defaultValue) }
              : field.inheritSchemaDefault !== false && schemaDefault !== undefined
                ? { defaultValue: structuredClone(schemaDefault) }
                : {}),
            ...(required ? { required: true as const } : {}),
          },
        },
      ];
    })
    .sort((left, right) => left.order - right.order)
    .map(({ entry }) => entry);
  const defaultValue = Object.fromEntries(
    Object.entries(input.fields).flatMap(([property, field]) => {
      if (!field.materializeDefault) return [];
      const schemaDefault = (field.schema as TSchema & { readonly default?: unknown }).default;
      const componentDefault = field.componentDefault !== undefined ? field.componentDefault : schemaDefault;
      if (componentDefault === undefined) throw new Error(`Component '${input.key}.${property}' materializes a missing component default`);
      return [[property, structuredClone(componentDefault)]];
    }),
  );
  const overrideFields = Object.entries(input.fields)
    .filter(([, field]) => field.override)
    .map(([property]) => property);
  const assetFields = Object.entries(input.fields).flatMap(([property, field]) => (field.asset ? [{ property, kind: field.asset }] : []));
  const artifactReferenceFields = Object.entries(input.fields)
    .filter(([, field]) => field.artifactReference)
    .map(([property]) => property);
  const customInspectorFields = Object.entries(input.fields)
    .filter(([, field]) => field.customInspector)
    .map(([property]) => property);
  const previewEntries: [string, ComponentPreviewFieldDefinition][] = Object.entries(input.fields).flatMap(([property, field]) => {
    if (!field.preview) return [];
    const preview = field.preview === true ? {} : field.preview;
    const defaultValue = (field.schema as TSchema & { readonly default?: unknown }).default;
    return [
      [
        preview.name ?? property,
        {
          schema: field.schema,
          handler: preview.handler ?? "componentField",
          sourceProperty: property,
          ...(field.asset ? { asset: field.asset } : {}),
          ...(defaultValue !== undefined ? { defaultValue: structuredClone(defaultValue) } : {}),
        },
      ],
    ];
  });
  for (const [name, field] of Object.entries(input.previewFields ?? {})) {
    if (previewEntries.some(([candidate]) => candidate === name))
      throw new Error(`Component '${input.key}' declares duplicate Preview capability '${name}'`);
    previewEntries.push([
      name,
      {
        schema: field.schema,
        handler: field.handler,
        ...(field.asset ? { asset: field.asset } : {}),
        ...(field.defaultValue !== undefined ? { defaultValue: structuredClone(field.defaultValue) } : {}),
      },
    ]);
  }
  const preview =
    previewEntries.length > 0
      ? {
          fields: Object.fromEntries(previewEntries),
          schema: Type.Object(
            Object.fromEntries(previewEntries.map(([name, field]) => [name, Type.Optional(field.schema)])) as TProperties,
            { additionalProperties: false, minProperties: 1 },
          ),
        }
      : undefined;
  const { key, fields, actions = [], validate, canAdd, previewFields: _previewFields, ...definition } = input;
  return {
    key,
    fields,
    schema: Type.Object(properties as TProperties, { additionalProperties: false }) as TObject<ComponentFieldSchemas<TFields>>,
    ...definition,
    defaultValue,
    inspector: [...inspector, ...actions],
    ...(assetFields.length > 0 ? { assetFields } : {}),
    ...(artifactReferenceFields.length > 0 ? { artifactReferenceFields } : {}),
    ...(customInspectorFields.length > 0 ? { customInspectorFields } : {}),
    ...(preview ? { preview } : {}),
    overrideFields,
    ...(validate ? { validate } : {}),
    ...(canAdd ? { canAdd } : {}),
  };
}
