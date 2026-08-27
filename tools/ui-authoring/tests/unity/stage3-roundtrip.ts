import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { applyPrefabReconcilePatches, parsePrefabObservation, reconcilePrefabObservation } from "../../src/kernel/prefab-observation.js";
import type { UnityProjection } from "../../src/kernel/projection.js";
import { formatProjection } from "../../src/kernel/projection.js";
import { createUnityProjectionGraph } from "../../src/kernel/projection-graph.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import { walkNodes } from "../../src/kernel/tree.js";
import { validateSource } from "../../src/kernel/validation.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { WorkspaceUnityJobExecutor } from "../../src/server/unity-job-service.js";
import { workspacePaths } from "../../src/server/workspace.js";

const paths = await workspacePaths();
const documents = stage3Documents();
const source = documents.at(-1)!;
assert.deepEqual(
  documents.flatMap((document) => validateSource(document).issues),
  [],
);

const firstRun = await executeGraphJob("stage3-roundtrip-test", documents, `stage3-${randomUUID()}`);
const baseline = parsePrefabObservation(firstRun.response.baselineObservation);
const changed = parsePrefabObservation(firstRun.response.observation);
const blockers = parsePrefabObservation(firstRun.response.blockerObservation);
const baselineResult = reconcilePrefabObservation(source, firstRun.rootProjection, baseline, {
  artifactKeyByPrefabPath: firstRun.artifactKeyByPrefabPath,
});
assert.deepEqual(baselineResult.issues, []);
assert.deepEqual(baselineResult.patches, []);

const changedResult = reconcilePrefabObservation(source, firstRun.rootProjection, changed, {
  artifactKeyByPrefabPath: firstRun.artifactKeyByPrefabPath,
});
assert.deepEqual(changedResult.issues, []);
for (const field of [
  "components.Slider.fillRect",
  "components.Slider.targetGraphic",
  "components.TMPDropdown.captionText",
  "components.ScrollRect.horizontal",
  "components.StateRoot.states",
  "components.StateRoot.elements",
  "components.StateToggle.selectedIndices",
  "components.ScrollRectEx.templates",
  "components.LayoutSettings.padding",
  "bindings",
  "components.PrefabRef.componentAdditions",
  "components.Animator.controller",
  "components.Animator.updateMode",
]) {
  assert.ok(
    changedResult.patches.some((patch) => patch.field === field),
    `missing Stage 3 roundtrip patch: ${field}`,
  );
}

const applied = applyPrefabReconcilePatches(source, changedResult);
const appliedNodes = new Map(walkNodes(applied).map(({ node }) => [node.id, node]));
assert.deepEqual(appliedNodes.get("stateToggle")?.components?.StateToggle?.selectedIndices, [0, 1]);
assert.deepEqual(appliedNodes.get("scrollEx")?.components?.ScrollRectEx?.templates, {
  StageThreeSecondaryTemplateWidget: "alternateTemplate",
  StageThreePrimaryTemplateWidget: "templateItem",
});
assert.deepEqual(
  {
    txtInnerAlternateText: applied.bindings?.find((binding) => binding.name === "txt_inner_alternate_text")?.target,
    imgInnerImage: applied.bindings?.find((binding) => binding.name === "img_inner_image")?.target,
    goInnerObject: applied.bindings?.find((binding) => binding.name === "go_inner_object")?.target,
  },
  {
    txtInnerAlternateText: { instancePath: ["outerFragment", "innerPrefabRef"], nodeId: "innerAlternateText", componentType: "Text" },
    imgInnerImage: { instancePath: ["outerFragment", "innerPrefabRef"], nodeId: "innerImage", componentType: "Image" },
    goInnerObject: { instancePath: ["outerFragment", "innerPrefabRef"], nodeId: "innerObject", componentType: "GameObject" },
  },
);
assert.equal(
  applied.bindings?.find((binding) => binding.name === "txt_inner_text"),
  undefined,
);
assert.deepEqual(
  appliedNodes.get("outerFragment")?.components?.PrefabRef?.componentAdditions?.map((addition) => ({
    target: addition.target,
    componentType: addition.componentType,
    value: addition.value,
  })),
  [
    {
      target: { nodeId: "outerArtwork" },
      componentType: "AspectRatioFitter",
      value: { aspectMode: "fitInParent", aspectRatio: 2.25 },
    },
    {
      target: { instancePath: ["innerPrefabRef"], nodeId: "innerText" },
      componentType: "LayoutElement",
      value: {
        ignoreLayout: false,
        maxWidth: 132,
        preferredWidth: 144,
        layoutPriority: 1,
      },
    },
  ],
);
assert.equal(appliedNodes.has("localAccent"), false);
assert.equal(appliedNodes.get("unityLocalChild")?.components?.Image?.color, "#336699FF");
assert.equal(
  appliedNodes.get("unityLocalChild") && walkNodes(applied).find(({ node }) => node.id === "unityLocalChild")?.parent?.id,
  "outerFragment",
);
assert.equal(appliedNodes.get("animator")?.components?.Animator?.controller, "_UnityTests/Stage3Assets/Changed.controller");
assert.equal(appliedNodes.get("animator")?.components?.Animator?.updateMode, "fixed");
const appliedStateElements = appliedNodes.get("stateRoot")?.components?.StateRoot?.elements ?? [];
assert.deepEqual(
  new Set(appliedStateElements.map((element) => element.elementType)),
  new Set([
    "ULocalPos",
    "UPivot",
    "UAnchorsMin",
    "UAnchorsMax",
    "ULocalPosX",
    "ULocalPosY",
    "UWidth",
    "UHeight",
    "UTMP_Text",
    "UTMP_FontSize",
    "USprite",
    "UColor",
    "UAlpha",
    "UGray",
    "UInteractable",
    "URaycastTarget",
    "CanvasGroup",
    "ULocalScale",
    "LocalRotation",
    "UTMP_Font",
  ]),
);
const appliedSpriteElements = appliedStateElements.filter((element) => element.elementType === "USprite");
assert.equal(appliedSpriteElements.length, 2);
for (const element of appliedSpriteElements) {
  assert.deepEqual(element.values.selected, { sprite: "_UnityTests/Stage3Assets/Round20.png", setNativeSize: true });
}
assert.equal(appliedStateElements.find((element) => element.elementType === "UTMP_Font")?.values.selected, "Font/alipuhui SDF.asset");
assert.deepEqual(appliedStateElements.find((element) => element.elementType === "ULocalScale")?.values.selected, [1.25, 0.75, 2]);
assert.deepEqual(appliedStateElements.find((element) => element.elementType === "LocalRotation")?.values.selected, [10, 20, 35]);
assert.equal(appliedStateElements.find((element) => element.elementType === "UGray")?.values.selected, false);
assert.equal(appliedStateElements.find((element) => element.elementType === "UInteractable")?.values.selected, false);
assert.equal(appliedStateElements.find((element) => element.elementType === "URaycastTarget")?.values.selected, true);
assert.deepEqual(appliedStateElements.find((element) => element.elementType === "CanvasGroup")?.values.selected, {
  alpha: 0.35,
  blocksRaycasts: false,
});

const blockerCodes = new Set(blockers.diagnostics?.map((diagnostic) => diagnostic.code));
for (const code of ["component.unityOnly.unregistered", "binding.componentUnsupported"]) {
  assert.ok(blockerCodes.has(code), `missing structured blocker: ${code}`);
}

const verifyDependencies = documents.slice(0, -1).map((document) => structuredClone(document));
const verifiedInner = verifyDependencies.find((document) => document.artifactKey === "StageThreeInnerFragment")!;
delete walkNodes(verifiedInner).find(({ node }) => node.id === "innerText")!.node.name;
walkNodes(verifiedInner).find(({ node }) => node.id === "innerAlternateText")!.node.name = "txt_inner_alternate_text";
walkNodes(verifiedInner).find(({ node }) => node.id === "innerObject")!.node.name = "go_inner_object";
const verifyRun = await executeGraphJob("roundtrip-verify", [...verifyDependencies, applied], `stage3-verify-${randomUUID()}`);
for (const result of verifyRun.response.stability ?? []) {
  assert.equal(result.byteStable, true);
  assert.equal(result.guidStable, true);
  assert.equal(result.fileIdsStable, true);
  assert.equal(result.second?.noOp, true);
}
const verifiedObservation = parsePrefabObservation(verifyRun.response.observation);
const verifiedResult = reconcilePrefabObservation(applied, verifyRun.rootProjection, verifiedObservation, {
  artifactKeyByPrefabPath: verifyRun.artifactKeyByPrefabPath,
});
assert.deepEqual(verifiedResult.issues, []);
assert.deepEqual(verifiedResult.patches, []);

console.log(
  JSON.stringify(
    {
      ok: true,
      source: source.artifactKey,
      patchCount: changedResult.patches.length,
      nestedBinding: Object.fromEntries(
        (applied.bindings ?? [])
          .filter(({ target }) => target.instancePath?.[0] === "outerFragment")
          .map(({ name, target }) => [name, target]),
      ),
      blockerCodes: [...blockerCodes].sort(),
      verifiedNoOp: true,
    },
    null,
    2,
  ),
);

function stage3Documents(): UiConcreteSource[] {
  const primaryTemplate: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "StageThreePrimaryTemplateWidget",
    artifactType: "Widget",
    widgetType: "StageThreePrimaryTemplateWidget",
    initialSize: [80, 32],
    root: { id: "StageThreePrimaryTemplateWidget", rect: rect(80, 32) },
  };
  const secondaryTemplate: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "StageThreeSecondaryTemplateWidget",
    artifactType: "Widget",
    widgetType: "StageThreeSecondaryTemplateWidget",
    initialSize: [80, 32],
    root: { id: "StageThreeSecondaryTemplateWidget", rect: rect(80, 32) },
  };
  const inner: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "StageThreeInnerFragment",
    artifactType: "Fragment",
    initialSize: [200, 80],
    root: {
      id: "StageThreeInnerFragment",
      rect: rect(200, 80),
      children: [
        { id: "innerText", name: "txt_inner_text", rect: rect(), components: { Text: { text: "Inner", fontSize: 18 } } },
        {
          id: "innerAlternateText",
          rect: rect(),
          components: { Text: { text: "Alternate", fontSize: 18 } },
        },
        { id: "innerImage", name: "img_inner_image", rect: rect(24, 24), components: { Image: {} } },
        { id: "innerObject", rect: rect(24, 24) },
      ],
    },
  };
  const outer: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "StageThreeOuterFragment",
    artifactType: "Fragment",
    initialSize: [220, 100],
    root: {
      id: "StageThreeOuterFragment",
      rect: rect(220, 100),
      children: [
        { id: "outerArtwork", rect: rect(200, 80), components: { Image: {} } },
        { id: "innerPrefabRef", rect: rect(200, 80), components: { PrefabRef: { artifactKey: inner.artifactKey } } },
      ],
    },
  };
  const widget: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "StageThreeRoundtripWidget",
    artifactType: "Widget",
    widgetType: "StageThreeRoundtripWidget",
    initialSize: [960, 720],
    bindings: [
      { name: "go_slider", target: { nodeId: "slider", componentType: "GameObject" } },
      { name: "go_dropdown", target: { nodeId: "dropdown", componentType: "GameObject" } },
      { name: "go_regular_scroll", target: { nodeId: "regularScroll", componentType: "GameObject" } },
      { name: "sr_state_root", target: { nodeId: "stateRoot", componentType: "StateRoot" } },
      { name: "go_state_toggle", target: { nodeId: "stateToggle", componentType: "GameObject" } },
      { name: "sv_scroll_ex", target: { nodeId: "scrollEx", componentType: "ScrollRectEx" } },
      {
        name: "txt_inner_text",
        target: { instancePath: ["outerFragment", "innerPrefabRef"], nodeId: "innerText", componentType: "Text" },
      },
      {
        name: "img_inner_image",
        target: { instancePath: ["outerFragment", "innerPrefabRef"], nodeId: "innerImage", componentType: "Image" },
      },
    ],
    root: {
      id: "StageThreeRoundtripWidget",
      rect: rect(960, 720),
      children: [
        {
          id: "slider",
          name: "go_slider",
          rect: rect(240, 24),
          components: {
            Image: {},
            Slider: { fillRect: "sliderFill", handleRect: "sliderHandle", targetGraphic: "slider", minValue: 0, maxValue: 10, value: 2 },
          },
        },
        { id: "sliderFill", rect: { ...rect(180, 12), anchorMin: [0, 0], anchorMax: [0.2, 1] }, components: { Image: {} } },
        { id: "sliderHandle", rect: { ...rect(20, 20), anchorMin: [0.2, 0], anchorMax: [0.2, 1] }, components: { Image: {} } },
        { id: "sliderAlternateGraphic", rect: rect(20, 20), components: { Image: {} } },
        {
          id: "dropdown",
          name: "go_dropdown",
          rect: rect(240, 40),
          components: {
            Image: {},
            TMPDropdown: {
              targetGraphic: "dropdown",
              captionText: "captionText",
              captionImage: "captionImage",
              template: "dropdownTemplate",
              itemText: "itemText",
              itemImage: "itemImage",
            },
          },
        },
        { id: "captionText", rect: rect(), components: { Text: { text: "High", fontSize: 18 } } },
        { id: "captionImage", rect: rect(20, 20), components: { Image: {} } },
        { id: "dropdownTemplate", rect: rect(240, 160) },
        { id: "itemText", rect: rect(), components: { Text: { text: "Item", fontSize: 18 } } },
        { id: "itemImage", rect: rect(20, 20), components: { Image: {} } },
        {
          id: "regularScroll",
          name: "go_regular_scroll",
          rect: rect(300, 180),
          components: { ScrollRect: { content: "regularContent", viewport: "regularViewport" } },
        },
        { id: "regularViewport", rect: rect(300, 180) },
        { id: "regularContent", rect: rect(300, 360) },
        {
          id: "stateRoot",
          name: "sr_state_root",
          rect: rect(240, 60),
          components: {
            StateRoot: {
              currentState: "unselected",
              states: { unselected: { stateVisual: false }, selected: { stateVisual: true } },
              elements: [
                { targetNodeId: "stateRect", elementType: "ULocalPos", values: { unselected: [0, 0], selected: [10, 20] } },
                { targetNodeId: "stateRect", elementType: "UPivot", values: { unselected: [0.5, 0.5], selected: [0.5, 1] } },
                { targetNodeId: "stateRect", elementType: "UAnchorsMin", values: { unselected: [0.5, 0.5], selected: [0.5, 1] } },
                { targetNodeId: "stateRect", elementType: "UAnchorsMax", values: { unselected: [0.5, 0.5], selected: [0.5, 1] } },
                { targetNodeId: "stateRect", elementType: "ULocalPosX", values: { unselected: 0, selected: 10 } },
                { targetNodeId: "stateRect", elementType: "ULocalPosY", values: { unselected: 0, selected: 20 } },
                { targetNodeId: "stateRect", elementType: "UWidth", values: { unselected: 100, selected: 120 } },
                { targetNodeId: "stateRect", elementType: "UHeight", values: { unselected: 40, selected: 50 } },
                { targetNodeId: "stateText", elementType: "UTMP_Text", values: { unselected: "Off", selected: "On" } },
                { targetNodeId: "stateText", elementType: "UTMP_FontSize", values: { unselected: 18, selected: 24 } },
                {
                  targetNodeId: "stateGraphic",
                  elementType: "USprite",
                  values: {
                    unselected: { sprite: "_UnityTests/Stage3Assets/Round12.png", setNativeSize: false },
                    selected: { sprite: null, setNativeSize: false },
                  },
                },
                {
                  targetNodeId: "stateGraphicNative",
                  elementType: "USprite",
                  values: {
                    unselected: { sprite: null, setNativeSize: false },
                    selected: { sprite: "_UnityTests/Stage3Assets/Round20.png", setNativeSize: true },
                  },
                },
                { targetNodeId: "stateGraphic", elementType: "UColor", values: { unselected: "#FFFFFFFF", selected: "#00FF00FF" } },
                { targetNodeId: "stateGraphic", elementType: "UAlpha", values: { unselected: 0.5, selected: 1 } },
                { targetNodeId: "stateGraphic", elementType: "UGray", values: { unselected: false, selected: true } },
                { targetNodeId: "slider", elementType: "UInteractable", values: { unselected: true, selected: false } },
                { targetNodeId: "stateGraphic", elementType: "URaycastTarget", values: { unselected: false, selected: true } },
                {
                  targetNodeId: "stateCanvasGroup",
                  elementType: "CanvasGroup",
                  values: {
                    unselected: { alpha: 1, blocksRaycasts: true },
                    selected: { alpha: 0.6, blocksRaycasts: true },
                  },
                },
                { targetNodeId: "stateRect", elementType: "ULocalScale", values: { unselected: [1, 1, 1], selected: [1.5, 0.5, 2] } },
                { targetNodeId: "stateRect", elementType: "LocalRotation", values: { unselected: [0, 0, 0], selected: [15, 25, 45] } },
                { targetNodeId: "stateText", elementType: "UTMP_Font", values: { unselected: "Font/alipuhui SDF.asset", selected: null } },
              ],
            },
          },
        },
        { id: "stateVisual", rect: rect(20, 20) },
        {
          id: "stateRect",
          rect: {
            ...rect(),
            anchorMin: [0.25, 0.25],
            anchorMax: [0.75, 0.75],
            sizeDelta: [-380, -320],
          },
        },
        { id: "stateText", rect: rect(), components: { Text: { text: "Off", fontSize: 18 } } },
        { id: "stateGraphic", rect: rect(40, 40), components: { Image: {} } },
        { id: "stateGraphicNative", rect: rect(40, 40), components: { Image: {} } },
        { id: "stateCanvasGroup", rect: rect(40, 40), components: { CanvasGroup: {} } },
        {
          id: "secondStateRoot",
          rect: rect(),
          components: {
            StateRoot: {
              currentState: "unselected",
              states: { unselected: { secondStateVisual: false }, selected: { secondStateVisual: true } },
            },
          },
        },
        { id: "secondStateVisual", rect: rect(20, 20) },
        {
          id: "stateToggle",
          name: "go_state_toggle",
          rect: rect(240, 40),
          components: { StateToggle: { stateRoots: ["stateRoot", "secondStateRoot"], selectedIndices: [0] } },
        },
        {
          id: "scrollEx",
          name: "sv_scroll_ex",
          rect: rect(320, 200),
          components: {
            ScrollRectEx: {
              content: "scrollExContent",
              viewport: "scrollExViewport",
              templates: { [primaryTemplate.widgetType!]: "templateItem" },
            },
            LayoutSettings: { spacing: [1, 2], padding: [1, 2, 3, 4] },
          },
        },
        { id: "scrollExViewport", rect: rect(320, 200) },
        { id: "scrollExContent", rect: rect(320, 400) },
        { id: "emptyTarget", rect: rect(120, 40) },
        { id: "templateItem", rect: rect(80, 32), components: { PrefabRef: { artifactKey: primaryTemplate.artifactKey } } },
        { id: "alternateTemplate", rect: rect(80, 32), components: { PrefabRef: { artifactKey: secondaryTemplate.artifactKey } } },
        {
          id: "outerFragment",
          rect: rect(220, 100),
          components: {
            PrefabRef: {
              artifactKey: outer.artifactKey,
              componentAdditions: [
                {
                  target: { nodeId: "outerArtwork" },
                  componentType: "AspectRatioFitter",
                  value: { aspectMode: "fitInParent", aspectRatio: 1.5 },
                },
                {
                  target: { instancePath: ["innerPrefabRef"], nodeId: "innerText" },
                  componentType: "LayoutElement",
                  value: { preferredWidth: 108, maxWidth: 120 },
                },
              ],
            },
          },
          children: [
            { id: "localAccent", rect: rect(24, 24), components: { Image: { color: "#FFCC00FF" } } },
            { id: "localCaption", rect: rect(120, 24), components: { Text: { text: "Local", fontSize: 16 } } },
          ],
        },
        {
          id: "animator",
          rect: rect(),
          components: {
            Animator: {
              controller: "_UnityTests/Stage3Assets/Initial.controller",
              updateMode: "unscaledTime",
              cullingMode: "cullUpdateTransforms",
              keepStateOnDisable: true,
            },
          },
        },
      ],
    },
  };
  return [primaryTemplate, secondaryTemplate, inner, outer, widget];
}

function rect(width = 100, height = 40): UiNode["rect"] {
  return { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [width, height] };
}

async function executeGraphJob(
  kind: "stage3-roundtrip-test" | "roundtrip-verify",
  sources: UiConcreteSource[],
  id: string,
): Promise<{
  readonly response: Stage3Response;
  readonly rootProjection: UnityProjection;
  readonly artifactKeyByPrefabPath: ReadonlyMap<string, string>;
}> {
  const catalog = createSourceCatalog(sources.map((document) => ({ path: `${document.artifactKey}.ui.json`, source: document })));
  const graph = createUnityProjectionGraph(catalog, sources.at(-1)!.artifactKey);
  const directory = join(paths.runtimeRoot, "unity-jobs", id);
  const requestPath = join(directory, "request.json");
  const resultPath = join(directory, "result.json");
  const logPath = join(directory, "unity.log");
  await mkdir(directory, { recursive: true });
  const projections = graph.map((entry) => entry.projection);
  const projectionPaths: string[] = [];
  for (const projection of projections) {
    const projectionPath = join(directory, `${projection.artifactKey}.projection.json`);
    await writeFile(projectionPath, formatProjection(projection), "utf8");
    projectionPaths.push(repoRelative(projectionPath));
  }
  await writeFile(
    requestPath,
    `${JSON.stringify(
      {
        jobId: id,
        kind,
        stage3Assets: true,
        projectionPaths,
        resultPath: repoRelative(resultPath),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await new WorkspaceUnityJobExecutor(paths).execute(repoRelative(requestPath), repoRelative(resultPath), logPath);
  const response = await waitForResult(resultPath);
  if (!response.ok) throw new Error(response.error || `${kind} failed`);
  return {
    response,
    rootProjection: projections.at(-1)!,
    artifactKeyByPrefabPath: new Map(projections.map((projection) => [projection.prefabPath, projection.artifactKey])),
  };
}

function repoRelative(path: string): string {
  return relative(paths.repoRoot, path).replaceAll("\\", "/");
}

interface StabilityResult {
  readonly byteStable: boolean;
  readonly guidStable: boolean;
  readonly fileIdsStable: boolean;
  readonly second?: { readonly noOp?: boolean };
}

interface Stage3Response {
  readonly ok: boolean;
  readonly error?: string;
  readonly baselineObservation?: unknown;
  readonly observation?: unknown;
  readonly blockerObservation?: unknown;
  readonly stability?: readonly StabilityResult[];
}

async function waitForResult(path: string): Promise<Stage3Response> {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(path, "utf8")) as Stage3Response;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Stage 3 Unity roundtrip verification timed out");
}
