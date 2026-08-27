import assert from "node:assert/strict";
import test from "node:test";
import type { UiNode } from "../../src/schema/ui-source-schema.js";
import { copyComponentProperties, pasteComponentProperties } from "../../src/web/editors/artifact/inspector/component-clipboard.js";

function node(id: string, text: string): UiNode {
  return {
    id,
    rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [100, 20] },
    components: {
      Text: {
        text,
        fontSize: 18,
        color: "#FFFFFFFF",
      },
    },
  };
}

test("copies component properties", () => {
  const clipboard = copyComponentProperties(node("source", "Source"), "Text");
  assert.equal(clipboard.componentType, "Text");
  assert.deepEqual(clipboard.properties, { text: "Source", fontSize: 18, color: "#FFFFFFFF" });
});

test("replaces same-type properties", () => {
  const clipboard = copyComponentProperties(node("source", "Source"), "Text");
  const pasted = pasteComponentProperties(node("target", "Target"), "Text", clipboard);
  assert.deepEqual(pasted.components?.Text, {
    text: "Source",
    fontSize: 18,
    color: "#FFFFFFFF",
  });
  assert.throws(() => pasteComponentProperties(node("target", "Target"), "Image", clipboard), /不能将 'Text' 属性粘贴到 'Image'/);
});
