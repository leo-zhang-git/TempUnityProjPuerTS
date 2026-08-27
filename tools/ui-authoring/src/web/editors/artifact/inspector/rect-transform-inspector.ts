import type { UiNode } from "../../../../schema/ui-source-schema.js";

export type RectTransformValue = UiNode["rect"];
export type RectTransformDisplayFieldKey = "posX" | "posY" | "width" | "height" | "left" | "right" | "top" | "bottom";
type RectTransformSourceField = "anchoredPosition" | "sizeDelta";

export interface RectTransformDisplayField {
  readonly key: RectTransformDisplayFieldKey;
  readonly label: string;
  readonly axis: 0 | 1;
  readonly sourceFields: readonly RectTransformSourceField[];
}

export interface AnchorPreset {
  readonly value: string;
  readonly label: string;
  readonly min: readonly [number, number];
  readonly max: readonly [number, number];
  readonly pivot: readonly [number, number];
}

export interface AnchorPresetModifiers {
  readonly setPivot: boolean;
  readonly setPosition: boolean;
}

export interface AnchorPresetPreview {
  readonly rect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  readonly pivot: readonly [number, number];
}

export interface RectTransformEvaluatedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const anchorPresets: readonly AnchorPreset[] = [
  { value: "topLeft", label: "Top Left", min: [0, 1], max: [0, 1], pivot: [0, 1] },
  { value: "topCenter", label: "Top Center", min: [0.5, 1], max: [0.5, 1], pivot: [0.5, 1] },
  { value: "topRight", label: "Top Right", min: [1, 1], max: [1, 1], pivot: [1, 1] },
  { value: "topStretch", label: "Top Stretch", min: [0, 1], max: [1, 1], pivot: [0.5, 1] },
  { value: "middleLeft", label: "Middle Left", min: [0, 0.5], max: [0, 0.5], pivot: [0, 0.5] },
  { value: "center", label: "Center", min: [0.5, 0.5], max: [0.5, 0.5], pivot: [0.5, 0.5] },
  { value: "middleRight", label: "Middle Right", min: [1, 0.5], max: [1, 0.5], pivot: [1, 0.5] },
  { value: "middleStretch", label: "Middle Stretch", min: [0, 0.5], max: [1, 0.5], pivot: [0.5, 0.5] },
  { value: "bottomLeft", label: "Bottom Left", min: [0, 0], max: [0, 0], pivot: [0, 0] },
  { value: "bottomCenter", label: "Bottom Center", min: [0.5, 0], max: [0.5, 0], pivot: [0.5, 0] },
  { value: "bottomRight", label: "Bottom Right", min: [1, 0], max: [1, 0], pivot: [1, 0] },
  { value: "bottomStretch", label: "Bottom Stretch", min: [0, 0], max: [1, 0], pivot: [0.5, 0] },
  { value: "stretchLeft", label: "Stretch Left", min: [0, 0], max: [0, 1], pivot: [0, 0.5] },
  { value: "stretchCenter", label: "Stretch Center", min: [0.5, 0], max: [0.5, 1], pivot: [0.5, 0.5] },
  { value: "stretchRight", label: "Stretch Right", min: [1, 0], max: [1, 1], pivot: [1, 0.5] },
  { value: "stretch", label: "Stretch", min: [0, 0], max: [1, 1], pivot: [0.5, 0.5] },
];

export function anchorPresetPreview(preset: AnchorPreset, modifiers: AnchorPresetModifiers): AnchorPresetPreview {
  const outerMin = 10;
  const outerSize = 80;
  const defaultSize = [42, 42] as const;
  const rect: { left: number; top: number; width: number; height: number } = {
    left: 29,
    top: 29,
    width: defaultSize[0],
    height: defaultSize[1],
  };
  if (modifiers.setPosition) {
    if (preset.min[0] !== preset.max[0]) {
      rect.left = outerMin;
      rect.width = outerSize;
    } else {
      rect.left = outerMin + preset.min[0] * outerSize - defaultSize[0] * preset.pivot[0];
    }
    if (preset.min[1] !== preset.max[1]) {
      rect.top = outerMin;
      rect.height = outerSize;
    } else {
      rect.top = outerMin + (1 - preset.min[1]) * outerSize - defaultSize[1] * (1 - preset.pivot[1]);
    }
  }
  return {
    rect,
    pivot: [rect.left + rect.width * preset.pivot[0], rect.top + rect.height * (1 - preset.pivot[1])],
  };
}

function sameTuple(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function stretched(rect: RectTransformValue, axis: 0 | 1): boolean {
  return rect.anchorMin[axis] !== rect.anchorMax[axis];
}

function displayNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

export function findAnchorPreset(rect: RectTransformValue): AnchorPreset | undefined {
  return anchorPresets.find((preset) => sameTuple(preset.min, rect.anchorMin) && sameTuple(preset.max, rect.anchorMax));
}

export function rectTransformDisplayFields(rect: RectTransformValue): {
  readonly horizontal: readonly [RectTransformDisplayField, RectTransformDisplayField];
  readonly vertical: readonly [RectTransformDisplayField, RectTransformDisplayField];
} {
  const horizontal: readonly [RectTransformDisplayField, RectTransformDisplayField] = stretched(rect, 0)
    ? [
        { key: "left", label: "Left", axis: 0, sourceFields: ["anchoredPosition", "sizeDelta"] },
        { key: "right", label: "Right", axis: 0, sourceFields: ["anchoredPosition", "sizeDelta"] },
      ]
    : [
        { key: "posX", label: "Pos X", axis: 0, sourceFields: ["anchoredPosition"] },
        { key: "width", label: "Width", axis: 0, sourceFields: ["sizeDelta"] },
      ];
  const vertical: readonly [RectTransformDisplayField, RectTransformDisplayField] = stretched(rect, 1)
    ? [
        { key: "top", label: "Top", axis: 1, sourceFields: ["anchoredPosition", "sizeDelta"] },
        { key: "bottom", label: "Bottom", axis: 1, sourceFields: ["anchoredPosition", "sizeDelta"] },
      ]
    : [
        { key: "posY", label: "Pos Y", axis: 1, sourceFields: ["anchoredPosition"] },
        { key: "height", label: "Height", axis: 1, sourceFields: ["sizeDelta"] },
      ];
  return { horizontal, vertical };
}

export function rectTransformDisplayValue(rect: RectTransformValue, key: RectTransformDisplayFieldKey): number {
  switch (key) {
    case "posX":
      return rect.anchoredPosition[0];
    case "posY":
      return rect.anchoredPosition[1];
    case "width":
      return rect.sizeDelta[0];
    case "height":
      return rect.sizeDelta[1];
    case "left":
      return displayNumber(rect.anchoredPosition[0] - rect.sizeDelta[0] * rect.pivot[0]);
    case "right":
      return displayNumber(-rect.anchoredPosition[0] - rect.sizeDelta[0] * (1 - rect.pivot[0]));
    case "top":
      return displayNumber(-rect.anchoredPosition[1] - rect.sizeDelta[1] * (1 - rect.pivot[1]));
    case "bottom":
      return displayNumber(rect.anchoredPosition[1] - rect.sizeDelta[1] * rect.pivot[1]);
  }
}

export function setRectTransformDisplayValue(
  rect: RectTransformValue,
  key: RectTransformDisplayFieldKey,
  value: number,
): RectTransformValue {
  const anchoredPosition: [number, number] = [...rect.anchoredPosition];
  const sizeDelta: [number, number] = [...rect.sizeDelta];
  switch (key) {
    case "posX":
      anchoredPosition[0] = value;
      break;
    case "posY":
      anchoredPosition[1] = value;
      break;
    case "width":
      sizeDelta[0] = value;
      break;
    case "height":
      sizeDelta[1] = value;
      break;
    case "left": {
      const right = rectTransformDisplayValue(rect, "right");
      sizeDelta[0] = -value - right;
      anchoredPosition[0] = value + sizeDelta[0] * rect.pivot[0];
      break;
    }
    case "right": {
      const left = rectTransformDisplayValue(rect, "left");
      sizeDelta[0] = -left - value;
      anchoredPosition[0] = left + sizeDelta[0] * rect.pivot[0];
      break;
    }
    case "top": {
      const bottom = rectTransformDisplayValue(rect, "bottom");
      sizeDelta[1] = -value - bottom;
      anchoredPosition[1] = bottom + sizeDelta[1] * rect.pivot[1];
      break;
    }
    case "bottom": {
      const top = rectTransformDisplayValue(rect, "top");
      sizeDelta[1] = -top - value;
      anchoredPosition[1] = value + sizeDelta[1] * rect.pivot[1];
      break;
    }
  }
  return { ...rect, anchoredPosition, sizeDelta };
}

export function setRectTransformPivot(rect: RectTransformValue, pivot: readonly [number, number]): RectTransformValue {
  return {
    ...rect,
    pivot: [...pivot],
    anchoredPosition: [
      rect.anchoredPosition[0] + rect.sizeDelta[0] * (pivot[0] - rect.pivot[0]),
      rect.anchoredPosition[1] + rect.sizeDelta[1] * (pivot[1] - rect.pivot[1]),
    ],
  };
}

export function applyAnchorPreset(
  rect: RectTransformValue,
  preset: AnchorPreset,
  modifiers: AnchorPresetModifiers,
  parentSize: readonly [number, number],
): RectTransformValue {
  const pivot: [number, number] = [...rect.pivot];
  const anchoredPosition: [number, number] = [...rect.anchoredPosition];
  const sizeDelta: [number, number] = [...rect.sizeDelta];
  for (const axis of [0, 1] as const) {
    const oldSpan = rect.anchorMax[axis] - rect.anchorMin[axis];
    const oldSize = parentSize[axis] * oldSpan + rect.sizeDelta[axis];
    const oldAnchor = parentSize[axis] * (rect.anchorMin[axis] + oldSpan * rect.pivot[axis]);
    const oldLeading = oldAnchor + rect.anchoredPosition[axis] - oldSize * rect.pivot[axis];
    if (modifiers.setPivot) pivot[axis] = preset.pivot[axis];
    if (modifiers.setPosition) {
      if (preset.min[axis] !== preset.max[axis]) {
        anchoredPosition[axis] = 0;
        sizeDelta[axis] = 0;
      } else {
        sizeDelta[axis] = oldSize;
        anchoredPosition[axis] = oldSize * (pivot[axis] - preset.min[axis]);
      }
    } else {
      const newSpan = preset.max[axis] - preset.min[axis];
      sizeDelta[axis] = oldSize - parentSize[axis] * newSpan;
      const newAnchor = parentSize[axis] * (preset.min[axis] + newSpan * pivot[axis]);
      anchoredPosition[axis] = oldLeading + oldSize * pivot[axis] - newAnchor;
    }
  }
  return {
    ...rect,
    anchorMin: [...preset.min],
    anchorMax: [...preset.max],
    pivot,
    anchoredPosition,
    sizeDelta,
  };
}

export function rectTransformFromEvaluated(
  rect: RectTransformValue,
  evaluated: RectTransformEvaluatedRect,
  parent: RectTransformEvaluatedRect,
): RectTransformValue {
  const localLeft = evaluated.x - parent.x;
  const localBottom = parent.height - (evaluated.y - parent.y) - evaluated.height;
  const sizeDelta: [number, number] = [
    evaluated.width - parent.width * (rect.anchorMax[0] - rect.anchorMin[0]),
    evaluated.height - parent.height * (rect.anchorMax[1] - rect.anchorMin[1]),
  ];
  const anchoredPosition: [number, number] = [
    localLeft +
      evaluated.width * rect.pivot[0] -
      parent.width * (rect.anchorMin[0] + (rect.anchorMax[0] - rect.anchorMin[0]) * rect.pivot[0]),
    localBottom +
      evaluated.height * rect.pivot[1] -
      parent.height * (rect.anchorMin[1] + (rect.anchorMax[1] - rect.anchorMin[1]) * rect.pivot[1]),
  ];
  return { ...rect, anchoredPosition, sizeDelta };
}

export function sameRectTransformTopology(rects: readonly RectTransformValue[]): boolean {
  const first = rects[0];
  if (!first) return false;
  return rects.every((rect) => stretched(rect, 0) === stretched(first, 0) && stretched(rect, 1) === stretched(first, 1));
}
