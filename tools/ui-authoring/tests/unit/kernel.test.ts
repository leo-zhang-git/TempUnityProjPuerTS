import assert from "node:assert/strict";
import test from "node:test";
import { createArtifactSource } from "../../src/kernel/authoring.js";
import { formatSource, parseSource } from "../../src/kernel/canonical.js";
import { createLayoutSnapshot, evaluateLayout, evaluateLocalLayout } from "../../src/kernel/layout.js";
import {
  applyCurrentStateRootStates,
  applyResolvedPreviewValues,
  applyStateRootPreviewState,
  resolvePreviewValues,
} from "../../src/kernel/preview-values.js";
import { createUnityProjection } from "../../src/kernel/projection.js";
import { createUnityProjectionGraph } from "../../src/kernel/projection-graph.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import { updateNode } from "../../src/kernel/tree.js";
import { validateSource } from "../../src/kernel/validation.js";
import type { UiConcreteSource, UiSource, UiVariantSource } from "../../src/schema/ui-source-schema.js";

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "LoadingCanvas",
    artifactType: "Canvas",
    bindings: [{ name: "titleText", target: { nodeId: "titleText", componentType: "Text" } }],
    root: {
      id: "LoadingCanvas",
      rect: {
        anchorMin: [0, 0],
        anchorMax: [1, 1],
        pivot: [0.5, 0.5],
        anchoredPosition: [0, 0],
        sizeDelta: [0, 0],
      },
      children: [
        {
          id: "titleText",
          rect: {
            anchorMin: [0, 1],
            anchorMax: [0, 1],
            pivot: [0, 1],
            anchoredPosition: [48, -32],
            sizeDelta: [420, 44],
          },
          components: {
            Text: {
              text: "Loading",
              font: "Font/alipuhui SDF.asset",
              fontSize: 30,
            },
          },
        },
      ],
    },
  };
}

test("validates identity and formats deterministically", () => {
  const value = source();
  assert.equal(validateSource(value).valid, true);
  const first = formatSource(value);
  assert.equal(formatSource(JSON.parse(first) as UiSource), first);
  assert.match(first, /"artifactKey": "LoadingCanvas"/);
  assert.doesNotMatch(first, /"wordWrapping"/);
  assert.doesNotMatch(first, /"idMode"/);

  value.root.children![0]!.idMode = "manual";
  assert.match(formatSource(value), /"idMode": "manual"/);

  value.root.idMode = "manual";
  assert.equal(
    validateSource(value).issues.some((issue) => issue.code === "identity.rootMode"),
    true,
  );
  delete value.root.idMode;

  const title = value.root.children?.[0]?.components?.Text;
  assert.ok(title);
  title.wordWrapping = true;
  assert.match(formatSource(value), /"wordWrapping": true/);
});

test("node updates preserve unchanged sibling references", () => {
  const value = source();
  const unchanged = { ...value.root.children![0]!, id: "unchanged" };
  value.root.children!.push(unchanged);
  const originalRoot = value.root;
  const originalChanged = value.root.children![0]!;

  const updated = updateNode(value, originalChanged.id, (node) => ({ ...node, name: "Updated" }));

  assert.notEqual(updated, value);
  assert.notEqual(updated.root, originalRoot);
  assert.notEqual(updated.root.children![0], originalChanged);
  assert.equal(updated.root.children![1], unchanged);
  assert.equal(value.root.children![0], originalChanged);
});

test("canonical Source preserves authored StateRoot order", () => {
  const value = source();
  value.root.components = {
    StateRoot: {
      currentState: "zeta",
      states: {
        zeta: { titleText: true },
        alpha: { titleText: false },
      },
      elements: [{ targetNodeId: "titleText", elementType: "UAlpha", values: { zeta: 1, alpha: 0 } }],
    },
  };

  const formatted = formatSource(value);
  const parsed = JSON.parse(formatted) as UiConcreteSource;
  const stateRoot = parsed.root.components!.StateRoot!;
  assert.deepEqual(Object.keys(stateRoot.states), ["zeta", "alpha"]);
  assert.deepEqual(Object.keys(stateRoot.elements![0]!.values), ["zeta", "alpha"]);
  assert.equal(formatSource(parseSource(formatted)), formatted);
});

test("keeps current Source versionless", () => {
  const value = source();
  assert.ok(formatSource(value).startsWith('{\n  "sourceKind": "artifact",'));
  assert.doesNotMatch(formatSource(value), /\$schema|schemaVersion|formatVersion|"version"/);
  assert.throws(() => parseSource(JSON.stringify({ ...value, schemaVersion: 1 })));
  assert.throws(() => parseSource(JSON.stringify({ ...value, version: "v1" })));
});

test("accepts only the current strict Source structure", () => {
  const text = JSON.stringify(source());
  assert.equal(validateSource(JSON.parse(text)).valid, true);
  assert.deepEqual(parseSource(text), source());
  assert.throws(() => parseSource(JSON.stringify({ ...source(), unknownFormatMarker: 1 })));
  assert.ok(validateSource({ ...source(), initialSize: [1280, 720] }).issues.some((entry) => entry.code === "canvas.initialSize"));
  assert.ok(validateSource({ ...source(), artifactType: "Widget" }).issues.some((entry) => entry.code === "artifact.initialSize"));
  for (const initialSize of [
    [0, 720],
    [1280, 0],
    [-1, 720],
  ]) {
    const result = validateSource({ ...source(), artifactType: "Widget", widgetType: "LoadingCanvas", initialSize });
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((entry) => entry.path.startsWith("/initialSize/")));
  }
});

test("accepts optional Widget Variant initialSize and rejects it for Canvas Variants", () => {
  const widgetVariant: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: "LargeLoadingWidget",
    artifactType: "Widget",
    variantOf: "LoadingWidget",
    initialSize: [320, 180],
    overrides: [],
  };
  assert.equal(validateSource(widgetVariant).valid, true);
  assert.deepEqual(parseSource(formatSource(widgetVariant)), widgetVariant);

  const canvasVariant = {
    ...widgetVariant,
    artifactKey: "LargeLoadingCanvas",
    artifactType: "Canvas",
    variantOf: "LoadingCanvas",
  };
  assert.equal(validateSource(canvasVariant).valid, false);
  assert.ok(validateSource(canvasVariant).issues.some((entry) => entry.code === "canvas.initialSize"));

  for (const initialSize of [
    [0, 180],
    [320, 0],
    [-1, 180],
  ]) {
    const result = validateSource({ ...widgetVariant, initialSize });
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((entry) => entry.path.startsWith("/initialSize/")));
  }
});

test("evaluates Unity anchors in top-left web coordinates", () => {
  const evaluated = evaluateLayout(source());
  const title = evaluated.children[0];
  assert.ok(title);
  assert.deepEqual(title.rect, {
    x: 48,
    y: 32,
    width: 420,
    height: 44,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  });
});

test("matches height-based CanvasScaler coordinates across screen sizes", () => {
  const fullHd = evaluateLayout(source(), [1920, 1080]);
  assert.deepEqual(fullHd.children[0]?.rect, {
    x: 72,
    y: 48,
    width: 630,
    height: 66,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  });

  const ultrawide = evaluateLayout(source(), [2560, 1080]);
  assert.deepEqual(ultrawide.children[0]?.rect, {
    x: 72,
    y: 48,
    width: 630,
    height: 66,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  });
});

test("creates deterministic multi-screen layout snapshots", () => {
  const snapshot = createLayoutSnapshot(source(), [
    [1280, 720],
    [2560, 1080],
  ]);
  assert.equal(snapshot.artifactKey, "LoadingCanvas");
  assert.deepEqual(
    snapshot.screens.map((screen) => screen.canvasSize),
    [
      [1280, 720],
      [5120 / 3, 720],
    ],
  );
  assert.equal(snapshot.screens[1]?.nodes.find((node) => node.id === "titleText")?.x, 72);
  assert.deepEqual(snapshot.screens[0]?.nodes.find((node) => node.id === "titleText")?.namePath, ["LoadingCanvas", "TitleText"]);
});

test("derives binding fields and expands asset roots in projection", () => {
  const value = source();
  const title = value.root.children?.[0];
  assert.ok(title);
  title.name = "TitleText";
  const projection = createUnityProjection(value);
  assert.deepEqual(projection.bindings, [
    {
      fieldName: "titleText",
      nodeId: "titleText",
      componentType: "Text",
      target: { instancePath: [], nodeId: "titleText", nodePath: ["titleText"], siblingPath: [0] },
    },
  ]);
  assert.equal(projection.root.children[0]?.name, "TitleText");
  const projectedText = projection.root.children[0]?.components.Text as { font: string; wordWrapping: boolean };
  assert.equal(projectedText.font, "Assets/Resources/UI/Font/alipuhui SDF.asset");
  assert.equal(projectedText.wordWrapping, false);
});

test("projects RectTransform bindings without emitting a duplicate component", () => {
  const value = source();
  const title = value.root.children?.[0];
  assert.ok(title);
  value.bindings = [...(value.bindings ?? []), { name: "titleRect", target: { nodeId: "titleText", componentType: "RectTransform" } }];

  assert.equal(validateSource(value).valid, true);
  const projection = createUnityProjection(value);
  assert.deepEqual(
    projection.bindings.find((binding) => binding.fieldName === "titleRect"),
    {
      fieldName: "titleRect",
      nodeId: "titleText",
      componentType: "RectTransform",
      target: { instancePath: [], nodeId: "titleText", nodePath: ["titleText"], siblingPath: [0] },
    },
  );
  assert.equal(projection.root.children[0]?.components.RectTransform, undefined);
});

test("rejects duplicate node ids", () => {
  const value = source();
  const firstChild = value.root.children?.[0];
  assert.ok(firstChild);
  value.root.children?.push(structuredClone(firstChild));
  const result = validateSource(value);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((item) => item.code === "identity.duplicate"));
});

test("applies active and property StateRoot previews without mutating source", () => {
  const value = source();
  const title = value.root.children?.[0];
  assert.ok(title);
  value.root.children?.push({
    id: "stateIcon",
    rect: structuredClone(title.rect),
    components: { Image: { sprite: "Generated/Shapes/Round12.png" } },
  });
  value.root.components = {
    StateRoot: {
      currentState: "visible",
      states: {
        visible: { titleText: true },
        hidden: { titleText: false },
      },
      elements: [
        { targetNodeId: "titleText", elementType: "ULocalPos", values: { visible: [12, -8], hidden: [24, -16] } },
        { targetNodeId: "titleText", elementType: "UPivot", values: { visible: [0.5, 1], hidden: [0.5, 0] } },
        { targetNodeId: "titleText", elementType: "UAnchorsMin", values: { visible: [0.5, 1], hidden: [0.5, 0] } },
        { targetNodeId: "titleText", elementType: "UAnchorsMax", values: { visible: [0.5, 1], hidden: [0.5, 0] } },
        { targetNodeId: "titleText", elementType: "UTMP_Text", values: { visible: "Visible", hidden: "Hidden" } },
        { targetNodeId: "titleText", elementType: "UColor", values: { visible: "#FFFFFFFF", hidden: "#FF333380" } },
        {
          targetNodeId: "stateIcon",
          elementType: "USprite",
          values: {
            visible: { sprite: "Generated/Shapes/Round12.png", setNativeSize: false },
            hidden: { sprite: null, setNativeSize: false },
          },
        },
      ],
    },
  };

  value.bindings = [{ name: "state", target: { nodeId: "LoadingCanvas", componentType: "StateRoot" } }];
  const catalog = createSourceCatalog([{ path: "LoadingCanvas.ui.json", source: value }]);
  const resolved = resolvePreviewValues({
    catalog,
    owner: { kind: "reference", artifactKey: "LoadingCanvas", path: "/values" },
    values: { state: { state: "hidden" } },
  });
  const preview = applyResolvedPreviewValues(value, resolved);
  assert.equal(preview.root.children?.[0]?.active, false);
  assert.deepEqual(preview.root.children?.[0]?.rect.anchoredPosition, [24, -16]);
  assert.deepEqual(preview.root.children?.[0]?.rect.pivot, [0.5, 0]);
  assert.deepEqual(preview.root.children?.[0]?.rect.anchorMin, [0.5, 0]);
  assert.deepEqual(preview.root.children?.[0]?.rect.anchorMax, [0.5, 0]);
  assert.equal(preview.root.children?.[0]?.components?.Text?.text, "Hidden");
  assert.equal(preview.root.children?.[0]?.components?.Text?.color, "#FF333380");
  assert.equal(preview.root.children?.[1]?.components?.Image?.sprite, undefined);
  assert.equal(value.root.children?.[0]?.active, undefined);
  assert.equal(value.root.children?.[0]?.components?.Text?.text, "Loading");
  assert.equal(value.root.children?.[1]?.components?.Image?.sprite, "Generated/Shapes/Round12.png");
  assert.equal(validateSource(value).valid, true);
  const projectionStateRoot = createUnityProjection(value).root.components.StateRoot as {
    elements: Array<{ elementType: string; values: Record<string, unknown> }>;
  };
  assert.equal(projectionStateRoot.elements.length, 7);
  assert.deepEqual(projectionStateRoot.elements.at(-1)?.values, {
    visible: { sprite: "Assets/Resources/UI/Generated/Shapes/Round12.png", setNativeSize: false },
    hidden: { sprite: null, setNativeSize: false },
  });
});

test("applies every StateRoot current state without mutating source", () => {
  const value = source();
  const title = value.root.children?.[0];
  assert.ok(title);
  value.root.components = {
    StateRoot: {
      currentState: "hidden",
      states: {
        visible: { titleText: true },
        hidden: { titleText: false },
      },
    },
  };
  value.root.children?.push({
    id: "secondaryState",
    rect: structuredClone(title.rect),
    components: {
      StateRoot: {
        currentState: "inactive",
        states: {
          active: { secondaryLabel: true },
          inactive: { secondaryLabel: false },
        },
      },
    },
    children: [
      {
        id: "secondaryLabel",
        rect: structuredClone(title.rect),
        components: { Text: { text: "Secondary" } },
      },
    ],
  });

  const preview = applyCurrentStateRootStates(value);

  assert.equal(preview.root.children?.[0]?.active, false);
  assert.equal(preview.root.children?.[1]?.children?.[0]?.active, false);
  assert.equal(value.root.children?.[0]?.active, undefined);
  assert.equal(value.root.children?.[1]?.children?.[0]?.active, undefined);
});

test("applies StateRoot root size controls to Widget preview layout", () => {
  const value: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "ResizableWidget",
    artifactType: "Widget",
    widgetType: "ResizableWidget",
    initialSize: [320, 180],
    root: {
      id: "ResizableWidget",
      rect: {
        anchorMin: [0, 1],
        anchorMax: [0, 1],
        pivot: [0, 1],
        anchoredPosition: [0, 0],
        sizeDelta: [320, 180],
      },
      components: {
        StateRoot: {
          currentState: "compact",
          states: { compact: {}, wide: {} },
          elements: [
            { targetNodeId: "ResizableWidget", elementType: "UWidth", values: { compact: 200, wide: 520 } },
            { targetNodeId: "ResizableWidget", elementType: "UHeight", values: { compact: 100, wide: 260 } },
          ],
        },
      },
      children: [
        {
          id: "child",
          rect: {
            anchorMin: [0, 1],
            anchorMax: [0, 1],
            pivot: [0, 1],
            anchoredPosition: [12, -8],
            sizeDelta: [40, 20],
          },
        },
      ],
    },
  };

  const compact = applyStateRootPreviewState(value, "ResizableWidget", "compact");
  const compactLayout = evaluateLocalLayout(compact);
  assert.deepEqual(compact.initialSize, [200, 100]);
  assert.deepEqual([compactLayout.rect.width, compactLayout.rect.height], [200, 100]);
  assert.deepEqual([compactLayout.children[0]?.rect.x, compactLayout.children[0]?.rect.y], [12, 8]);

  const wide = applyStateRootPreviewState(value, "ResizableWidget", "wide");
  const wideLayout = evaluateLocalLayout(wide);
  assert.deepEqual(wide.initialSize, [520, 260]);
  assert.deepEqual([wideLayout.rect.width, wideLayout.rect.height], [520, 260]);
  assert.deepEqual(value.initialSize, [320, 180]);
});

test("accepts numeric Unity StateRoot state names", () => {
  const value = source();
  value.root.components = {
    StateRoot: {
      currentState: "0",
      states: { "0": { titleText: true }, "1": { titleText: false } },
    },
  };

  assert.equal(validateSource(value).valid, true);
  const projected = createUnityProjection(value).root.components.StateRoot as { currentState: string; states: Record<string, unknown> };
  assert.equal(projected.currentState, "0");
  assert.deepEqual(Object.keys(projected.states), ["0", "1"]);
});

test("rejects incomplete or incompatible StateRoot property elements", () => {
  const value = source();
  value.root.components = {
    StateRoot: {
      currentState: "normal",
      states: { normal: {}, alert: {} },
      elements: [{ targetNodeId: "titleText", elementType: "UAlpha", values: { normal: 1 } }],
    },
  };
  assert.ok(validateSource(value).issues.some((item) => item.code === "state.elementStates"));
  value.root.components.StateRoot!.elements = [
    { targetNodeId: "LoadingCanvas", elementType: "UTMP_Text", values: { normal: "Ready", alert: "Alert" } },
  ];
  assert.ok(validateSource(value).issues.some((item) => item.code === "state.elementCapability"));
  value.root.components.StateRoot!.elements = [
    {
      targetNodeId: "LoadingCanvas",
      elementType: "USprite",
      values: {
        normal: { sprite: null, setNativeSize: false },
        alert: { sprite: "Generated/Shapes/Round12.png", setNativeSize: false },
      },
    },
  ];
  assert.ok(validateSource(value).issues.some((item) => item.code === "state.elementCapability"));
});

test("supports explicit names for multiple bindings on one node", () => {
  const value = source();
  const title = value.root.children?.[0];
  assert.ok(title?.components?.Text);
  value.bindings = [
    { name: "titleRoot", target: { nodeId: "titleText", componentType: "GameObject" } },
    { name: "titleLabel", target: { nodeId: "titleText", componentType: "Text" } },
  ];

  assert.equal(validateSource(value).valid, true);
  assert.deepEqual(createUnityProjection(value).bindings, [
    {
      fieldName: "titleRoot",
      nodeId: "titleText",
      componentType: "GameObject",
      target: { instancePath: [], nodeId: "titleText", nodePath: ["titleText"], siblingPath: [0] },
    },
    {
      fieldName: "titleLabel",
      nodeId: "titleText",
      componentType: "Text",
      target: { instancePath: [], nodeId: "titleText", nodePath: ["titleText"], siblingPath: [0] },
    },
  ]);
});

test("binds same-named GameObjects independently by node id and structure", () => {
  const value = source();
  const first = value.root.children![0]!;
  first.name = "Shared Label";
  value.root.children!.push({
    ...structuredClone(first),
    id: "secondaryText",
    name: "Shared Label",
  });
  value.bindings = [
    { name: "primaryLabel", target: { nodeId: "titleText", componentType: "Text" } },
    { name: "secondaryLabel", target: { nodeId: "secondaryText", componentType: "Text" } },
  ];

  assert.equal(validateSource(value).valid, true);
  assert.deepEqual(
    createUnityProjection(value).bindings.map((binding) => [binding.fieldName, binding.target]),
    [
      ["primaryLabel", { instancePath: [], nodeId: "titleText", nodePath: ["titleText"], siblingPath: [0] }],
      ["secondaryLabel", { instancePath: [], nodeId: "secondaryText", nodePath: ["secondaryText"], siblingPath: [1] }],
    ],
  );
});

function graphSource(artifactKey: string, artifactType: "Canvas" | "Widget", dependency?: string): UiConcreteSource {
  const value = createArtifactSource({ artifactKey, artifactType, initialSize: [1280, 720] });
  value.root.children = dependency
    ? [
        {
          id: `nested${dependency}`,
          name: dependency,
          active: false,
          rect: {
            anchorMin: [0.5, 0.5],
            anchorMax: [0.5, 0.5],
            pivot: [0.5, 0.5],
            anchoredPosition: [0, 0],
            sizeDelta: [640, 360],
          },
          components: { PrefabRef: { artifactKey: dependency } },
        },
      ]
    : [];
  if (dependency) value.bindings = [{ name: dependency, target: { nodeId: `nested${dependency}`, componentType: "PrefabRef" } }];
  else delete value.bindings;
  return value;
}

test("projects artifact graphs from leaf to root and resolves prefab paths", () => {
  const row = graphSource("LoginServerRowWidget", "Widget");
  const selector = graphSource("ServerSelectWidget", "Widget", "LoginServerRowWidget");
  const login = graphSource("LoginCanvas", "Canvas", "ServerSelectWidget");
  const catalog = createSourceCatalog([
    { path: "LoginCanvas.ui.json", source: login },
    { path: "ServerSelectWidget.ui.json", source: selector },
    { path: "LoginServerRowWidget.ui.json", source: row },
  ]);

  const graph = createUnityProjectionGraph(catalog, "LoginCanvas");
  assert.deepEqual(
    graph.map((entry) => entry.projection.artifactKey),
    ["LoginServerRowWidget", "ServerSelectWidget", "LoginCanvas"],
  );
  const selectorRef = graph[1]?.projection.root.children[0]?.components.PrefabRef as { artifactKey: string; prefabPath: string };
  assert.deepEqual(selectorRef, {
    artifactKey: "LoginServerRowWidget",
    sourcePath: "LoginServerRowWidget.ui.json",
    prefabPath: "Assets/Resources/UI/Prefab/LoginServerRowWidget.prefab",
    artifactType: "Widget",
    overrides: [],
    componentAdditions: [],
  });

  const formalGraph = createUnityProjectionGraph(catalog, "LoginCanvas");
  assert.equal(formalGraph.at(-1)?.projection.prefabPath, "Assets/Resources/UI/Prefab/LoginCanvas.prefab");
  const formalSelectorRef = formalGraph[1]?.projection.root.children[0]?.components.PrefabRef as { prefabPath: string };
  assert.equal(formalSelectorRef.prefabPath, "Assets/Resources/UI/Prefab/LoginServerRowWidget.prefab");
});

test("rejects missing, duplicate and circular artifact graph ownership", () => {
  const missing = graphSource("LoginCanvas", "Canvas", "MissingWidget");
  assert.throws(
    () => createUnityProjectionGraph(createSourceCatalog([{ path: "LoginCanvas.ui.json", source: missing }]), "LoginCanvas"),
    /missing artifact 'MissingWidget'/,
  );

  const row = graphSource("LoginServerRowWidget", "Widget");
  assert.throws(
    () =>
      createSourceCatalog([
        { path: "a.ui.json", source: row },
        { path: "b.ui.json", source: structuredClone(row) },
      ]),
    /Duplicate artifactKey/,
  );
  const caseConflict = graphSource("LoginServerRowwidget", "Widget");
  assert.throws(
    () =>
      createSourceCatalog([
        { path: "a.ui.json", source: row },
        { path: "b.ui.json", source: caseConflict },
      ]),
    /Duplicate case-insensitive artifactKey/,
  );

  const first = graphSource("FirstWidget", "Widget", "SecondWidget");
  const second = graphSource("SecondWidget", "Widget", "FirstWidget");
  const cyclic = createSourceCatalog([
    { path: "first.ui.json", source: first },
    { path: "second.ui.json", source: second },
  ]);
  assert.throws(() => createUnityProjectionGraph(cyclic, "FirstWidget"), /FirstWidget -> SecondWidget -> FirstWidget/);
});
