import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AuthoringAssetEntry } from "../../src/schema/asset-catalog.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { Inspector } from "../../src/web/editors/artifact/inspector/artifact-inspector.js";

const inspectorAssets: readonly AuthoringAssetEntry[] = [
  {
    kind: "image",
    type: "sprite",
    path: "Icons/Ready.png",
    guid: "00000000000000000000000000000001",
    name: "Ready.png",
    directory: "Icons",
    importer: { kind: "TextureImporter", textureType: "Sprite", spriteMode: "single" },
    metrics: { width: 1, height: 1, pixelsPerUnit: 100, border: [0, 0, 0, 0] },
  },
  {
    kind: "font",
    type: "tmpFont",
    path: "Font/Main SDF.asset",
    guid: "00000000000000000000000000000002",
    name: "Main SDF.asset",
    directory: "Font",
    importer: { kind: "NativeFormatImporter", sourceFontGuid: "00000000000000000000000000000003", sourceFontPath: "Font/Main.ttf" },
    metrics: { atlasPopulationMode: "static", pointSize: 16, scale: 1, lineHeight: 16, ascentLine: 12, descentLine: -4, characterCount: 1 },
  },
];

const root: UiNode = {
  id: "MainCanvas",
  rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
  components: {
    Image: { sprite: "Icons/Ready.png" },
    Text: { text: "Ready", fontSize: 24 },
    RoundedRect: { fillAmount: 0.5 },
    PrefabRef: { artifactKey: "ChildWidget" },
    ButtonEx: { targetGraphic: "MainCanvas" },
    Slider: { fillRect: "MainCanvas", handleRect: "MainCanvas", targetGraphic: "MainCanvas" },
    TMPDropdown: { targetGraphic: "MainCanvas", captionText: "MainCanvas", template: "MainCanvas", itemText: "MainCanvas" },
    TMPInputField: { targetGraphic: "MainCanvas", textViewport: "MainCanvas", textComponent: "MainCanvas" },
    StateRoot: { currentState: "default", states: { default: { MainCanvas: true } } },
    StateToggle: { stateRoots: ["MainCanvas"], selectedIndices: [0] },
    ScrollRect: { content: "MainCanvas", viewport: "MainCanvas" },
    ScrollRectEx: { content: "MainCanvas", viewport: "MainCanvas", templates: { ChildWidget: "MainCanvas" } },
    RectMask2D: {},
    HorizontalLayoutGroup: {},
    VerticalLayoutGroup: {},
    GridLayoutGroup: { cellSize: [100, 100] },
    ContentSizeFitter: {},
    LayoutElement: {},
    AspectRatioFitter: { aspectMode: "widthControlsHeight", aspectRatio: 1 },
  },
};

const source: UiConcreteSource = {
  sourceKind: "artifact",
  artifactKey: "MainCanvas",
  artifactType: "Canvas",
  root,
};

test("renders every registered component through the Inspector", () => {
  const markup = renderToStaticMarkup(
    createElement(Inspector, {
      source,
      node: root,
      catalog: {
        artifacts: [
          {
            artifactKey: "ChildWidget",
            artifactType: "Widget",
            path: "ChildWidget.ui.json",
            prefabPath: "ChildWidget.prefab",
            dependencies: [],
          },
        ],
        references: [],
        prototypes: [],
      },
      assets: inspectorAssets,
      onRefreshAssets: async () => {},
      onUpdate: () => {},
      stateOverrides: {},
      onStatePreview: () => {},
      onOpenArtifact: () => {},
    }),
  );
  for (const label of [
    "Rect Transform",
    "Source Image",
    "TMP Text",
    "Slider",
    "TMP Dropdown",
    "Scroll Rect",
    "State Toggle",
    "Scroll Rect Ex",
    "Grid Layout Group",
    "Layout Element",
    "Aspect Ratio Fitter",
    "添加组件",
  ]) {
    assert.match(markup, new RegExp(label));
  }
  assert.doesNotMatch(markup, /INSPECTOR/);
});

test("uses the same Inspector renderer for Variant overrides and referenced read-only nodes", () => {
  const common = {
    source,
    node: root,
    catalog: {
      artifacts: [
        {
          artifactKey: "ChildWidget",
          artifactType: "Widget" as const,
          path: "ChildWidget.ui.json",
          prefabPath: "ChildWidget.prefab",
          dependencies: [],
        },
      ],
      references: [],
      prototypes: [],
    },
    assets: [],
    onRefreshAssets: async () => {},
    onUpdate: () => {},
    stateOverrides: {},
    onStatePreview: () => {},
    onOpenArtifact: () => {},
  };
  const variant = renderToStaticMarkup(
    createElement(Inspector, {
      ...common,
      variant: true,
      overrideState: (componentType, fieldPath) =>
        componentType === "Image" && fieldPath === "sprite"
          ? "overridden"
          : componentType === "Image" && fieldPath === "color"
            ? "conflict"
            : "inherited",
      onResetOverride: () => {},
    }),
  );
  assert.match(variant, /还原为继承值/);
  assert.match(variant, /继承自基础 Artifact/);
  assert.match(variant, /字段冲突/);
  assert.match(variant, /Variant 不能删除继承组件/);
  assert.doesNotMatch(variant, />添加组件</);

  const referenced = renderToStaticMarkup(createElement(Inspector, { ...common, readOnly: true }));
  assert.match(referenced, /<fieldset[^>]*data-ui="inspector-content"[^>]*disabled=""/);
});

test("renders indexed selection override state and reset independently from its list", () => {
  const node: UiNode = {
    id: "ToggleCanvas",
    rect: root.rect,
    components: {
      StateRoot: { currentState: "unselected", states: { unselected: {}, selected: {} }, elements: [] },
      StateToggle: { stateRoots: ["ToggleCanvas"], selectedIndices: [0] },
    },
  };
  const toggleSource: UiConcreteSource = { ...source, artifactKey: "ToggleCanvas", root: node };
  const markup = renderToStaticMarkup(
    createElement(Inspector, {
      source: toggleSource,
      node,
      catalog: { artifacts: [], references: [], prototypes: [] },
      assets: [],
      onRefreshAssets: async () => {},
      onUpdate: () => {},
      stateOverrides: {},
      onStatePreview: () => {},
      onOpenArtifact: () => {},
      variant: true,
      overrideState: (componentType, fieldPath) =>
        componentType === "StateToggle" && fieldPath === "selectedIndices" ? "overridden" : "inherited",
      onResetOverride: () => {},
    }),
  );
  assert.equal(markup.match(/aria-label="还原为继承值"/g)?.length, 1);
  assert.match(markup, /inspector-field-frame[^\"]*is-overridden/);
});
