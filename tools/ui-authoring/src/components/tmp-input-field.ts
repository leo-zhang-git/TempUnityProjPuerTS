import { Type } from "@sinclair/typebox";
import { componentField, defineComponent, nodesHaveAnyComponent, previewField } from "./component-module.js";
import { nodeIdSchema, requiredNodeReferenceSchema } from "./shared-schema.js";

const contentTypes = [
  "standard",
  "autocorrected",
  "integerNumber",
  "decimalNumber",
  "alphanumeric",
  "name",
  "emailAddress",
  "password",
  "pin",
  "custom",
] as const;

export const tmpInputFieldComponent = defineComponent({
  key: "TMPInputField",
  label: "TMP Input Field",
  bindingSuffix: "InputField",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  unity: { type: "TMPro.TMP_InputField", pathConvention: "mPascal", capability: "tmpInputField" },
  canAdd: ({ nodes }) => {
    if (!nodesHaveAnyComponent(nodes, ["Image", "RoundedRect"])) return "Requires a Graphic target";
    return nodesHaveAnyComponent(nodes, ["Text"]) ? undefined : "Requires a TMP Text target";
  },
  previewFields: {
    text: previewField(Type.String(), { handler: "tmpInputFieldText", defaultValue: "" }),
  },
  fields: {
    targetGraphic: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Target Graphic", control: "nodeReference", referenceFilter: "graphic" },
      materializeDefault: true,
    }),
    textViewport: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Text Viewport", control: "nodeReference", referenceFilter: "any" },
      materializeDefault: true,
    }),
    textComponent: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Text Component", control: "nodeReference", referenceFilter: "text" },
      materializeDefault: true,
    }),
    placeholder: componentField(Type.Optional(nodeIdSchema), {
      inspector: { label: "Placeholder", control: "nodeReference", referenceFilter: "text" },
    }),
    contentType: componentField(
      Type.Optional(
        Type.Union(
          contentTypes.map((value) => Type.Literal(value)),
          { default: "standard" },
        ),
      ),
      {
        inspector: { label: "Content Type", control: "enum", options: contentTypes.map((value) => ({ value, label: value })) },
        override: true,
      },
    ),
    lineType: componentField(
      Type.Optional(
        Type.Union([Type.Literal("singleLine"), Type.Literal("multiLineSubmit"), Type.Literal("multiLineNewline")], {
          default: "singleLine",
        }),
      ),
      {
        inspector: {
          label: "Line Type",
          control: "enum",
          options: [
            { value: "singleLine", label: "Single Line" },
            { value: "multiLineSubmit", label: "Multi Line Submit" },
            { value: "multiLineNewline", label: "Multi Line Newline" },
          ],
        },
        override: true,
      },
    ),
    characterLimit: componentField(Type.Optional(Type.Integer({ minimum: 0, default: 0 })), {
      inspector: { label: "Character Limit", control: "number", minimum: 0, step: 1, numericKind: "integer" },
      override: true,
    }),
    readOnly: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Read Only", control: "boolean" },
      override: true,
    }),
    richText: componentField(Type.Optional(Type.Boolean({ default: true })), {
      inspector: { label: "Rich Text", control: "boolean" },
      override: true,
    }),
    caretWidth: componentField(Type.Optional(Type.Integer({ minimum: 1, default: 1 })), {
      inspector: { label: "Caret Width", control: "number", minimum: 1, step: 1, numericKind: "integer" },
      override: true,
    }),
    scrollSensitivity: componentField(Type.Optional(Type.Number({ minimum: 0, default: 1 })), {
      inspector: { label: "Scroll Sensitivity", control: "number", minimum: 0, step: 0.1 },
      override: true,
    }),
  },
});
