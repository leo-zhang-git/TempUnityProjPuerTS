import assert from "node:assert/strict";
import test from "node:test";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import {
  canMove,
  canResize,
  commonMoveCapabilities,
  commonResizeCapabilities,
  moveRect,
  pointerDeltaToRectLocal,
  rectTransformCapabilityMap,
  resizeRect,
  resizeSelection,
} from "../../src/web/editors/artifact/canvas/rect-transform-authoring.js";

function rect(x = 0, y = 0, width = 100, height = 40): UiNode["rect"] {
  return { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0.5, 0.5], anchoredPosition: [x, y], sizeDelta: [width, height] };
}

function source(root: UiNode, artifactType: UiConcreteSource["artifactType"] = "Widget"): UiConcreteSource {
  return artifactType === "Canvas"
    ? {
        sourceKind: "artifact",
        artifactKey: "PanelWidget",
        artifactType: "Canvas",
        root,
      }
    : {
        sourceKind: "artifact",
        artifactKey: "PanelWidget",
        artifactType,
        initialSize: [320, 180],
        root,
      };
}

test("classifies Unity layout and self-driven RectTransform axes", () => {
  const document = source({
    id: "PanelWidget",
    rect: rect(0, 0, 320, 180),
    components: { HorizontalLayoutGroup: { childControlWidth: false } },
    children: [
      { id: "freeSize", rect: rect() },
      { id: "ignored", rect: rect(), components: { LayoutElement: { ignoreLayout: true } } },
      { id: "fitted", rect: rect(), components: { ContentSizeFitter: { verticalFit: "preferredSize" } } },
    ],
  });
  const capabilities = rectTransformCapabilityMap(document);
  assert.deepEqual(capabilities.get("PanelWidget"), {
    position: ["Artifact 本地尺寸", "Artifact 本地尺寸"],
    size: [undefined, undefined],
  });
  assert.deepEqual(capabilities.get("freeSize"), {
    position: ["PanelWidget · HorizontalLayoutGroup", "PanelWidget · HorizontalLayoutGroup"],
    size: [undefined, "PanelWidget · HorizontalLayoutGroup"],
  });
  assert.deepEqual(capabilities.get("ignored"), { position: [undefined, undefined], size: [undefined, undefined] });
  assert.deepEqual(capabilities.get("fitted")?.size, [undefined, "Fitted (fitted) · ContentSizeFitter"]);
});

test("classifies AutoLayoutGroup linear and grid driven axes", () => {
  const linear = source({
    id: "PanelWidget",
    rect: rect(0, 0, 320, 180),
    components: { AutoLayoutGroup: { mode: "horizontal" } },
    children: [{ id: "child", rect: rect() }],
  });
  assert.deepEqual(rectTransformCapabilityMap(linear).get("child"), {
    position: ["PanelWidget · AutoLayoutGroup", "PanelWidget · AutoLayoutGroup"],
    size: [undefined, undefined],
  });
  linear.root.components!.AutoLayoutGroup = { mode: "grid" };
  assert.deepEqual(rectTransformCapabilityMap(linear).get("child"), {
    position: ["PanelWidget · AutoLayoutGroup", "PanelWidget · AutoLayoutGroup"],
    size: ["PanelWidget · AutoLayoutGroup", "PanelWidget · AutoLayoutGroup"],
  });
});

test("moves only free axes and resizes around the opposite edge", () => {
  const node: UiNode = { id: "label", rect: rect(10, -20, 100, 40) };
  const free = { position: [undefined, undefined], size: [undefined, undefined] } as const;
  assert.deepEqual(moveRect(node, [8, 5], free).rect.anchoredPosition, [18, -25]);
  const resized = resizeRect(node, "topLeft", [10, 4], [100, 40], free);
  assert.deepEqual(resized.rect.sizeDelta, [90, 36]);
  assert.deepEqual(resized.rect.anchoredPosition, [15, -22]);

  const drivenX = { position: ["layout", undefined], size: ["layout", undefined] } as const;
  const partial = resizeRect(node, "bottomRight", [20, 10], [100, 40], drivenX);
  assert.deepEqual(partial.rect.sizeDelta, [100, 50]);
  assert.deepEqual(partial.rect.anchoredPosition, [10, -25]);
});

test("multi-selection movement uses only axes free for every participant", () => {
  const free = { position: [undefined, undefined], size: [undefined, undefined] } as const;
  const drivenX = { position: ["horizontal layout", undefined], size: [undefined, undefined] } as const;
  const drivenY = { position: [undefined, "vertical layout"], size: [undefined, undefined] } as const;

  const sharedY = commonMoveCapabilities([free, drivenX]);
  assert.deepEqual(sharedY.position, ["horizontal layout", undefined]);
  assert.deepEqual(moveRect({ id: "free", rect: rect() }, [20, 10], sharedY).rect.anchoredPosition, [0, -10]);

  const blocked = commonMoveCapabilities([drivenX, drivenY]);
  assert.deepEqual(blocked.position, ["horizontal layout", "vertical layout"]);
  assert.equal(canMove(blocked), false);
});

test("multi-selection resize scales positions and sizes around the group bounds", () => {
  const free = { position: [undefined, undefined], size: [undefined, undefined] } as const;
  const first: UiNode = { id: "first", rect: rect(0, 0, 100, 100) };
  const second: UiNode = { id: "second", rect: rect(200, 0, 100, 100) };
  const entries = [
    { node: first, rect: { x: 0, y: 0, width: 100, height: 100 }, capabilities: free },
    { node: second, rect: { x: 200, y: 0, width: 100, height: 100 }, capabilities: free },
  ];
  const capabilities = commonResizeCapabilities(entries.map((entry) => entry.capabilities));

  const resized = resizeSelection(entries, { x: 0, y: 0, width: 300, height: 100 }, "right", [300, 0], capabilities);
  assert.deepEqual(
    resized.map((node) => [node.rect.anchoredPosition, node.rect.sizeDelta]),
    [
      [
        [50, 0],
        [200, 100],
      ],
      [
        [450, 0],
        [200, 100],
      ],
    ],
  );

  const proportional = resizeSelection(entries, { x: 0, y: 0, width: 300, height: 100 }, "right", [300, 0], capabilities, 1, {
    preserveAspectRatio: true,
  });
  assert.deepEqual(
    proportional.map((node) => [node.rect.anchoredPosition, node.rect.sizeDelta]),
    [
      [
        [50, 0],
        [200, 200],
      ],
      [
        [450, 0],
        [200, 200],
      ],
    ],
  );

  const centered = resizeSelection(entries, { x: 0, y: 0, width: 300, height: 100 }, "right", [150, 0], capabilities, 1, {
    centered: true,
  });
  assert.deepEqual(
    centered.map((node) => [node.rect.anchoredPosition, node.rect.sizeDelta]),
    [
      [
        [-100, 0],
        [200, 100],
      ],
      [
        [300, 0],
        [200, 100],
      ],
    ],
  );
});

test("multi-selection resize blocks axes driven in either position or size", () => {
  const free = { position: [undefined, undefined], size: [undefined, undefined] } as const;
  const drivenX = { position: ["layout", undefined], size: [undefined, undefined] } as const;
  const capabilities = commonResizeCapabilities([free, drivenX]);
  assert.deepEqual(capabilities, { position: ["layout", undefined], size: ["layout", undefined] });
  assert.equal(canResize(capabilities, "right"), false);
  assert.equal(canResize(capabilities, "bottom"), true);
});

test("converts pointer deltas through RectTransform rotation and scale", () => {
  const local = pointerDeltaToRectLocal([0, 20], 90, [2, 1]);
  assert.ok(Math.abs(local[0] + 10) < 0.000001);
  assert.ok(Math.abs(local[1]) < 0.000001);
});

test("resizes proportionally from the opposite edge with Shift", () => {
  const node: UiNode = { id: "panel", rect: rect(10, -20, 100, 50) };
  const free = { position: [undefined, undefined], size: [undefined, undefined] } as const;
  const corner = resizeRect(node, "bottomRight", [20, 4], [100, 50], free, 1, { preserveAspectRatio: true });
  assert.deepEqual(corner.rect.sizeDelta, [120, 60]);
  assert.deepEqual(corner.rect.anchoredPosition, [20, -25]);

  const edge = resizeRect(node, "right", [20, 0], [100, 50], free, 1, { preserveAspectRatio: true });
  assert.deepEqual(edge.rect.sizeDelta, [120, 60]);
  assert.deepEqual(edge.rect.anchoredPosition, [20, -20]);
});

test("resizes around the visual center with Alt and combines with Shift", () => {
  const node: UiNode = {
    id: "panel",
    rect: { ...rect(10, -20, 100, 50), pivot: [0.25, 0.75] },
  };
  const free = { position: [undefined, undefined], size: [undefined, undefined] } as const;
  const centered = resizeRect(node, "right", [10, 0], [100, 50], free, 1, { centered: true });
  assert.deepEqual(centered.rect.sizeDelta, [120, 50]);
  assert.deepEqual(centered.rect.anchoredPosition, [5, -20]);

  const proportional = resizeRect(node, "bottomRight", [10, 2], [100, 50], free, 1, { centered: true, preserveAspectRatio: true });
  assert.deepEqual(proportional.rect.sizeDelta, [120, 60]);
  assert.deepEqual(proportional.rect.anchoredPosition, [5, -17.5]);
});

test("marks Canvas root position and size as viewport-driven", () => {
  const document = source({ id: "PanelWidget", rect: rect(0, 0, 0, 0) }, "Canvas");
  assert.deepEqual(rectTransformCapabilityMap(document).get("PanelWidget"), {
    position: ["Canvas 预览尺寸", "Canvas 预览尺寸"],
    size: ["Canvas 预览尺寸", "Canvas 预览尺寸"],
  });
});
