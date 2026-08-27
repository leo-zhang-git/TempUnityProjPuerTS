import assert from "node:assert/strict";
import test from "node:test";
import { evaluateLayout, evaluateLocalLayout } from "../../src/kernel/layout.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import {
  CANVAS_VIEWPORT_PRESETS,
  clampEditorZoom,
  DEFAULT_CANVAS_VIEWPORT_INDEX,
  editorSafeArea,
  editorViewport,
  editorZoomPolicy,
} from "../../src/web/editors/artifact/canvas/artifact-viewport.js";

function source(artifactType: "Canvas" | "Widget" | "Fragment", initialSize: readonly [number, number]): UiConcreteSource {
  const artifactKey = `${artifactType}Fixture`;
  const root = {
    id: artifactKey,
    rect: {
      anchorMin: [0, 1] as [number, number],
      anchorMax: [0, 1] as [number, number],
      pivot: [0, 1] as [number, number],
      anchoredPosition: [0, 0] as [number, number],
      sizeDelta: [...initialSize] as [number, number],
    },
    children: [
      {
        id: "localItem",
        rect: {
          anchorMin: [0, 1] as [number, number],
          anchorMax: [0, 1] as [number, number],
          pivot: [0, 1] as [number, number],
          anchoredPosition: [48, 0] as [number, number],
          sizeDelta: [34, 39] as [number, number],
        },
      },
    ],
  };
  return artifactType === "Canvas"
    ? {
        sourceKind: "artifact",
        artifactKey,
        artifactType: "Canvas",
        root,
      }
    : {
        sourceKind: "artifact",
        artifactKey,
        artifactType,
        initialSize: [...initialSize],
        root,
      };
}

test("defines the approved Canvas viewport presets with 16:9 as default", () => {
  assert.deepEqual(CANVAS_VIEWPORT_PRESETS, [
    { label: "4:3(Pad)", size: [1280, 960] },
    { label: "16:9", size: [1280, 720] },
    { label: "21:9", size: [1680, 720] },
    { label: "21:9(Safe)", size: [1680, 720], safeArea: [80, 0, 1600, 720] },
  ]);
  assert.equal(DEFAULT_CANVAS_VIEWPORT_INDEX, 1);
  assert.deepEqual(editorViewport(source("Canvas", [1280, 720]), DEFAULT_CANVAS_VIEWPORT_INDEX), [1280, 720]);
  assert.deepEqual(editorViewport(source("Canvas", [1280, 720]), 99), [1280, 720]);
  assert.equal(editorSafeArea(source("Canvas", [1280, 720]), 2), undefined);
  assert.deepEqual(editorSafeArea(source("Canvas", [1280, 720]), 3), [80, 0, 1600, 720]);
});

test("keeps Widget and Fragment layout in their local initial size", () => {
  const widget = source("Widget", [322, 52]);
  const fragment = source("Fragment", [180, 64]);
  assert.deepEqual(editorViewport(widget, 0), [322, 52]);
  assert.deepEqual(editorViewport(widget, 2), [322, 52]);
  assert.deepEqual(editorViewport(fragment, 1), [180, 64]);
  assert.equal(editorSafeArea(widget, 3), undefined);

  const evaluated = evaluateLayout(widget, editorViewport(widget, 0));
  assert.deepEqual([evaluated.rect.width, evaluated.rect.height], [322, 52]);
  assert.deepEqual([evaluated.children[0]!.rect.x, evaluated.children[0]!.rect.width, evaluated.children[0]!.rect.height], [48, 34, 39]);
});

test("resizes a referenced Widget root without scaling fixed local children", () => {
  const widget = source("Widget", [190, 190]);
  widget.root.children![0]!.rect = {
    anchorMin: [0.5, 0.5],
    anchorMax: [0.5, 0.5],
    pivot: [0.5, 0.5],
    anchoredPosition: [0, 0],
    sizeDelta: [190, 190],
  };

  const evaluated = evaluateLocalLayout(widget, [440, 450]);
  assert.deepEqual([evaluated.rect.width, evaluated.rect.height], [440, 450]);
  assert.deepEqual(
    [evaluated.children[0]!.rect.x, evaluated.children[0]!.rect.y, evaluated.children[0]!.rect.width, evaluated.children[0]!.rect.height],
    [125, 130, 190, 190],
  );
});

test("uses independent Canvas and local zoom policies", () => {
  const canvas = source("Canvas", [1280, 720]);
  const widget = source("Widget", [126.667, 72]);
  assert.deepEqual(editorZoomPolicy(canvas), { default: 0.65, min: 0.2, max: 1.5, step: 0.1 });
  assert.deepEqual(editorZoomPolicy(widget), { default: 1, min: 0.25, max: 8, step: 0.25 });
  assert.equal(clampEditorZoom(canvas, 4), 1.5);
  assert.equal(clampEditorZoom(widget, 4), 4);
});
