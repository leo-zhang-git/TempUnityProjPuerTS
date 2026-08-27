import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAuthoringStructureOperation,
  createArtifactSource,
  createEmptyNode,
  createImageNode,
  createPrefabRefNode,
  createPrototype,
  createReference,
  createTextNode,
} from "../../src/kernel/authoring.js";
import { createReferenceCatalog } from "../../src/kernel/prototype.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";

test("creates valid Canvas, Widget, and Fragment authoring documents", () => {
  const canvas = createArtifactSource({ artifactKey: "MainCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
  const widget = createArtifactSource({ artifactKey: "PanelWidget", artifactType: "Widget", initialSize: [320, 180] });
  const fragment = createArtifactSource({ artifactKey: "BadgeFragment", artifactType: "Fragment", initialSize: [64, 64] });
  assert.equal("initialSize" in canvas, false);
  assert.deepEqual(canvas.root.rect.sizeDelta, [0, 0]);
  assert.equal(widget.widgetType, "PanelWidget");
  assert.deepEqual(widget.root.rect.sizeDelta, [320, 180]);
  assert.equal("widgetType" in fragment, false);
});

test("creates normal and PrefabRef nodes with deterministic defaults", () => {
  assert.deepEqual(createEmptyNode("panel", [240, 120]).rect.sizeDelta, [240, 120]);
  assert.equal(createPrefabRefNode("panelUse", "PanelWidget").components?.PrefabRef?.artifactKey, "PanelWidget");
  assert.deepEqual(createImageNode("image").components, { Image: {} });
  assert.deepEqual(createTextNode("label").components, { Text: { text: "Text", fontSize: 24 } });
  assert.deepEqual(createTextNode("label").rect.sizeDelta, [200, 40]);
});

test("creates validated Reference and Prototype documents", () => {
  const canvas = createArtifactSource({ artifactKey: "MainCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
  const sources = createSourceCatalog([{ path: "MainCanvas.ui.json", source: canvas }]);
  const reference = createReference({ referenceKey: "MainReference", subjectArtifactKey: "MainCanvas" }, sources);
  const references = createReferenceCatalog([{ path: "MainReference.ui-reference.json", reference }]);
  const prototype = createPrototype("MainFlow", "MainReference", references, sources);
  assert.equal("$schema" in reference, false);
  assert.equal(reference.subjectArtifactKey, "MainCanvas");
  assert.equal("viewport" in reference, false);
  assert.equal(prototype.startReferenceKey, "MainReference");
  assert.equal("schemaVersion" in prototype, false);
  assert.deepEqual(prototype.interactions, []);
});

test("applies structural operations with a shared semantic result", () => {
  const source = createArtifactSource({ artifactKey: "MainCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
  const inserted = applyAuthoringStructureOperation(source, { kind: "insert", parentId: "MainCanvas", node: createEmptyNode("panel") });
  assert.equal(inserted.selectedNodeId, "panel");
  assert.ok(inserted.diff.changes.some((change) => change.kind === "nodeAdded" && change.nodeId === "panel"));
  const removed = applyAuthoringStructureOperation(inserted.source, { kind: "remove", nodeId: "panel" });
  assert.equal(removed.selectedNodeId, "MainCanvas");
  assert.ok(removed.diff.changes.some((change) => change.kind === "nodeRemoved" && change.nodeId === "panel"));
});
