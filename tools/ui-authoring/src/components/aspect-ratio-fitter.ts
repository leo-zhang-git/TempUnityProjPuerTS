import { Type } from "@sinclair/typebox";
import { componentField, defineComponent } from "./component-module.js";

export const aspectRatioFitterComponent = defineComponent({
  key: "AspectRatioFitter",
  label: "Aspect Ratio Fitter",
  bindingSuffix: "AspectRatioFitter",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  useSiteAddable: true,
  unity: { type: "UnityEngine.UI.AspectRatioFitter", pathConvention: "mPascal" },
  fields: {
    aspectMode: componentField(
      Type.Union(
        [
          Type.Literal("widthControlsHeight"),
          Type.Literal("heightControlsWidth"),
          Type.Literal("fitInParent"),
          Type.Literal("envelopeParent"),
        ],
        { default: "widthControlsHeight" },
      ),
      {
        inspector: {
          label: "Aspect Mode",
          control: "enum",
          options: [
            { value: "widthControlsHeight", label: "Width Controls Height" },
            { value: "heightControlsWidth", label: "Height Controls Width" },
            { value: "fitInParent", label: "Fit In Parent" },
            { value: "envelopeParent", label: "Envelope Parent" },
          ],
        },
        override: true,
        materializeDefault: true,
        unity: { enumValues: { widthControlsHeight: 1, heightControlsWidth: 2, fitInParent: 3, envelopeParent: 4 } },
      },
    ),
    aspectRatio: componentField(Type.Number({ exclusiveMinimum: 0, default: 1 }), {
      inspector: { label: "Aspect Ratio", control: "number", minimum: 0.0001, step: 0.01 },
      override: true,
      materializeDefault: true,
    }),
  },
});
