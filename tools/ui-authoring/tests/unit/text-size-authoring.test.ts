import assert from "node:assert/strict";
import test from "node:test";
import type { LayoutIntrinsicProvider } from "../../src/kernel/layout.js";
import type { UiNode } from "../../src/schema/ui-source-schema.js";
import { ensureTextMinimumHeight, TEXT_HEIGHT_SAFETY_PX } from "../../src/web/editors/artifact/inspector/text-size-authoring.js";

const intrinsic: LayoutIntrinsicProvider = {
  measureText: () => ({ minWidth: 0, minHeight: 0, preferredWidth: 80, preferredHeight: 24.25 }),
};

function textNode(height: number, stretch = false): UiNode {
  return {
    id: "label",
    rect: {
      anchorMin: [0.5, stretch ? 0 : 0.5],
      anchorMax: [0.5, stretch ? 1 : 0.5],
      pivot: [0.5, 0.5],
      anchoredPosition: [0, 0],
      sizeDelta: [100, height],
    },
    components: { Text: { text: "Ready", fontSize: 20 } },
  };
}

test("fixed TMP nodes grow to preferred height plus exactly one pixel without shrinking", () => {
  const grown = ensureTextMinimumHeight(textNode(20), 100, intrinsic);
  assert.equal(grown.rect.sizeDelta[1], 24.25 + TEXT_HEIGHT_SAFETY_PX);
  const retained = ensureTextMinimumHeight(textNode(40), 100, intrinsic);
  assert.equal(retained.rect.sizeDelta[1], 40);
});

test("stretch and layout-driven TMP nodes preserve their authored height", () => {
  assert.equal(ensureTextMinimumHeight(textNode(20, true), 100, intrinsic).rect.sizeDelta[1], 20);
  assert.equal(
    ensureTextMinimumHeight(textNode(20), 100, intrinsic, { position: [undefined, undefined], size: [undefined, "layout"] }).rect
      .sizeDelta[1],
    20,
  );
});
