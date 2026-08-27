import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "@sinclair/typebox/value";
import { useSiteComponentAdditionSchema } from "../../src/components/prefab-ref.js";
import { type EvaluatedNode, evaluateLocalLayout } from "../../src/kernel/layout.js";
import { componentManifest } from "../../src/registry/component-manifest.js";
import { componentInspectorFields, componentRegistry } from "../../src/registry/component-registry.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { UiComponentsSchema } from "../../src/schema/ui-source-schema.js";
import { visibleInspectorEntries } from "../../src/web/editors/artifact/inspector/inspector-entry.js";
import { shapeSoftMaskInspectorState } from "../../src/web/editors/artifact/inspector/shape-soft-mask-inspector.js";
import { visibleEvaluatedNodes } from "../../src/web/rendering/artifact-renderer/rect-mask-rendering.js";
import { shapeSoftMaskSvg } from "../../src/web/rendering/artifact-renderer/shape-soft-mask-rendering.js";
import { groupShapeSoftMaskEntries } from "../../src/web/rendering/shape-soft-mask-layer.js";

function rect(width: number, height: number, rotation = 0, scale: [number, number] = [1, 1]): UiNode["rect"] {
  return {
    anchorMin: [0.5, 0.5],
    anchorMax: [0.5, 0.5],
    pivot: [0.5, 0.5],
    anchoredPosition: [0, 0],
    sizeDelta: [width, height],
    rotation,
    scale,
  };
}

function previewSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "SoftMaskWidget",
    artifactType: "Widget",
    widgetType: "SoftMaskWidget",
    initialSize: [240, 160],
    root: {
      id: "SoftMaskWidget",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      components: { ShapeSoftMask: { shape: "Rect", rectSoftness: [4, 8, 12, 16], falloff: 1.5 } },
      children: [
        {
          id: "roundedMask",
          rect: rect(120, 80, 30, [1.5, 0.75]),
          components: { ShapeSoftMask: { shape: "RoundedRect", rectSoftness: [3, 5, 7, 9], cornerRadius: 18, falloff: 2 } },
          children: [{ id: "content", rect: rect(180, 120), components: { Image: { color: "#FFFFFFFF" } } }],
        },
      ],
    },
  };
}

function evaluatedNode(root: EvaluatedNode, nodeId: string): EvaluatedNode {
  if (root.node.id === nodeId) return root;
  for (const child of root.children) {
    try {
      return evaluatedNode(child, nodeId);
    } catch {}
  }
  throw new Error(`Missing evaluated node '${nodeId}'`);
}

test("declares the ShapeSoftMask Source and Unity field contract", () => {
  assert.equal(Value.Check(UiComponentsSchema, { ShapeSoftMask: {} }), true);
  assert.equal(
    Value.Check(UiComponentsSchema, {
      ShapeSoftMask: {
        shape: "RoundedRect",
        rectSoftness: [1, 2, 3, 4],
        cornerRadius: 12,
        falloff: 1.5,
      },
    }),
    true,
  );
  assert.equal(Value.Check(UiComponentsSchema, { ShapeSoftMask: { shape: "Ellipse" } }), false);
  assert.equal(Value.Check(UiComponentsSchema, { ShapeSoftMask: { rectSoftness: [-1, 0, 0, 0] } }), false);
  assert.equal(Value.Check(UiComponentsSchema, { ShapeSoftMask: { falloff: 0 } }), false);
  assert.equal(Value.Check(UiComponentsSchema, { ShapeSoftMask: { falloff: 0.00001 } }), false);
  assert.equal(
    Value.Check(useSiteComponentAdditionSchema, {
      target: { nodeId: "panel" },
      componentType: "ShapeSoftMask",
      value: { shape: "Circle", radialSoftness: 8 },
    }),
    true,
  );

  const manifest = componentManifest.components.find((entry) => entry.key === "ShapeSoftMask");
  assert.deepEqual(manifest, {
    key: "ShapeSoftMask",
    unityType: "UnityEngine.UI.ShapeSoftMask",
    exactType: false,
    useSiteAddable: true,
    fields: [
      { property: "shape", path: "m_Shape", codec: "enum", enumValues: { Rect: 0, RoundedRect: 1, Circle: 2 } },
      { property: "rectSoftness", path: "m_RectSoftness", codec: "vector4" },
      { property: "radialSoftness", path: "m_RadialSoftness", codec: "float" },
      { property: "cornerRadius", path: "m_CornerRadius", codec: "float" },
      { property: "falloff", path: "m_Falloff", codec: "float" },
    ],
  });
});

test("shows ShapeSoftMask fields for the selected shape", () => {
  const entries = componentInspectorFields("ShapeSoftMask");
  const visible = (shape: "Rect" | "RoundedRect" | "Circle") =>
    visibleInspectorEntries(entries, { shape }, [])
      .filter((entry) => "property" in entry)
      .map((entry) => entry.property);

  assert.deepEqual(visible("Rect"), ["shape", "rectSoftness", "falloff"]);
  assert.deepEqual(visible("RoundedRect"), ["shape", "rectSoftness", "cornerRadius", "falloff"]);
  assert.deepEqual(visible("Circle"), ["shape", "radialSoftness", "falloff"]);
  assert.equal(componentRegistry.ShapeSoftMask.previewRenderer, "none");
});

test("builds root-canvas ShapeSoftMask layers for the mask node and descendants", () => {
  const source = previewSource();
  const evaluated = evaluateLocalLayout(source);
  const nodes = visibleEvaluatedNodes(evaluated);
  const root = nodes.find((entry) => entry.node.id === "SoftMaskWidget")!;
  const rounded = nodes.find((entry) => entry.node.id === "roundedMask")!;
  const content = nodes.find((entry) => entry.node.id === "content")!;

  assert.ok(root.shapeMaskStyle?.maskImage);
  assert.ok(rounded.shapeMaskStyle?.maskImage);
  assert.equal(content.shapeMaskStyle, rounded.shapeMaskStyle);
  assert.notEqual(root.shapeMaskStyle, rounded.shapeMaskStyle);
  assert.notEqual(rounded.shapeMaskStyle?.maskSize, "240px 160px");
  assert.notEqual(rounded.shapeMaskStyle?.maskPosition, "0px 0px");
  assert.ok(rounded.shapeMaskStyle?.clipPath);

  const roundedNode = evaluatedNode(evaluated, "roundedMask");
  assert.ok(roundedNode.localToCanvas);
  assert.ok(Math.abs(roundedNode.localToCanvas[1]) > 0.1);
  const svg = shapeSoftMaskSvg(
    [
      { node: evaluated, value: source.root.components!.ShapeSoftMask! },
      { node: roundedNode, value: source.root.children![0]!.components!.ShapeSoftMask! },
    ],
    [240, 160],
  );
  assert.match(svg, /linearGradient id="h0"/);
  assert.match(svg, /rx="18"/);
  assert.match(svg, /transform="matrix\([^)]*[1-9][^)]*\)"/);
  assert.match(svg, /mask="url\(#shape0\)".*mask="url\(#shape1\)"/);
});

test("groups consecutive nodes that share one ShapeSoftMask chain", () => {
  const firstStyle = { maskImage: "first" };
  const nestedStyle = { maskImage: "nested" };
  const groups = groupShapeSoftMaskEntries([
    { id: "root" },
    { id: "mask", shapeMaskStyle: firstStyle },
    { id: "child", shapeMaskStyle: firstStyle },
    { id: "nested", shapeMaskStyle: nestedStyle },
    { id: "after", shapeMaskStyle: firstStyle },
  ]);

  assert.deepEqual(
    groups.map((group) => ({
      style: group.style?.maskImage,
      entries: group.entries.map(({ entry, index }) => [entry.id, index]),
    })),
    [
      { style: undefined, entries: [["root", 0]] },
      {
        style: "first",
        entries: [
          ["mask", 1],
          ["child", 2],
        ],
      },
      { style: "nested", entries: [["nested", 3]] },
      { style: "first", entries: [["after", 4]] },
    ],
  );
});

test("renders Circle with radial softness and reports simplified Inspector state", () => {
  const source = previewSource();
  source.root.children![0]!.components!.ShapeSoftMask = { shape: "Circle", radialSoftness: 10, falloff: 1.25 };
  const evaluated = evaluateLocalLayout(source);
  const circle = evaluatedNode(evaluated, "roundedMask");
  const svg = shapeSoftMaskSvg([{ node: circle, value: source.root.children![0]!.components!.ShapeSoftMask! }], [240, 160]);
  assert.match(svg, /radialGradient id="r0"/);
  assert.match(svg, /<circle /);

  source.root.children![0]!.components!.ShapeSoftMask = { shape: "RoundedRect", cornerRadius: 80 };
  assert.deepEqual(shapeSoftMaskInspectorState(source, "roundedMask", circle.rect), {
    activeDepth: 2,
    maximumRadius: 40,
    radiusClamped: true,
  });
});
