import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_UI_FONT_ASSET } from "../../src/registry/component-registry.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { intrinsicAssetPaths } from "../../src/web/rendering/intrinsic/intrinsic.js";

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "IntrinsicCanvas",
    artifactType: "Canvas",
    root: {
      id: "IntrinsicCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        {
          id: "label",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [200, 40] },
          components: { Text: { text: "Label", font: "Font/Main.asset", fontSize: 20 } },
        },
        {
          id: "defaultLabel",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, -20], sizeDelta: [200, 40] },
          components: { Text: { text: "Default" } },
        },
        {
          id: "image",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, -40], sizeDelta: [100, 100] },
          components: { Image: { sprite: "Images/Main.png" } },
        },
      ],
    },
  };
}

test("collects stable unique intrinsic resource paths", () => {
  assert.deepEqual(intrinsicAssetPaths(source()), {
    fonts: ["Font/Main.asset", DEFAULT_UI_FONT_ASSET].sort(),
    images: ["Images/Main.png"],
  });
  const empty = structuredClone(source());
  empty.root.children = [];
  assert.deepEqual(intrinsicAssetPaths(empty), { fonts: [], images: [] });
});
