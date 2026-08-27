import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPrefabReconcilePatches,
  parsePrefabObservation as parseRawPrefabObservation,
  reconcilePrefabObservation,
} from "../../src/kernel/prefab-observation.js";
import { createUnityProjection } from "../../src/kernel/projection.js";
import { createUnityProjectionGraph } from "../../src/kernel/projection-graph.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";

function source(): UiConcreteSource & { artifactType: "Widget" } {
  return {
    sourceKind: "artifact",
    artifactKey: "MainWidget",
    artifactType: "Widget",
    widgetType: "MainWidget",
    initialSize: [320, 180],
    root: {
      id: "MainWidget",
      rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [320, 180] },
      children: [
        {
          id: "title",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [16, -12], sizeDelta: [200, 40] },
          components: { Text: { text: "Ready", fontSize: 24 } },
        },
      ],
    },
  };
}

function parsePrefabObservation(value: Parameters<typeof parseRawPrefabObservation>[0]) {
  return parseRawPrefabObservation({
    localWidgetType: "MainWidget",
    effectiveWidgetType: "MainWidget",
    ...(value as Record<string, unknown>),
  });
}

test("reconciles supported prefab observations and ignores float noise", () => {
  const document = source();
  const projection = createUnityProjection(document);
  const observation = parsePrefabObservation({
    artifactKey: "MainWidget",
    prefabPath: projection.prefabPath,
    issues: [],
    nodes: [
      { id: "MainWidget", namePath: ["MainWidget"], active: true, rect: { ...projection.root.rect }, components: {} },
      {
        id: "title",
        namePath: ["MainWidget", "Title"],
        active: true,
        rect: { ...projection.root.children[0]!.rect, anchoredPosition: [16.00001, -12] },
        components: { Text: { ...(projection.root.children[0]!.components.Text as object), text: "Deploy", material: "outline" } },
      },
    ],
  });
  const result = reconcilePrefabObservation(document, projection, observation);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(
    result.patches.map((patch) => [patch.nodeId, patch.field]),
    [
      ["title", "components.Text.text"],
      ["title", "components.Text.material"],
    ],
  );
  const applied = applyPrefabReconcilePatches(document, result);
  assert.equal(applied.root.children?.[0]?.components?.Text?.text, "Deploy");
  assert.equal(applied.root.children?.[0]?.components?.Text?.material, "outline");
  const projectionChanged = reconcilePrefabObservation(document, projection, observation, { projectionChanged: true });
  assert.match(projectionChanged.issues[0] ?? "", /stable component manifest/);
});

test("reconciles fixed root axes into initialSize while preserving stretched axes", () => {
  const document: UiConcreteSource = {
    ...source(),
    initialSize: [504, 583],
    root: {
      id: "MainWidget",
      rect: {
        anchorMin: [0.5, 0],
        anchorMax: [0.5, 1],
        pivot: [0.5, 0.5],
        anchoredPosition: [0, -2.5],
        sizeDelta: [472, -137],
      },
    },
  };
  const projection = createUnityProjection(document);
  const observation = parsePrefabObservation({
    artifactKey: document.artifactKey,
    prefabPath: projection.prefabPath,
    issues: [],
    nodes: [
      {
        id: document.root.id,
        namePath: [projection.root.name],
        active: true,
        rect: { ...projection.root.rect, sizeDelta: [508, -137] },
        components: {},
      },
    ],
  });

  const result = reconcilePrefabObservation(document, projection, observation);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(
    result.patches.map((patch) => [patch.kind, patch.field, patch.observed]),
    [
      ["artifact-size", "initialSize", [508, 583]],
      ["field", "rect.sizeDelta", [508, -137]],
    ],
  );
  const applied = applyPrefabReconcilePatches(document, result);
  assert.deepEqual(applied.initialSize, [508, 583]);
  assert.deepEqual(applied.root.rect.sizeDelta, [508, -137]);
  assert.deepEqual(reconcilePrefabObservation(applied, createUnityProjection(applied), observation).patches, []);
});

test("preserves initialSize on root axes driven by self layout components", () => {
  const document: UiConcreteSource = {
    ...source(),
    initialSize: [200, 160],
    root: {
      id: "MainWidget",
      rect: {
        anchorMin: [0.5, 0.5],
        anchorMax: [0.5, 0.5],
        pivot: [0.5, 0.5],
        anchoredPosition: [0, 0],
        sizeDelta: [200, 160],
      },
      components: {
        ContentSizeFitter: { horizontalFit: "preferredSize" },
        AspectRatioFitter: { aspectMode: "widthControlsHeight", aspectRatio: 1.25 },
      },
    },
  };
  const projection = createUnityProjection(document);
  const observation = parsePrefabObservation({
    artifactKey: document.artifactKey,
    prefabPath: projection.prefabPath,
    issues: [],
    nodes: [
      {
        id: document.root.id,
        namePath: [projection.root.name],
        active: true,
        rect: { ...projection.root.rect, sizeDelta: [240, 192] },
        components: projection.root.components,
      },
    ],
  });

  const result = reconcilePrefabObservation(document, projection, observation);
  assert.equal(
    result.patches.some((patch) => patch.kind === "artifact-size"),
    false,
  );
  const applied = applyPrefabReconcilePatches(document, result);
  assert.deepEqual(applied.initialSize, [200, 160]);
  assert.deepEqual(applied.root.rect.sizeDelta, [240, 192]);
});

test("normalizes registered asset fields when reconciling changed Unity values", () => {
  const document: UiConcreteSource = {
    ...source(),
    root: {
      ...source().root,
      components: { Animator: { controller: "Animation/GameplayMainHudGraph/CrossHit.controller" } },
      children: [],
    },
  };
  const projection = createUnityProjection(document);
  const observation = parsePrefabObservation({
    artifactKey: document.artifactKey,
    prefabPath: projection.prefabPath,
    issues: [],
    nodes: [
      {
        id: document.root.id,
        namePath: [projection.root.name],
        active: true,
        rect: projection.root.rect,
        components: { Animator: { controller: "Assets/Resources/UI/Animation/CrossBreakArmor.controller" } },
      },
    ],
  });

  const result = reconcilePrefabObservation(document, projection, observation);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(
    result.patches.map((patch) => [patch.field, patch.observed]),
    [["components.Animator.controller", "Animation/CrossBreakArmor.controller"]],
  );
  const applied = applyPrefabReconcilePatches(document, result);
  assert.equal(applied.root.components?.Animator?.controller, "Animation/CrossBreakArmor.controller");
});

test("roundtrips the bounded TMP Bold semantic", () => {
  const document = source();
  const projection = createUnityProjection(document);
  const title = projection.root.children[0]!;
  const observation = parsePrefabObservation({
    artifactKey: document.artifactKey,
    prefabPath: projection.prefabPath,
    issues: [],
    nodes: [
      { id: document.root.id, namePath: [projection.root.name], active: true, rect: projection.root.rect, components: {} },
      {
        id: title.id,
        namePath: [projection.root.name, title.name],
        active: true,
        rect: title.rect,
        components: { Text: { ...(title.components.Text as object), bold: true } },
      },
    ],
  });

  const result = reconcilePrefabObservation(document, projection, observation);
  assert.deepEqual(
    result.patches.map((patch) => [patch.field, patch.expected, patch.observed]),
    [["components.Text.bold", false, true]],
  );
  const applied = applyPrefabReconcilePatches(document, result);
  assert.equal(applied.root.children?.[0]?.components?.Text?.bold, true);
  assert.deepEqual(reconcilePrefabObservation(applied, createUnityProjection(applied), observation).patches, []);
});

test("normalizes Animation Clip arrays when reconciling Unity values", () => {
  const document: UiConcreteSource = {
    ...source(),
    root: {
      ...source().root,
      components: { Animation: { clips: ["Animation/Idle.anim"] } },
      children: [],
    },
  };
  const projection = createUnityProjection(document);
  const observation = parsePrefabObservation({
    artifactKey: document.artifactKey,
    prefabPath: projection.prefabPath,
    issues: [],
    nodes: [
      {
        id: document.root.id,
        namePath: [projection.root.name],
        active: true,
        rect: projection.root.rect,
        components: { Animation: { defaultClip: "", clips: ["Assets/Resources/UI/Animation/Hit.anim", "Assets/Resources/UI/Animation/Break.anim"] } },
      },
    ],
  });

  const result = reconcilePrefabObservation(document, projection, observation);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(
    result.patches.map((patch) => [patch.field, patch.observed]),
    [["components.Animation.clips", ["Animation/Hit.anim", "Animation/Break.anim"]]],
  );
});

test("ignores Slider-driven anchor axes while reconciling other RectTransform changes", () => {
  const document: UiConcreteSource = {
    ...source(),
    root: {
      ...source().root,
      children: [
        {
          id: "slider",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [200, 24] },
          components: { Slider: { fillRect: "fill", handleRect: "handle", targetGraphic: "handle", value: 0.5 } },
          children: [
            {
              id: "fill",
              rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
              components: { Image: {} },
            },
            {
              id: "handle",
              rect: { anchorMin: [0, 0], anchorMax: [0, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [20, 0] },
              components: { Image: { raycastTarget: true } },
            },
          ],
        },
      ],
    },
  };
  const projection = createUnityProjection(document);
  const slider = projection.root.children[0]!;
  const fill = slider.children[0]!;
  const handle = slider.children[1]!;
  const observation = parsePrefabObservation({
    artifactKey: document.artifactKey,
    prefabPath: projection.prefabPath,
    issues: [],
    nodes: [
      { id: document.root.id, namePath: [projection.root.name], active: true, rect: projection.root.rect, components: {} },
      { id: slider.id, namePath: [projection.root.name, slider.name], active: true, rect: slider.rect, components: slider.components },
      {
        id: fill.id,
        namePath: [projection.root.name, slider.name, fill.name],
        active: true,
        rect: { ...fill.rect, anchorMax: [0.5, 0.75] },
        components: fill.components,
      },
      {
        id: handle.id,
        namePath: [projection.root.name, slider.name, handle.name],
        active: true,
        rect: { ...handle.rect, anchorMin: [0.5, 0], anchorMax: [0.5, 1] },
        components: handle.components,
      },
    ],
  });

  const result = reconcilePrefabObservation(document, projection, observation);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(
    result.patches.map((patch) => [patch.nodeId, patch.field, patch.observed]),
    [["fill", "rect.anchorMax", [1, 0.75]]],
  );
});

test("treats dependent Image enum defaults as roundtrip defaults", () => {
  const document: UiConcreteSource = {
    ...source(),
    root: { ...source().root, components: { Image: {} }, children: [] },
  };
  const projection = createUnityProjection(document);
  const observation = parsePrefabObservation({
    artifactKey: document.artifactKey,
    prefabPath: projection.prefabPath,
    issues: [],
    nodes: [
      {
        id: document.root.id,
        namePath: [document.root.id],
        active: true,
        rect: projection.root.rect,
        components: { Image: { ...(projection.root.components.Image as object), fillOrigin: "bottom" } },
      },
    ],
  });

  assert.deepEqual(reconcilePrefabObservation(document, projection, observation).patches, []);
});

test("reconciles every AutoLayoutGroup observed field and converges", () => {
  const document: UiConcreteSource = {
    ...source(),
    root: { ...source().root, components: { AutoLayoutGroup: { mode: "horizontal", gridSpacing: [2, 4] } }, children: [] },
  };
  const projection = createUnityProjection(document);
  const observedAuto = {
    ...(projection.root.components.AutoLayoutGroup as object),
    mode: "grid",
    padding: [3, 5, 7, 11],
    childAlignment: "lowerRight",
    spacing: 13,
    reverseArrangement: true,
    childControlWidth: true,
    childControlHeight: true,
    childScaleWidth: true,
    childScaleHeight: true,
    childForceExpandWidth: false,
    childForceExpandHeight: false,
    cellSize: [90, 44],
    gridSpacing: [6, 8],
    autoGrid: false,
    rowCount: 2,
    columnCount: 3,
    startCorner: "lowerRight",
    startAxis: "vertical",
  };
  const observation = parsePrefabObservation({
    artifactKey: document.artifactKey,
    prefabPath: projection.prefabPath,
    issues: [],
    nodes: [
      {
        id: document.root.id,
        namePath: [projection.root.name],
        active: true,
        rect: projection.root.rect,
        components: { AutoLayoutGroup: observedAuto },
      },
    ],
  });
  const result = reconcilePrefabObservation(document, projection, observation);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(
    result.patches.map((patch) => patch.field),
    Object.keys(observedAuto).map((field) => `components.AutoLayoutGroup.${field}`),
  );
  const applied = applyPrefabReconcilePatches(document, result);
  assert.deepEqual(reconcilePrefabObservation(applied, createUnityProjection(applied), observation).patches, []);
});

test("reconciles LayoutSettings fields and reaches an empty patch after apply", () => {
  const document: UiConcreteSource = {
    ...source(),
    root: {
      ...source().root,
      components: {
        ScrollRectEx: { content: "title", viewport: "title", templates: {} },
        LayoutSettings: { spacing: [8, 12], padding: [1, 2, 3, 4] },
      },
    },
  };
  const projection = createUnityProjection(document);
  const observation = parsePrefabObservation({
    artifactKey: document.artifactKey,
    prefabPath: projection.prefabPath,
    issues: [],
    nodes: [
      {
        id: "MainWidget",
        namePath: ["MainWidget"],
        active: true,
        rect: projection.root.rect,
        components: { LayoutSettings: { spacing: [99, 99] } },
      },
      {
        id: "title",
        namePath: ["MainWidget", "Title"],
        active: true,
        rect: projection.root.children[0]!.rect,
        components: {},
      },
    ],
  });

  const result = reconcilePrefabObservation(document, projection, observation);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(
    result.patches.map((patch) => patch.field),
    ["components.LayoutSettings.spacing"],
  );
  const applied = applyPrefabReconcilePatches(document, result);
  assert.deepEqual(applied.root.components?.LayoutSettings?.spacing, [99, 99]);
  const nextProjection = createUnityProjection(applied);
  const next = reconcilePrefabObservation(applied, nextProjection, observation);
  assert.deepEqual(next.issues, []);
  assert.deepEqual(next.patches, []);
});

test("normalizes null optional fields in Unity observation diagnostics", () => {
  const document = source();
  const projection = createUnityProjection(document);
  const observation = parsePrefabObservation({
    artifactKey: document.artifactKey,
    prefabPath: projection.prefabPath,
    nodes: [],
    bindings: [],
    diagnostics: [
      {
        code: "binding.componentUnsupported",
        message: "Binding uses an unsupported Unity type",
        path: "/prefab/bindings/unsupported",
        nodeId: null,
        componentType: "UnityEngine.UI.Shadow",
      },
    ],
    issues: [],
  });

  assert.deepEqual(observation.diagnostics, [
    {
      code: "binding.componentUnsupported",
      message: "Binding uses an unsupported Unity type",
      path: "/prefab/bindings/unsupported",
      componentType: "UnityEngine.UI.Shadow",
    },
  ]);
});

test("blocks observations with identity or structural issues", () => {
  const document = source();
  const projection = createUnityProjection(document);
  const observation = parsePrefabObservation({
    artifactKey: "OtherWidget",
    prefabPath: projection.prefabPath,
    issues: ["missing component"],
    nodes: [],
  });
  const result = reconcilePrefabObservation(document, projection, observation);
  assert.ok(result.issues.some((issue) => issue.includes("artifactKey mismatch")));
  assert.throws(() => applyPrefabReconcilePatches(document, result), /blocking issues/);
});

test("blocks observations whose stable id is paired with the wrong name path", () => {
  const document = source();
  const projection = createUnityProjection(document);
  const observation = parsePrefabObservation({
    artifactKey: "MainWidget",
    prefabPath: projection.prefabPath,
    issues: [],
    nodes: [
      { id: "MainWidget", namePath: ["MainWidget"], active: true, rect: projection.root.rect, components: {} },
      {
        id: "title",
        namePath: ["MainWidget", "Other"],
        active: true,
        rect: projection.root.children[0]!.rect,
        components: projection.root.children[0]!.components,
      },
    ],
  });
  const result = reconcilePrefabObservation(document, projection, observation);
  assert.ok(result.issues.some((issue) => issue.includes("namePath mismatch")));
});

test("applies reviewed structure and binding patches", () => {
  const document: UiConcreteSource = {
    ...source(),
    bindings: [{ name: "titleText", target: { nodeId: "title", componentType: "Text" } }],
    root: {
      ...source().root,
      children: [
        {
          ...source().root.children![0]!,
          components: { Text: { text: "Ready", fontSize: 24 } },
        },
      ],
    },
  };
  const projection = createUnityProjection(document);
  const observation = parsePrefabObservation({
    artifactKey: document.artifactKey,
    prefabPath: projection.prefabPath,
    issues: [],
    bindings: [{ fieldName: "unityTitle", nodeId: "title", componentType: "Text" }],
    nodes: [
      structuredObservation(projection.root, null, 0),
      {
        ...structuredObservation(projection.root.children[0]!, "container", 0),
        identity: "marker",
        name: "Unity Title",
        namePath: ["MainWidget", "Container", "Unity Title"],
      },
      {
        id: "container",
        identity: "generated",
        name: "Container",
        namePath: ["MainWidget", "Container"],
        parentId: "MainWidget",
        siblingIndex: 0,
        active: true,
        rect: {
          anchorMin: [0, 1],
          anchorMax: [0, 1],
          pivot: [0, 1],
          anchoredPosition: [4, -4],
          sizeDelta: [300, 160],
          rotation: 0,
          scale: [1, 1],
        },
        components: {},
        completeComponents: true,
        unityOnlyComponents: ["Game.LegacyBehaviour"],
      },
    ],
  });

  const result = reconcilePrefabObservation(document, projection, observation);
  assert.deepEqual(result.issues, []);
  assert.ok(result.patches.some((patch) => patch.kind === "node-add" && patch.nodeId === "container"));
  assert.ok(result.patches.some((patch) => patch.kind === "node-move" && patch.nodeId === "title"));
  assert.ok(result.patches.some((patch) => patch.kind === "node-name" && patch.nodeId === "title"));
  assert.ok(result.patches.some((patch) => patch.kind === "binding" && patch.risk === "review"));
  assert.deepEqual(result.unityOnlyComponents, [{ nodeId: "container", componentTypes: ["Game.LegacyBehaviour"] }]);

  const applied = applyPrefabReconcilePatches(document, result);
  assert.equal(applied.root.children?.[0]?.id, "container");
  assert.equal(applied.root.children?.[0]?.children?.[0]?.id, "title");
  assert.equal(applied.root.children?.[0]?.children?.[0]?.name, "Unity Title");
  assert.deepEqual(applied.bindings, [{ name: "unityTitle", target: { nodeId: "title", componentType: "Text" } }]);
  const withoutNamePatch = applyPrefabReconcilePatches(document, result, { skipNodeName: true });
  assert.equal(withoutNamePatch.root.children?.[0]?.children?.[0]?.name, undefined);
});

test("reconciles local component references by stable node id", () => {
  const document: UiConcreteSource = {
    ...source(),
    root: {
      ...source().root,
      components: { ButtonEx: { targetGraphic: "first" } },
      children: [
        { id: "first", rect: source().root.children![0]!.rect, components: { Image: {} } },
        { id: "second", rect: source().root.children![0]!.rect, components: { Image: {} } },
      ],
    },
  };
  const projection = createUnityProjection(document);
  const observation = parsePrefabObservation({
    artifactKey: document.artifactKey,
    prefabPath: projection.prefabPath,
    issues: [],
    nodes: [
      {
        ...structuredObservation(projection.root, null, 0),
        components: { ButtonEx: { ...(projection.root.components.ButtonEx as object), targetGraphic: "second" } },
      },
      structuredObservation(projection.root.children[0]!, document.root.id, 0),
      structuredObservation(projection.root.children[1]!, document.root.id, 1),
    ],
  });
  const result = reconcilePrefabObservation(document, projection, observation);
  assert.deepEqual(result.issues, []);
  assert.ok(result.patches.some((patch) => patch.field === "components.ButtonEx.targetGraphic" && patch.risk === "safe"));
  assert.equal(applyPrefabReconcilePatches(document, result).root.components?.ButtonEx?.targetGraphic, "second");
});

test("returns PrefabRef identity changes as reviewed Catalog-backed patches", () => {
  const child = (artifactKey: string): UiConcreteSource => ({
    ...source(),
    artifactKey,
    root: { ...source().root, id: artifactKey },
  });
  const document: UiConcreteSource = {
    ...source(),
    root: {
      ...source().root,
      children: [
        {
          id: "childWidget",
          rect: source().root.children![0]!.rect,
          components: { PrefabRef: { artifactKey: "FirstWidget" } },
        },
      ],
    },
  };
  const catalog = createSourceCatalog([
    { path: "MainWidget.ui.json", source: document },
    { path: "FirstWidget.ui.json", source: child("FirstWidget") },
    { path: "SecondWidget.ui.json", source: child("SecondWidget") },
  ]);
  const projection = createUnityProjection(catalog.entries.get(document.artifactKey)!, catalog);
  const observation = parsePrefabObservation({
    artifactKey: document.artifactKey,
    prefabPath: projection.prefabPath,
    issues: [],
    nodes: [
      structuredObservation(projection.root, null, 0),
      {
        ...structuredObservation(projection.root.children[0]!, document.root.id, 0),
        prefabPath: "Assets/Resources/UI/Prefab/Widget/SecondWidget/SecondWidget.prefab",
      },
    ],
  });
  const result = reconcilePrefabObservation(document, projection, observation, {
    artifactKeyByPrefabPath: new Map([
      ["Assets/Resources/UI/Prefab/Widget/FirstWidget/FirstWidget.prefab", "FirstWidget"],
      ["Assets/Resources/UI/Prefab/Widget/SecondWidget/SecondWidget.prefab", "SecondWidget"],
    ]),
  });
  assert.deepEqual(result.issues, []);
  assert.ok(result.patches.some((patch) => patch.kind === "prefab-ref" && patch.risk === "review"));
  assert.equal(applyPrefabReconcilePatches(document, result).root.children?.[0]?.components?.PrefabRef?.artifactKey, "SecondWidget");
});

test("reconciles PrefabRef component additions through create, update, remove, and no-op", () => {
  const { widgetType: artworkWidgetType, ...artworkFragmentBase } = source();
  void artworkWidgetType;
  const fragment: UiConcreteSource = {
    ...artworkFragmentBase,
    artifactKey: "ArtworkFragment",
    artifactType: "Fragment",
    root: {
      id: "ArtworkFragment",
      rect: source().root.rect,
      children: [{ id: "artwork", rect: source().root.children![0]!.rect, components: { Image: {} } }],
    },
  };
  const { initialSize: artworkInitialSize, widgetType: artworkCanvasWidgetType, ...artworkCanvasBase } = source();
  void artworkInitialSize;
  void artworkCanvasWidgetType;
  const canvas: UiConcreteSource = {
    ...artworkCanvasBase,
    artifactKey: "ArtworkCanvas",
    artifactType: "Canvas",
    root: {
      id: "ArtworkCanvas",
      rect: source().root.rect,
      children: [
        {
          id: "artworkUse",
          rect: source().root.children![0]!.rect,
          components: { PrefabRef: { artifactKey: "ArtworkFragment" } },
        },
      ],
    },
  };
  const project = (current: UiConcreteSource) => {
    const catalog = createSourceCatalog([
      { path: "ArtworkFragment.ui.json", source: fragment },
      { path: "ArtworkCanvas.ui.json", source: current },
    ]);
    return createUnityProjectionGraph(catalog, current.artifactKey).at(-1)!.projection;
  };
  const observation = (
    projection: ReturnType<typeof project>,
    addition?: {
      readonly componentType: "AspectRatioFitter" | "ShapeSoftMask";
      readonly value: Record<string, unknown>;
    },
  ) =>
    parsePrefabObservation({
      artifactKey: canvas.artifactKey,
      prefabPath: projection.prefabPath,
      issues: [],
      nodes: [
        structuredObservation(projection.root, null, 0),
        {
          ...structuredObservation(projection.root.children[0]!, canvas.root.id, 0),
          prefabPath: "Assets/Resources/UI/Prefab/ArtworkFragment.prefab",
        },
      ],
      componentAdditions:
        addition === undefined
          ? []
          : [
              {
                prefabRefNodeId: "artworkUse",
                target: { nodeId: "artwork" },
                componentType: addition.componentType,
                value: addition.value,
              },
            ],
    });

  const initialProjection = project(canvas);
  const createdResult = reconcilePrefabObservation(
    canvas,
    initialProjection,
    observation(initialProjection, { componentType: "AspectRatioFitter", value: { aspectMode: "fitInParent", aspectRatio: 1.5 } }),
  );
  assert.deepEqual(createdResult.issues, []);
  assert.equal(createdResult.patches[0]?.kind, "component-addition");
  const created = applyPrefabReconcilePatches(canvas, createdResult);
  assert.equal(
    (created.root.children![0]!.components!.PrefabRef!.componentAdditions![0]!.value as { aspectRatio: number }).aspectRatio,
    1.5,
  );

  const createdProjection = project(created);
  assert.deepEqual(
    reconcilePrefabObservation(
      created,
      createdProjection,
      observation(createdProjection, { componentType: "AspectRatioFitter", value: { aspectMode: "fitInParent", aspectRatio: 1.5 } }),
    ).patches,
    [],
  );
  const updatedResult = reconcilePrefabObservation(
    created,
    createdProjection,
    observation(createdProjection, { componentType: "AspectRatioFitter", value: { aspectMode: "fitInParent", aspectRatio: 2 } }),
  );
  const updated = applyPrefabReconcilePatches(created, updatedResult);
  assert.equal((updated.root.children![0]!.components!.PrefabRef!.componentAdditions![0]!.value as { aspectRatio: number }).aspectRatio, 2);

  const updatedProjection = project(updated);
  const removed = applyPrefabReconcilePatches(
    updated,
    reconcilePrefabObservation(updated, updatedProjection, observation(updatedProjection, undefined)),
  );
  assert.equal(removed.root.children![0]!.components!.PrefabRef!.componentAdditions, undefined);
  const removedProjection = project(removed);
  assert.deepEqual(reconcilePrefabObservation(removed, removedProjection, observation(removedProjection)).patches, []);

  const shapeResult = reconcilePrefabObservation(
    canvas,
    initialProjection,
    observation(initialProjection, {
      componentType: "ShapeSoftMask",
      value: { shape: "Circle", radialSoftness: 6, falloff: 1.5 },
    }),
  );
  assert.deepEqual(shapeResult.issues, []);
  assert.equal(shapeResult.patches[0]?.kind, "component-addition");
  const withShape = applyPrefabReconcilePatches(canvas, shapeResult);
  assert.deepEqual(withShape.root.children![0]!.components!.PrefabRef!.componentAdditions?.[0], {
    target: { nodeId: "artwork" },
    componentType: "ShapeSoftMask",
    value: { shape: "Circle", radialSoftness: 6, falloff: 1.5 },
  });
  const shapeProjection = project(withShape);
  assert.deepEqual(
    reconcilePrefabObservation(
      withShape,
      shapeProjection,
      observation(shapeProjection, {
        componentType: "ShapeSoftMask",
        value: { shape: "Circle", radialSoftness: 6, falloff: 1.5 },
      }),
    ).patches,
    [],
  );
});

test("applies local child additions, moves, and removals under PrefabRef use sites", () => {
  const { widgetType: emptyWidgetType, ...emptyFragmentBase } = source();
  void emptyWidgetType;
  const fragment: UiConcreteSource = {
    ...emptyFragmentBase,
    artifactKey: "EmptyFragment",
    artifactType: "Fragment",
    root: { id: "EmptyFragment", rect: source().root.rect },
  };
  const { initialSize: localInitialSize, widgetType: localCanvasWidgetType, ...localCanvasBase } = source();
  void localInitialSize;
  void localCanvasWidgetType;
  const canvas: UiConcreteSource = {
    ...localCanvasBase,
    artifactKey: "LocalChildCanvas",
    artifactType: "Canvas",
    root: {
      id: "LocalChildCanvas",
      rect: source().root.rect,
      children: [
        { id: "fragmentUse", rect: source().root.children![0]!.rect, components: { PrefabRef: { artifactKey: "EmptyFragment" } } },
        { id: "caption", rect: source().root.children![0]!.rect, components: { Text: { text: "Caption", fontSize: 14 } } },
      ],
    },
  };
  const project = (current: UiConcreteSource) => {
    const catalog = createSourceCatalog([
      { path: "EmptyFragment.ui.json", source: fragment },
      { path: "LocalChildCanvas.ui.json", source: current },
    ]);
    return createUnityProjectionGraph(catalog, current.artifactKey).at(-1)!.projection;
  };
  const projection = project(canvas);
  const addedObservation = parsePrefabObservation({
    artifactKey: canvas.artifactKey,
    prefabPath: projection.prefabPath,
    issues: [],
    nodes: [
      structuredObservation(projection.root, null, 0),
      {
        ...structuredObservation(projection.root.children[0]!, canvas.root.id, 0),
        prefabPath: "Assets/Resources/UI/Prefab/EmptyFragment.prefab",
      },
      {
        ...structuredObservation(projection.root.children[1]!, "fragmentUse", 0),
        namePath: ["LocalChildCanvas", "FragmentUse", "Caption"],
      },
      {
        id: "localAccent",
        identity: "marker",
        name: "LocalAccent",
        namePath: ["LocalChildCanvas", "FragmentUse", "LocalAccent"],
        parentId: "fragmentUse",
        siblingIndex: 1,
        active: true,
        rect: projection.root.children[1]!.rect,
        components: { Image: { color: "#FFFFFFFF" } },
        completeComponents: true,
        unityOnlyComponents: [],
      },
    ],
  });
  const movedAndAdded = applyPrefabReconcilePatches(canvas, reconcilePrefabObservation(canvas, projection, addedObservation));
  assert.deepEqual(
    movedAndAdded.root.children![0]!.children?.map((node) => node.id),
    ["caption", "localAccent"],
  );

  const nextProjection = project(movedAndAdded);
  const removedObservation = parsePrefabObservation({
    ...addedObservation,
    nodes: [
      structuredObservation(nextProjection.root, null, 0),
      {
        ...structuredObservation(nextProjection.root.children[0]!, movedAndAdded.root.id, 0),
        prefabPath: "Assets/Resources/UI/Prefab/EmptyFragment.prefab",
      },
      {
        ...structuredObservation(nextProjection.root.children[0]!.children[0]!, "fragmentUse", 0),
        namePath: ["LocalChildCanvas", "FragmentUse", "Caption"],
      },
    ],
  });
  const removed = applyPrefabReconcilePatches(movedAndAdded, reconcilePrefabObservation(movedAndAdded, nextProjection, removedObservation));
  assert.deepEqual(
    removed.root.children![0]!.children?.map((node) => node.id),
    ["caption"],
  );
});

test("reconciles nested Fragment binding rename, add, remove, and second-pass no-op", () => {
  const { widgetType: badgeWidgetType, ...fragmentBase } = source();
  void badgeWidgetType;
  const fragment: UiConcreteSource = {
    ...fragmentBase,
    artifactKey: "BadgeFragment",
    artifactType: "Fragment",
    root: {
      id: "BadgeFragment",
      rect: source().root.rect,
      components: { StateRoot: { currentState: "visible", states: { visible: {} }, elements: [] } },
      children: [
        { id: "img_badge", name: "img_badge", rect: source().root.children![0]!.rect, components: { Image: {} } },
        { id: "txt_badge", name: "txt_badge", rect: source().root.children![0]!.rect, components: { Text: { text: "Badge", fontSize: 16 } } },
      ],
    },
  };
  const { initialSize: profileInitialSize, widgetType: profileCanvasWidgetType, ...canvasBase } = source();
  void profileInitialSize;
  void profileCanvasWidgetType;
  const canvas: UiConcreteSource = {
    ...canvasBase,
    artifactKey: "ProfileCanvas",
    artifactType: "Canvas",
    bindings: [
      { name: "img_badge", target: { instancePath: ["badge"], nodeId: "img_badge", componentType: "Image" } },
    ],
    root: {
      id: "ProfileCanvas",
      rect: source().root.rect,
      children: [
        {
          id: "badge",
          rect: source().root.children![0]!.rect,
          components: {
            PrefabRef: { artifactKey: "BadgeFragment" },
          },
        },
      ],
    },
  };
  const catalog = createSourceCatalog([
    { path: "BadgeFragment.ui.json", source: fragment },
    { path: "ProfileCanvas.ui.json", source: canvas },
  ]);
  const projection = createUnityProjectionGraph(catalog, canvas.artifactKey).at(-1)!.projection;
  const changed = parsePrefabObservation({
    artifactKey: canvas.artifactKey,
    prefabPath: projection.prefabPath,
    issues: [],
    nodes: [
      { id: "ProfileCanvas", namePath: ["ProfileCanvas"], active: true, rect: projection.root.rect, components: {} },
      {
        id: "badge",
        namePath: ["ProfileCanvas", "Badge"],
        active: true,
        rect: projection.root.children[0]!.rect,
        components: {},
        prefabPath: "Assets/Resources/UI/Prefab/BadgeFragment.prefab",
      },
    ],
    bindings: [
      { fieldName: "txt_badge", prefabRefNodeId: "badge", instancePath: [], nodeId: "txt_badge", componentType: "Text" },
    ],
  });
  const changedResult = reconcilePrefabObservation(canvas, projection, changed);
  assert.deepEqual(changedResult.issues, []);
  assert.deepEqual(
    changedResult.patches.map((patch) => patch.field),
    ["bindings"],
  );
  const applied = applyPrefabReconcilePatches(canvas, changedResult);
  assert.deepEqual(applied.bindings, [
    { name: "txt_badge", target: { instancePath: ["badge"], nodeId: "txt_badge", componentType: "Text" } },
  ]);

  const appliedCatalog = createSourceCatalog([
    { path: "BadgeFragment.ui.json", source: fragment },
    { path: "ProfileCanvas.ui.json", source: applied },
  ]);
  const appliedProjection = createUnityProjectionGraph(appliedCatalog, applied.artifactKey).at(-1)!.projection;
  assert.deepEqual(reconcilePrefabObservation(applied, appliedProjection, changed).patches, []);

  const removed = parsePrefabObservation({ ...changed, bindings: [] });
  const removedResult = reconcilePrefabObservation(applied, appliedProjection, removed);
  assert.deepEqual(removedResult.issues, []);
  assert.equal(applyPrefabReconcilePatches(applied, removedResult).bindings, undefined);
});

test("reconciles StateRoot states and elements as complete Source-owned values", () => {
  const document = source();
  document.root.children![0]!.components!.Image = {};
  document.root.components = {
    StateRoot: {
      currentState: "normal",
      states: { normal: { title: true }, hidden: { title: false } },
      elements: [
        { targetNodeId: "title", elementType: "UTMP_Text", values: { normal: "Ready", hidden: "Hidden" } },
        {
          targetNodeId: "title",
          elementType: "USprite",
          values: {
            normal: { sprite: "Generated/Shapes/Round12.png", setNativeSize: false },
            hidden: { sprite: null, setNativeSize: false },
          },
        },
      ],
    },
  };
  const projection = createUnityProjection(document);
  const observation = parsePrefabObservation({
    artifactKey: document.artifactKey,
    prefabPath: projection.prefabPath,
    issues: [],
    nodes: [
      {
        id: document.root.id,
        namePath: [document.root.id],
        active: true,
        rect: projection.root.rect,
        components: {
          StateRoot: {
            currentState: "hidden",
            states: { normal: { title: false }, hidden: { title: true } },
            elements: [
              { targetNodeId: "title", elementType: "UTMP_Text", values: { normal: "Online", hidden: "Offline" } },
              {
                targetNodeId: "title",
                elementType: "USprite",
                values: {
                  normal: { sprite: "Assets/Resources/UI/Generated/Shapes/Round20.png", setNativeSize: true },
                  hidden: { sprite: null, setNativeSize: false },
                },
              },
            ],
            interactable: true,
          },
        },
      },
      {
        id: "title",
        namePath: [document.root.id, "Title"],
        active: true,
        rect: projection.root.children[0]!.rect,
        components: projection.root.children[0]!.components,
      },
    ],
  });
  const result = reconcilePrefabObservation(document, projection, observation);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(
    result.patches.map((patch) => patch.field),
    ["components.StateRoot.currentState", "components.StateRoot.states", "components.StateRoot.elements"],
  );
  const applied = applyPrefabReconcilePatches(document, result);
  assert.equal(applied.root.components?.StateRoot?.currentState, "hidden");
  assert.equal(applied.root.components?.StateRoot?.elements?.[0]?.values.hidden, "Offline");
  assert.deepEqual(applied.root.components?.StateRoot?.elements?.[1]?.values.normal, {
    sprite: "Generated/Shapes/Round20.png",
    setNativeSize: true,
  });
  const nextProjection = createUnityProjection(applied);
  assert.deepEqual(reconcilePrefabObservation(applied, nextProjection, observation).patches, []);
});

test("reconciles ScrollRectEx template maps by stable PrefabRef node id", () => {
  const row = source();
  row.artifactKey = "RowWidget";
  row.root.id = "RowWidget";
  const list = source();
  list.artifactKey = "ListWidget";
  list.root.id = "ListWidget";
  list.root.components = { ScrollRectEx: { content: "content", viewport: "viewport", templates: { Row: "firstTemplate" } } };
  list.root.children = [
    { id: "viewport", rect: source().root.children![0]!.rect },
    { id: "content", rect: source().root.children![0]!.rect },
    { id: "firstTemplate", rect: source().root.children![0]!.rect, components: { PrefabRef: { artifactKey: "RowWidget" } } },
    { id: "secondTemplate", rect: source().root.children![0]!.rect, components: { PrefabRef: { artifactKey: "RowWidget" } } },
  ];
  const catalog = createSourceCatalog([
    { path: "RowWidget.ui.json", source: row },
    { path: "ListWidget.ui.json", source: list },
  ]);
  const projection = createUnityProjectionGraph(catalog, list.artifactKey).at(-1)!.projection;
  const observation = parsePrefabObservation({
    artifactKey: list.artifactKey,
    prefabPath: projection.prefabPath,
    issues: [],
    nodes: [
      {
        id: "ListWidget",
        namePath: ["ListWidget"],
        active: true,
        rect: projection.root.rect,
        components: { ScrollRectEx: { ...(projection.root.components.ScrollRectEx as object), templates: { Row: "secondTemplate" } } },
      },
      ...projection.root.children.map((node) => ({
        id: node.id,
        namePath: ["ListWidget", node.name],
        active: node.active,
        rect: node.rect,
        components: {},
        ...((node.components.PrefabRef as { prefabPath?: string } | undefined)?.prefabPath
          ? { prefabPath: (node.components.PrefabRef as { prefabPath: string }).prefabPath }
          : {}),
      })),
    ],
  });
  const result = reconcilePrefabObservation(list, projection, observation);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(
    result.patches.map((patch) => patch.field),
    ["components.ScrollRectEx.templates"],
  );
  const applied = applyPrefabReconcilePatches(list, result);
  assert.equal(applied.root.components?.ScrollRectEx?.templates.Row, "secondTemplate");
  const nextCatalog = createSourceCatalog([
    { path: "RowWidget.ui.json", source: row },
    { path: "ListWidget.ui.json", source: applied },
  ]);
  const nextProjection = createUnityProjectionGraph(nextCatalog, applied.artifactKey).at(-1)!.projection;
  assert.deepEqual(reconcilePrefabObservation(applied, nextProjection, observation).patches, []);
});

function structuredObservation(node: ReturnType<typeof createUnityProjection>["root"], parentId: string | null, siblingIndex: number) {
  return {
    id: node.id,
    identity: "marker",
    name: node.name,
    namePath: parentId === null ? [node.name] : ["MainWidget", node.name],
    parentId,
    siblingIndex,
    active: node.active,
    rect: node.rect,
    components: node.components,
    completeComponents: true,
    unityOnlyComponents: [],
  };
}
