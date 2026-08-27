import { Type } from "@sinclair/typebox";
import { componentField, defineComponent } from "./component-module.js";

export const roundedRectComponent = defineComponent({
  key: "RoundedRect",
  label: "Rounded Rect",
  bindingSuffix: "RoundedRect",
  previewRenderer: "roundedRect",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  useSiteAddable: true,
  unity: { type: "UnityEngine.UI.RoundedRectGraphic", pathConvention: "mPascal" },
  fields: {
    color: componentField(Type.Optional(Type.String({ pattern: "^#[0-9A-Fa-f]{8}$", default: "#FFFFFFFF" })), {
      inspector: { label: "Color", control: "color" },
      override: true,
      preview: true,
    }),
    cornerRadii: componentField(
      Type.Optional(
        Type.Tuple([Type.Number({ minimum: 0 }), Type.Number({ minimum: 0 }), Type.Number({ minimum: 0 }), Type.Number({ minimum: 0 })]),
      ),
      {
        inspector: { label: "Corner Radii", control: "vector4", defaultValue: [0, 0, 0, 0], labels: ["TL", "TR", "BR", "BL"], minimum: 0 },
        override: true,
      },
    ),
    fillAmount: componentField(Type.Optional(Type.Number({ minimum: 0, maximum: 1, default: 1 })), {
      inspector: { label: "Fill Amount", control: "number", minimum: 0, maximum: 1, step: 0.01 },
      override: true,
      preview: true,
    }),
    raycastTarget: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Raycast Target", control: "boolean" },
      override: true,
    }),
  },
});
