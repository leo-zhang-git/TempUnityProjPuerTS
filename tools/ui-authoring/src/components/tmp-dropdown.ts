import { Type } from "@sinclair/typebox";
import { selectableTransitionOptions } from "../registry/component-options.js";
import { componentField, defineComponent, nodesHaveAnyComponent } from "./component-module.js";
import { nodeIdSchema, requiredNodeReferenceSchema, selectableTransitionSchema } from "./shared-schema.js";

export const tmpDropdownComponent = defineComponent({
  key: "TMPDropdown",
  label: "TMP Dropdown",
  bindingSuffix: "Dropdown",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  unity: { type: "TMPro.TMP_Dropdown", pathConvention: "mPascal", capability: "tmpDropdown" },
  canAdd: ({ nodes }) => {
    if (!nodesHaveAnyComponent(nodes, ["Image", "RoundedRect"])) return "Requires a Graphic target";
    return nodesHaveAnyComponent(nodes, ["Text"]) ? undefined : "Requires a TMP Text target";
  },
  fields: {
    targetGraphic: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Target Graphic", control: "nodeReference", referenceFilter: "graphic" },
      materializeDefault: true,
    }),
    template: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Template", control: "nodeReference", referenceFilter: "any" },
      materializeDefault: true,
    }),
    captionText: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Caption Text", control: "nodeReference", referenceFilter: "text" },
      materializeDefault: true,
    }),
    captionImage: componentField(Type.Optional(Type.Union([nodeIdSchema, Type.Null()], { default: null })), {
      inspector: { label: "Caption Image", control: "nodeReference", referenceFilter: "image", nullable: true },
    }),
    itemText: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Item Text", control: "nodeReference", referenceFilter: "text" },
      materializeDefault: true,
    }),
    itemImage: componentField(Type.Optional(Type.Union([nodeIdSchema, Type.Null()], { default: null })), {
      inspector: { label: "Item Image", control: "nodeReference", referenceFilter: "image", nullable: true },
    }),
    value: componentField(Type.Optional(Type.Integer({ minimum: 0, default: 0 })), {
      inspector: { label: "Value", control: "number", minimum: 0, step: 1 },
      override: true,
    }),
    optionsText: componentField(Type.Optional(Type.String({ default: "Option A\nOption B\nOption C" })), {
      inspector: { label: "Options", control: "multiline" },
      override: true,
      unity: { path: "m_Options", capability: "tmpDropdownOptions" },
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
