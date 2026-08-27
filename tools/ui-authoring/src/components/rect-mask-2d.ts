import { Type } from "@sinclair/typebox";
import { componentField, defineComponent } from "./component-module.js";

export const rectMask2DComponent = defineComponent({
  key: "RectMask2D",
  label: "Rect Mask 2D",
  bindingSuffix: "Mask",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  useSiteAddable: true,
  unity: { type: "UnityEngine.UI.RectMask2D", pathConvention: "mPascal" },
  fields: {
    padding: componentField(
      Type.Optional(Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()], { default: [0, 0, 0, 0] })),
      {
        inspector: { label: "Padding", control: "vector4", labels: ["L", "B", "R", "T"] },
        override: true,
      },
    ),
    softness: componentField(Type.Optional(Type.Tuple([Type.Number({ minimum: 0 }), Type.Number({ minimum: 0 })], { default: [0, 0] })), {
      inspector: { label: "Softness", control: "vector2", labels: ["X", "Y"], minimum: 0 },
      override: true,
    }),
  },
});
