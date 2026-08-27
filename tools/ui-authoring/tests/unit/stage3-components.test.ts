import assert from "node:assert/strict";
import test from "node:test";
import { collectBindings } from "../../src/kernel/binding.js";
import { formatSource } from "../../src/kernel/canonical.js";
import { collectLocalNodeReferences, remapLocalNodeReferenceTargets } from "../../src/kernel/node-references.js";
import { createUnityProjection } from "../../src/kernel/projection.js";
import { validateSource } from "../../src/kernel/validation.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";

function rect(width = 100, height = 40): UiNode["rect"] {
  return { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [width, height] };
}

function stage3Source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "StageThreeWidget",
    artifactType: "Widget",
    widgetType: "StageThreeWidget",
    initialSize: [640, 360],
    bindings: [
      { name: "progressSlider", target: { nodeId: "slider", componentType: "Slider" } },
      { name: "qualityDropdown", target: { nodeId: "dropdown", componentType: "TMPDropdown" } },
      { name: "resultScrollRect", target: { nodeId: "scroll", componentType: "ScrollRect" } },
      { name: "modeStateToggle", target: { nodeId: "modeToggle", componentType: "StateToggle" } },
    ],
    root: {
      id: "StageThreeWidget",
      rect: rect(640, 360),
      children: [
        {
          id: "slider",
          rect: rect(240, 24),
          components: {
            Image: {},
            Slider: {
              fillRect: "sliderFill",
              handleRect: "sliderHandle",
              targetGraphic: "slider",
              direction: "leftToRight",
              interactable: true,
              transition: "colorTint",
              minValue: 0,
              maxValue: 1,
              wholeNumbers: false,
              value: 0,
            },
          },
        },
        { id: "sliderFill", rect: rect(180, 12), components: { Image: {} } },
        { id: "sliderHandle", rect: rect(20, 20), components: { Image: {} } },
        {
          id: "dropdown",
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
              interactable: true,
              transition: "colorTint",
              value: 0,
            },
          },
        },
        { id: "captionText", rect: rect(), components: { Text: { text: "High", fontSize: 18 } } },
        { id: "captionImage", rect: rect(20, 20), components: { Image: {} } },
        { id: "dropdownTemplate", rect: rect(240, 160) },
        { id: "itemText", rect: rect(), components: { Text: { text: "Item", fontSize: 18 } } },
        { id: "itemImage", rect: rect(20, 20), components: { Image: {} } },
        {
          id: "scroll",
          rect: rect(300, 180),
          components: {
            ScrollRect: {
              content: "scrollContent",
              viewport: "scrollViewport",
              horizontal: false,
              vertical: true,
              movementType: "elastic",
              inertia: true,
              scrollSensitivity: 1,
              elasticity: 0.1,
              decelerationRate: 0.135,
            },
          },
        },
        { id: "scrollViewport", rect: rect(300, 180) },
        { id: "scrollContent", rect: rect(300, 360) },
        {
          id: "modeToggle",
          rect: rect(240, 40),
          components: {
            StateToggle: {
              stateRoots: ["firstState", "secondState"],
              multipleSelect: false,
              allowSwitchOff: false,
              selectedIndices: [1],
            },
          },
        },
        {
          id: "firstState",
          rect: rect(),
          components: {
            StateRoot: {
              currentState: "unselected",
              states: { unselected: { firstVisual: false }, selected: { firstVisual: true } },
            },
          },
        },
        { id: "firstVisual", rect: rect() },
        {
          id: "secondState",
          rect: rect(),
          components: {
            StateRoot: {
              currentState: "unselected",
              states: { unselected: { secondVisual: false }, selected: { secondVisual: true } },
            },
          },
        },
        { id: "secondVisual", rect: rect() },
        {
          id: "animatedCrosshair",
          rect: rect(),
          components: {
            Animator: {
              controller: "Animation/GameplayMainHudGraph/CrossHit.controller",
              updateMode: "unscaledTime",
              cullingMode: "cullUpdateTransforms",
              keepStateOnDisable: true,
            },
            Crosshair: {
              scatterScale: 30,
              edges: [{ target: "crosshairEdge", direction: [1, 0] }],
              punch: {
                ...{
                  duration: 0.1,
                  vibrato: 3,
                  elasticity: 0.5,
                  scale: 0.1,
                  rotationEnabled: false,
                  rotationZ: 0,
                  randomRotationZ: 15,
                },
              },
            },
          },
        },
        { id: "crosshairEdge", rect: rect(8, 8) },
        {
          id: "roundedMask",
          rect: rect(176, 176),
          components: {
            RoundedRect: { cornerRadii: [88, 88, 88, 88] },
            Mask: { showMaskGraphic: false },
            RectMask2D: {},
          },
          children: [{ id: "maskedContent", rect: rect(176, 176), components: { Image: {} } }],
        },
      ],
    },
  };
}

test("projects, binds, and canonicalizes the stage 3 Registry components", () => {
  const source = stage3Source();
  assert.deepEqual(validateSource(source).issues, []);

  assert.deepEqual(
    collectBindings(source).map(({ fieldName, componentType }) => [fieldName, componentType]),
    [
      ["progressSlider", "Slider"],
      ["qualityDropdown", "TMPDropdown"],
      ["resultScrollRect", "ScrollRect"],
      ["modeStateToggle", "StateToggle"],
    ],
  );

  const projection = createUnityProjection(source);
  const [slider, , , dropdown, , , , , , scroll, , , stateToggle] = projection.root.children;
  assert.deepEqual(slider?.components.Slider, {
    fillRect: "sliderFill",
    handleRect: "sliderHandle",
    targetGraphic: "slider",
    direction: "leftToRight",
    interactable: true,
    transition: "colorTint",
    minValue: 0,
    maxValue: 1,
    wholeNumbers: false,
    value: 0,
  });
  assert.equal((slider!.components.Image as { raycastTarget?: boolean }).raycastTarget, true);
  assert.equal((dropdown!.components.Image as { raycastTarget?: boolean }).raycastTarget, true);
  assert.deepEqual(scroll?.components.ScrollRect, {
    content: "scrollContent",
    viewport: "scrollViewport",
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
  });
  assert.deepEqual(stateToggle?.components.StateToggle, {
    stateRoots: ["firstState", "secondState"],
    multipleSelect: false,
    allowSwitchOff: false,
    selectedIndices: [1],
  });
  const animatedCrosshair = projection.root.children.find((node) => node.id === "animatedCrosshair");
  assert.deepEqual(animatedCrosshair?.components.Animator, {
    controller: "Assets/Resources/UI/Animation/GameplayMainHudGraph/CrossHit.controller",
    updateMode: "unscaledTime",
    cullingMode: "cullUpdateTransforms",
    applyRootMotion: false,
    keepStateOnDisable: true,
  });
  assert.deepEqual(animatedCrosshair?.components.Crosshair, {
    scatterScale: 30,
    edges: [{ target: "crosshairEdge", direction: [1, 0] }],
    punch: {
      duration: 0.1,
      vibrato: 3,
      elasticity: 0.5,
      scale: 0.1,
      rotationEnabled: false,
      rotationZ: 0,
      randomRotationZ: 15,
    },
  });
  const roundedMask = projection.root.children.find((node) => node.id === "roundedMask");
  assert.deepEqual(roundedMask?.components.Mask, { showMaskGraphic: false });
  assert.deepEqual(roundedMask?.components.RoundedRect, {
    color: "#FFFFFFFF",
    cornerRadii: [88, 88, 88, 88],
    fillAmount: 1,
    raycastTarget: false,
  });

  const formatted = formatSource(source);
  for (const field of ["minValue", "maxValue", "wholeNumbers", "multipleSelect", "allowSwitchOff"]) {
    assert.doesNotMatch(formatted, new RegExp(`"${field}"`));
  }
  assert.match(formatted, /"selectedIndices": \[/);
});

test("requires a Graphic on Mask nodes", () => {
  const source = stage3Source();
  source.root.children?.push({ id: "invalidMask", rect: rect(), components: { Mask: {} } });
  assert.ok(validateSource(source).issues.some((issue) => issue.code === "mask.graphic"));
});

test("collects and remaps every structural reference owned by the stage 3 components", () => {
  const source = stage3Source();
  const fields = collectLocalNodeReferences(source.root).map(({ field }) => field);
  for (const field of [
    "Slider.fillRect",
    "Slider.handleRect",
    "Slider.targetGraphic",
    "TMPDropdown.targetGraphic",
    "TMPDropdown.captionText",
    "TMPDropdown.captionImage",
    "TMPDropdown.template",
    "TMPDropdown.itemText",
    "TMPDropdown.itemImage",
    "ScrollRect.content",
    "ScrollRect.viewport",
    "StateToggle.stateRoots",
    "Crosshair.edges.0.target",
  ])
    assert.ok(fields.includes(field), field);

  const remapped = remapLocalNodeReferenceTargets(source.root, (nodeId) => `copy_${nodeId}`);
  assert.deepEqual(remapped.children?.find((node) => node.id === "slider")?.components?.Slider, {
    ...source.root.children?.find((node) => node.id === "slider")?.components?.Slider,
    fillRect: "copy_sliderFill",
    handleRect: "copy_sliderHandle",
    targetGraphic: "copy_slider",
  });
  assert.deepEqual(remapped.children?.find((node) => node.id === "modeToggle")?.components?.StateToggle?.stateRoots, [
    "copy_firstState",
    "copy_secondState",
  ]);
  assert.equal(
    remapped.children?.find((node) => node.id === "animatedCrosshair")?.components?.Crosshair?.edges?.[0]?.target,
    "copy_crosshairEdge",
  );
});

test("accepts cleared optional TMPDropdown image references", () => {
  const source = stage3Source();
  const dropdown = source.root.children?.find((node) => node.id === "dropdown")?.components?.TMPDropdown;
  dropdown!.captionImage = null;
  dropdown!.itemImage = null;

  assert.deepEqual(validateSource(source).issues, []);
  assert.deepEqual(
    collectLocalNodeReferences(source.root)
      .filter(({ field }) => field.startsWith("TMPDropdown."))
      .map(({ field }) => field),
    ["TMPDropdown.targetGraphic", "TMPDropdown.template", "TMPDropdown.captionText", "TMPDropdown.itemText"],
  );
});

test("rejects invalid stage 3 ranges, selections, crosshair edges, and mutually exclusive scroll owners", () => {
  const source = stage3Source();
  const slider = source.root.children?.find((node) => node.id === "slider")?.components?.Slider;
  const stateToggle = source.root.children?.find((node) => node.id === "modeToggle")?.components?.StateToggle;
  const scrollNode = source.root.children?.find((node) => node.id === "scroll");
  const crosshair = source.root.children?.find((node) => node.id === "animatedCrosshair")?.components?.Crosshair;
  assert.ok(slider && stateToggle && scrollNode?.components && crosshair);
  slider.minValue = 5;
  slider.maxValue = 2;
  slider.value = 3;
  stateToggle.selectedIndices = [2];
  scrollNode.components.ScrollRectEx = { content: "scrollContent", viewport: "scrollViewport", templates: {} };
  crosshair.edges = [
    { target: "crosshairEdge", direction: [0, 0] },
    { target: "crosshairEdge", direction: [1, 0] },
  ];
  const codes = validateSource(source).issues.map((issue) => issue.code);
  assert.ok(codes.includes("slider.range"));
  assert.ok(codes.includes("slider.value"));
  assert.ok(codes.includes("stateToggle.selectionRange"));
  assert.ok(codes.includes("scrollRect.conflict"));
  assert.ok(codes.includes("crosshair.edgeDirectionZero"));
  assert.ok(codes.includes("crosshair.edgeTargetDuplicate"));
});
