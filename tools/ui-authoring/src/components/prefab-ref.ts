import { type TLiteral, Type } from "@sinclair/typebox";
import { nonPrefabComponentModules } from "./component-list.js";
import { componentField, defineComponent } from "./component-module.js";
import { nodeIdSchema, requiredArtifactReferenceSchema } from "./shared-schema.js";

type NonPrefabComponentModule = (typeof nonPrefabComponentModules)[keyof typeof nonPrefabComponentModules];
type ComponentKeySchema = TLiteral<NonPrefabComponentModule["key"]>;

const componentTypeSchema = Type.Union(Object.keys(nonPrefabComponentModules).map((key) => Type.Literal(key)) as ComponentKeySchema[]);
const useSiteAddableComponentTypes = new Set<string>(
  Object.values(nonPrefabComponentModules)
    .filter((component) => component.useSiteAddable === true)
    .map((component) => component.key),
);
const overrideComponentTypeSchema = Type.Union([
  Type.Literal("Node"),
  Type.Literal("RectTransform"),
  Type.Literal("PrefabRef"),
  componentTypeSchema,
]);
const nestedComponentTargetSchema = Type.Object(
  {
    instancePath: Type.Optional(Type.Array(nodeIdSchema, { default: [] })),
    nodeId: nodeIdSchema,
    componentType: overrideComponentTypeSchema,
    fieldPath: Type.String({ minLength: 1, pattern: "^[A-Za-z_$][A-Za-z0-9_$]*(?:\\.[A-Za-z_$][A-Za-z0-9_$]*)*$" }),
  },
  { additionalProperties: false },
);
const propertyOverrideSchema = Type.Object({ target: nestedComponentTargetSchema, value: Type.Unknown() }, { additionalProperties: false });
const useSiteTargetSchema = Type.Object(
  {
    instancePath: Type.Optional(Type.Array(nodeIdSchema, { default: [] })),
    nodeId: nodeIdSchema,
  },
  { additionalProperties: false },
);
export const useSiteComponentAdditionSchema = Type.Union([
  Type.Object(
    { target: useSiteTargetSchema, componentType: Type.Literal("Image"), value: nonPrefabComponentModules.Image.schema },
    { additionalProperties: false },
  ),
  Type.Object(
    { target: useSiteTargetSchema, componentType: Type.Literal("Text"), value: nonPrefabComponentModules.Text.schema },
    { additionalProperties: false },
  ),
  Type.Object(
    { target: useSiteTargetSchema, componentType: Type.Literal("RoundedRect"), value: nonPrefabComponentModules.RoundedRect.schema },
    { additionalProperties: false },
  ),
  Type.Object(
    { target: useSiteTargetSchema, componentType: Type.Literal("LayoutSettings"), value: nonPrefabComponentModules.LayoutSettings.schema },
    { additionalProperties: false },
  ),
  Type.Object(
    { target: useSiteTargetSchema, componentType: Type.Literal("RectMask2D"), value: nonPrefabComponentModules.RectMask2D.schema },
    { additionalProperties: false },
  ),
  Type.Object(
    { target: useSiteTargetSchema, componentType: Type.Literal("ShapeSoftMask"), value: nonPrefabComponentModules.ShapeSoftMask.schema },
    { additionalProperties: false },
  ),
  Type.Object(
    { target: useSiteTargetSchema, componentType: Type.Literal("CanvasGroup"), value: nonPrefabComponentModules.CanvasGroup.schema },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      target: useSiteTargetSchema,
      componentType: Type.Literal("HorizontalLayoutGroup"),
      value: nonPrefabComponentModules.HorizontalLayoutGroup.schema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      target: useSiteTargetSchema,
      componentType: Type.Literal("VerticalLayoutGroup"),
      value: nonPrefabComponentModules.VerticalLayoutGroup.schema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      target: useSiteTargetSchema,
      componentType: Type.Literal("GridLayoutGroup"),
      value: nonPrefabComponentModules.GridLayoutGroup.schema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      target: useSiteTargetSchema,
      componentType: Type.Literal("AutoLayoutGroup"),
      value: nonPrefabComponentModules.AutoLayoutGroup.schema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      target: useSiteTargetSchema,
      componentType: Type.Literal("ContentSizeFitter"),
      value: nonPrefabComponentModules.ContentSizeFitter.schema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { target: useSiteTargetSchema, componentType: Type.Literal("LayoutElement"), value: nonPrefabComponentModules.LayoutElement.schema },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      target: useSiteTargetSchema,
      componentType: Type.Literal("AspectRatioFitter"),
      value: nonPrefabComponentModules.AspectRatioFitter.schema,
    },
    { additionalProperties: false },
  ),
]);

export const prefabRefComponent = defineComponent({
  key: "PrefabRef",
  label: "Prefab Reference",
  bindingSuffix: "Widget",
  previewRenderer: "prefabRef",
  projectionHandler: "prefabRef",
  roundtrip: "bidirectional",
  canAdd: ({ node }) =>
    Object.keys(node.components ?? {}).some((componentType) => !useSiteAddableComponentTypes.has(componentType))
      ? "Remove components outside the PrefabRef use-site whitelist first"
      : undefined,
  fields: {
    artifactKey: componentField(requiredArtifactReferenceSchema, {
      inspector: { label: "Artifact", control: "artifactReference" },
      materializeDefault: true,
    }),
    overrides: componentField(Type.Optional(Type.Array(propertyOverrideSchema)), { customInspector: true }),
    componentAdditions: componentField(Type.Optional(Type.Array(useSiteComponentAdditionSchema)), { customInspector: true }),
  },
});
