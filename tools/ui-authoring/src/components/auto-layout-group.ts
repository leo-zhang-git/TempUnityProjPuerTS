import { Type } from "@sinclair/typebox";
import { alignmentOptions } from "../registry/component-options.js";
import { componentField, defineComponent } from "./component-module.js";

const linearVisibility = { property: "mode", oneOf: ["horizontal", "vertical"] } as const;
const gridVisibility = { property: "mode", equals: "grid" } as const;
const manualGridRowVisibility = {
  all: [gridVisibility, { property: "autoGrid", equals: false }, { property: "startAxis", equals: "vertical" }],
} as const;
const manualGridColumnVisibility = {
  all: [gridVisibility, { property: "autoGrid", equals: false }, { property: "startAxis", equals: "horizontal" }],
} as const;
const uniformMode = { requiresUniformProperty: "mode" } as const;

export interface AutoLayoutGridDimensionsInput {
  readonly containerWidth: number;
  readonly containerHeight: number;
  readonly childCount: number;
  readonly cellSize?: readonly [number, number] | undefined;
  readonly spacing?: readonly [number, number] | undefined;
  readonly padding?: readonly number[] | undefined;
  readonly startAxis?: string | undefined;
  readonly autoGrid?: boolean | undefined;
  readonly rowCount?: number | undefined;
  readonly columnCount?: number | undefined;
}

export interface AutoLayoutGridDimensions {
  readonly rows: number;
  readonly columns: number;
}

export function autoLayoutGridDimensions(input: AutoLayoutGridDimensionsInput): AutoLayoutGridDimensions {
  if (input.autoGrid === false) {
    if (input.startAxis === "vertical") {
      const rows = positiveInteger(input.rowCount);
      return { rows, columns: input.childCount <= 0 ? 0 : Math.ceil(input.childCount / rows) };
    }
    const columns = positiveInteger(input.columnCount);
    return { rows: input.childCount <= 0 ? 0 : Math.ceil(input.childCount / columns), columns };
  }
  if (input.childCount <= 0) return { rows: 0, columns: 0 };
  const cell = input.cellSize ?? [100, 100];
  const spacing = input.spacing ?? [0, 0];
  const padding = input.padding ?? [0, 0, 0, 0];
  const horizontalCapacity = axisCapacity(input.containerWidth, Number(padding[0] ?? 0) + Number(padding[1] ?? 0), cell[0], spacing[0]);
  const verticalCapacity = axisCapacity(input.containerHeight, Number(padding[2] ?? 0) + Number(padding[3] ?? 0), cell[1], spacing[1]);
  if (input.startAxis === "vertical") {
    const rows = Math.min(verticalCapacity, input.childCount);
    return { rows, columns: Math.ceil(input.childCount / rows) };
  }
  const columns = Math.min(horizontalCapacity, input.childCount);
  return { rows: Math.ceil(input.childCount / columns), columns };
}

function positiveInteger(value: number | undefined): number {
  return Math.max(1, Math.floor(value ?? 1));
}

function axisCapacity(containerSize: number, padding: number, cell: number, spacing: number): number {
  const stride = cell + spacing;
  return stride <= 0 ? Number.MAX_SAFE_INTEGER : Math.max(1, Math.floor((containerSize - padding + spacing + 0.001) / stride));
}

export const autoLayoutGroupComponent = defineComponent({
  key: "AutoLayoutGroup",
  label: "Auto Layout Group",
  bindingSuffix: "Layout",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  useSiteAddable: true,
  exclusiveGroup: "layoutDriver",
  unity: { type: "UnityEngine.UI.AutoLayoutGroup", pathConvention: "mPascal" },
  fields: {
    mode: componentField(
      Type.Optional(Type.Union([Type.Literal("horizontal"), Type.Literal("vertical"), Type.Literal("grid")], { default: "horizontal" })),
      {
        inspector: {
          label: "Layout Mode",
          control: "segmented",
          options: [
            { value: "horizontal", label: "Horizontal" },
            { value: "vertical", label: "Vertical" },
            { value: "grid", label: "Grid" },
          ],
        },
        inspectorOrder: 0,
        override: true,
      },
    ),
    padding: componentField(
      Type.Optional(Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()], { default: [0, 0, 0, 0] })),
      {
        inspector: { label: "Padding", control: "vector4", labels: ["L", "R", "T", "B"] },
        inspectorOrder: 1,
        override: true,
        unity: { codec: "rectOffset" },
      },
    ),
    childAlignment: componentField(
      Type.Optional(
        Type.Union(
          alignmentOptions.map((option) => Type.Literal(option.value)),
          { default: "upperLeft" },
        ),
      ),
      {
        inspector: { label: "Child Alignment", control: "enum", options: alignmentOptions },
        inspectorOrder: 2,
        override: true,
      },
    ),
    spacing: componentField(Type.Optional(Type.Number({ default: 0 })), {
      inspector: { label: "Spacing", control: "number", step: 0.5, visibleWhen: linearVisibility, ...uniformMode },
      inspectorOrder: 3,
      override: true,
    }),
    reverseArrangement: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Reverse Arrangement", control: "boolean", visibleWhen: linearVisibility, ...uniformMode },
      inspectorOrder: 4,
      override: true,
    }),
    childControlWidth: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Control Child Width", control: "boolean", visibleWhen: linearVisibility, ...uniformMode },
      inspectorOrder: 5,
      override: true,
    }),
    childControlHeight: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Control Child Height", control: "boolean", visibleWhen: linearVisibility, ...uniformMode },
      inspectorOrder: 6,
      override: true,
    }),
    childScaleWidth: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Use Child Scale Width", control: "boolean", visibleWhen: linearVisibility, ...uniformMode },
      inspectorOrder: 7,
      override: true,
    }),
    childScaleHeight: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Use Child Scale Height", control: "boolean", visibleWhen: linearVisibility, ...uniformMode },
      inspectorOrder: 8,
      override: true,
    }),
    childForceExpandWidth: componentField(Type.Optional(Type.Boolean({ default: true })), {
      inspector: { label: "Force Expand Width", control: "boolean", visibleWhen: linearVisibility, ...uniformMode },
      inspectorOrder: 9,
      override: true,
    }),
    childForceExpandHeight: componentField(Type.Optional(Type.Boolean({ default: true })), {
      inspector: { label: "Force Expand Height", control: "boolean", visibleWhen: linearVisibility, ...uniformMode },
      inspectorOrder: 10,
      override: true,
    }),
    cellSize: componentField(Type.Optional(Type.Tuple([Type.Number(), Type.Number()], { default: [100, 100] })), {
      inspector: { label: "Cell Size", control: "vector2", labels: ["X", "Y"], visibleWhen: gridVisibility, ...uniformMode },
      inspectorOrder: 11,
      override: true,
    }),
    gridSpacing: componentField(Type.Optional(Type.Tuple([Type.Number(), Type.Number()], { default: [0, 0] })), {
      inspector: { label: "Spacing", control: "vector2", labels: ["X", "Y"], visibleWhen: gridVisibility, ...uniformMode },
      inspectorOrder: 12,
      override: true,
    }),
    autoGrid: componentField(Type.Optional(Type.Boolean({ default: true })), {
      inspector: {
        label: "Auto",
        control: "boolean",
        visibleWhen: gridVisibility,
        resetPropertiesOnChange: ["rowCount", "columnCount"],
        ...uniformMode,
      },
      inspectorOrder: 13,
      override: true,
    }),
    rowCount: componentField(Type.Optional(Type.Integer({ minimum: 1, default: 1 })), {
      inspector: {
        label: "Rows",
        control: "number",
        minimum: 1,
        step: 1,
        numericKind: "integer",
        visibleWhen: manualGridRowVisibility,
        ...uniformMode,
      },
      inspectorOrder: 14,
      override: true,
    }),
    columnCount: componentField(Type.Optional(Type.Integer({ minimum: 1, default: 1 })), {
      inspector: {
        label: "Columns",
        control: "number",
        minimum: 1,
        step: 1,
        numericKind: "integer",
        visibleWhen: manualGridColumnVisibility,
        ...uniformMode,
      },
      inspectorOrder: 15,
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
          visibleWhen: gridVisibility,
          ...uniformMode,
        },
        inspectorOrder: 16,
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
          visibleWhen: gridVisibility,
          resetPropertiesOnChange: ["rowCount", "columnCount"],
          ...uniformMode,
        },
        inspectorOrder: 17,
        override: true,
      },
    ),
  },
});
