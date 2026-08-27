import { Type } from "@sinclair/typebox";
import { componentField, defineComponent } from "./component-module.js";

export const canvasGroupComponent = defineComponent({
  key: "CanvasGroup",
  label: "Canvas Group",
  bindingSuffix: "CanvasGroup",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  useSiteAddable: true,
  unity: { type: "UnityEngine.CanvasGroup", pathConvention: "mPascal" },
  fields: {
    alpha: componentField(Type.Optional(Type.Number({ minimum: 0, maximum: 1, default: 1 })), {
      inspector: { label: "Alpha", control: "number", minimum: 0, maximum: 1, step: 0.05 },
      override: true,
    }),
    interactable: componentField(Type.Optional(Type.Boolean({ default: true })), {
      inspector: { label: "Interactable", control: "boolean" },
      override: true,
    }),
    blocksRaycasts: componentField(Type.Optional(Type.Boolean({ default: true })), {
      inspector: { label: "Blocks Raycasts", control: "boolean" },
      override: true,
    }),
    ignoreParentGroups: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Ignore Parent Groups", control: "boolean" },
      override: true,
    }),
  },
});
