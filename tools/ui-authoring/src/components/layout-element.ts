import { Type } from "@sinclair/typebox";
import { componentField, defineComponent } from "./component-module.js";

export const layoutElementComponent = defineComponent({
  key: "LayoutElement",
  label: "Layout Element",
  bindingSuffix: "LayoutElement",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  useSiteAddable: true,
  unity: { type: "UnityEngine.UI.LayoutElement", pathConvention: "mPascal" },
  fields: {
    ignoreLayout: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Ignore Layout", control: "boolean" },
      override: true,
    }),
    minWidth: componentField(Type.Optional(Type.Number({ minimum: 0 })), {
      inspector: {
        label: "Min Width",
        control: "optionalNumber",
        suggestedValue: 0,
        minimum: 0,
        visibleWhen: { property: "ignoreLayout", equals: false },
      },
      override: true,
    }),
    minHeight: componentField(Type.Optional(Type.Number({ minimum: 0 })), {
      inspector: {
        label: "Min Height",
        control: "optionalNumber",
        suggestedValue: 0,
        minimum: 0,
        visibleWhen: { property: "ignoreLayout", equals: false },
      },
      override: true,
    }),
    maxWidth: componentField(Type.Optional(Type.Number({ minimum: 0 })), {
      inspector: {
        label: "Max Width",
        control: "optionalNumber",
        suggestedValue: 100,
        minimum: 0,
        visibleWhen: { property: "ignoreLayout", equals: false },
      },
      override: true,
    }),
    maxHeight: componentField(Type.Optional(Type.Number({ minimum: 0 })), {
      inspector: {
        label: "Max Height",
        control: "optionalNumber",
        suggestedValue: 100,
        minimum: 0,
        visibleWhen: { property: "ignoreLayout", equals: false },
      },
      override: true,
    }),
    preferredWidth: componentField(Type.Optional(Type.Number({ minimum: 0 })), {
      inspector: {
        label: "Preferred Width",
        control: "optionalNumber",
        suggestedValue: 100,
        minimum: 0,
        visibleWhen: { property: "ignoreLayout", equals: false },
      },
      override: true,
    }),
    preferredHeight: componentField(Type.Optional(Type.Number({ minimum: 0 })), {
      inspector: {
        label: "Preferred Height",
        control: "optionalNumber",
        suggestedValue: 100,
        minimum: 0,
        visibleWhen: { property: "ignoreLayout", equals: false },
      },
      override: true,
    }),
    flexibleWidth: componentField(Type.Optional(Type.Number({ minimum: 0 })), {
      inspector: {
        label: "Flexible Width",
        control: "optionalNumber",
        suggestedValue: 0,
        minimum: 0,
        visibleWhen: { property: "ignoreLayout", equals: false },
      },
      override: true,
    }),
    flexibleHeight: componentField(Type.Optional(Type.Number({ minimum: 0 })), {
      inspector: {
        label: "Flexible Height",
        control: "optionalNumber",
        suggestedValue: 0,
        minimum: 0,
        visibleWhen: { property: "ignoreLayout", equals: false },
      },
      override: true,
    }),
    layoutPriority: componentField(Type.Optional(Type.Integer({ default: 1 })), {
      inspector: { label: "Layout Priority", control: "number", step: 1, numericKind: "integer" },
      override: true,
    }),
  },
});
