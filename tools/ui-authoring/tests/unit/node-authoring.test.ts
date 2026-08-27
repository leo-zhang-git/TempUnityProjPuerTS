import assert from "node:assert/strict";
import test from "node:test";
import { findNode } from "../../src/kernel/tree.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import {
  canvasNodePlacement,
  createImageNode,
  imageDropParent,
  imageNodeBaseId,
  replaceImageSprite,
  topmostNodeIdAt,
  uniqueNodeId,
} from "../../src/web/editors/artifact/canvas/node-authoring.js";

function node(id: string, components?: UiNode["components"], children?: UiNode[]): UiNode {
  return {
    id,
    rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [100, 100] },
    ...(components ? { components } : {}),
    ...(children ? { children } : {}),
  };
}

function source(root: UiNode): UiConcreteSource {
  return { sourceKind: "artifact", artifactKey: "MainCanvas", artifactType: "Canvas", root };
}

test("derives stable unique lowerCamelCase ids from image filenames", () => {
  const document = source(node("MainCanvas", undefined, [node("readyIcon"), node("readyIcon2")]));
  assert.equal(imageNodeBaseId("Icons/Ready_Icon.png"), "ready_Icon");
  assert.equal(imageNodeBaseId("Icons/123.png"), "_123");
  assert.equal(uniqueNodeId(document, "readyIcon"), "readyIcon_1");
});

test("uses the selected local parent including PrefabRef use sites", () => {
  const panel = node("panel", undefined, [node("widget", { PrefabRef: { artifactKey: "ChildWidget" } })]);
  const document = source(node("MainCanvas", undefined, [panel]));
  assert.equal(imageDropParent(document, "panel").id, "panel");
  assert.equal(imageDropParent(document, "widget").id, "widget");
  assert.equal(imageDropParent(document, "missing").id, "MainCanvas");
});

test("chooses the last rendered node under a canvas point", () => {
  const entries = [
    { node: { id: "panel" }, rect: { x: 0, y: 0, width: 300, height: 200 } },
    { node: { id: "icon" }, rect: { x: 80, y: 60, width: 40, height: 40 } },
  ];
  assert.equal(topmostNodeIdAt(entries, [90, 70]), "icon");
  assert.equal(topmostNodeIdAt(entries, [20, 20]), "panel");
  assert.equal(topmostNodeIdAt(entries, [400, 300]), undefined);
});

test("converts Canvas click and drag gestures into parent-local RectTransform values", () => {
  const parent = { x: 100, y: 80, width: 400, height: 240 };
  assert.deepEqual(canvasNodePlacement([260, 160], [260, 160], parent, [200, 40], false), {
    anchoredPosition: [-40, 40],
    size: [200, 40],
  });
  assert.deepEqual(canvasNodePlacement([180, 140], [300, 210], parent, [100, 100], true), {
    anchoredPosition: [-60, 25],
    size: [120, 70],
  });
  assert.deepEqual(canvasNodePlacement([300, 210], [180, 140], parent, [100, 100], true).size, [120, 70]);
});

test("creates an intrinsic-sized image at the free-layout drop point", () => {
  const document = source(node("MainCanvas"));
  const result = createImageNode(document, {
    assetPath: "Icons/Ready.png",
    parentId: "MainCanvas",
    parentRect: { x: 0, y: 0, width: 1280, height: 720 },
    dropPoint: [740, 410],
    metrics: { width: 200, height: 100, pixelsPerUnit: 100, border: [0, 0, 0, 0] },
  });
  const created = findNode(result.source, "ready");
  assert.deepEqual(created?.rect.anchoredPosition, [100, -50]);
  assert.deepEqual(created?.rect.sizeDelta, [200, 100]);
  assert.equal(created?.components?.Image?.sprite, "Icons/Ready.png");
});

test("appends under layout groups and replaces existing Image sprites", () => {
  const layout = node("layout", { HorizontalLayoutGroup: {} }, [node("icon", { Image: { sprite: "Old.png" } })]);
  const document = source(node("MainCanvas", undefined, [layout]));
  const replaced = replaceImageSprite(document, "icon", "New.png");
  assert.equal(findNode(replaced, "icon")?.components?.Image?.sprite, "New.png");
  const result = createImageNode(replaced, {
    assetPath: "Added.png",
    parentId: "layout",
    parentRect: { x: 10, y: 20, width: 300, height: 100 },
    dropPoint: [200, 80],
    metrics: { width: 64, height: 32, pixelsPerUnit: 100, border: [0, 0, 0, 0] },
  });
  assert.deepEqual(findNode(result.source, "added")?.rect.anchoredPosition, [0, 0]);

  const auto = node("auto", { AutoLayoutGroup: { mode: "grid" } });
  const autoResult = createImageNode(source(node("MainCanvas", undefined, [auto])), {
    assetPath: "Auto.png",
    parentId: "auto",
    parentRect: { x: 0, y: 0, width: 300, height: 100 },
    dropPoint: [200, 80],
    metrics: { width: 64, height: 32, pixelsPerUnit: 100, border: [0, 0, 0, 0] },
  });
  assert.deepEqual(findNode(autoResult.source, "auto_1")?.rect.anchoredPosition, [0, 0]);
});
