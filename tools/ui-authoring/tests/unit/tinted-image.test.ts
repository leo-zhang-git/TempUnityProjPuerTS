import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { UiNode } from "../../src/schema/ui-source-schema.js";
import { nodeVisualStyle } from "../../src/web/rendering/artifact-renderer/artifact-rendering.js";
import { imageTintMultipliers, TintedImage } from "../../src/web/rendering/artifact-renderer/tinted-image.js";

const rect: UiNode["rect"] = { anchorMin: [0, 0], anchorMax: [0, 0], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [32, 32] };

test("converts Image color channels to sprite multipliers", () => {
  assert.deepEqual(imageTintMultipliers("#80402080"), [128 / 255, 64 / 255, 32 / 255, 128 / 255]);
  assert.deepEqual(imageTintMultipliers(undefined), [1, 1, 1, 1]);
});

test("renders per-channel RGBA multiplication only for tinted sprites", () => {
  const tinted = renderToStaticMarkup(createElement(TintedImage, { src: "/sprite.png", color: "#80402080" }));
  assert.match(tinted, /<feFuncR[^>]*slope="0\.5019607843137255"/);
  assert.match(tinted, /<feFuncG[^>]*slope="0\.25098039215686274"/);
  assert.match(tinted, /<feFuncB[^>]*slope="0\.12549019607843137"/);
  assert.match(tinted, /<feFuncA[^>]*slope="0\.5019607843137255"/);
  assert.match(tinted, /filter:url\(#image-tint-/);

  const untinted = renderToStaticMarkup(createElement(TintedImage, { src: "/sprite.png", color: "#FFFFFFFF" }));
  assert.doesNotMatch(untinted, /feComponentTransfer|filter:/);
  assert.match(untinted, /<img src="\/sprite\.png"/);
});

test("uses Image color as a fill only when no sprite is assigned", () => {
  const spriteNode: UiNode = { id: "sprite", rect, components: { Image: { sprite: "Icons/Test.png", color: "#80402080" } } };
  const fillNode: UiNode = { id: "fill", rect, components: { Image: { color: "#80402080" } } };
  const defaultFillNode: UiNode = { id: "defaultFill", rect, components: { Image: {} } };
  assert.equal(nodeVisualStyle(spriteNode).backgroundColor, "transparent");
  assert.equal(nodeVisualStyle(fillNode).backgroundColor, "#80402080");
  assert.equal(nodeVisualStyle(defaultFillNode).backgroundColor, "#FFFFFFFF");
});
