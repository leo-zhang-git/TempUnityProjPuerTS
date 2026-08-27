import { Type } from "@sinclair/typebox";
import { componentField, defineComponent } from "./component-module.js";

export const safeAreaReferenceOrientationValues = {
  portrait: 0,
  landscapeLeft: 1,
  portraitUpsideDown: 2,
  landscapeRight: 3,
} as const;

export const safeAreaEdgeValues = {
  none: 0,
  top: 1,
  right: 2,
  topRight: 3,
  bottom: 4,
  vertical: 5,
  rightBottom: 6,
  topRightBottom: 7,
  left: 8,
  topLeft: 9,
  horizontal: 10,
  topHorizontal: 11,
  leftBottom: 12,
  topLeftBottom: 13,
  horizontalBottom: 14,
  all: 15,
} as const;

export const safeAreaAlignmentValues = {
  none: 0,
  horizontal: 1,
  vertical: 2,
  both: 3,
} as const;

export const safeAreaComponent = defineComponent({
  key: "SafeArea",
  label: "Safe Area",
  bindingSuffix: "SafeArea",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  unity: { type: "UnityEngine.UI.SafeArea", pathConvention: "mPascal" },
  fields: {
    referenceOrientation: componentField(
      Type.Union(
        [Type.Literal("portrait"), Type.Literal("landscapeLeft"), Type.Literal("portraitUpsideDown"), Type.Literal("landscapeRight")],
        { default: "landscapeLeft" },
      ),
      {
        inspector: {
          label: "Reference Orientation",
          control: "enum",
          options: [
            { value: "portrait", label: "Portrait" },
            { value: "landscapeLeft", label: "Landscape Left" },
            { value: "portraitUpsideDown", label: "Portrait Upside Down" },
            { value: "landscapeRight", label: "Landscape Right" },
          ],
        },
        override: true,
        materializeDefault: true,
        unity: { path: "m_ReferenceOrientation", enumValues: safeAreaReferenceOrientationValues },
      },
    ),
    edges: componentField(
      Type.Union(
        [
          Type.Literal("none"),
          Type.Literal("top"),
          Type.Literal("right"),
          Type.Literal("topRight"),
          Type.Literal("bottom"),
          Type.Literal("vertical"),
          Type.Literal("rightBottom"),
          Type.Literal("topRightBottom"),
          Type.Literal("left"),
          Type.Literal("topLeft"),
          Type.Literal("horizontal"),
          Type.Literal("topHorizontal"),
          Type.Literal("leftBottom"),
          Type.Literal("topLeftBottom"),
          Type.Literal("horizontalBottom"),
          Type.Literal("all"),
        ],
        { default: "all" },
      ),
      {
        inspector: {
          label: "Edges",
          control: "enum",
          options: [
            { value: "none", label: "None" },
            { value: "top", label: "Top" },
            { value: "right", label: "Right" },
            { value: "topRight", label: "Top + Right" },
            { value: "bottom", label: "Bottom" },
            { value: "vertical", label: "Vertical" },
            { value: "rightBottom", label: "Right + Bottom" },
            { value: "topRightBottom", label: "Top + Right + Bottom" },
            { value: "left", label: "Left" },
            { value: "topLeft", label: "Top + Left" },
            { value: "horizontal", label: "Horizontal" },
            { value: "topHorizontal", label: "Top + Horizontal" },
            { value: "leftBottom", label: "Left + Bottom" },
            { value: "topLeftBottom", label: "Top + Left + Bottom" },
            { value: "horizontalBottom", label: "Horizontal + Bottom" },
            { value: "all", label: "All" },
          ],
        },
        override: true,
        materializeDefault: true,
        unity: { path: "m_Edges", enumValues: safeAreaEdgeValues },
      },
    ),
    alignment: componentField(
      Type.Union([Type.Literal("none"), Type.Literal("horizontal"), Type.Literal("vertical"), Type.Literal("both")], {
        default: "none",
      }),
      {
        inspector: {
          label: "Alignment",
          control: "enum",
          options: [
            { value: "none", label: "None" },
            { value: "horizontal", label: "Horizontal" },
            { value: "vertical", label: "Vertical" },
            { value: "both", label: "Both" },
          ],
        },
        override: true,
        materializeDefault: true,
        unity: { path: "m_Alignment", enumValues: safeAreaAlignmentValues },
      },
    ),
  },
});
