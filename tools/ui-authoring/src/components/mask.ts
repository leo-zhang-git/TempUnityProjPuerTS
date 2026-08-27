import { Type } from "@sinclair/typebox";
import { componentField, defineComponent } from "./component-module.js";

function hasGraphic(node: { readonly components?: Readonly<Record<string, unknown>> }): boolean {
  return Boolean(node.components?.Image || node.components?.RoundedRect || node.components?.Text);
}

export const maskComponent = defineComponent({
  key: "Mask",
  label: "Mask",
  bindingSuffix: "Mask",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  unity: { type: "UnityEngine.UI.Mask", pathConvention: "mPascal" },
  fields: {
    showMaskGraphic: componentField(Type.Optional(Type.Boolean({ default: true })), {
      inspector: { label: "Show Mask Graphic", control: "boolean" },
      override: true,
    }),
  },
  canAdd: ({ node }) => (hasGraphic(node) ? undefined : "Requires a Graphic on the same node"),
  validate: ({ node, report }) => {
    if (!hasGraphic(node)) report("", "mask.graphic", "Mask requires Image, RoundedRect, or Text on the same node");
  },
});
