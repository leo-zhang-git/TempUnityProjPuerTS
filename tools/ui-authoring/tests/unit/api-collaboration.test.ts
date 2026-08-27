import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import test from "node:test";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiCollaborationSavedDocument } from "../../src/schema/ui-collaboration.js";
import { type CollaborationApiService, collaborationContentHash } from "../../src/server/collaboration-service.js";
import { fixture, recordingCollaborationService, responseBody, source, startApi } from "./api-test-fixture.js";

test("collaboration routes validate and forward profile, status, activity, and presence requests", async () => {
  const { root, paths } = await fixture();
  const document = { kind: "artifact", key: "A", path: "A.ui.json" } as const;
  let updatedUserName = "";
  let statusDocuments: readonly (typeof document)[] = [];
  let activityDocuments: readonly (typeof document)[] = [];
  let presenceSessionId = "";
  const profile = { actorId: "local", userName: "Wen", source: "token-bubble", editable: true } as const;
  const collaborationService: CollaborationApiService = {
    profile: async () => profile,
    updateProfile: async (userName) => {
      updatedUserName = userName;
      return { ...profile, userName };
    },
    status: async (documents) => {
      statusDocuments = documents as readonly (typeof document)[];
      return {
        connection: "connected",
        profile,
        documents: documents.map((entry) => ({ document: entry, svnBaseHash: "base", editors: [], latestSave: null })),
      };
    },
    activity: async (documents) => {
      activityDocuments = documents as readonly (typeof document)[];
      return { connection: "connected", profile, documents: documents.map((entry) => ({ document: entry, editors: [] })) };
    },
    syncPresence: async (request) => {
      presenceSessionId = request.sessionId;
      return { connection: "connected" };
    },
    recordSaved: async () => {},
  };
  const api = await startApi(paths, undefined, undefined, undefined, undefined, collaborationService);
  try {
    assert.deepEqual(await responseBody(await fetch(`${api.origin}/api/collaboration/profile`)), profile);

    const update = await fetch(`${api.origin}/api/collaboration/profile`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userName: "Lin" }),
    });
    assert.equal(update.status, 200);
    assert.equal(updatedUserName, "Lin");

    const status = await fetch(`${api.origin}/api/collaboration/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documents: [document] }),
    });
    assert.equal(status.status, 200);
    assert.deepEqual(statusDocuments, [document]);
    assert.equal(((await responseBody(status)).documents as Array<{ svnBaseHash?: unknown }>)[0]?.svnBaseHash, "base");

    const activity = await fetch(`${api.origin}/api/collaboration/activity`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documents: [document] }),
    });
    assert.equal(activity.status, 200);
    assert.deepEqual(activityDocuments, [document]);

    const presence = await fetch(`${api.origin}/api/collaboration/presence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: "tab-1", documents: [document] }),
    });
    assert.equal(presence.status, 200);
    assert.equal(presenceSessionId, "tab-1");

    const invalid = await fetch(`${api.origin}/api/collaboration/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documents: [document], unexpected: true }),
    });
    assert.equal(invalid.status, 400);
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("document saves notify collaboration only after successful persistence", async () => {
  const { root, paths } = await fixture();
  const saved: UiCollaborationSavedDocument[][] = [];
  const api = await startApi(paths, undefined, undefined, undefined, undefined, recordingCollaborationService(saved));
  try {
    const baseline = await readFile(`${paths.sourceRoot}/A.ui.json`, "utf8");
    const invalid = await fetch(`${api.origin}/api/artifacts/transaction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ upserts: [{ path: "A.ui.json", source: {}, expectedContent: baseline }], deletes: [] }),
    });
    assert.equal(invalid.status, 422);
    assert.equal(saved.length, 0);

    const changed = source("A", "saved");
    const artifact = await fetch(`${api.origin}/api/artifacts/transaction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ upserts: [{ path: "A.ui.json", source: changed, expectedContent: baseline }], deletes: [] }),
    });
    assert.equal(artifact.status, 200);
    assert.deepEqual(saved.at(-1), [
      {
        kind: "artifact",
        key: "A",
        path: "A.ui.json",
        contentHash: collaborationContentHash(formatSource(changed)),
      },
    ]);

    const reference = { referenceKey: "R", subjectArtifactKey: "A" };
    const referenceResponse = await fetch(`${api.origin}/api/reference?path=R.ui-reference.json`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: reference, expectedContent: null }),
    });
    assert.equal(referenceResponse.status, 200, JSON.stringify(await referenceResponse.clone().json()));
    assert.equal(saved.at(-1)?.[0]?.kind, "reference");

    const prototype = { prototypeKey: "P", startReferenceKey: "R", interactions: [] };
    const prototypeResponse = await fetch(`${api.origin}/api/prototype?path=P.ui-prototype.json`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: prototype, expectedContent: null }),
    });
    assert.equal(prototypeResponse.status, 200, JSON.stringify(await prototypeResponse.clone().json()));
    assert.equal(saved.at(-1)?.[0]?.kind, "prototype");

    const notificationCount = saved.length;
    const staleReference = await fetch(`${api.origin}/api/reference?path=R.ui-reference.json`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: reference, expectedContent: null }),
    });
    assert.equal(staleReference.status, 409);
    assert.equal(saved.length, notificationCount);
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace rename, duplicate, and delete operations publish complete collaboration changes", async () => {
  const { root, paths } = await fixture();
  const saved: UiCollaborationSavedDocument[][] = [];
  const api = await startApi(paths, undefined, undefined, undefined, undefined, recordingCollaborationService(saved));
  const operate = (body: object): Promise<Response> =>
    fetch(`${api.origin}/api/workspace/documents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const duplicate = await operate({
      action: "duplicate-document",
      kind: "artifact",
      key: "A",
      nextKey: "Copy",
      nextPath: "Copy.ui.json",
    });
    assert.equal(duplicate.status, 200, JSON.stringify(await duplicate.clone().json()));
    assert.deepEqual(
      saved.at(-1)?.map(({ kind, key, path, contentHash }) => ({ kind, key, path, deleted: contentHash === null })),
      [{ kind: "artifact", key: "Copy", path: "Copy.ui.json", deleted: false }],
    );

    const deleted = await operate({ action: "delete-document", kind: "artifact", key: "Copy" });
    assert.equal(deleted.status, 200, JSON.stringify(await deleted.clone().json()));
    assert.deepEqual(saved.at(-1), [{ kind: "artifact", key: "Copy", path: "Copy.ui.json", contentHash: null }]);

    const moved = await operate({ action: "move-document", kind: "artifact", key: "A", nextKey: "B", nextPath: "Moved/B.ui.json" });
    assert.equal(moved.status, 200, JSON.stringify(await moved.clone().json()));
    assert.deepEqual(
      saved.at(-1)?.map(({ kind, key, path, contentHash }) => ({ kind, key, path, deleted: contentHash === null })),
      [
        { kind: "artifact", key: "A", path: "A.ui.json", deleted: true },
        { kind: "artifact", key: "B", path: "Moved/B.ui.json", deleted: false },
      ],
    );
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});
