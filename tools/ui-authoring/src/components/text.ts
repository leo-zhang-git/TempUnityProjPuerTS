import { Type } from "@sinclair/typebox";
import { DEFAULT_UI_FONT_ASSET } from "../registry/component-contract.js";
import { componentField, defineComponent } from "./component-module.js";

const textMaterialOptions = [
  { value: "normal", label: "普通" },
  { value: "outline", label: "描边" },
] as const;

export const textComponent = defineComponent({
  key: "Text",
  label: "TMP Text",
  bindingSuffix: "Text",
  previewRenderer: "text",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  useSiteAddable: true,
  unity: { type: "TMPro.TextMeshProUGUI", pathConvention: "mPascal", capability: "tmpText" },
  fields: {
    text: componentField(Type.Optional(Type.String({ default: "" })), {
      inspector: { label: "Text", control: "multiline" },
      override: true,
      materializeDefault: true,
      preview: true,
      unity: { path: "m_text" },
    }),
    font: componentField(
      Type.Optional(Type.String({ pattern: "^(?!/)(?!.*\\\\)(?!.*(?:^|/)\\.\\.(?:/|$)).+", default: DEFAULT_UI_FONT_ASSET })),
      {
        inspector: { label: "Font Asset", control: "fontAsset" },
        override: true,
        asset: "font",
        materializeDefault: true,
        unity: { path: "m_fontAsset" },
      },
    ),
    material: componentField(Type.Optional(Type.Union([Type.Literal("normal"), Type.Literal("outline")], { default: "normal" })), {
      inspector: { label: "Material", control: "segmented", options: textMaterialOptions },
      override: true,
      materializeDefault: true,
      preview: true,
      unity: { path: "m_sharedMaterial", capability: "tmpTextMaterial" },
    }),
    fontSize: componentField(Type.Optional(Type.Number({ exclusiveMinimum: 0, default: 24 })), {
      inspector: { label: "Font Size", control: "number", minimum: 0.01, step: 0.5 },
      override: true,
      materializeDefault: true,
      unity: { path: "m_fontSize" },
    }),
    bold: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Bold", control: "boolean" },
      override: true,
      unity: { path: "m_fontStyle" },
    }),
    color: componentField(Type.Optional(Type.String({ pattern: "^#[0-9A-Fa-f]{8}$", default: "#FFFFFFFF" })), {
      inspector: { label: "Color", control: "color" },
      override: true,
      preview: true,
      unity: { path: "m_fontColor" },
    }),
    alignment: componentField(
      Type.Optional(
        Type.Union(
          [
            Type.Literal("topLeft"),
            Type.Literal("top"),
            Type.Literal("topRight"),
            Type.Literal("left"),
            Type.Literal("center"),
            Type.Literal("right"),
            Type.Literal("bottomLeft"),
            Type.Literal("bottom"),
            Type.Literal("bottomRight"),
          ],
          { default: "topLeft" },
        ),
      ),
      { inspector: { label: "Alignment", control: "textAlignment" }, override: true, unity: { capability: "tmpAlignment" } },
    ),
    overflow: componentField(
      Type.Optional(Type.Union([Type.Literal("overflow"), Type.Literal("ellipsis"), Type.Literal("truncate")], { default: "overflow" })),
      {
        inspector: {
          label: "Overflow",
          control: "enum",
          options: [
            { value: "overflow", label: "Overflow" },
            { value: "ellipsis", label: "Ellipsis" },
            { value: "truncate", label: "Truncate" },
          ],
        },
        override: true,
        unity: { path: "m_overflowMode", enumValues: { overflow: 0, ellipsis: 1, truncate: 3 } },
      },
    ),
    wordWrapping: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Auto Wrap", control: "boolean" },
      override: true,
      unity: { path: "m_TextWrappingMode", capability: "tmpWordWrapping" },
    }),
    lineSpacing: componentField(Type.Optional(Type.Number({ default: 0 })), {
      inspector: { label: "Line Spacing", control: "number", step: 0.5 },
      override: true,
      unity: { path: "m_lineSpacing" },
    }),
    characterSpacing: componentField(Type.Optional(Type.Number({ default: 0 })), {
      inspector: { label: "Character Spacing", control: "number", step: 0.5 },
      override: true,
      unity: { path: "m_characterSpacing" },
    }),
    margin: componentField(
      Type.Optional(Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()], { default: [0, 0, 0, 0] })),
      {
        inspector: { label: "Margin", control: "vector4", labels: ["L", "T", "R", "B"], step: 0.5 },
        override: true,
        unity: { path: "m_margin" },
      },
    ),
  },
  validate: ({ value, report }) => {
    if (value.material === "outline" && (value.font ?? DEFAULT_UI_FONT_ASSET) !== DEFAULT_UI_FONT_ASSET) {
      report("material", "text.materialFont", "Outline material requires the default UI font", { fieldPath: "material", readiness: true });
    }
  },
});
