import assert from "node:assert/strict";
import test from "node:test";
import type { UiNode } from "../../src/schema/ui-source-schema.js";
import {
  anchorPresetPreview,
  anchorPresets,
  applyAnchorPreset,
  findAnchorPreset,
  rectTransformDisplayFields,
  rectTransformDisplayValue,
  rectTransformFromEvaluated,
  sameRectTransformTopology,
  setRectTransformDisplayValue,
  setRectTransformPivot,
} from "../../src/web/editors/artifact/inspector/rect-transform-inspector.js";

function rect(overrides: Partial<UiNode["rect"]> = {}): UiNode["rect"] {
  return {
    anchorMin: [0, 1],
    anchorMax: [1, 1],
    pivot: [0.5, 0.5],
    anchoredPosition: [0, -19],
    sizeDelta: [0, 38],
    ...overrides,
  };
}

test("projects RectTransform values through Unity stretch field semantics", () => {
  const value = rect();
  const fields = rectTransformDisplayFields(value);
  assert.deepEqual(
    fields.horizontal.map((field) => field.label),
    ["Left", "Right"],
  );
  assert.deepEqual(
    fields.vertical.map((field) => field.label),
    ["Pos Y", "Height"],
  );
  assert.equal(rectTransformDisplayValue(value, "left"), 0);
  assert.equal(rectTransformDisplayValue(value, "right"), 0);
  assert.equal(rectTransformDisplayValue(value, "posY"), -19);
  assert.equal(rectTransformDisplayValue(value, "height"), 38);
});

test("edits stretch edges while preserving the opposite edge", () => {
  const leftChanged = setRectTransformDisplayValue(rect(), "left", 12);
  assert.equal(rectTransformDisplayValue(leftChanged, "left"), 12);
  assert.equal(rectTransformDisplayValue(leftChanged, "right"), 0);

  const vertical = rect({ anchorMin: [0, 0], anchorMax: [0, 1], anchoredPosition: [0, 0], sizeDelta: [0, 0] });
  const topChanged = setRectTransformDisplayValue(vertical, "top", 10);
  assert.equal(rectTransformDisplayValue(topChanged, "top"), 10);
  assert.equal(rectTransformDisplayValue(topChanged, "bottom"), 0);
  const bottomChanged = setRectTransformDisplayValue(topChanged, "bottom", 20);
  assert.equal(rectTransformDisplayValue(bottomChanged, "top"), 10);
  assert.equal(rectTransformDisplayValue(bottomChanged, "bottom"), 20);
});

test("changes pivot while preserving the visual rectangle", () => {
  const original = rect({ pivot: [0.25, 0.25], anchoredPosition: [14, -22], sizeDelta: [-80, 40] });
  const next = setRectTransformPivot(original, [0.75, 0.75]);
  assert.deepEqual(next.pivot, [0.75, 0.75]);
  assert.deepEqual(next.anchoredPosition, [-26, -2]);
  assert.equal(rectTransformDisplayValue(next, "left"), rectTransformDisplayValue(original, "left"));
  assert.equal(rectTransformDisplayValue(next, "right"), rectTransformDisplayValue(original, "right"));
  assert.equal(rectTransformDisplayValue(next, "top"), rectTransformDisplayValue(original, "top"));
  assert.equal(rectTransformDisplayValue(next, "bottom"), rectTransformDisplayValue(original, "bottom"));
});

test("provides all Unity anchor combinations and applies modifier behavior", () => {
  assert.equal(anchorPresets.length, 16);
  const topStretch = anchorPresets.find((preset) => preset.value === "topStretch");
  assert.ok(topStretch);

  const parentSize = [300, 200] as const;
  const original = rect({
    anchorMin: [0.5, 0.5],
    anchorMax: [0.5, 0.5],
    pivot: [0.2, 0.3],
    anchoredPosition: [14, -22],
    sizeDelta: [80, 40],
  });
  const anchorsOnly = applyAnchorPreset(original, topStretch, { setPivot: false, setPosition: false }, parentSize);
  assert.deepEqual(anchorsOnly.anchorMin, [0, 1]);
  assert.deepEqual(anchorsOnly.anchorMax, [1, 1]);
  assert.deepEqual(anchorsOnly.pivot, [0.2, 0.3]);
  assert.deepEqual(anchorsOnly.anchoredPosition, [104, -122]);
  assert.deepEqual(anchorsOnly.sizeDelta, [-220, 40]);

  const pivotAndPosition = applyAnchorPreset(original, topStretch, { setPivot: true, setPosition: true }, parentSize);
  assert.deepEqual(pivotAndPosition.pivot, [0.5, 1]);
  assert.deepEqual(pivotAndPosition.anchoredPosition, [0, 0]);
  assert.deepEqual(pivotAndPosition.sizeDelta, [0, 40]);
  assert.equal(findAnchorPreset(pivotAndPosition)?.value, "topStretch");

  const pivotOnly = applyAnchorPreset(original, topStretch, { setPivot: true, setPosition: false }, parentSize);
  assert.deepEqual(pivotOnly.pivot, [0.5, 1]);
  assert.deepEqual(
    rectTransformFromEvaluated(original, { x: 148, y: 94, width: 80, height: 40 }, { x: 0, y: 0, width: 300, height: 200 }).sizeDelta,
    [80, 40],
  );
  const before = rectTransformFromEvaluated(original, { x: 148, y: 94, width: 80, height: 40 }, { x: 0, y: 0, width: 300, height: 200 });
  const after = rectTransformFromEvaluated(pivotOnly, { x: 148, y: 94, width: 80, height: 40 }, { x: 0, y: 0, width: 300, height: 200 });
  assert.deepEqual([before.anchoredPosition, before.sizeDelta], [original.anchoredPosition, original.sizeDelta]);
  assert.deepEqual(after.sizeDelta, pivotOnly.sizeDelta);

  const positionOnly = applyAnchorPreset(original, topStretch, { setPivot: false, setPosition: true }, parentSize);
  assert.deepEqual(positionOnly.pivot, original.pivot);
  assert.deepEqual(positionOnly.anchoredPosition, [0, -28]);
  assert.deepEqual(positionOnly.sizeDelta, [0, 40]);

  const right = anchorPresets.find((preset) => preset.value === "middleRight")!;
  const fromStretch = rect({
    anchorMin: [0, 0.5],
    anchorMax: [1, 0.5],
    pivot: [0.25, 0.5],
    anchoredPosition: [0, 0],
    sizeDelta: [-20, 40],
  });
  const alignedRight = applyAnchorPreset(fromStretch, right, { setPivot: false, setPosition: true }, parentSize);
  assert.deepEqual(alignedRight.sizeDelta, [280, 40]);
  assert.deepEqual(alignedRight.anchoredPosition, [-210, 0]);
});

test("previews Unity anchor modifier results", () => {
  const topLeft = anchorPresets.find((preset) => preset.value === "topLeft")!;
  const anchorsOnly = anchorPresetPreview(topLeft, { setPivot: false, setPosition: false });
  const pivotOnly = anchorPresetPreview(topLeft, { setPivot: true, setPosition: false });
  const positionOnly = anchorPresetPreview(topLeft, { setPivot: false, setPosition: true });
  const pivotAndPosition = anchorPresetPreview(topLeft, { setPivot: true, setPosition: true });

  assert.deepEqual(anchorsOnly.rect, { left: 29, top: 29, width: 42, height: 42 });
  assert.deepEqual(anchorsOnly.pivot, [29, 29]);
  assert.deepEqual(pivotOnly.rect, anchorsOnly.rect);
  assert.deepEqual(pivotOnly.pivot, [29, 29]);
  assert.deepEqual(positionOnly.rect, { left: 10, top: 10, width: 42, height: 42 });
  assert.deepEqual(positionOnly.pivot, [10, 10]);
  assert.deepEqual(pivotAndPosition.rect, positionOnly.rect);
  assert.deepEqual(pivotAndPosition.pivot, positionOnly.pivot);
});

test("requires matching stretch topology for batch display fields", () => {
  assert.equal(sameRectTransformTopology([rect(), rect({ anchoredPosition: [2, 3] })]), true);
  assert.equal(sameRectTransformTopology([rect(), rect({ anchorMin: [0, 0], anchorMax: [1, 1] })]), false);
});
