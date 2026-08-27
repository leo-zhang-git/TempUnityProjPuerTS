import assert from "node:assert/strict";
import test from "node:test";
import { createArtifactSource } from "../../src/kernel/authoring.js";
import { importPrefabObservation } from "../../src/kernel/prefab-import.js";
import type { PrefabObservation } from "../../src/kernel/prefab-observation.js";
import { artifactPrefabPath } from "../../src/kernel/prefab-path.js";
import { createSourceCatalog, type SourceCatalog } from "../../src/kernel/source-catalog.js";

const sourceIdentity = { path: "Imported/LegacyWidget.ui.json", artifactKey: "LegacyWidget" } as const;
const widgetPath = artifactPrefabPath(sourceIdentity);

function importOptions(catalog?: SourceCatalog) {
  return catalog ? { sourceIdentity, catalog } : { sourceIdentity };
}

function rect(size: readonly [number, number] = [320, 180]): PrefabObservation["nodes"][number]["rect"] {
  return {
    anchorMin: [0, 1],
    anchorMax: [0, 1],
    pivot: [0, 1],
    anchoredPosition: [0, 0],
    sizeDelta: size,
    rotation: 0,
    scale: [1, 1],
  };
}

function observation(overrides: Partial<PrefabObservation> = {}): PrefabObservation {
  return {
    artifactKey: "LegacyWidget",
    artifactType: "Widget",
    prefabPath: widgetPath,
    rawPrefabHash: "abc123",
    localWidgetType: "LegacyWidget",
    effectiveWidgetType: "LegacyWidget",
    suggestedDesignSize: [320, 180],
    nodes: [
      {
        id: "LegacyWidget",
        identity: "projection",
        name: "LegacyWidget",
        namePath: ["LegacyWidget"],
        parentId: null,
        siblingIndex: 0,
        active: true,
        rect: rect(),
        components: {},
        completeComponents: true,
        unityOnlyComponents: [],
      },
      {
        id: "txt_label",
        identity: "generated",
        name: "txt_label",
        namePath: ["LegacyWidget", "txt_label"],
        parentId: "LegacyWidget",
        siblingIndex: 0,
        active: true,
        rect: rect([120, 30]),
        components: { Text: { text: "Legacy", fontSize: 20 } },
        completeComponents: true,
        unityOnlyComponents: [],
      },
    ],
    bindings: [{ fieldName: "txt_label", nodeId: "txt_label", componentType: "Text" }],
    issues: [],
    ...overrides,
  };
}

test("imports a concrete Prefab observation into a draft Source", () => {
  const result = importPrefabObservation(observation(), importOptions());

  assert.deepEqual(result.blockers, []);
  assert.equal(result.source.sourceKind, "artifact");
  assert.equal(result.source.artifactType, "Widget");
  assert.deepEqual(result.source.initialSize, [320, 180]);
  assert.equal(result.source.root.children?.[0]?.components?.Text?.text, "Legacy");
  assert.equal(result.source.bindings?.find((binding) => binding.name === "txt_label")?.target.nodeId, "txt_label");
  assert.equal(result.observationHash, "abc123");
});

test("collapses a nested Prefab instance into PrefabRef", () => {
  const child = createArtifactSource({ artifactKey: "ChildWidget", artifactType: "Widget", initialSize: [100, 50] });
  const childPath = artifactPrefabPath({ path: "Shared/ChildWidget.ui.json", artifactKey: child.artifactKey });
  const nested = observation({
    nodes: [
      observation().nodes[0]!,
      {
        id: "child",
        identity: "generated",
        name: "Child",
        namePath: ["LegacyWidget", "Child"],
        parentId: "LegacyWidget",
        siblingIndex: 0,
        active: true,
        rect: rect([100, 50]),
        components: {},
        completeComponents: true,
        prefabPath: childPath,
        unityOnlyComponents: [],
      },
    ],
    bindings: [],
  });
  const catalog = createSourceCatalog([{ path: "Shared/ChildWidget.ui.json", source: child }]);

  const result = importPrefabObservation(nested, importOptions(catalog));

  assert.deepEqual(result.blockers, []);
  assert.equal(result.source.sourceKind, "artifact");
  assert.equal(result.source.root.children?.[0]?.components?.PrefabRef?.artifactKey, "ChildWidget");
  assert.equal(result.source.root.children?.[0]?.children, undefined);
});

test("returns a useful Source preview while Unity-only components block writing", () => {
  const result = importPrefabObservation(
    observation({
      diagnostics: [{ code: "component.unityOnly.unregistered", message: "txt_label has LegacyBehaviour", nodeId: "txt_label" }],
      nodes: observation().nodes.map((node) =>
        node.id === "txt_label" ? { ...node, unityOnlyComponents: ["Game.LegacyBehaviour"] } : node,
      ),
    }),
    importOptions(),
  );

  assert.equal(result.source.sourceKind, "artifact");
  assert.equal(result.source.root.children?.[0]?.id, "txt_label");
  assert.deepEqual(result.blockers, ["txt_label has LegacyBehaviour"]);
  assert.deepEqual(result.unityOnlyComponents, [{ nodeId: "txt_label", componentTypes: ["Game.LegacyBehaviour"] }]);
});

test("omits empty optional asset fields while importing components", () => {
  const sourceObservation = observation();
  const result = importPrefabObservation(
    observation({
      nodes: [
        {
          ...sourceObservation.nodes[0]!,
          components: {
            Animation: {
              defaultClip: "",
              clips: [],
              wrapMode: "default",
              playAutomatically: false,
              animatePhysics: false,
              updateMode: "normal",
              cullingType: "alwaysAnimate",
            },
          },
        },
      ],
      bindings: [],
    }),
    importOptions(),
  );

  assert.deepEqual(result.blockers, []);
  assert.equal(result.source.sourceKind, "artifact");
  assert.equal(result.source.root.components?.Animation?.defaultClip, undefined);
});

test("blocks a Variant until its base Source exists", () => {
  const result = importPrefabObservation(
    observation({
      basePrefabPath: "Assets/Resources/UI/Prefab/Imported/BaseWidget.prefab",
    }),
    importOptions(),
  );

  assert.equal(result.source.sourceKind, "variant");
  assert.match(result.blockers[0]!, /requires an imported base Source/);
});

test("imports a Variant component addition before validating its Binding", () => {
  const base = createArtifactSource({ artifactKey: "BaseWidget", artifactType: "Widget", initialSize: [320, 180] });
  base.root.children = [{ id: "img_icon", name: "img_icon", rect: base.root.rect }];
  const variantIcon = {
    ...observation().nodes[1]!,
    id: "img_icon",
    name: "img_icon",
    namePath: ["LegacyWidget", "img_icon"],
    parentId: "LegacyWidget",
    components: {},
  };
  const result = importPrefabObservation(
    observation({
      basePrefabPath: artifactPrefabPath({ path: "Imported/BaseWidget.ui.json", artifactKey: base.artifactKey }),
      nodes: [observation().nodes[0]!, variantIcon],
      bindings: [{ fieldName: "img_icon", nodeId: "img_icon", componentType: "Image" }],
      componentAdditions: [
        {
          prefabRefNodeId: "LegacyWidget",
          target: { nodeId: "img_icon" },
          componentType: "Image",
          value: { color: "#59D9FFFF", raycastTarget: false },
        },
      ],
    }),
    importOptions(createSourceCatalog([{ path: "Imported/BaseWidget.ui.json", source: base }])),
  );

  assert.deepEqual(result.blockers, []);
  assert.equal(result.source.sourceKind, "variant");
  assert.deepEqual(result.source.componentAdditions?.[0]?.target, { nodeId: "img_icon" });
  assert.equal(result.source.componentAdditions?.[0]?.componentType, "Image");
  assert.deepEqual(result.source.bindings?.[0], {
    name: "img_icon",
    target: { nodeId: "img_icon", componentType: "Image" },
  });
});

test("imports a Variant-local PrefabRef from the existing Catalog", () => {
  const base = createArtifactSource({ artifactKey: "BaseWidget", artifactType: "Widget", initialSize: [320, 180] });
  const child = createArtifactSource({ artifactKey: "ChildWidget", artifactType: "Widget", initialSize: [80, 40] });
  const sourceObservation = observation();
  const result = importPrefabObservation(
    observation({
      basePrefabPath: artifactPrefabPath({ path: "Imported/BaseWidget.ui.json", artifactKey: base.artifactKey }),
      nodes: [
        sourceObservation.nodes[0]!,
        {
          id: "child",
          identity: "generated",
          name: "Child",
          namePath: ["LegacyWidget", "Child"],
          parentId: "LegacyWidget",
          siblingIndex: 0,
          active: true,
          rect: rect([80, 40]),
          components: {},
          completeComponents: true,
          prefabPath: artifactPrefabPath({ path: "Imported/ChildWidget.ui.json", artifactKey: child.artifactKey }),
          unityOnlyComponents: [],
        },
      ],
      bindings: [],
    }),
    importOptions(
      createSourceCatalog([
        { path: "Imported/BaseWidget.ui.json", source: base },
        { path: "Imported/ChildWidget.ui.json", source: child },
      ]),
    ),
  );

  assert.deepEqual(result.blockers, []);
  assert.equal(result.source.sourceKind, "variant");
  assert.equal(result.source.nodeAdditions?.[0]?.node.components?.PrefabRef?.artifactKey, "ChildWidget");
});
