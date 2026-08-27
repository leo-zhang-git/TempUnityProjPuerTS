import assert from "node:assert/strict";
import test from "node:test";
import { artifactPrefabPath } from "../../src/kernel/prefab-path.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { createHierarchyNodeStatusIndex, hierarchyNodeStatus } from "../../src/web/editors/shared/editor-hierarchy-status.js";
import type { ArtifactDocument } from "../../src/web/shared/types.js";

function source(artifactKey: string, artifactType: "Canvas" | "Widget", root: UiConcreteSource["root"]): UiConcreteSource {
  return artifactType === "Canvas"
    ? {
        sourceKind: "artifact",
        artifactKey,
        artifactType: "Canvas",
        root,
      }
    : {
        sourceKind: "artifact",
        artifactKey,
        artifactType: "Widget",
        widgetType: artifactKey,
        initialSize: [1280, 720],
        root,
      };
}

function document(source: UiConcreteSource): ArtifactDocument {
  return {
    artifactKey: source.artifactKey,
    artifactType: source.artifactType,
    path: `${source.artifactKey}.ui.json`,
    prefabPath: artifactPrefabPath({ path: `${source.artifactKey}.ui.json`, artifactKey: source.artifactKey }),
    dependencies: [],
    modifiedAt: 0,
    source,
    resolvedSource: source,
  };
}

test("Hierarchy status matches Unity Binder, referenced Binder and StateRoot labels", () => {
  const canvas = source("MainCanvas", "Canvas", {
    id: "MainCanvas",
    rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
    children: [
      {
        id: "widgetUse",
        rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
        components: { PrefabRef: { artifactKey: "StatusWidget" } },
      },
    ],
  });
  canvas.bindings = [{ name: "widgetUse", target: { nodeId: "widgetUse", componentType: "PrefabRef" } }];
  const widget = source("StatusWidget", "Widget", {
    id: "StatusWidget",
    rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
    components: { StateRoot: { currentState: "default", states: { default: { label: true } } } },
    children: [
      { id: "label", rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] } },
    ],
  });
  const artifacts = new Map([
    [canvas.artifactKey, document(canvas)],
    [widget.artifactKey, document(widget)],
  ]);

  assert.deepEqual(
    hierarchyNodeStatus({
      node: canvas.root,
      ownerArtifactKey: canvas.artifactKey,
      instancePath: [],
      localArtifactKey: canvas.artifactKey,
      artifacts,
    }),
    ["B"],
  );
  assert.deepEqual(
    hierarchyNodeStatus({
      node: widget.root,
      ownerArtifactKey: widget.artifactKey,
      instancePath: ["widgetUse"],
      localArtifactKey: canvas.artifactKey,
      artifacts,
    }),
    ["BR", "SR"],
  );
  assert.deepEqual(
    hierarchyNodeStatus({
      node: widget.root.children![0]!,
      ownerArtifactKey: widget.artifactKey,
      instancePath: ["widgetUse"],
      localArtifactKey: canvas.artifactKey,
      artifacts,
    }),
    ["SR:A"],
  );
  const index = createHierarchyNodeStatusIndex(canvas);
  assert.deepEqual(
    hierarchyNodeStatus({
      node: canvas.root,
      ownerArtifactKey: canvas.artifactKey,
      instancePath: [],
      localArtifactKey: canvas.artifactKey,
      artifacts,
      index,
    }),
    ["B"],
  );
});
