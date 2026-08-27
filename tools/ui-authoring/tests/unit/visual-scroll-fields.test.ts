import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatSource } from "../../src/kernel/canonical.js";
import { createUnityProjection } from "../../src/kernel/projection.js";
import { createUnityProjectionGraph } from "../../src/kernel/projection-graph.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import { validateSource } from "../../src/kernel/validation.js";
import type { UiConcreteSource, UiNode, UiVariantSource } from "../../src/schema/ui-source-schema.js";
import { Inspector } from "../../src/web/editors/artifact/inspector/artifact-inspector.js";
import { textAlignmentStyle, textContentStyle } from "../../src/web/rendering/artifact-renderer/artifact-rendering.js";

function rect(width = 200, height = 80) {
  return {
    anchorMin: [0.5, 0.5] as [number, number],
    anchorMax: [0.5, 0.5] as [number, number],
    pivot: [0.5, 0.5] as [number, number],
    anchoredPosition: [0, 0] as [number, number],
    sizeDelta: [width, height] as [number, number],
  };
}

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "FieldWidget",
    artifactType: "Widget",
    widgetType: "FieldWidget",
    initialSize: [400, 240],
    root: {
      id: "FieldWidget",
      rect: rect(400, 240),
      children: [
        {
          id: "image",
          rect: rect(),
          components: {
            Image: { raycastPadding: [-8, 2, 3, 4] },
            Animation: { defaultClip: "Animation/Idle.anim", clips: ["Animation/Idle.anim", "Assets/Resources/UI/Animation/Hit.anim"] },
          },
        },
        {
          id: "label",
          rect: rect(),
          components: { Text: { text: "AB", fontSize: 30, bold: true, wordWrapping: true, characterSpacing: 10, margin: [1, 2, 3, 4] } },
        },
        {
          id: "scroll",
          rect: rect(),
          components: {
            ScrollRectEx: {
              content: "content",
              viewport: "viewport",
              emptyDefaultTarget: "emptyTarget",
              emptyDefaultStateRoot: "emptyState",
              templates: {},
            },
          },
        },
        { id: "content", rect: rect() },
        { id: "viewport", rect: rect() },
        { id: "emptyTarget", active: false, rect: rect() },
        {
          id: "emptyState",
          rect: rect(),
          components: {
            StateRoot: {
              currentState: "hidden",
              states: { hidden: { emptyTarget: false }, shown: { emptyTarget: true } },
            },
          },
        },
      ],
    },
  };
}

function inspectorMarkup(document: UiConcreteSource, node: UiNode): string {
  return renderToStaticMarkup(
    createElement(Inspector, {
      source: document,
      node,
      catalog: { artifacts: [], references: [], prototypes: [] },
      assets: [],
      onRefreshAssets: async () => {},
      onUpdate: () => {},
      stateOverrides: {},
      onStatePreview: () => {},
      onOpenArtifact: () => {},
    }),
  );
}

test("projects Image, TMP and ScrollRectEx fields with stable Source semantics", () => {
  const document = source();
  assert.equal(validateSource(document).valid, true);
  const projection = createUnityProjection(document);
  assert.deepEqual(projection.root.children[0]!.components.Image, {
    raycastPadding: [-8, 2, 3, 4],
    color: "#FFFFFFFF",
    imageType: "simple",
    fillCenter: true,
    pixelsPerUnitMultiplier: 1,
    fillMethod: "radial360",
    fillClockwise: true,
    useSpriteMesh: false,
    preserveAspect: false,
    fillAmount: 1,
    raycastTarget: false,
    maskable: true,
  });
  assert.equal((projection.root.children[0]!.components.Animation as { defaultClip: string }).defaultClip, "Assets/Resources/UI/Animation/Idle.anim");
  assert.deepEqual((projection.root.children[0]!.components.Animation as { clips: readonly string[] }).clips, [
    "Assets/Resources/UI/Animation/Idle.anim",
    "Assets/Resources/UI/Animation/Hit.anim",
  ]);
  assert.deepEqual(projection.root.children[1]!.components.Text, {
    text: "AB",
    font: "Assets/Resources/UI/Font/alipuhui SDF.asset",
    material: "normal",
    fontSize: 30,
    bold: true,
    characterSpacing: 10,
    margin: [1, 2, 3, 4],
    color: "#FFFFFFFF",
    alignment: "topLeft",
    overflow: "overflow",
    wordWrapping: true,
    lineSpacing: 0,
  });
  assert.deepEqual(projection.root.children[2]!.components.ScrollRectEx, {
    content: "content",
    viewport: "viewport",
    emptyDefaultTarget: "emptyTarget",
    emptyDefaultStateRoot: "emptyState",
    templates: {},
    horizontal: false,
    vertical: true,
    movementType: "elastic",
    inertia: true,
    scrollSensitivity: 1,
    elasticity: 0.1,
    decelerationRate: 0.135,
    horizontalScrollbar: null,
    verticalScrollbar: null,
    horizontalScrollbarVisibility: "permanent",
    verticalScrollbarVisibility: "permanent",
    horizontalScrollbarSpacing: -3,
    verticalScrollbarSpacing: -3,
    autoAlignCenter: false,
    autoClamped: false,
  });
});

test("strips new visual and empty-state defaults from canonical Source", () => {
  const document = source();
  document.root.children![0]!.components!.Image!.raycastPadding = [0, 0, 0, 0];
  document.root.children![1]!.components!.Text!.characterSpacing = 0;
  document.root.children![1]!.components!.Text!.margin = [0, 0, 0, 0];
  document.root.children![1]!.components!.Text!.bold = false;
  document.root.children![2]!.components!.ScrollRectEx!.emptyDefaultTarget = null;
  document.root.children![2]!.components!.ScrollRectEx!.emptyDefaultStateRoot = null;
  const formatted = formatSource(document);
  for (const field of ["raycastPadding", "bold", "characterSpacing", "margin", "emptyDefaultTarget", "emptyDefaultStateRoot"]) {
    assert.doesNotMatch(formatted, new RegExp(`"${field}"`));
  }
});

test("validates ScrollRectEx empty StateRoot references", () => {
  const document = source();
  document.root.children![2]!.components!.ScrollRectEx!.emptyDefaultStateRoot = "emptyTarget";
  assert.ok(validateSource(document).issues.some((issue) => issue.code === "scroll.emptyStateRoot"));
});

test("projects ScrollRectEx empty-state overrides as structured targets", () => {
  const base = source();
  const variant: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: "AlternateFieldWidget",
    artifactType: "Widget",
    variantOf: base.artifactKey,
    overrides: [
      { target: { nodeId: "scroll", componentType: "ScrollRectEx", fieldPath: "emptyDefaultTarget" }, value: "viewport" },
      { target: { nodeId: "scroll", componentType: "ScrollRectEx", fieldPath: "emptyDefaultStateRoot" }, value: null },
    ],
  };
  const catalog = createSourceCatalog([
    { path: "FieldWidget.ui.json", source: base },
    { path: "AlternateFieldWidget.ui.json", source: variant },
  ]);
  const projection = createUnityProjectionGraph(catalog, variant.artifactKey).at(-1)!.projection;
  assert.deepEqual(
    projection.propertyOverrides.map((override) => [override.fieldPath, override.value]),
    [
      ["emptyDefaultTarget", { instancePath: [], nodeId: "viewport", nodePath: ["viewport"], siblingPath: [4] }],
      ["emptyDefaultStateRoot", null],
    ],
  );
});

test("renders the new Image, TMP and ScrollRectEx fields in the shared Inspector", () => {
  const document = source();
  const [image, text, scroll] = document.root.children!;
  assert.match(inspectorMarkup(document, image!), /Raycast Padding/);
  assert.match(inspectorMarkup(document, text!), /Character Spacing/);
  assert.match(inspectorMarkup(document, text!), /Bold/);
  assert.match(inspectorMarkup(document, text!), /Margin/);
  assert.match(inspectorMarkup(document, scroll!), /Empty Default Target/);
  assert.match(inspectorMarkup(document, scroll!), /Empty Default StateRoot/);
});

test("renders bounded TMP Bold in Preview styles", () => {
  assert.equal(textContentStyle({ bold: true }).fontWeight, 700);
  assert.equal(textContentStyle({ bold: false }).fontWeight, 400);
});

test("maps all TMP alignment tokens onto vertical and horizontal flex axes", () => {
  const expected = {
    topLeft: ["flex-start", "flex-start", "left"],
    top: ["flex-start", "center", "center"],
    topRight: ["flex-start", "flex-end", "right"],
    left: ["center", "flex-start", "left"],
    center: ["center", "center", "center"],
    right: ["center", "flex-end", "right"],
    bottomLeft: ["flex-end", "flex-start", "left"],
    bottom: ["flex-end", "center", "center"],
    bottomRight: ["flex-end", "flex-end", "right"],
  } as const;

  for (const [alignment, [justifyContent, alignItems, textAlign]] of Object.entries(expected)) {
    assert.deepEqual(textAlignmentStyle(alignment as keyof typeof expected), {
      flexDirection: "column",
      justifyContent,
      alignItems,
      textAlign,
    });
  }
});
