import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatSource } from "../../src/kernel/canonical.js";
import { applyPrefabReconcilePatches, parsePrefabObservation, reconcilePrefabObservation } from "../../src/kernel/prefab-observation.js";
import type { ProjectionNode } from "../../src/kernel/projection.js";
import { createUnityProjection } from "../../src/kernel/projection.js";
import { createUnityProjectionGraph } from "../../src/kernel/projection-graph.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import { validateSource } from "../../src/kernel/validation.js";
import type { UiConcreteSource, UiVariantSource } from "../../src/schema/ui-source-schema.js";
import { Inspector } from "../../src/web/editors/artifact/inspector/artifact-inspector.js";

function rect(width = 320, height = 80) {
  return {
    anchorMin: [0.5, 0.5] as [number, number],
    anchorMax: [0.5, 0.5] as [number, number],
    pivot: [0.5, 0.5] as [number, number],
    anchoredPosition: [0, 0] as [number, number],
    sizeDelta: [width, height] as [number, number],
  };
}

function buttonSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "ActionWidget",
    artifactType: "Widget",
    widgetType: "ActionWidget",
    initialSize: [320, 80],
    root: {
      id: "ActionWidget",
      rect: rect(),
      components: {
        Image: {},
        ButtonEx: {
          targetGraphic: "ActionWidget",
          usePressFeedback: true,
          pressFeedbackScale: 0.9,
          pressFeedbackScaleTarget: "scaleTarget",
          pressFeedbackActiveTarget: "activeTarget",
          useClickInterval: true,
          clickInterval: 0.45,
          useDoubleClick: true,
          useLongPress: true,
          longPressThreshold: 0.8,
          longPressInterval: 0.2,
        },
      },
      children: [
        { id: "scaleTarget", rect: rect(280, 60) },
        { id: "activeTarget", rect: rect(24, 24) },
      ],
    },
  };
}

function observationNodes(node: ProjectionNode, parentPath: readonly string[] = []): unknown[] {
  const namePath = [...parentPath, node.name];
  const button = node.components.ButtonEx as Record<string, unknown> | undefined;
  return [
    {
      id: node.id,
      namePath,
      active: node.active,
      rect: node.rect,
      components: button
        ? {
            ButtonEx: Object.fromEntries(
              Object.entries(button).filter(
                ([field]) => !["targetGraphic", "pressFeedbackScaleTarget", "pressFeedbackActiveTarget"].includes(field),
              ),
            ),
          }
        : {},
    },
    ...node.children.flatMap((child) => observationNodes(child, namePath)),
  ];
}

test("projects the supported ButtonEx interaction fields with ActivityTab-style values", () => {
  const source = buttonSource();
  assert.equal(validateSource(source).valid, true);
  const button = createUnityProjection(source).root.components.ButtonEx as Record<string, unknown>;
  assert.deepEqual(button, {
    targetGraphic: "ActionWidget",
    interactable: true,
    transition: "none",
    highlightedSprite: null,
    pressedSprite: null,
    selectedSprite: null,
    disabledSprite: null,
    usePressFeedback: true,
    pressFeedbackScale: 0.9,
    pressFeedbackScaleTarget: "scaleTarget",
    pressFeedbackActiveTarget: "activeTarget",
    useClickInterval: true,
    clickInterval: 0.45,
    useDoubleClick: true,
    useLongPress: true,
    longPressThreshold: 0.8,
    longPressInterval: 0.2,
  });
});

test("projects the fixed ButtonEx transition policy and clears every Unity SpriteState field", () => {
  const source = buttonSource();

  const projection = createUnityProjection(source);
  const button = projection.root.components.ButtonEx as Record<string, unknown>;
  assert.equal(button.interactable, true);
  assert.equal(button.transition, "none");
  assert.equal(button.highlightedSprite, null);
  assert.equal(button.pressedSprite, null);
  assert.equal(button.selectedSprite, null);
  assert.equal(button.disabledSprite, null);

  const manifest = projection.componentManifest.components.find((component) => component.key === "ButtonEx")!;
  assert.deepEqual(
    manifest.fields.find((field) => field.property === "transition"),
    {
      property: "transition",
      path: "m_Transition",
      codec: "enum",
      enumValues: { none: 0, colorTint: 1, spriteSwap: 2, animation: 3 },
    },
  );
  assert.deepEqual(
    manifest.fields.filter((field) => field.property.endsWith("Sprite")).map(({ property, path, codec }) => ({ property, path, codec })),
    [
      { property: "highlightedSprite", path: "m_SpriteState.m_HighlightedSprite", codec: "asset" },
      { property: "pressedSprite", path: "m_SpriteState.m_PressedSprite", codec: "asset" },
      { property: "selectedSprite", path: "m_SpriteState.m_SelectedSprite", codec: "asset" },
      { property: "disabledSprite", path: "m_SpriteState.m_DisabledSprite", codec: "asset" },
    ],
  );
});

test("projects ButtonEx target graphics as raycast targets without changing Source defaults", () => {
  const document = buttonSource();
  const projected = createUnityProjection(document);
  assert.equal((projected.root.components.Image as { raycastTarget?: unknown }).raycastTarget, true);
  assert.equal(document.root.components?.Image?.raycastTarget, undefined);
});

test("strips ButtonEx defaults from canonical Source without changing Projection defaults", () => {
  const source = buttonSource();
  source.root.components!.ButtonEx = {
    targetGraphic: "ActionWidget",
    interactable: true,
    transition: "none",
    highlightedSprite: null,
    pressedSprite: null,
    selectedSprite: null,
    disabledSprite: null,
    usePressFeedback: false,
    pressFeedbackScale: 0.95,
    pressFeedbackScaleTarget: null,
    pressFeedbackActiveTarget: null,
    useClickInterval: false,
    clickInterval: 0.3,
    useDoubleClick: false,
    useLongPress: false,
    longPressThreshold: 0.7,
    longPressInterval: 0.1,
  };
  const formatted = formatSource(source);
  for (const field of [
    "interactable",
    "transition",
    "usePressFeedback",
    "highlightedSprite",
    "pressedSprite",
    "selectedSprite",
    "disabledSprite",
    "pressFeedbackScale",
    "pressFeedbackScaleTarget",
    "pressFeedbackActiveTarget",
    "useClickInterval",
    "clickInterval",
    "useDoubleClick",
    "useLongPress",
    "longPressThreshold",
    "longPressInterval",
  ]) {
    assert.doesNotMatch(formatted, new RegExp(`"${field}"`));
  }
  assert.deepEqual(createUnityProjection(source).root.components.ButtonEx, {
    targetGraphic: "ActionWidget",
    interactable: true,
    transition: "none",
    highlightedSprite: null,
    pressedSprite: null,
    selectedSprite: null,
    disabledSprite: null,
    usePressFeedback: false,
    pressFeedbackScale: 0.95,
    pressFeedbackScaleTarget: null,
    pressFeedbackActiveTarget: null,
    useClickInterval: false,
    clickInterval: 0.3,
    useDoubleClick: false,
    useLongPress: false,
    longPressThreshold: 0.7,
    longPressInterval: 0.1,
  });
});

test("validates ButtonEx feedback targets as local node references", () => {
  const source = buttonSource();
  source.root.components!.ButtonEx!.pressFeedbackScaleTarget = "missingScaleTarget";
  source.root.components!.ButtonEx!.pressFeedbackActiveTarget = "missingActiveTarget";
  const issues = validateSource(source).issues;
  assert.ok(issues.some((issue) => issue.path.endsWith("pressFeedbackScaleTarget")));
  assert.ok(issues.some((issue) => issue.path.endsWith("pressFeedbackActiveTarget")));
});

test("rejects project-disabled ButtonEx state and Sprite Swap values", () => {
  const source = buttonSource();
  Object.assign(source.root.components!.ButtonEx as Record<string, unknown>, {
    interactable: false,
    transition: "spriteSwap",
    disabledSprite: "Buttons/Disabled.png",
  });
  const issues = validateSource(source).issues;
  assert.ok(issues.some((issue) => issue.path.endsWith("interactable")));
  assert.ok(issues.some((issue) => issue.path.endsWith("transition")));
  assert.ok(issues.some((issue) => issue.path.endsWith("disabledSprite")));
});

test("reconciles all non-reference ButtonEx fields from prefab observation", () => {
  const source = buttonSource();
  const projection = createUnityProjection(source);
  const nodes = observationNodes(projection.root) as Array<{ id: string; components: Record<string, Record<string, unknown>> }>;
  const observed = nodes.find((node) => node.id === "ActionWidget")!.components.ButtonEx!;
  Object.assign(observed, {
    usePressFeedback: false,
    pressFeedbackScale: 0.85,
    useClickInterval: false,
    clickInterval: 0.6,
    useDoubleClick: false,
    useLongPress: false,
    longPressThreshold: 0.9,
    longPressInterval: 0.25,
  });
  const observation = parsePrefabObservation({
    artifactKey: source.artifactKey,
    prefabPath: projection.prefabPath,
    localWidgetType: projection.localWidgetType,
    effectiveWidgetType: projection.effectiveWidgetType,
    nodes,
    issues: [],
  });
  const result = reconcilePrefabObservation(source, projection, observation);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(
    result.patches.map((patch) => patch.field),
    [
      "components.ButtonEx.clickInterval",
      "components.ButtonEx.longPressInterval",
      "components.ButtonEx.longPressThreshold",
      "components.ButtonEx.pressFeedbackScale",
      "components.ButtonEx.useClickInterval",
      "components.ButtonEx.useDoubleClick",
      "components.ButtonEx.useLongPress",
      "components.ButtonEx.usePressFeedback",
    ],
  );
  const applied = applyPrefabReconcilePatches(source, result).root.components!.ButtonEx!;
  assert.equal(applied.pressFeedbackScale, 0.85);
  assert.equal(applied.clickInterval, 0.6);
  assert.equal(applied.useDoubleClick, false);
  assert.equal(applied.longPressThreshold, 0.9);
  assert.equal(applied.longPressInterval, 0.25);
});

test("ignores project-disabled ButtonEx fields from prefab observation", () => {
  const source = buttonSource();
  const projection = createUnityProjection(source);
  const nodes = observationNodes(projection.root) as Array<{ id: string; components: Record<string, Record<string, unknown>> }>;
  Object.assign(nodes.find((node) => node.id === "ActionWidget")!.components.ButtonEx!, {
    interactable: false,
    transition: "spriteSwap",
    highlightedSprite: "Assets/Resources/UI/Buttons/Highlighted.png",
    pressedSprite: "Assets/Resources/UI/Buttons/Pressed.png",
    selectedSprite: "Assets/Resources/UI/Buttons/Selected.png",
    disabledSprite: "Assets/Resources/UI/Buttons/Disabled.png",
  });
  const observation = parsePrefabObservation({
    artifactKey: source.artifactKey,
    prefabPath: projection.prefabPath,
    localWidgetType: projection.localWidgetType,
    effectiveWidgetType: projection.effectiveWidgetType,
    nodes,
    issues: [],
  });
  const result = reconcilePrefabObservation(source, projection, observation);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.patches, []);
});

test("normalizes project-disabled fields on a Unity-added ButtonEx", () => {
  const source = buttonSource();
  const projection = createUnityProjection(source);
  const nodes = observationNodes(projection.root);
  nodes.push({
    id: "unityAddedButton",
    identity: "generated",
    name: "Unity Added Button",
    namePath: ["ActionWidget", "Unity Added Button"],
    parentId: "ActionWidget",
    siblingIndex: projection.root.children.length,
    active: true,
    rect: rect(80, 32),
    components: {
      ButtonEx: {
        targetGraphic: "ActionWidget",
        interactable: true,
        transition: "colorTint",
        highlightedSprite: null,
        pressedSprite: null,
        selectedSprite: null,
        disabledSprite: null,
      },
    },
    completeComponents: true,
    unityOnlyComponents: [],
  });
  const observation = parsePrefabObservation({
    artifactKey: source.artifactKey,
    prefabPath: projection.prefabPath,
    localWidgetType: projection.localWidgetType,
    effectiveWidgetType: projection.effectiveWidgetType,
    nodes,
    issues: [],
  });

  const result = reconcilePrefabObservation(source, projection, observation);
  assert.deepEqual(result.issues, []);
  assert.ok(result.patches.some((patch) => patch.kind === "node-add" && patch.nodeId === "unityAddedButton"));

  const applied = applyPrefabReconcilePatches(source, result);
  const added = applied.root.children?.find((node) => node.id === "unityAddedButton");
  assert.equal(added?.components?.ButtonEx?.targetGraphic, "ActionWidget");
  const canonical = formatSource(applied);
  assert.doesNotMatch(canonical, /"interactable"|"transition"|"highlightedSprite"|"pressedSprite"|"selectedSprite"|"disabledSprite"/);

  const canonicalSource = JSON.parse(canonical) as UiConcreteSource;
  assert.deepEqual(createUnityProjection(canonicalSource).root.children.find((node) => node.id === "unityAddedButton")?.components.ButtonEx, {
    targetGraphic: "ActionWidget",
    interactable: true,
    transition: "none",
    highlightedSprite: null,
    pressedSprite: null,
    selectedSprite: null,
    disabledSprite: null,
    usePressFeedback: false,
    pressFeedbackScale: 0.95,
    pressFeedbackScaleTarget: null,
    pressFeedbackActiveTarget: null,
    useClickInterval: false,
    clickInterval: 0.3,
    useDoubleClick: false,
    useLongPress: false,
    longPressThreshold: 0.7,
    longPressInterval: 0.1,
  });
});

test("projects ButtonEx node-reference overrides as structured targets", () => {
  const base = buttonSource();
  const variant: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: "AlternateActionWidget",
    artifactType: "Widget",
    variantOf: base.artifactKey,
    overrides: [
      { target: { nodeId: "ActionWidget", componentType: "ButtonEx", fieldPath: "pressFeedbackScaleTarget" }, value: "activeTarget" },
      { target: { nodeId: "ActionWidget", componentType: "ButtonEx", fieldPath: "pressFeedbackActiveTarget" }, value: null },
    ],
  };
  const catalog = createSourceCatalog([
    { path: "ActionWidget.ui.json", source: base },
    { path: "AlternateActionWidget.ui.json", source: variant },
  ]);
  const projection = createUnityProjectionGraph(catalog, variant.artifactKey).at(-1)!.projection;
  assert.deepEqual(
    projection.propertyOverrides.map((override) => [override.fieldPath, override.value]),
    [
      ["pressFeedbackScaleTarget", { instancePath: [], nodeId: "activeTarget", nodePath: ["activeTarget"], siblingPath: [1] }],
      ["pressFeedbackActiveTarget", null],
    ],
  );
});

test("renders the supported ButtonEx interaction fields in the shared Inspector", () => {
  const source = buttonSource();
  const markup = renderToStaticMarkup(
    createElement(Inspector, {
      source,
      node: source.root,
      catalog: { artifacts: [], references: [], prototypes: [] },
      assets: [],
      onRefreshAssets: async () => {},
      onUpdate: () => {},
      stateOverrides: {},
      onStatePreview: () => {},
      onOpenArtifact: () => {},
    }),
  );
  for (const label of [
    "Interactable",
    "Transition",
    "Disabled Sprite",
    "Use Press Feedback",
    "Press Feedback Scale",
    "Press Feedback Scale Target",
    "Press Feedback Active Target",
    "Use Click Interval",
    "Click Interval",
    "Use Double Click",
    "Use Long Press",
    "Long Press Threshold",
    "Long Press Interval",
  ]) {
    assert.match(markup, new RegExp(label));
  }
  assert.match(markup, /项目内禁用：按钮可用性由 StateRoot 的 UGray 与 UInteractable 控制/);
  assert.match(markup, /项目内禁用：每种按钮视觉样式使用独立 Prefab/);
});
