import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { UiNode } from "../../src/schema/ui-source-schema.js";
import { NodeVisual, nodePreviewRenderers } from "../../src/web/rendering/artifact-renderer/artifact-rendering.js";

function nodeWith(components: NonNullable<UiNode["components"]>): UiNode {
  return {
    id: "previewNode",
    rect: { anchorMin: [0, 0], anchorMax: [0, 0], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [100, 40] },
    components,
  };
}

test("Web preview dispatch follows Component Registry renderer identities", () => {
  assert.deepEqual([...nodePreviewRenderers(nodeWith({ Image: { color: "#FFFFFFFF", imageType: "simple" } }))], ["image"]);
  assert.deepEqual([...nodePreviewRenderers(nodeWith({ Text: { text: "Preview", fontSize: 14, color: "#FFFFFFFF" } }))], ["text"]);
  assert.deepEqual([...nodePreviewRenderers(nodeWith({ RoundedRect: { color: "#FFFFFFFF" } }))], ["roundedRect"]);
  assert.deepEqual([...nodePreviewRenderers(nodeWith({ PrefabRef: { artifactKey: "NestedWidget" } }))], ["prefabRef"]);
  assert.deepEqual(
    [...nodePreviewRenderers(nodeWith({ Slider: { fillRect: "fill", handleRect: "handle", targetGraphic: "graphic" } }))],
    [],
  );
  assert.deepEqual(
    [
      ...nodePreviewRenderers(
        nodeWith({ TMPDropdown: { targetGraphic: "graphic", captionText: "caption", template: "template", itemText: "item" } }),
      ),
    ],
    [],
  );
  assert.deepEqual([...nodePreviewRenderers(nodeWith({ ScrollRect: { content: "content", viewport: "viewport" } }))], []);
  assert.deepEqual([...nodePreviewRenderers(nodeWith({ StateToggle: { stateRoots: ["state"], selectedIndices: [0] } }))], []);
});

test("Web preview renders omitted Image and RoundedRect colors with Registry defaults", () => {
  assert.match(renderToStaticMarkup(createElement(NodeVisual, { node: nodeWith({ Image: {} }) })), /background-color:#FFFFFFFF/);
  assert.match(renderToStaticMarkup(createElement(NodeVisual, { node: nodeWith({ RoundedRect: {} }) })), /background-color:#FFFFFFFF/);
});
