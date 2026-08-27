import assert from "node:assert/strict";
import test from "node:test";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { resolveArtifactDocuments, resolveLocalArtifactDocuments } from "../../src/web/editors/artifact/artifact-documents.js";
import {
  createTransaction,
  createTransactionForKeys,
  createWorkspaceSaveTransactionForKeys,
  dirtyKeys,
  type WorkspaceArtifactMap,
} from "../../src/web/editors/artifact/artifact-workspace-state.js";

function source(artifactKey: string, label: string): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey,
    artifactType: "Widget",
    widgetType: artifactKey,
    initialSize: [100, 40],
    root: {
      id: artifactKey,
      name: label,
      rect: { anchorMin: [0, 0], anchorMax: [0, 0], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [100, 40] },
    },
  };
}

test("workspace transaction protects same-path updates with the saved canonical baseline", () => {
  const previous = source("Existing", "before");
  const saved: WorkspaceArtifactMap = new Map([["Existing", { path: "Existing.ui.json", source: previous }]]);
  const current: WorkspaceArtifactMap = new Map([
    ["Existing", { path: "Existing.ui.json", source: source("Existing", "after") }],
    ["NewWidget", { path: "NewWidget.ui.json", source: source("NewWidget", "new") }],
  ]);

  const transaction = createTransaction(saved, current);

  assert.equal(transaction.upserts.find((entry) => entry.path === "Existing.ui.json")?.expectedContent, formatSource(previous));
  assert.equal(transaction.upserts.find((entry) => entry.path === "NewWidget.ui.json")?.expectedContent, null);
});

test("workspace transaction does not attach an old-path baseline to a moved document", () => {
  const saved: WorkspaceArtifactMap = new Map([["Existing", { path: "Old/Existing.ui.json", source: source("Existing", "before") }]]);
  const current: WorkspaceArtifactMap = new Map([["Existing", { path: "New/Existing.ui.json", source: source("Existing", "after") }]]);

  const transaction = createTransaction(saved, current);

  assert.deepEqual(transaction.deletes, [
    {
      path: "Old/Existing.ui.json",
      expectedContent: formatSource(saved.get("Existing")!.source),
    },
  ]);
  assert.equal(transaction.upserts[0]?.expectedContent, null);
});

test("workspace derives and saves a selected dirty artifact without including its siblings", () => {
  const saved: WorkspaceArtifactMap = new Map([
    ["First", { path: "First.ui.json", source: source("First", "before") }],
    ["Second", { path: "Second.ui.json", source: source("Second", "before") }],
  ]);
  const current: WorkspaceArtifactMap = new Map([
    ["First", { path: "First.ui.json", source: source("First", "after") }],
    ["Second", { path: "Second.ui.json", source: source("Second", "after") }],
  ]);

  assert.deepEqual([...dirtyKeys(saved, current)].sort(), ["First", "Second"]);
  const transaction = createTransactionForKeys(saved, current, new Set(["First"]));
  assert.deepEqual(
    transaction.upserts.map((entry) => entry.source.artifactKey),
    ["First"],
  );
  assert.deepEqual(transaction.deletes, []);
});

test("Web workspace save uses the loaded semantic revision while the standalone transaction keeps exact content", () => {
  const previous = source("Existing", "before");
  const saved: WorkspaceArtifactMap = new Map([
    ["Existing", { path: "Existing.ui.json", source: previous, revision: "json-sha256:baseline" }],
  ]);
  const current: WorkspaceArtifactMap = new Map([
    ["Existing", { path: "Existing.ui.json", source: source("Existing", "after"), revision: "json-sha256:baseline" }],
  ]);

  const workspaceTransaction = createWorkspaceSaveTransactionForKeys(saved, current, new Set(["Existing"]));
  const standaloneTransaction = createTransactionForKeys(saved, current, new Set(["Existing"]));

  assert.equal(workspaceTransaction.upserts[0]?.expectedRevision, "json-sha256:baseline");
  assert.equal(standaloneTransaction.upserts[0]?.expectedContent, formatSource(previous));
});

test("local value resolution updates one concrete artifact and preserves sibling identity", () => {
  const documents: WorkspaceArtifactMap = new Map([
    ["First", { path: "First.ui.json", source: source("First", "first") }],
    ["Second", { path: "Second.ui.json", source: source("Second", "second") }],
  ]);
  const previous = resolveArtifactDocuments(documents);
  const first = documents.get("First")!;
  const firstSource = first.source as UiConcreteSource;
  const changed = new Map(documents).set("First", {
    ...first,
    source: { ...firstSource, root: { ...firstSource.root, rect: { ...firstSource.root.rect, rotation: 15 } } },
  });

  const resolved = resolveLocalArtifactDocuments(previous, changed, new Set(["First"]));

  assert.equal(resolved.get("Second"), previous.get("Second"));
  assert.equal(resolved.get("First")?.resolvedSource.root.rect.rotation, 15);
});
