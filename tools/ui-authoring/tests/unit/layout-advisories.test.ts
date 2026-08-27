import assert from "node:assert/strict";
import test from "node:test";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { layoutAdvisories } from "../../src/web/editors/artifact/inspector/layout-advisories.js";

function rect(width: number, height: number): UiNode["rect"] {
  return { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [width, height] };
}

function source(child: UiNode, forceWidth: boolean): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "Warnings",
    artifactType: "Widget",
    widgetType: "Warnings",
    initialSize: [400, 100],
    root: {
      id: "Warnings",
      rect: rect(400, 100),
      components: { VerticalLayoutGroup: { childForceExpandWidth: forceWidth, childForceExpandHeight: false } },
      children: [child],
    },
  };
}

test("explains Force Expand without treating an intentional zero axis as a conflict", () => {
  const value = source(
    {
      id: "divider",
      rect: rect(378, 0),
      components: { LayoutElement: { preferredWidth: 378, preferredHeight: 0 } },
    },
    true,
  );
  assert.deepEqual(layoutAdvisories(value, "divider", { x: 0, y: 0, width: 400, height: 0 }), [
    "Width: Warnings Force Expand drives the final size to 400; Preferred 378 remains the layout preference.",
  ]);
});

test("warns when a controlled non-zero baseline resolves to zero", () => {
  const value = source({ id: "content", rect: rect(378, 40), components: { VerticalLayoutGroup: {} } }, false);
  assert.deepEqual(layoutAdvisories(value, "content", { x: 0, y: 0, width: 0, height: 0 }), [
    "Width: the controlled size resolves to 0. Provide a non-zero layout size or enable Force Expand on Warnings.",
    "Height: the controlled size resolves to 0. Provide a non-zero layout size or enable Force Expand on Warnings.",
  ]);
});

test("uses AutoLayoutGroup linear defaults for advisory control semantics", () => {
  const value = source({ id: "content", rect: rect(100, 40), components: { LayoutElement: { preferredWidth: 120 } } }, false);
  value.root.components = { AutoLayoutGroup: { mode: "horizontal" } };
  assert.deepEqual(layoutAdvisories(value, "content", { x: 0, y: 0, width: 100, height: 40 }), [
    "Width: Preferred 120 does not set the RectTransform size because Warnings does not control this axis.",
  ]);
});
