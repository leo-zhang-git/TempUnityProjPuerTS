import { type Static, type TLiteral, type TObject, type TOptional, Type } from "@sinclair/typebox";
import { useSiteComponentAdditionSchema } from "../components/prefab-ref.js";
import { stateRootElementSchema } from "../components/state-root.js";
import { componentRegistry } from "../registry/component-registry.js";

const Vector2Schema = Type.Tuple([Type.Number(), Type.Number()]);
const PositiveSizeSchema = Type.Tuple([Type.Number({ exclusiveMinimum: 0 }), Type.Number({ exclusiveMinimum: 0 })]);

export const CANVAS_DESIGN_SIZE = [1280, 720] as const;

const NodeIdSchema = Type.String({ pattern: "^[A-Za-z_$][A-Za-z0-9_$]*$" });
const ArtifactKeySchema = Type.String({ pattern: "^[A-Z][A-Za-z0-9]*$" });

type ComponentTypeLiteral = TLiteral<keyof typeof componentRegistry & string>;
const componentTypeLiterals = Object.keys(componentRegistry).map((key) => Type.Literal(key)) as ComponentTypeLiteral[];
const BindingComponentTypeSchema = Type.Union([Type.Literal("GameObject"), Type.Literal("RectTransform"), ...componentTypeLiterals]);

const OverrideComponentTypeSchema = Type.Union([
  Type.Literal("Node"),
  Type.Literal("RectTransform"),
  Type.Exclude(BindingComponentTypeSchema, Type.Union([Type.Literal("GameObject"), Type.Literal("RectTransform")])),
]);

const NestedTargetSchema = Type.Object(
  {
    instancePath: Type.Optional(Type.Array(NodeIdSchema, { default: [] })),
    nodeId: NodeIdSchema,
    componentType: BindingComponentTypeSchema,
  },
  { additionalProperties: false },
);

const BindingDeclarationSchema = Type.Object(
  {
    name: Type.String(),
    target: NestedTargetSchema,
  },
  { additionalProperties: false },
);

const BindingsSchema = Type.Array(BindingDeclarationSchema);

const PropertyOverrideSchema = Type.Object(
  {
    target: Type.Object(
      {
        instancePath: Type.Optional(Type.Array(NodeIdSchema, { default: [] })),
        nodeId: NodeIdSchema,
        componentType: OverrideComponentTypeSchema,
        fieldPath: Type.String({ minLength: 1, pattern: "^[A-Za-z_$][A-Za-z0-9_$]*(?:\\.[A-Za-z_$][A-Za-z0-9_$]*)*$" }),
      },
      { additionalProperties: false },
    ),
    value: Type.Unknown(),
  },
  { additionalProperties: false },
);

const RectSchema = Type.Object(
  {
    anchorMin: Vector2Schema,
    anchorMax: Vector2Schema,
    pivot: Vector2Schema,
    anchoredPosition: Vector2Schema,
    sizeDelta: Vector2Schema,
    rotation: Type.Optional(Type.Number({ default: 0 })),
    scale: Type.Optional(Vector2Schema),
  },
  { additionalProperties: false },
);

type ComponentSchemaProperties<TRegistry extends Readonly<Record<string, { readonly schema: TObject }>>> = {
  -readonly [TKey in keyof TRegistry]: TOptional<TRegistry[TKey]["schema"]>;
};

function componentSchemaProperties<TRegistry extends Readonly<Record<string, { readonly schema: TObject }>>>(
  registry: TRegistry,
): ComponentSchemaProperties<TRegistry> {
  return Object.fromEntries(
    Object.entries(registry).map(([key, module]) => [key, Type.Optional(module.schema)]),
  ) as ComponentSchemaProperties<TRegistry>;
}

export const UiComponentsSchema = Type.Object(componentSchemaProperties(componentRegistry), { additionalProperties: false });

const NodeSchema = Type.Recursive(
  (Self) =>
    Type.Object(
      {
        id: NodeIdSchema,
        idMode: Type.Optional(Type.Literal("manual")),
        name: Type.Optional(Type.String({ minLength: 1, pattern: "^[^/\\\\]+$" })),
        active: Type.Optional(Type.Boolean({ default: true })),
        rect: RectSchema,
        components: Type.Optional(UiComponentsSchema),
        children: Type.Optional(Type.Array(Self, { default: [] })),
      },
      { additionalProperties: false },
    ),
  { $id: "UiNode" },
);

const VariantLocalNodeSchema = Type.Recursive(
  (Self) =>
    Type.Object(
      {
        id: NodeIdSchema,
        idMode: Type.Optional(Type.Literal("manual")),
        name: Type.Optional(Type.String({ minLength: 1, pattern: "^[^/\\\\]+$" })),
        active: Type.Optional(Type.Boolean({ default: true })),
        rect: RectSchema,
        components: Type.Optional(UiComponentsSchema),
        children: Type.Optional(Type.Array(Self, { default: [] })),
      },
      { additionalProperties: false },
    ),
  { $id: "UiVariantLocalNode" },
);

const VariantNodeAdditionSchema = Type.Object(
  {
    parentId: NodeIdSchema,
    siblingIndex: Type.Integer({ minimum: 0 }),
    node: VariantLocalNodeSchema,
  },
  { additionalProperties: false },
);

const SourceIdentity = {
  artifactKey: ArtifactKeySchema,
  displayName: Type.Optional(Type.String({ minLength: 1 })),
  description: Type.Optional(Type.String({ minLength: 1 })),
} as const;

const ConcreteSourceCommon = {
  ...SourceIdentity,
  sourceKind: Type.Literal("artifact"),
  widgetType: Type.Optional(ArtifactKeySchema),
  bindings: Type.Optional(BindingsSchema),
  root: NodeSchema,
} as const;

export const UiConcreteSourceSchema = Type.Object(
  {
    ...ConcreteSourceCommon,
    artifactType: Type.Union([Type.Literal("Canvas"), Type.Literal("Widget"), Type.Literal("Fragment")]),
    initialSize: Type.Optional(PositiveSizeSchema),
  },
  { $id: "UiConcreteSource", additionalProperties: false },
);

const UiVariantSourceSchema = Type.Object(
  {
    ...SourceIdentity,
    artifactType: Type.Union([Type.Literal("Canvas"), Type.Literal("Widget"), Type.Literal("Fragment")]),
    sourceKind: Type.Literal("variant"),
    variantOf: ArtifactKeySchema,
    widgetType: Type.Optional(ArtifactKeySchema),
    initialSize: Type.Optional(PositiveSizeSchema),
    nodeAdditions: Type.Optional(Type.Array(VariantNodeAdditionSchema)),
    componentAdditions: Type.Optional(Type.Array(useSiteComponentAdditionSchema)),
    overrides: Type.Array(PropertyOverrideSchema, { default: [] }),
    bindings: Type.Optional(BindingsSchema),
  },
  { $id: "UiVariantSource", additionalProperties: false },
);

export const UiSourceSchema = Type.Union([UiConcreteSourceSchema, UiVariantSourceSchema], { $id: "UiSource" });

type UiConcreteSourceShape = Static<typeof UiConcreteSourceSchema>;
type UiConcreteSourceCommon = Omit<UiConcreteSourceShape, "artifactType" | "initialSize">;
export type UiConcreteSource = UiConcreteSourceCommon &
  ({ artifactType: "Canvas"; initialSize?: never } | { artifactType: "Widget" | "Fragment"; initialSize: [number, number] });
type UiVariantSourceShape = Static<typeof UiVariantSourceSchema>;
type UiVariantSourceCommon = Omit<UiVariantSourceShape, "artifactType" | "initialSize">;
export type UiVariantSource = UiVariantSourceCommon &
  ({ artifactType: "Canvas"; initialSize?: never } | { artifactType: "Widget" | "Fragment"; initialSize?: [number, number] });
export type UiSource = UiConcreteSource | UiVariantSource;
export type UiNode = Static<typeof NodeSchema>;
export type UiNodeIdMode = "auto" | "manual";
export type UiVariantNodeAddition = Static<typeof VariantNodeAdditionSchema>;
export type UiRect = Static<typeof RectSchema>;
export type UiComponents = Static<typeof UiComponentsSchema>;
export type UiStateRootElement = Static<typeof stateRootElementSchema>;
export type UiComponentType = keyof UiComponents;
export type UiBindingComponentType = "GameObject" | "RectTransform" | UiComponentType;
export type UiOverrideComponentType = "Node" | "RectTransform" | UiComponentType;
export type UiNestedTarget = Static<typeof NestedTargetSchema>;
export type UiPropertyOverride = Static<typeof PropertyOverrideSchema>;
export type UiBindings = Static<typeof BindingsSchema>;
export type UiUseSiteComponentAddition = NonNullable<NonNullable<UiComponents["PrefabRef"]>["componentAdditions"]>[number];
export type UiComponentAddition = UiUseSiteComponentAddition;
export type UiVariantComponentAddition = UiUseSiteComponentAddition;
export type UiComponentAdditionType = UiComponentAddition["componentType"];
