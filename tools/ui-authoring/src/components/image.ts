import { Type } from "@sinclair/typebox";
import { componentField, defineComponent } from "./component-module.js";

const IMAGE_FILL_ORIGINS = {
  horizontal: ["left", "right"],
  vertical: ["bottom", "top"],
  radial90: ["bottomLeft", "topLeft", "topRight", "bottomRight"],
  radial180: ["bottom", "left", "top", "right"],
  radial360: ["bottom", "right", "top", "left"],
} as const;

export type ImageFillMethod = keyof typeof IMAGE_FILL_ORIGINS;
export type ImageFillOrigin = (typeof IMAGE_FILL_ORIGINS)[ImageFillMethod][number];

function isImageFillMethod(value: unknown): value is ImageFillMethod {
  return typeof value === "string" && value in IMAGE_FILL_ORIGINS;
}

export function defaultImageFillOrigin(method: ImageFillMethod): ImageFillOrigin {
  return IMAGE_FILL_ORIGINS[method][0];
}

function isImageFillOrigin(method: ImageFillMethod, value: unknown): value is ImageFillOrigin {
  return typeof value === "string" && (IMAGE_FILL_ORIGINS[method] as readonly string[]).includes(value);
}

export function imageFillOriginIndex(method: ImageFillMethod, value: unknown): number {
  const index = (IMAGE_FILL_ORIGINS[method] as readonly unknown[]).indexOf(value);
  return index >= 0 ? index : 0;
}

export function imageFillOriginToken(method: ImageFillMethod, index: number): ImageFillOrigin {
  return IMAGE_FILL_ORIGINS[method][index] ?? defaultImageFillOrigin(method);
}

const imageTypeOptions = [
  { value: "simple", label: "Simple" },
  { value: "sliced", label: "Sliced" },
  { value: "tiled", label: "Tiled" },
  { value: "filled", label: "Filled" },
] as const;

const fillMethodOptions = [
  { value: "horizontal", label: "Horizontal" },
  { value: "vertical", label: "Vertical" },
  { value: "radial90", label: "Radial 90" },
  { value: "radial180", label: "Radial 180" },
  { value: "radial360", label: "Radial 360" },
] as const;

export const imageComponent = defineComponent({
  key: "Image",
  label: "Image",
  bindingSuffix: "Image",
  previewRenderer: "image",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  useSiteAddable: true,
  unity: { type: "UnityEngine.UI.Image", pathConvention: "mPascal", capability: "image" },
  fields: {
    sprite: componentField(Type.Optional(Type.String({ pattern: "^(?!/)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$)).+" })), {
      inspector: { label: "Source Image", control: "imageAsset" },
      inspectorOrder: 0,
      override: true,
      asset: "image",
      preview: true,
    }),
    color: componentField(Type.Optional(Type.String({ pattern: "^#[0-9A-Fa-f]{8}$", default: "#FFFFFFFF" })), {
      inspector: { label: "Color", control: "color" },
      inspectorOrder: 1,
      override: true,
      preview: true,
    }),
    imageType: componentField(
      Type.Optional(
        Type.Union([Type.Literal("simple"), Type.Literal("sliced"), Type.Literal("tiled"), Type.Literal("filled")], { default: "simple" }),
      ),
      {
        inspector: { label: "Image Type", control: "enum", options: imageTypeOptions, visibleWhen: { property: "sprite", present: true } },
        inspectorOrder: 5,
        override: true,
        unity: { path: "m_Type" },
      },
    ),
    fillCenter: componentField(Type.Optional(Type.Boolean({ default: true })), {
      inspector: {
        label: "Fill Center",
        control: "boolean",
        visibleWhen: {
          all: [
            { property: "imageType", oneOf: ["sliced", "tiled"] },
            { assetProperty: "sprite", metric: "hasBorder", equals: true },
          ],
        },
      },
      inspectorOrder: 6,
      override: true,
    }),
    pixelsPerUnitMultiplier: componentField(Type.Optional(Type.Number({ minimum: 0.01, default: 1 })), {
      inspector: {
        label: "Pixels Per Unit Multiplier",
        control: "number",
        minimum: 0.01,
        step: 0.01,
        visibleWhen: { property: "imageType", oneOf: ["sliced", "tiled"] },
      },
      inspectorOrder: 7,
      override: true,
    }),
    fillMethod: componentField(
      Type.Optional(
        Type.Union(
          [
            Type.Literal("horizontal"),
            Type.Literal("vertical"),
            Type.Literal("radial90"),
            Type.Literal("radial180"),
            Type.Literal("radial360"),
          ],
          { default: "radial360" },
        ),
      ),
      {
        inspector: {
          label: "Fill Method",
          control: "enum",
          options: fillMethodOptions,
          resetPropertiesOnChange: ["fillOrigin"],
          visibleWhen: { property: "imageType", equals: "filled" },
        },
        inspectorOrder: 8,
        override: true,
      },
    ),
    fillOrigin: componentField(
      Type.Optional(
        Type.Union([
          Type.Literal("left"),
          Type.Literal("right"),
          Type.Literal("bottom"),
          Type.Literal("top"),
          Type.Literal("bottomLeft"),
          Type.Literal("topLeft"),
          Type.Literal("topRight"),
          Type.Literal("bottomRight"),
        ]),
      ),
      {
        inspector: {
          label: "Fill Origin",
          control: "enum",
          optionsBy: {
            property: "fillMethod",
            values: {
              horizontal: [
                { value: "left", label: "Left" },
                { value: "right", label: "Right" },
              ],
              vertical: [
                { value: "bottom", label: "Bottom" },
                { value: "top", label: "Top" },
              ],
              radial90: [
                { value: "bottomLeft", label: "Bottom Left" },
                { value: "topLeft", label: "Top Left" },
                { value: "topRight", label: "Top Right" },
                { value: "bottomRight", label: "Bottom Right" },
              ],
              radial180: [
                { value: "bottom", label: "Bottom" },
                { value: "left", label: "Left" },
                { value: "top", label: "Top" },
                { value: "right", label: "Right" },
              ],
              radial360: [
                { value: "bottom", label: "Bottom" },
                { value: "right", label: "Right" },
                { value: "top", label: "Top" },
                { value: "left", label: "Left" },
              ],
            },
          },
          visibleWhen: { property: "imageType", equals: "filled" },
        },
        inspectorOrder: 9,
        override: true,
        unity: { path: "m_FillOrigin", capability: "imageFillOrigin" },
      },
    ),
    fillAmount: componentField(Type.Optional(Type.Number({ minimum: 0, maximum: 1, default: 1 })), {
      inspector: {
        label: "Fill Amount",
        control: "number",
        minimum: 0,
        maximum: 1,
        step: 0.01,
        visibleWhen: { property: "imageType", equals: "filled" },
      },
      inspectorOrder: 10,
      override: true,
      preview: true,
    }),
    fillClockwise: componentField(Type.Optional(Type.Boolean({ default: true })), {
      inspector: {
        label: "Clockwise",
        control: "boolean",
        visibleWhen: {
          all: [
            { property: "imageType", equals: "filled" },
            { property: "fillMethod", oneOf: ["radial90", "radial180", "radial360"] },
          ],
        },
      },
      inspectorOrder: 11,
      override: true,
    }),
    useSpriteMesh: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Use Sprite Mesh", control: "boolean", visibleWhen: { property: "imageType", equals: "simple" } },
      inspectorOrder: 12,
      override: true,
    }),
    preserveAspect: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Preserve Aspect", control: "boolean", visibleWhen: { property: "imageType", oneOf: ["simple", "filled"] } },
      inspectorOrder: 13,
      override: true,
    }),
    raycastTarget: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Raycast Target", control: "boolean" },
      inspectorOrder: 2,
      override: true,
    }),
    raycastPadding: componentField(
      Type.Optional(Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()], { default: [0, 0, 0, 0] })),
      {
        inspector: { label: "Raycast Padding", control: "vector4", labels: ["L", "B", "R", "T"], step: 0.5 },
        inspectorOrder: 3,
        override: true,
      },
    ),
    maskable: componentField(Type.Optional(Type.Boolean({ default: true })), {
      inspector: { label: "Maskable", control: "boolean" },
      inspectorOrder: 4,
      override: true,
    }),
  },
  actions: [
    {
      action: "setImageNativeSize",
      label: "Set Native Size",
      visibleWhen: {
        all: [
          { property: "sprite", present: true },
          { property: "imageType", oneOf: ["simple", "filled"] },
        ],
      },
    },
  ],
  validate: ({ value, report }) => {
    const method = isImageFillMethod(value.fillMethod) ? value.fillMethod : "radial360";
    if (value.fillOrigin !== undefined && !isImageFillOrigin(method, value.fillOrigin)) {
      report("fillOrigin", "image.fillOrigin", `Fill Origin '${String(value.fillOrigin)}' is not valid for ${method}`, {
        fieldPath: "fillOrigin",
      });
    }
  },
});
