import { componentField, defineComponent } from "./component-module.js";
import { requiredNodeReferenceSchema } from "./shared-schema.js";

export const customDropDownOptionComponent = defineComponent({
  key: "CustomDropDownOption",
  label: "Custom DropDown Option",
  bindingSuffix: "DropDownOption",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  unity: { type: "UnityEngine.UI.CustomDropDownOption", pathConvention: "exact" },
  fields: {
    button: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Button", control: "nodeReference", referenceFilter: { componentTypes: ["ButtonEx"] } },
      materializeDefault: true,
      unity: { path: "Button" },
    }),
    contentHost: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Content Host", control: "nodeReference" },
      materializeDefault: true,
      unity: { path: "ContentHost" },
    }),
    selectedVisual: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Selected Visual", control: "nodeReference" },
      materializeDefault: true,
      unity: { path: "SelectedVisual" },
    }),
  },
});
