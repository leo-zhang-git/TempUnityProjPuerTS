import assert from "node:assert/strict";
import test from "node:test";
import type { UiReference } from "../../src/schema/ui-prototype-schema.js";
import { subjectOnlyPreviewReference } from "../../src/web/editors/artifact/artifact-editor-context-preview.js";

test("subject-only Preview removes context evidence and keeps the subject mount chain", () => {
  const reference: UiReference = {
    referenceKey: "SubjectWidget",
    subjectArtifactKey: "SubjectWidget",
    values: { title: { text: "Subject" } },
    instanceValues: [
      { owner: { kind: "artifact", root: "subject", instancePath: ["subjectChild"] }, values: { label: { text: "Subject child" } } },
      { owner: { kind: "artifact", root: "context", instancePath: ["contextChild"] }, values: { label: { text: "Context child" } } },
    ],
    context: { parentArtifactKey: "HostCanvas", placement: { targetBinding: "subjectMount" } },
    collections: [
      { key: "subjectItems", targetBinding: "items", groups: [{ templateKey: "ItemWidget", count: 1 }] },
      {
        key: "subjectMountItems",
        owner: { kind: "mount", mountKey: "subjectMount" },
        targetBinding: "items",
        groups: [{ templateKey: "ItemWidget", count: 1 }],
      },
      { key: "contextItems", owner: { kind: "context" }, targetBinding: "items", groups: [{ templateKey: "ItemWidget", count: 1 }] },
      {
        key: "contextMountItems",
        owner: { kind: "mount", mountKey: "contextMount" },
        targetBinding: "items",
        groups: [{ templateKey: "ItemWidget", count: 1 }],
      },
    ],
    mounts: [
      { key: "subjectMount", targetBinding: "mount", artifactKey: "ChildWidget" },
      {
        key: "nestedSubjectMount",
        owner: { kind: "mount", mountKey: "subjectMount" },
        targetBinding: "nestedMount",
        artifactKey: "NestedWidget",
      },
      { key: "contextMount", owner: { kind: "context" }, targetBinding: "mount", artifactKey: "ChildWidget" },
      {
        key: "nestedContextMount",
        owner: { kind: "mount", mountKey: "contextMount" },
        targetBinding: "nestedMount",
        artifactKey: "NestedWidget",
      },
    ],
    viewport: [1280, 720],
    backdrop: { images: [{ path: "Backdrops/Host.png", viewport: [1280, 720] }] },
  };

  const result = subjectOnlyPreviewReference(reference);

  assert.equal(result.context, undefined);
  assert.equal(result.viewport, undefined);
  assert.equal(result.backdrop, undefined);
  assert.deepEqual(
    result.instanceValues?.map((entry) => entry.owner),
    [{ kind: "artifact", root: "subject", instancePath: ["subjectChild"] }],
  );
  assert.deepEqual(
    result.collections?.map((entry) => entry.key),
    ["subjectItems", "subjectMountItems"],
  );
  assert.deepEqual(
    result.mounts?.map((entry) => entry.key),
    ["subjectMount", "nestedSubjectMount"],
  );
  assert.deepEqual(result.values, reference.values);
  assert.notEqual(result, reference);
});
