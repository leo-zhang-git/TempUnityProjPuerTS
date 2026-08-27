import { Type } from "@sinclair/typebox";
import { directionOptions, selectableTransitionOptions } from "../registry/component-options.js";
import { componentField, defineComponent, nodesHaveAnyComponent } from "./component-module.js";
import { directionSchema, requiredNodeReferenceSchema, selectableTransitionSchema } from "./shared-schema.js";

export const sliderComponent = defineComponent({
  key: "Slider",
  label: "Slider",
  bindingSuffix: "Slider",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  unity: { type: "UnityEngine.UI.Slider", pathConvention: "mPascal" },
  canAdd: ({ nodes }) => (nodesHaveAnyComponent(nodes, ["Image", "RoundedRect"]) ? undefined : "Requires a Graphic target"),
  fields: {
    targetGraphic: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Target Graphic", control: "nodeReference", referenceFilter: "graphic" },
      materializeDefault: true,
    }),
    fillRect: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Fill Rect", control: "nodeReference", referenceFilter: "any" },
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
    minValue: componentField(Type.Optional(Type.Number({ default: 0 })), {
      inspector: { label: "Min Value", control: "number", step: 0.1 },
      override: true,
    }),
    maxValue: componentField(Type.Optional(Type.Number({ default: 1 })), {
      inspector: { label: "Max Value", control: "number", step: 0.1 },
      override: true,
    }),
    wholeNumbers: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Whole Numbers", control: "boolean" },
      override: true,
    }),
    value: componentField(Type.Optional(Type.Number({ default: 0 })), {
      inspector: { label: "Value", control: "number", step: 0.1 },
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
