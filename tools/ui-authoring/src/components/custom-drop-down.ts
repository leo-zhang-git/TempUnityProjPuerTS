import { Type } from "@sinclair/typebox";
import { componentField, defineComponent } from "./component-module.js";
import { artifactReferenceSchema, requiredNodeReferenceSchema, vector2Schema } from "./shared-schema.js";

export const customDropDownComponent = defineComponent({
  key: "CustomDropDown",
  label: "Custom DropDown",
  bindingSuffix: "DropDown",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  previewCollectionOwner: true,
  unity: { type: "UnityEngine.UI.CustomDropDown", pathConvention: "exact" },
  fields: {
    currentButton: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Current Button", control: "nodeReference", referenceFilter: { componentTypes: ["ButtonEx"] } },
      materializeDefault: true,
      unity: { path: "CurrentButton" },
    }),
    expandArrow: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Expand Arrow", control: "nodeReference" },
      materializeDefault: true,
      unity: { path: "ExpandArrow" },
    }),
    currentContentHost: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Current Content Host", control: "nodeReference" },
      materializeDefault: true,
      unity: { path: "CurrentContentHost" },
    }),
    currentContentPrefab: componentField(Type.Optional(artifactReferenceSchema), {
      inspector: { label: "Current Content Prefab", control: "artifactReference" },
      artifactReference: true,
      override: true,
      unity: { path: "CurrentContentPrefab" },
    }),
    optionView: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Option View", control: "nodeReference" },
      materializeDefault: true,
      unity: { path: "OptionView" },
    }),
    optionScrollRect: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Option Scroll Rect", control: "nodeReference", referenceFilter: { componentTypes: ["ScrollRect"] } },
      materializeDefault: true,
      unity: { path: "OptionScrollRect" },
    }),
    minOptionViewSize: componentField(Type.Optional(vector2Schema), {
      inspector: { label: "Min Option View Size", control: "vector2", defaultValue: [0, 0] },
      override: true,
      unity: { path: "MinOptionViewSize" },
    }),
    maxOptionViewSize: componentField(Type.Optional(vector2Schema), {
      inspector: { label: "Max Option View Size", control: "vector2", defaultValue: [0, 0] },
      override: true,
      unity: { path: "MaxOptionViewSize" },
    }),
    optionTemplate: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Option Template", control: "nodeReference", referenceFilter: { componentTypes: ["CustomDropDownOption"] } },
      materializeDefault: true,
      unity: { path: "OptionTemplate" },
    }),
    optionContentPrefab: componentField(Type.Optional(artifactReferenceSchema), {
      inspector: { label: "Option Content Prefab", control: "artifactReference" },
      artifactReference: true,
      override: true,
      unity: { path: "OptionContentPrefab" },
    }),
  },
});
