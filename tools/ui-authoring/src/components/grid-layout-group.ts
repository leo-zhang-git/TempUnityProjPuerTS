import { Type } from "@sinclair/typebox";
import { alignmentOptions } from "../registry/component-options.js";
import { componentField, defineComponent } from "./component-module.js";
import { childAlignmentSchema } from "./shared-schema.js";

export const gridLayoutGroupComponent = defineComponent({
  key: "GridLayoutGroup",
  label: "Grid Layout Group",
  bindingSuffix: "Layout",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  previewCollectionOwner: true,
  useSiteAddable: true,
  exclusiveGroup: "layoutDriver",
  unity: { type: "UnityEngine.UI.GridLayoutGroup", pathConvention: "mPascal" },
  fields: {
    padding: componentField(
      Type.Optional(Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()], { default: [0, 0, 0, 0] })),
      { inspector: { label: "Padding", control: "vector4", labels: ["L", "R", "T", "B"] }, override: true, unity: { codec: "rectOffset" } },
    ),
    cellSize: componentField(Type.Tuple([Type.Number(), Type.Number()], { default: [100, 100] }), {
      inspector: { label: "Cell Size", control: "vector2", labels: ["X", "Y"] },
      override: true,
      materializeDefault: true,
    }),
    spacing: componentField(Type.Optional(Type.Tuple([Type.Number(), Type.Number()], { default: [0, 0] })), {
      inspector: { label: "Spacing", control: "vector2", labels: ["X", "Y"] },
      override: true,
    }),
    startCorner: componentField(
      Type.Optional(
        Type.Union([Type.Literal("upperLeft"), Type.Literal("upperRight"), Type.Literal("lowerLeft"), Type.Literal("lowerRight")], {
          default: "upperLeft",
        }),
      ),
      {
        inspector: {
          label: "Start Corner",
          control: "enum",
          options: [
            { value: "upperLeft", label: "Upper Left" },
            { value: "upperRight", label: "Upper Right" },
            { value: "lowerLeft", label: "Lower Left" },
            { value: "lowerRight", label: "Lower Right" },
          ],
        },
        override: true,
      },
    ),
    startAxis: componentField(
      Type.Optional(Type.Union([Type.Literal("horizontal"), Type.Literal("vertical")], { default: "horizontal" })),
      {
        inspector: {
          label: "Start Axis",
          control: "enum",
          options: [
            { value: "horizontal", label: "Horizontal" },
            { value: "vertical", label: "Vertical" },
          ],
        },
        override: true,
      },
    ),
    childAlignment: componentField(Type.Optional(childAlignmentSchema), {
      inspector: { label: "Child Alignment", control: "enum", options: alignmentOptions },
      override: true,
    }),
    constraint: componentField(
      Type.Optional(
        Type.Union([Type.Literal("flexible"), Type.Literal("fixedColumnCount"), Type.Literal("fixedRowCount")], { default: "flexible" }),
      ),
      {
        inspector: {
          label: "Constraint",
          control: "enum",
          options: [
            { value: "flexible", label: "Flexible" },
            { value: "fixedColumnCount", label: "Fixed Column Count" },
            { value: "fixedRowCount", label: "Fixed Row Count" },
          ],
        },
        override: true,
      },
    ),
    constraintCount: componentField(Type.Optional(Type.Integer({ minimum: 1, default: 2 })), {
      inspector: {
        label: "Constraint Count",
        control: "number",
        minimum: 1,
        step: 1,
        numericKind: "integer",
        visibleWhen: { property: "constraint", oneOf: ["fixedColumnCount", "fixedRowCount"] },
      },
      override: true,
    }),
  },
});
