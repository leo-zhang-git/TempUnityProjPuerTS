import assert from "node:assert/strict";
import test from "node:test";
import { createArtifactSource } from "../../src/kernel/authoring.js";
import { copyNodeSubtree } from "../../src/kernel/node-clipboard.js";
import { createUnityProjection } from "../../src/kernel/projection.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import { validateSource, validateSourceReadiness } from "../../src/kernel/validation.js";

test("sources preserve empty required references while publish readiness rejects them", () => {
  const source = createArtifactSource({ artifactKey: "DraftCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
  source.root.components = {
    Image: {},
    ButtonEx: { targetGraphic: "" },
    TMPInputField: { targetGraphic: "", textViewport: "", textComponent: "" },
    ScrollRectEx: { viewport: "", content: "", templates: {} },
    VirtualJoystick: { area: "DraftCanvas", background: "DraftCanvas", knob: "" },
  };

  assert.equal(validateSource(source).valid, true);
  const readiness = validateSourceReadiness(source);
  assert.equal(readiness.valid, false);
  assert.deepEqual(
    readiness.issues
      .filter((issue) => issue.code === "required.empty")
      .map((issue) => [issue.nodeId, issue.componentType, issue.fieldPath]),
    [
      ["DraftCanvas", "ButtonEx", "targetGraphic"],
      ["DraftCanvas", "TMPInputField", "targetGraphic"],
      ["DraftCanvas", "TMPInputField", "textViewport"],
      ["DraftCanvas", "TMPInputField", "textComponent"],
      ["DraftCanvas", "ScrollRectEx", "content"],
      ["DraftCanvas", "ScrollRectEx", "viewport"],
    ],
  );
  assert.throws(() => createUnityProjection(source), /required\.empty/);
  assert.doesNotThrow(() => copyNodeSubtree(source, source.root.id));
});

test("draft catalogs ignore an empty PrefabRef dependency until readiness", () => {
  const source = createArtifactSource({ artifactKey: "DraftCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
  source.root.children = [
    {
      id: "pendingPrefab",
      rect: {
        anchorMin: [0.5, 0.5],
        anchorMax: [0.5, 0.5],
        pivot: [0.5, 0.5],
        anchoredPosition: [0, 0],
        sizeDelta: [100, 100],
      },
      components: { PrefabRef: { artifactKey: "" } },
    },
  ];

  const catalog = createSourceCatalog([{ path: "DraftCanvas.ui.json", source }]);
  assert.deepEqual(catalog.entries.get("DraftCanvas")?.dependencies, []);
  assert.equal(validateSource(source).valid, true);
  assert.ok(
    validateSourceReadiness(source).issues.some((issue) => issue.componentType === "PrefabRef" && issue.fieldPath === "artifactKey"),
  );
});

test("VirtualJoystick allows an empty knob while rejecting a missing knob target", () => {
  const source = createArtifactSource({ artifactKey: "JoystickCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
  const joystick = { area: "joystickArea", background: "joystickArea", knob: "" };
  source.root.components = {
    ...source.root.components,
    VirtualJoystick: joystick,
  };
  source.root.children = [
    {
      id: "joystickArea",
      rect: {
        anchorMin: [0.5, 0.5],
        anchorMax: [0.5, 0.5],
        pivot: [0.5, 0.5],
        anchoredPosition: [0, 0],
        sizeDelta: [100, 100],
      },
      components: { Image: {} },
    },
  ];

  assert.equal(validateSourceReadiness(source).valid, true);
  joystick.knob = "missingKnob";
  assert.ok(validateSourceReadiness(source).issues.some((issue) => issue.code === "joystick.knob"));
});
