import assert from "node:assert/strict";
import test from "node:test";
import { measureUnityImage, setUnityImageNativeSize } from "../../src/kernel/image-intrinsic.js";
import type { UiNode } from "../../src/schema/ui-source-schema.js";
import { parseUnitySpriteAsset, unitySpriteImportMode } from "../../src/server/sprite-asset.js";

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function imageNode(imageType: "simple" | "sliced" = "simple"): UiNode {
  return {
    id: "image",
    rect: {
      anchorMin: [0, 1],
      anchorMax: [0, 1],
      pivot: [0, 1],
      anchoredPosition: [0, 0],
      sizeDelta: [1, 1],
    },
    components: { Image: { imageType } },
  };
}

test("parses PNG size and Unity sprite importer metrics", () => {
  const metrics = parseUnitySpriteAsset(png(128, 64), "spritePixelsToUnits: 200\nspriteBorder: {x: 4, y: 5, z: 6, w: 7}\n");
  assert.deepEqual(metrics, { width: 128, height: 64, pixelsPerUnit: 200, border: [4, 5, 6, 7] });
});

test("matches UGUI simple and sliced preferred sizes", () => {
  const metrics = { width: 128, height: 64, pixelsPerUnit: 200, border: [4, 5, 6, 7] as const };
  assert.deepEqual(measureUnityImage(metrics, imageNode()), {
    minWidth: 0,
    minHeight: 0,
    preferredWidth: 64,
    preferredHeight: 32,
  });
  assert.deepEqual(measureUnityImage(metrics, imageNode("sliced")), {
    minWidth: 0,
    minHeight: 0,
    preferredWidth: 5,
    preferredHeight: 6,
  });
});

test("matches UGUI Image Set Native Size anchor and size semantics", () => {
  const node = imageNode("sliced");
  node.rect.anchorMax = [1, 0];
  const result = setUnityImageNativeSize(node, { width: 128, height: 64, pixelsPerUnit: 200, border: [4, 5, 6, 7] });
  assert.deepEqual(result.rect.anchorMax, [0, 1]);
  assert.deepEqual(result.rect.sizeDelta, [64, 32]);
  assert.deepEqual(result.rect.anchoredPosition, [0, 0]);
});

test("classifies Unity sprite importer modes", () => {
  assert.equal(unitySpriteImportMode("textureType: 8\nspriteMode: 1\n"), "single");
  assert.equal(unitySpriteImportMode("textureType: 8\nspriteMode: 2\n"), "multiple");
  assert.equal(unitySpriteImportMode("textureType: 0\nspriteMode: 1\n"), "notSprite");
});
