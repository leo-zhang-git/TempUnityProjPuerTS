import assert from "node:assert/strict";
import test from "node:test";
import type { EvaluatedNode, EvaluatedRect } from "../../src/kernel/layout.js";
import type { UiNode } from "../../src/schema/ui-source-schema.js";
import { visibleEvaluatedNodes } from "../../src/web/rendering/artifact-renderer/rect-mask-rendering.js";

function sourceRect(): UiNode["rect"] {
  return { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [1, 1] };
}

function evaluatedRect(x: number, y: number, width: number, height: number): EvaluatedRect {
  return { x, y, width, height, rotation: 0, scaleX: 1, scaleY: 1 };
}

function evaluated(node: UiNode, rect: EvaluatedRect, children: readonly EvaluatedNode[] = []): EvaluatedNode {
  return { node, rect, children };
}

test("clips descendants by RectMask2D padding while leaving the mask node itself unclipped", () => {
  const child = evaluated({ id: "child", rect: sourceRect(), components: { Image: {} } }, evaluatedRect(0, 0, 200, 200));
  const mask = evaluated(
    { id: "mask", rect: sourceRect(), components: { RectMask2D: { padding: [5, 7, 10, 15] } } },
    evaluatedRect(20, 30, 100, 80),
    [child],
  );
  const root = evaluated({ id: "root", rect: sourceRect() }, evaluatedRect(0, 0, 200, 200), [mask]);
  const nodes = visibleEvaluatedNodes(root);
  assert.deepEqual(nodes.find((entry) => entry.node.id === "mask")!.maskStyle, {});
  assert.equal(nodes.find((entry) => entry.node.id === "child")!.maskStyle.clipPath, "inset(45px 90px 97px 25px)");
});

test("composes RectMask2D softness into the descendant mask", () => {
  const child = evaluated({ id: "child", rect: sourceRect(), components: { Image: {} } }, evaluatedRect(0, 0, 200, 200));
  const mask = evaluated(
    { id: "mask", rect: sourceRect(), components: { RectMask2D: { softness: [8, 6] } } },
    evaluatedRect(20, 30, 100, 80),
    [child],
  );
  const root = evaluated({ id: "root", rect: sourceRect() }, evaluatedRect(0, 0, 200, 200), [mask]);
  const style = nodesStyle(root, "child");
  assert.match(String(style.maskImage), /linear-gradient\(to right/);
  assert.equal(style.maskComposite, "intersect");
});

test("inherits CanvasGroup alpha through descendants", () => {
  const child = evaluated({ id: "child", rect: sourceRect(), components: { CanvasGroup: { alpha: 0.5 } } }, evaluatedRect(0, 0, 20, 20));
  const parent = evaluated(
    { id: "parent", rect: sourceRect(), components: { CanvasGroup: { alpha: 0.25 } } },
    evaluatedRect(0, 0, 20, 20),
    [child],
  );
  const root = evaluated({ id: "root", rect: sourceRect() }, evaluatedRect(0, 0, 20, 20), [parent]);
  const nodes = visibleEvaluatedNodes(root);
  assert.equal(nodes.find((entry) => entry.node.id === "parent")!.opacity, 0.25);
  assert.equal(nodes.find((entry) => entry.node.id === "child")!.opacity, 0.125);
});

test("CanvasGroup ignoreParentGroups resets inherited alpha", () => {
  const child = evaluated(
    { id: "child", rect: sourceRect(), components: { CanvasGroup: { alpha: 0.5, ignoreParentGroups: true } } },
    evaluatedRect(0, 0, 20, 20),
  );
  const parent = evaluated(
    { id: "parent", rect: sourceRect(), components: { CanvasGroup: { alpha: 0.25 } } },
    evaluatedRect(0, 0, 20, 20),
    [child],
  );
  const root = evaluated({ id: "root", rect: sourceRect() }, evaluatedRect(0, 0, 20, 20), [parent]);
  assert.equal(visibleEvaluatedNodes(root).find((entry) => entry.node.id === "child")!.opacity, 0.5);
});

test("clamps CanvasGroup alpha to Unity's valid range", () => {
  const over = evaluated({ id: "over", rect: sourceRect(), components: { CanvasGroup: { alpha: 2 } } }, evaluatedRect(0, 0, 1, 1));
  const under = evaluated({ id: "under", rect: sourceRect(), components: { CanvasGroup: { alpha: -1 } } }, evaluatedRect(0, 0, 1, 1));
  const root = evaluated({ id: "root", rect: sourceRect() }, evaluatedRect(0, 0, 1, 1), [over, under]);
  const nodes = visibleEvaluatedNodes(root);
  assert.equal(nodes.find((entry) => entry.node.id === "over")!.opacity, 1);
  assert.equal(nodes.find((entry) => entry.node.id === "under")!.opacity, 0);
});

function nodesStyle(root: EvaluatedNode, nodeId: string) {
  return visibleEvaluatedNodes(root).find((entry) => entry.node.id === nodeId)!.maskStyle;
}
