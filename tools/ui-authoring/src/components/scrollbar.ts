import { Type } from "@sinclair/typebox";
import { directionOptions, selectableTransitionOptions } from "../registry/component-options.js";
import { componentField, defineComponent } from "./component-module.js";
import { directionSchema, requiredNodeReferenceSchema, selectableTransitionSchema } from "./shared-schema.js";

export const scrollbarComponent = defineComponent({
  key: "Scrollbar",
  label: "Scrollbar",
  bindingSuffix: "Scrollbar",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  unity: { type: "UnityEngine.UI.Scrollbar", pathConvention: "mPascal" },
  fields: {
    targetGraphic: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Target Graphic", control: "nodeReference", referenceFilter: "graphic" },
      materializeDefault: true,
    }),
    handleRect: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Handle Rect", control: "nodeReference", referenceFilter: "any" },
      materializeDefault: true,
    }),
    direction: componentField(Type.Optional(directionSchema), {
      inspector: { label: "Direction", control: "enum", options: directionOptions },
      override: true,
    }),
    value: componentField(Type.Optional(Type.Number({ minimum: 0, maximum: 1, default: 0 })), {
      inspector: { label: "Value", control: "number", minimum: 0, maximum: 1, step: 0.01 },
      override: true,
    }),
    size: componentField(Type.Optional(Type.Number({ minimum: 0, maximum: 1, default: 0.2 })), {
      inspector: { label: "Size", control: "number", minimum: 0, maximum: 1, step: 0.01 },
      override: true,
    }),
    numberOfSteps: componentField(Type.Optional(Type.Integer({ minimum: 0, default: 0 })), {
      inspector: { label: "Number Of Steps", control: "number", minimum: 0, step: 1 },
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
