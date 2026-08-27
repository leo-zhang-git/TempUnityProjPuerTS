import assert from "node:assert/strict";
import test from "node:test";
import type { DocumentCatalog } from "../../src/schema/ui-api.js";
import type { UiCollaborationActivityStatus } from "../../src/schema/ui-collaboration.js";
import { createWorkspaceOverview, selectWorkspaceOverviewRows } from "../../src/web/workspace/overview/workspace-overview-model.js";

const now = Date.UTC(2026, 6, 30, 12);
const catalog: DocumentCatalog = {
  artifacts: [
    {
      artifactKey: "MainCanvas",
      artifactType: "Canvas",
      path: "Flow/MainCanvas.ui.json",
      prefabPath: "Assets/Resources/UI/MainCanvas.prefab",
      dependencies: ["ButtonWidget"],
      modifiedAt: now - 60_000,
    },
    {
      artifactKey: "ButtonWidget",
      artifactType: "Widget",
      path: "Common/ButtonWidget.ui.json",
      prefabPath: "Assets/Resources/UI/ButtonWidget.prefab",
      dependencies: [],
      modifiedAt: now - 10 * 24 * 60 * 60_000,
    },
  ],
  references: [
    {
      referenceKey: "MainPreview",
      subjectArtifactKey: "MainCanvas",
      path: "Flow/MainPreview.ui-reference.json",
      modifiedAt: now - 2 * 24 * 60 * 60_000,
    },
  ],
  prototypes: [
    {
      prototypeKey: "MainFlow",
      startReferenceKey: "MainPreview",
      path: "Flow/MainFlow.ui-prototype.json",
      interactionCount: 3,
      modifiedAt: now - 3 * 24 * 60 * 60_000,
    },
  ],
  unavailable: [
    { kind: "artifact", key: "BrokenWidget", path: "BrokenWidget.ui.json", artifactType: "Widget", modifiedAt: now - 4 * 24 * 60 * 60_000 },
  ],
  problems: [
    {
      severity: "error",
      category: "syntax",
      code: "document.json.invalid",
      message: "invalid",
      path: "BrokenWidget.ui.json",
      owner: "artifact",
      safeFixable: false,
      nextAction: "Fix JSON",
    },
  ],
};
const activity: UiCollaborationActivityStatus = {
  connection: "connected",
  profile: { actorId: "wen", userName: "Wen", source: "token-bubble", editable: true },
  documents: [
    {
      document: { kind: "artifact", key: "ButtonWidget", path: "Common/ButtonWidget.ui.json" },
      editors: [
        { actorId: "lin", userName: "Lin", sessionId: "tab", startedAt: "2026-07-30T10:00:00Z", lastSeenAt: "2026-07-30T10:01:00Z" },
      ],
    },
  ],
};

test("workspace overview combines catalog, recent saves, local drafts, and online editors", () => {
  const model = createWorkspaceOverview(catalog, new Set(["artifact:MainCanvas"]), activity, now);
  assert.deepEqual(model.summary, {
    totalDocuments: 5,
    artifactCount: 2,
    canvasCount: 1,
    widgetCount: 1,
    fragmentCount: 0,
    referenceCount: 1,
    prototypeCount: 1,
    interactionCount: 3,
    recentCount: 4,
    activeCount: 2,
    unavailableCount: 1,
    problemCount: 1,
    latestModifiedAt: now - 60_000,
  });
  assert.equal(model.rows.find((entry) => entry.key === "MainCanvas")?.localDirty, true);
  assert.equal(model.rows.find((entry) => entry.key === "ButtonWidget")?.editors[0]?.userName, "Lin");
  assert.equal(model.rows.find((entry) => entry.key === "BrokenWidget")?.problemCount, 1);
});

test("workspace overview filters by type, activity, search, and selected sort", () => {
  const model = createWorkspaceOverview(catalog, new Set(["artifact:MainCanvas"]), activity, now);
  assert.deepEqual(
    selectWorkspaceOverviewRows(model.rows, "lin", "all", true, "name").map((entry) => entry.key),
    ["ButtonWidget"],
  );
  assert.deepEqual(
    selectWorkspaceOverviewRows(model.rows, "", "Prototype", false, "path").map((entry) => entry.key),
    ["MainFlow"],
  );
  assert.equal(selectWorkspaceOverviewRows(model.rows, "missing", "all", false, "modified").length, 0);
});
