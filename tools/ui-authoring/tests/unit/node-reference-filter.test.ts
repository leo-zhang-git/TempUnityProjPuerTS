import assert from "node:assert/strict";
import test from "node:test";
import type { UiNode } from "../../src/schema/ui-source-schema.js";
import { matchesNodeReferenceFilter } from "../../src/web/editors/artifact/inspector/node-reference-filter.js";

const node = {
  id: "scroll",
  rect: { anchorMin: [0, 0], anchorMax: [0, 0], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [100, 100] },
  components: { ScrollRectEx: { content: "content", viewport: "viewport", templates: {} } },
} as UiNode;

test("component reference filters accept one or more component types", () => {
  assert.equal(matchesNodeReferenceFilter(node, { componentTypes: ["ScrollRect"] }), false);
  assert.equal(matchesNodeReferenceFilter(node, { componentTypes: ["ScrollRect", "ScrollRectEx"] }), true);
  assert.equal(matchesNodeReferenceFilter(node, "any"), true);
});

test("graphic reference filters include TMP Text nodes", () => {
  const textNode = {
    ...node,
    id: "label",
    components: { Text: { text: "Label", fontSize: 18, alignment: "center", color: "#FFFFFFFF" } },
  } as UiNode;

  assert.equal(matchesNodeReferenceFilter(textNode, "graphic"), true);
});
