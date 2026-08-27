import assert from "node:assert/strict";
import test from "node:test";
import { assertNoPrefabRefLayoutImpacts, findPrefabRefLayoutImpacts } from "../../src/kernel/prefab-ref-layout-impact.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import type { UiConcreteSource, UiPropertyOverride, UiRect } from "../../src/schema/ui-source-schema.js";

function rect(anchorMin: [number, number] = [0, 1], anchorMax: [number, number] = [0, 1], sizeDelta: [number, number] = [100, 20]): UiRect {
  return { anchorMin, anchorMax, pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta };
}

function fragment(artifactKey: string, childId = "track"): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey,
    artifactType: "Fragment",
    initialSize: [100, 20],
    root: {
      id: artifactKey,
      rect: rect(),
      children: [{ id: childId, rect: rect(), components: { Image: { color: "#FFFFFFFF" } } }],
    },
  };
}

function canvas(artifactKey: string, targetArtifactKey: string, overrides: readonly UiPropertyOverride[]): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey,
    artifactType: "Canvas",
    root: {
      id: artifactKey,
      rect: rect([0, 0], [1, 1], [0, 0]),
      children: [
        {
          id: "progressUse",
          rect: rect(),
          components: { PrefabRef: { artifactKey: targetArtifactKey, overrides: [...overrides] } },
        },
      ],
    },
  };
}

function coordinateOverrides(instancePath: readonly string[] = []): UiPropertyOverride[] {
  return [
    {
      target: { instancePath: [...instancePath], nodeId: "track", componentType: "RectTransform", fieldPath: "anchoredPosition" },
      value: [0, 0],
    },
    {
      target: { instancePath: [...instancePath], nodeId: "track", componentType: "RectTransform", fieldPath: "sizeDelta" },
      value: [240, 12],
    },
  ];
}

function catalog(...sources: readonly UiConcreteSource[]) {
  return createSourceCatalog(sources.map((source) => ({ path: `${source.artifactKey}.ui.json`, source })));
}

function stretchTrack(source: UiConcreteSource): UiConcreteSource {
  const result = structuredClone(source);
  result.root.children![0]!.rect.anchorMin = [0, 0];
  result.root.children![0]!.rect.anchorMax = [1, 1];
  return result;
}

test("ignores base layout changes that preserve RectTransform anchors", () => {
  const progress = fragment("ProgressFragment");
  const owner = canvas("OwnerCanvas", progress.artifactKey, coordinateOverrides());
  const changed = structuredClone(progress);
  changed.root.children![0]!.rect.sizeDelta = [200, 20];

  assert.deepEqual(findPrefabRefLayoutImpacts(catalog(progress, owner), catalog(changed, owner)), []);
});

test("reports coordinate overrides that inherit changed anchors", () => {
  const progress = fragment("ProgressFragment");
  const owner = canvas("OwnerCanvas", progress.artifactKey, coordinateOverrides());
  const before = catalog(progress, owner);
  const after = catalog(stretchTrack(progress), owner);

  assert.deepEqual(findPrefabRefLayoutImpacts(before, after), [
    {
      changedArtifactKey: "ProgressFragment",
      changedNodeId: "track",
      changedAnchorFields: ["anchorMin", "anchorMax"],
      ownerArtifactKey: "OwnerCanvas",
      ownerPath: "OwnerCanvas.ui.json",
      useSiteNodeId: "progressUse",
      targetInstancePath: [],
      coordinateOverrideFields: ["anchoredPosition", "sizeDelta"],
      inheritedAnchorFields: ["anchorMin", "anchorMax"],
    },
  ]);
  assert.throws(() => assertNoPrefabRefLayoutImpacts(before, after), /PrefabRef layout impact blocks the anchor change/);
});

test("allows an anchor change when the same transaction completes the use-site override", () => {
  const progress = fragment("ProgressFragment");
  const owner = canvas("OwnerCanvas", progress.artifactKey, coordinateOverrides());
  const fixedOwner = canvas("OwnerCanvas", progress.artifactKey, [
    ...coordinateOverrides(),
    { target: { nodeId: "track", componentType: "RectTransform", fieldPath: "anchorMin" }, value: [0, 1] },
    { target: { nodeId: "track", componentType: "RectTransform", fieldPath: "anchorMax" }, value: [0, 1] },
  ]);

  assert.doesNotThrow(() => assertNoPrefabRefLayoutImpacts(catalog(progress, owner), catalog(stretchTrack(progress), fixedOwner)));
});

test("allows an anchor change when coordinate overrides are removed", () => {
  const progress = fragment("ProgressFragment");
  const owner = canvas("OwnerCanvas", progress.artifactKey, coordinateOverrides());
  const cleanedOwner = canvas("OwnerCanvas", progress.artifactKey, [
    { target: { nodeId: "track", componentType: "Image", fieldPath: "color" }, value: "#00FF00FF" },
  ]);

  assert.doesNotThrow(() => assertNoPrefabRefLayoutImpacts(catalog(progress, owner), catalog(stretchTrack(progress), cleanedOwner)));
});

test("ignores unrelated component overrides", () => {
  const progress = fragment("ProgressFragment");
  const owner = canvas("OwnerCanvas", progress.artifactKey, [
    { target: { nodeId: "track", componentType: "Image", fieldPath: "color" }, value: "#00FF00FF" },
  ]);

  assert.deepEqual(findPrefabRefLayoutImpacts(catalog(progress, owner), catalog(stretchTrack(progress), owner)), []);
});

test("resolves nested PrefabRef instance paths to the changed Artifact", () => {
  const progress = fragment("ProgressFragment");
  const wrapper = fragment("WrapperFragment", "plain");
  wrapper.root.children!.push({
    id: "nestedUse",
    rect: rect(),
    components: { PrefabRef: { artifactKey: progress.artifactKey } },
  });
  const owner = canvas("OwnerCanvas", wrapper.artifactKey, coordinateOverrides(["nestedUse"]));

  const impacts = findPrefabRefLayoutImpacts(catalog(progress, wrapper, owner), catalog(stretchTrack(progress), wrapper, owner));
  assert.equal(impacts.length, 1);
  assert.equal(impacts[0]?.changedArtifactKey, progress.artifactKey);
  assert.deepEqual(impacts[0]?.targetInstancePath, ["nestedUse"]);
});
