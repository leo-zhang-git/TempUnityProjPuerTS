import { Type } from "@sinclair/typebox";
import { selectableTransitionOptions } from "../registry/component-options.js";
import { componentField, defineComponent } from "./component-module.js";
import { requiredNodeReferenceSchema, selectableTransitionSchema } from "./shared-schema.js";

export const toggleComponent = defineComponent({
  key: "Toggle",
  label: "Toggle",
  bindingSuffix: "Toggle",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  unity: { type: "UnityEngine.UI.Toggle", pathConvention: "mPascal" },
  fields: {
    targetGraphic: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Target Graphic", control: "nodeReference", referenceFilter: "graphic" },
      materializeDefault: true,
    }),
    graphic: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Checkmark Graphic", control: "nodeReference", referenceFilter: "graphic" },
      materializeDefault: true,
      unity: { path: "graphic" },
    }),
    isOn: componentField(Type.Optional(Type.Boolean({ default: true })), {
      inspector: { label: "Is On", control: "boolean" },
      override: true,
    }),
    interactable: componentField(Type.Optional(Type.Boolean({ default: true })), {
      inspector: { label: "Interactable", control: "boolean" },
      override: true,
    }),
    transition: componentField(Type.Optional(selectableTransitionSchema), {
      inspector: { label: "Transition", control: "enum", options: selectableTransitionOptions },
      override: true,
    }),
  },
});
