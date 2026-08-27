import assert from "node:assert/strict";
import test from "node:test";

import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { documentRevision, documentRevisionFromText } from "../../src/server/document-revision.js";

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "RevisionCanvas",
    artifactType: "Canvas",
    root: {
      id: "RevisionCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
    },
  };
}

test("document revision ignores formatting while preserving invalid external fields as a conflict", () => {
  const document = source();
  const semanticRevision = documentRevision("artifact", document);

  assert.equal(documentRevisionFromText("artifact", JSON.stringify(document)), semanticRevision);
  assert.equal(documentRevisionFromText("artifact", formatSource(document)), semanticRevision);
  assert.notEqual(documentRevisionFromText("artifact", JSON.stringify({ ...document, unsupportedExternalField: true })), semanticRevision);
});
