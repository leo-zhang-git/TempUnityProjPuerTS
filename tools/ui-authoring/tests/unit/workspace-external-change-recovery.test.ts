import assert from "node:assert/strict";
import test from "node:test";

import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { rebaseWorkspaceDrafts } from "../../src/web/application/workspace-external-change-recovery.js";
import type { WorkspaceArtifactDocument, WorkspaceDraftDocuments } from "../../src/web/editors/artifact/artifact-workspace-state.js";

function source(label: string, artifactKey = "A"): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey,
    artifactType: "Canvas",
    root: {
      id: artifactKey,
      name: label,
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
    },
  };
}

function workspace(artifact?: WorkspaceArtifactDocument): WorkspaceDraftDocuments {
  return {
    artifacts: artifact ? new Map([[artifact.source.artifactKey, artifact]]) : new Map(),
    references: new Map(),
    prototypes: new Map(),
  };
}

test("external-change recovery merges disjoint object fields and advances the disk revision", () => {
  const baseline = { path: "A.ui.json", source: source("before"), revision: "revision:before" };
  const localSource = structuredClone(baseline.source);
  localSource.root.children = [
    {
      id: "localLabel",
      rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [100, 30] },
    },
  ];
  const remoteSource = structuredClone(baseline.source);
  remoteSource.description = "remote description";
  const result = rebaseWorkspaceDrafts({
    current: workspace({ ...baseline, source: localSource }),
    saved: workspace(baseline),
    remote: workspace({ ...baseline, source: remoteSource, revision: "revision:remote" }),
    documentIds: new Set(["artifact:A"]),
  });

  assert.deepEqual(result.conflicts, []);
  const draft = result.drafts.artifacts.get("A");
  assert.ok(draft);
  assert.equal(draft.source.description, "remote description");
  assert.equal((draft.source as UiConcreteSource).root.children?.[0]?.id, "localLabel");
  assert.equal(draft.revision, "revision:remote");
  assert.equal(result.saved.artifacts.get("A")?.revision, "revision:remote");
});

test("external-change recovery keeps overlapping arrays blocked", () => {
  const baseline = { path: "A.ui.json", source: source("before"), revision: "revision:before" };
  const localSource = structuredClone(baseline.source);
  const remoteSource = structuredClone(baseline.source);
  localSource.root.children = [
    {
      id: "localLabel",
      rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [100, 30] },
    },
  ];
  remoteSource.root.children = [
    {
      id: "remoteLabel",
      rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [100, 30] },
    },
  ];
  const result = rebaseWorkspaceDrafts({
    current: workspace({ ...baseline, source: localSource }),
    saved: workspace(baseline),
    remote: workspace({ ...baseline, source: remoteSource, revision: "revision:remote" }),
    documentIds: new Set(["artifact:A"]),
  });

  assert.deepEqual(result.conflicts, [{ documentId: "artifact:A", fieldPaths: ["/root/children"] }]);
});

test("external-change recovery does not advance an unrelated dirty document baseline", () => {
  const baselineA = { path: "A.ui.json", source: source("A before"), revision: "a:before" };
  const baselineB = { path: "B.ui.json", source: source("B before", "B"), revision: "b:before" };
  const localB = { ...baselineB, source: source("B local", "B") };
  const remoteB = { ...baselineB, source: source("B remote", "B"), revision: "b:remote" };
  const saved = {
    artifacts: new Map([
      ["A", baselineA],
      ["B", baselineB],
    ]),
    references: new Map(),
    prototypes: new Map(),
  };
  const result = rebaseWorkspaceDrafts({
    current: { ...saved, artifacts: new Map(saved.artifacts).set("B", localB) },
    saved,
    remote: { ...saved, artifacts: new Map(saved.artifacts).set("B", remoteB) },
    documentIds: new Set(["artifact:A"]),
    protectedDocumentIds: new Set(["artifact:B"]),
  });

  assert.deepEqual(result.conflicts, []);
  const draftB = result.drafts.artifacts.get("B");
  const savedB = result.saved.artifacts.get("B");
  assert.ok(draftB);
  assert.ok(savedB);
  assert.equal((draftB.source as UiConcreteSource).root.name, "B local");
  assert.equal((savedB.source as UiConcreteSource).root.name, "B before");
  assert.equal(savedB.revision, "b:before");
});
