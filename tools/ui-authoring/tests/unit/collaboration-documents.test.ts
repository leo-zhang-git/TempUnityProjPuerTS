import assert from "node:assert/strict";
import test from "node:test";
import type { DocumentCatalog } from "../../src/schema/ui-api.js";
import {
  allCollaborationDocuments,
  currentCollaborationDocuments,
  dirtyCollaborationDocuments,
} from "../../src/web/application/collaboration-documents.js";

const catalog: DocumentCatalog = {
  artifacts: [{ artifactKey: "A", artifactType: "Widget", path: "A.ui.json", prefabPath: "Assets/Resources/UI/A.prefab", dependencies: [] }],
  references: [{ referenceKey: "R", subjectArtifactKey: "A", path: "R.ui-reference.json" }],
  prototypes: [{ prototypeKey: "P", startReferenceKey: "R", path: "P.ui-prototype.json", interactionCount: 0 }],
  directories: [],
  unavailable: [],
  problems: [],
};

test("current collaboration documents include the prototype and its active reference", () => {
  assert.deepEqual(currentCollaborationDocuments({ kind: "prototype", prototypeKey: "P" }, catalog), [
    { kind: "prototype", key: "P", path: "P.ui-prototype.json" },
    { kind: "reference", key: "R", path: "R.ui-reference.json" },
  ]);
});

test("dirty collaboration documents follow all workspace dirty identities", () => {
  assert.deepEqual(dirtyCollaborationDocuments(new Set(["reference:R", "artifact:A", "missing:X"]), catalog), [
    { kind: "artifact", key: "A", path: "A.ui.json" },
    { kind: "reference", key: "R", path: "R.ui-reference.json" },
  ]);
});

test("workspace collaboration documents include every valid catalog document", () => {
  assert.deepEqual(allCollaborationDocuments(catalog), [
    { kind: "artifact", key: "A", path: "A.ui.json" },
    { kind: "prototype", key: "P", path: "P.ui-prototype.json" },
    { kind: "reference", key: "R", path: "R.ui-reference.json" },
  ]);
});
