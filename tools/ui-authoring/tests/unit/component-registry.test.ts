import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentValidationNode } from "../../src/components/component-module.js";
import { createArtifactSource } from "../../src/kernel/authoring.js";
import { createUnityProjection } from "../../src/kernel/projection.js";
import { componentManifest } from "../../src/registry/component-manifest.js";
import {
  componentAvailabilityReason,
  componentInspectorFields,
  componentPreview,
  componentRegistry,
  defaultComponent,
  initialComponent,
  type PreviewRendererId,
  type ProjectionHandlerId,
  type RoundtripHandlerId,
} from "../../src/registry/component-registry.js";
import type { UiComponentType } from "../../src/schema/ui-source-schema.js";
import { UiComponentsSchema } from "../../src/schema/ui-source-schema.js";
import { visibleInspectorEntries } from "../../src/web/editors/artifact/inspector/inspector-entry.js";

const previewRenderers = new Set<PreviewRendererId>(["none", "image", "text", "roundedRect", "prefabRef"]);
const projectionHandlers = new Set<ProjectionHandlerId>(["copy", "prefabRef", "stateRoot"]);
const roundtripHandlers = new Set<RoundtripHandlerId>(["bidirectional"]);

function unavailableReason(
  type: UiComponentType,
  node: ComponentValidationNode,
  nodes: readonly ComponentValidationNode[] = [node],
): string | undefined {
  return componentAvailabilityReason(type, node, nodes);
}

test("covers every Source component and Source-owned field", () => {
  assert.deepEqual(Object.keys(componentRegistry).sort(), Object.keys(UiComponentsSchema.properties).sort());
  for (const [componentType, schema] of Object.entries(UiComponentsSchema.properties)) {
    const expected = Object.keys(schema.properties).sort();
    const definition = componentRegistry[componentType as keyof typeof componentRegistry];
    const actual = [
      ...componentInspectorFields(componentType as UiComponentType).map((field) => field.property),
      ...("customInspectorFields" in definition ? definition.customInspectorFields : []),
    ].sort();
    assert.deepEqual(actual, expected, componentType);
  }
});

test("derives the Unity component manifest from Component Modules", () => {
  const manifestByKey = new Map(componentManifest.components.map((entry) => [entry.key, entry]));
  for (const [componentType, definition] of Object.entries(componentRegistry)) {
    if (!("unity" in definition) || definition.unity === undefined) {
      assert.equal(manifestByKey.has(componentType), false, componentType);
      continue;
    }
    const entry = manifestByKey.get(componentType);
    assert.ok(entry, componentType);
    assert.equal(entry.unityType, definition.unity.type, componentType);
    assert.equal(entry.exactType, definition.unity.exactType === true, componentType);
    assert.equal(entry.useSiteAddable, definition.useSiteAddable === true, componentType);
    assert.equal(entry.capability, definition.unity.capability, componentType);
    assert.deepEqual(
      entry.fields.map((field) => field.property),
      Object.keys(definition.fields),
      componentType,
    );
  }
  assert.deepEqual(
    [...manifestByKey.keys()].sort(),
    Object.entries(componentRegistry)
      .filter(([, definition]) => "unity" in definition && definition.unity !== undefined)
      .map(([key]) => key)
      .sort(),
  );
});

test("creates isolated component defaults", () => {
  const first = defaultComponent("StateRoot");
  first.states.default = { node: true };
  assert.deepEqual(defaultComponent("StateRoot"), { currentState: "default", states: { default: {} }, elements: [] });
});

test("projects SafeArea defaults to the Unity UGUI component", () => {
  assert.deepEqual(defaultComponent("SafeArea"), {
    referenceOrientation: "landscapeLeft",
    edges: "all",
    alignment: "none",
  });
  assert.deepEqual(
    componentManifest.components.find((entry) => entry.key === "SafeArea"),
    {
      key: "SafeArea",
      unityType: "UnityEngine.UI.SafeArea",
      exactType: false,
      useSiteAddable: false,
      fields: [
        {
          property: "referenceOrientation",
          path: "m_ReferenceOrientation",
          codec: "enum",
          enumValues: { portrait: 0, landscapeLeft: 1, portraitUpsideDown: 2, landscapeRight: 3 },
        },
        {
          property: "edges",
          path: "m_Edges",
          codec: "enum",
          enumValues: {
            none: 0,
            top: 1,
            right: 2,
            topRight: 3,
            bottom: 4,
            vertical: 5,
            rightBottom: 6,
            topRightBottom: 7,
            left: 8,
            topLeft: 9,
            horizontal: 10,
            topHorizontal: 11,
            leftBottom: 12,
            topLeftBottom: 13,
            horizontalBottom: 14,
            all: 15,
          },
        },
        {
          property: "alignment",
          path: "m_Alignment",
          codec: "enum",
          enumValues: { none: 0, horizontal: 1, vertical: 2, both: 3 },
        },
      ],
    },
  );
});

test("projects CanvasGroup fields through the Unity component manifest", () => {
  assert.deepEqual(defaultComponent("CanvasGroup"), {});
  assert.equal(componentRegistry.CanvasGroup.useSiteAddable, true);
  assert.deepEqual(
    componentManifest.components.find((entry) => entry.key === "CanvasGroup"),
    {
      key: "CanvasGroup",
      unityType: "UnityEngine.CanvasGroup",
      exactType: false,
      useSiteAddable: true,
      fields: [
        { property: "alpha", path: "m_Alpha", codec: "float" },
        { property: "interactable", path: "m_Interactable", codec: "boolean" },
        { property: "blocksRaycasts", path: "m_BlocksRaycasts", codec: "boolean" },
        { property: "ignoreParentGroups", path: "m_IgnoreParentGroups", codec: "boolean" },
      ],
    },
  );
});

test("initializes context-dependent component values through Component Modules", () => {
  const graphic = { id: "graphic", components: { Image: {} } };
  assert.deepEqual(initialComponent("ButtonEx", graphic, [graphic]), {
    targetGraphic: "graphic",
    highlightedSprite: null,
    pressedSprite: null,
    selectedSprite: null,
    disabledSprite: null,
  });
  assert.deepEqual(initialComponent("ButtonEx", { id: "button", components: {} }, [graphic]), {
    targetGraphic: "",
    highlightedSprite: null,
    pressedSprite: null,
    selectedSprite: null,
    disabledSprite: null,
  });
  assert.deepEqual(initialComponent("Image", graphic, [graphic]), {});
});

test("limits VirtualJoystick graphic references to Image nodes", () => {
  const fields = componentInspectorFields("VirtualJoystick").filter(
    (field) => field.property === "area" || field.property === "background",
  );
  assert.deepEqual(
    fields.map((field) => ("referenceFilter" in field ? field.referenceFilter : undefined)),
    ["image", "image"],
  );
});

test("projects the VirtualJoystick area as a raycast target without changing Source defaults", () => {
  const source = createArtifactSource({ artifactKey: "JoystickCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
  source.root.components = {
    Image: {},
    VirtualJoystick: { area: source.root.id, background: source.root.id },
  };

  const projection = createUnityProjection(source);

  assert.equal((projection.root.components.Image as { raycastTarget?: unknown }).raycastTarget, true);
  assert.equal(source.root.components.Image?.raycastTarget, undefined);
});

test("declares the bounded Text Bold and VirtualJoystick behavior fields", () => {
  const textFields = componentInspectorFields("Text");
  assert.deepEqual(
    textFields.slice(0, 6).map((field) => field.property),
    ["text", "font", "material", "fontSize", "bold", "color"],
  );
  assert.equal(textFields.find((field) => field.property === "bold")?.defaultValue, false);
  assert.deepEqual(
    componentManifest.components.find((entry) => entry.key === "Text")?.fields.find((field) => field.property === "bold"),
    {
      property: "bold",
      path: "m_fontStyle",
      codec: "boolean",
    },
  );

  const joystick = componentRegistry.VirtualJoystick.inspector;
  assert.deepEqual(
    joystick.map((entry) => ("property" in entry ? entry.property : entry.action)),
    ["area", "background", "knob", "isActiveJoystick", "staticBackground", "keepKnobVisibleWhenIdle", "maxOffsetScale"],
  );
  assert.equal(
    visibleInspectorEntries(joystick, { isActiveJoystick: false }, []).some(
      (entry) => "property" in entry && entry.property === "staticBackground",
    ),
    false,
  );
  assert.equal(
    visibleInspectorEntries(joystick, {}, []).some((entry) => "property" in entry && entry.property === "staticBackground"),
    true,
  );
  const knobInspector = joystick.find((entry) => "property" in entry && entry.property === "knob");
  assert.ok(knobInspector && "property" in knobInspector);
  assert.equal(knobInspector.required, undefined);
});

test("owns component availability prerequisites in Component Modules", () => {
  const empty = { id: "empty", components: {} };
  const graphic = { id: "graphic", components: { RoundedRect: {} } };
  const image = { id: "image", components: { Image: {} } };
  const text = { id: "text", components: { Text: {} } };

  assert.equal(unavailableReason("ButtonEx", empty), "Requires an Image or Rounded Rect target");
  assert.equal(unavailableReason("ButtonEx", empty, [empty, graphic]), undefined);
  assert.equal(unavailableReason("Slider", empty), "Requires a Graphic target");
  assert.equal(unavailableReason("Slider", empty, [empty, graphic]), undefined);
  assert.equal(unavailableReason("TMPInputField", empty, [empty, graphic]), "Requires a TMP Text target");
  assert.equal(unavailableReason("TMPInputField", empty, [empty, graphic, text]), undefined);
  assert.equal(unavailableReason("TMPDropdown", empty, [empty, text]), "Requires a Graphic target");
  assert.equal(unavailableReason("TMPDropdown", empty, [empty, image, text]), undefined);
  assert.equal(unavailableReason("VirtualJoystick", empty, [empty, graphic]), "Requires an Image target");
  assert.equal(unavailableReason("VirtualJoystick", empty, [empty, image]), undefined);
  assert.equal(unavailableReason("LayoutSettings", empty), "Requires Scroll Rect Ex on this node");
  assert.equal(unavailableReason("LayoutSettings", { id: "scroll", components: { ScrollRectEx: {} } }), undefined);
  assert.equal(
    unavailableReason("PrefabRef", { id: "button", components: { ButtonEx: {} } }),
    "Remove components outside the PrefabRef use-site whitelist first",
  );
  assert.equal(unavailableReason("PrefabRef", image), undefined);
});

test("declares closed Preview, Projection, and roundtrip dispatch identities", () => {
  const previewExceptions: Partial<Record<UiComponentType, PreviewRendererId>> = {
    Image: "image",
    Text: "text",
    RoundedRect: "roundedRect",
    PrefabRef: "prefabRef",
  };
  const projectionExceptions: Partial<Record<UiComponentType, ProjectionHandlerId>> = {
    PrefabRef: "prefabRef",
    StateRoot: "stateRoot",
  };

  for (const [componentType, definition] of Object.entries(componentRegistry) as [
    UiComponentType,
    (typeof componentRegistry)[UiComponentType],
  ][]) {
    assert.ok(previewRenderers.has(definition.previewRenderer), `${componentType} previewRenderer`);
    assert.equal(definition.previewRenderer, previewExceptions[componentType] ?? "none", `${componentType} previewRenderer`);
    assert.ok(projectionHandlers.has(definition.projectionHandler), `${componentType} projectionHandler`);
    assert.equal(definition.projectionHandler, projectionExceptions[componentType] ?? "copy", `${componentType} projectionHandler`);
    assert.ok(roundtripHandlers.has(definition.roundtrip), `${componentType} roundtrip`);
    assert.equal(definition.roundtrip, "bidirectional", `${componentType} roundtrip`);
  }
});

test("declares asset fields independently from Inspector controls", () => {
  assert.deepEqual(componentRegistry.Image.assetFields, [{ property: "sprite", kind: "image" }]);
  assert.deepEqual(componentRegistry.Text.assetFields, [{ property: "font", kind: "font" }]);
  assert.deepEqual(componentRegistry.Animation.assetFields, [
    { property: "defaultClip", kind: "animationClip" },
    { property: "clips", kind: "animationClip" },
  ]);
  assert.deepEqual(componentRegistry.Animator.assetFields, [{ property: "controller", kind: "animatorController" }]);
  for (const [componentType, definition] of Object.entries(componentRegistry)) {
    for (const field of "assetFields" in definition ? definition.assetFields : []) {
      assert.ok(
        componentInspectorFields(componentType as UiComponentType).some((candidate) => candidate.property === field.property),
        `${componentType}.${field.property}`,
      );
    }
  }
});

test("declares CustomDropDown content Prefabs as Artifact references", () => {
  assert.deepEqual(componentRegistry.CustomDropDown.artifactReferenceFields, ["currentContentPrefab", "optionContentPrefab"]);
  const manifest = componentManifest.components.find((entry) => entry.key === "CustomDropDown");
  assert.deepEqual(
    manifest?.fields.filter((field) => field.codec === "artifactReference").map((field) => field.property),
    ["currentContentPrefab", "optionContentPrefab"],
  );
});

test("derives Preview capabilities from Component Modules", () => {
  assert.deepEqual(Object.keys(componentPreview("Text")?.fields ?? {}).sort(), ["color", "material", "text"]);
  assert.deepEqual(Object.keys(componentPreview("Image")?.fields ?? {}).sort(), ["color", "fillAmount", "sprite"]);
  assert.deepEqual(Object.keys(componentPreview("RoundedRect")?.fields ?? {}).sort(), ["color", "fillAmount"]);
  assert.deepEqual(Object.keys(componentPreview("StateRoot")?.fields ?? {}), ["state"]);
  assert.deepEqual(Object.keys(componentPreview("TMPInputField")?.fields ?? {}), ["text"]);
  assert.equal(componentPreview("ButtonEx"), undefined);
});
