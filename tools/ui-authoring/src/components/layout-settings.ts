import { Type } from "@sinclair/typebox";
import { componentField, defineComponent } from "./component-module.js";

export const layoutSettingsComponent = defineComponent({
  key: "LayoutSettings",
  label: "Layout Settings",
  bindingSuffix: "LayoutSettings",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  useSiteAddable: true,
  unity: { type: "UnityEngine.UI.LayoutSettings", pathConvention: "exact" },
  canAdd: ({ node }) => (node.components?.ScrollRectEx ? undefined : "Requires Scroll Rect Ex on this node"),
  fields: {
    spacing: componentField(Type.Optional(Type.Tuple([Type.Number(), Type.Number()], { default: [0, 0] })), {
      inspector: { label: "Spacing", control: "vector2", labels: ["X", "Y"] },
    }),
    padding: componentField(
      Type.Optional(Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()], { default: [0, 0, 0, 0] })),
      { inspector: { label: "Padding", control: "vector4", labels: ["L", "R", "T", "B"] } },
    ),
  },
});
