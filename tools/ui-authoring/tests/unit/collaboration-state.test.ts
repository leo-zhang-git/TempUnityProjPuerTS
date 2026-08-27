import assert from "node:assert/strict";
import test from "node:test";
import type { UiCollaborationStatus } from "../../src/schema/ui-collaboration.js";
import { isCurrentCollaborationUser, presentCollaborationStatus } from "../../src/web/application/collaboration-state.js";

const profile = { actorId: "local-actor", userName: "Wen X", source: "token-bubble", editable: true } as const;

function connected(overrides: Partial<UiCollaborationStatus["documents"][number]> = {}): UiCollaborationStatus {
  return {
    connection: "connected",
    profile,
    documents: [
      {
        document: { kind: "artifact", key: "LoadingCanvas", path: "LoadingCanvas/LoadingCanvas.ui.json" },
        svnBaseHash: "base-hash",
        editors: [],
        latestSave: null,
        ...overrides,
      },
    ],
  };
}

test("collaboration identity treats the same actor or normalized nickname as self", () => {
  assert.equal(isCurrentCollaborationUser({ actorId: "local-actor", userName: "other" }, profile), true);
  assert.equal(isCurrentCollaborationUser({ actorId: "other-actor", userName: "  wen   x " }, profile), true);
  assert.equal(isCurrentCollaborationUser({ actorId: "other-actor", userName: "Lin" }, profile), false);
});

test("collaboration status stays ready for self edits and self saves", () => {
  const status = connected({
    editors: [
      {
        actorId: "other-machine",
        userName: "Wen X",
        sessionId: "tab",
        startedAt: "2026-07-29T10:00:00Z",
        lastSeenAt: "2026-07-29T10:01:00Z",
      },
    ],
    latestSave: {
      actorId: "other-machine",
      userName: "Wen X",
      path: "LoadingCanvas/LoadingCanvas.ui.json",
      contentHash: "new-hash",
      savedAt: "2026-07-29T10:01:00Z",
    },
  });
  assert.equal(presentCollaborationStatus(status).tone, "ready");
});

test("collaboration status warns for other active editors", () => {
  const result = presentCollaborationStatus(
    connected({
      editors: [
        { actorId: "lin", userName: "Lin", sessionId: "tab", startedAt: "2026-07-29T10:00:00Z", lastSeenAt: "2026-07-29T10:01:00Z" },
      ],
    }),
  );
  assert.equal(result.tone, "warning");
  assert.equal(result.documents[0]?.tone, "editing");
});

test("collaboration status only warns for another user's save when SVN BASE differs", () => {
  const latestSave = {
    actorId: "lin",
    userName: "Lin",
    path: "LoadingCanvas/LoadingCanvas.ui.json",
    contentHash: "new-hash",
    savedAt: "2026-07-29T10:01:00Z",
  };
  assert.equal(presentCollaborationStatus(connected({ latestSave })).documents[0]?.tone, "saved-ahead");
  assert.equal(presentCollaborationStatus(connected({ svnBaseHash: "new-hash", latestSave })).documents[0]?.tone, "ready");
});

test("collaboration status is unavailable without a central response", () => {
  assert.equal(presentCollaborationStatus(null).tone, "unavailable");
  assert.equal(presentCollaborationStatus({ connection: "unavailable", profile, documents: [], message: "timeout" }).summary, "timeout");
});
