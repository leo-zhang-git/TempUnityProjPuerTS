import { Type } from "@sinclair/typebox";
import { componentField, defineComponent } from "./component-module.js";

const fitMode = () =>
  Type.Optional(
    Type.Union([Type.Literal("unconstrained"), Type.Literal("minSize"), Type.Literal("preferredSize")], { default: "unconstrained" }),
  );
const options = [
  { value: "unconstrained", label: "Unconstrained" },
  { value: "minSize", label: "Min Size" },
  { value: "preferredSize", label: "Preferred Size" },
] as const;

export const contentSizeFitterComponent = defineComponent({
  key: "ContentSizeFitter",
  label: "Content Size Fitter",
  bindingSuffix: "SizeFitter",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  useSiteAddable: true,
  unity: { type: "UnityEngine.UI.ContentSizeFitter", pathConvention: "mPascal" },
  fields: {
    horizontalFit: componentField(fitMode(), { inspector: { label: "Horizontal Fit", control: "enum", options }, override: true }),
    verticalFit: componentField(fitMode(), { inspector: { label: "Vertical Fit", control: "enum", options }, override: true }),
  },
});
