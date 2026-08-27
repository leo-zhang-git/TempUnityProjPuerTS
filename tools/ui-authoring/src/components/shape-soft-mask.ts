import { Type } from "@sinclair/typebox";
import { componentField, defineComponent } from "./component-module.js";

const rectShapeVisibility = { property: "shape", oneOf: ["Rect", "RoundedRect"] } as const;
const roundedRectVisibility = { property: "shape", equals: "RoundedRect" } as const;
const circleVisibility = { property: "shape", equals: "Circle" } as const;

export const shapeSoftMaskComponent = defineComponent({
  key: "ShapeSoftMask",
  label: "Shape Soft Mask",
  bindingSuffix: "Mask",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  useSiteAddable: true,
  unity: { type: "UnityEngine.UI.ShapeSoftMask", pathConvention: "mPascal" },
  fields: {
    shape: componentField(
      Type.Optional(Type.Union([Type.Literal("Rect"), Type.Literal("RoundedRect"), Type.Literal("Circle")], { default: "Rect" })),
      {
        inspector: {
          label: "Shape",
          control: "segmented",
          options: [
            { value: "Rect", label: "Rect" },
            { value: "RoundedRect", label: "Rounded Rect" },
            { value: "Circle", label: "Circle" },
          ],
        },
        override: true,
        unity: { enumValues: { Rect: 0, RoundedRect: 1, Circle: 2 } },
      },
    ),
    rectSoftness: componentField(
      Type.Optional(
        Type.Tuple([Type.Number({ minimum: 0 }), Type.Number({ minimum: 0 }), Type.Number({ minimum: 0 }), Type.Number({ minimum: 0 })], {
          default: [0, 0, 0, 0],
        }),
      ),
      {
        inspector: {
          label: "Rect Softness",
          control: "vector4",
          labels: ["L", "R", "T", "B"],
          minimum: 0,
          visibleWhen: rectShapeVisibility,
        },
        override: true,
      },
    ),
    radialSoftness: componentField(Type.Optional(Type.Number({ minimum: 0, default: 0 })), {
      inspector: { label: "Radial Softness", control: "number", minimum: 0, visibleWhen: circleVisibility },
      override: true,
    }),
    cornerRadius: componentField(Type.Optional(Type.Number({ minimum: 0, default: 0 })), {
      inspector: { label: "Corner Radius", control: "number", minimum: 0, visibleWhen: roundedRectVisibility },
      override: true,
    }),
    falloff: componentField(Type.Optional(Type.Number({ minimum: 0.0001, default: 1 })), {
      inspector: { label: "Falloff", control: "number", minimum: 0.0001, step: 0.1 },
      override: true,
    }),
  },
});
