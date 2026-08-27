import assert from "node:assert/strict";
import test from "node:test";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { scrollRectAdvisories } from "../../src/web/editors/artifact/inspector/scroll-rect-advisories.js";

const rect = (): UiNode["rect"] => ({
  anchorMin: [0, 0],
  anchorMax: [0, 0],
  pivot: [0.5, 0.5],
  anchoredPosition: [0, 0],
  sizeDelta: [100, 100],
});
const child = (id: string): UiNode => ({ id, rect: rect() });

test("reports non-blocking direct-child guidance for expanded scrollbars", () => {
  const viewport = child("viewport");
  const scrollbar = child("scrollbar");
  const nestedOwner: UiNode = { id: "nested", rect: rect(), children: [viewport, scrollbar] };
  const scroll: UiNode = {
    id: "scroll",
    rect: rect(),
    components: {
      ScrollRect: {
        content: "viewport",
        viewport: "viewport",
        horizontalScrollbar: "scrollbar",
        horizontalScrollbarVisibility: "autoHideAndExpandViewport",
      },
    },
    children: [nestedOwner],
  };
  const source: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "Scroll",
    artifactType: "Widget",
    widgetType: "Scroll",
    initialSize: [100, 100],
    root: scroll,
  };
  assert.equal(scrollRectAdvisories(source, "scroll").length, 2);
  scroll.children = [viewport, scrollbar];
  assert.deepEqual(scrollRectAdvisories(source, "scroll"), []);
});
