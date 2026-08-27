import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CollaborationService, collaborationContentHash } from "../../src/server/collaboration-service.js";
import type { WorkspacePaths } from "../../src/server/workspace.js";

function paths(root: string): WorkspacePaths {
  return {
    repoRoot: root,
    sourceRoot: join(root, "Sources"),
    assetRoot: join(root, "Assets", "UI"),
    runtimeRoot: join(root, ".runtime"),
    defaultArtifact: "LoadingCanvas/LoadingCanvas.ui.json",
    defaultPrototype: "LobbySortieFlow/LobbySortieFlowCore.ui-prototype.json",
  };
}

test("CollaborationService reuses and updates token-bubble identity without dropping other fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "legma-collaboration-profile-"));
  try {
    const userConfigPath = join(root, "user.json");
    await writeFile(userConfigPath, JSON.stringify({ user_name: "Old Name", retained: true }), "utf8");
    const service = new CollaborationService(paths(root), { userConfigPath, environment: {}, actorId: "local", remoteUrl: "" });
    assert.deepEqual(await service.profile(), { actorId: "local", userName: "Old Name", source: "token-bubble", editable: true });
    assert.equal((await service.updateProfile("  Wen   X ")).userName, "Wen X");
    assert.deepEqual(JSON.parse(await readFile(userConfigPath, "utf8")), { user_name: "Wen X", retained: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CollaborationService treats TOKEN_BUBBLE_USER as a read-only override", async () => {
  const service = new CollaborationService(paths("C:/workspace"), {
    environment: { TOKEN_BUBBLE_USER: "Env User" },
    actorId: "local",
    remoteUrl: "",
    userConfigPath: "C:/unused/user.json",
  });
  assert.deepEqual(await service.profile(), { actorId: "local", userName: "Env User", source: "environment", editable: false });
  await assert.rejects(() => service.updateProfile("Other"), /TOKEN_BUBBLE_USER/);
});

test("collaborationContentHash ignores JSON formatting and object key order", () => {
  assert.equal(
    collaborationContentHash('{\r\n  "b": 2, "a": { "d": 4, "c": 3 }\r\n}'),
    collaborationContentHash('{"a":{"c":3,"d":4},"b":2}'),
  );
});

test("CollaborationService combines central status with the local SVN BASE hash", async () => {
  const requests: Array<{ readonly url: string; readonly body: Record<string, unknown> }> = [];
  const fetchLike = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(
      JSON.stringify({
        documents: [
          {
            document: { kind: "artifact", key: "LoadingCanvas", path: "LoadingCanvas/LoadingCanvas.ui.json" },
            editors: [
              { actorId: "lin", userName: "Lin", sessionId: "tab", startedAt: "2026-07-29T10:00:00Z", lastSeenAt: "2026-07-29T10:01:00Z" },
            ],
            latestSave: {
              actorId: "lin",
              userName: "Lin",
              path: "LoadingCanvas/LoadingCanvas.ui.json",
              contentHash: "saved",
              savedAt: "2026-07-29T10:01:00Z",
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  const service = new CollaborationService(paths("C:/workspace"), {
    environment: { TOKEN_BUBBLE_USER: "Wen" },
    actorId: "wen",
    remoteUrl: "http://coordination:8714",
    fetch: fetchLike,
    readSvnBase: async () => '{"value":1}',
  });
  const document = { kind: "artifact", key: "LoadingCanvas", path: "LoadingCanvas/LoadingCanvas.ui.json" } as const;
  const status = await service.status([document]);
  assert.equal(status.connection, "connected");
  assert.equal(status.documents[0]?.svnBaseHash, collaborationContentHash('{"value":1}'));
  assert.equal(status.documents[0]?.editors[0]?.userName, "Lin");
  assert.equal(requests[0]?.url, "http://coordination:8714/api/status");

  await service.recordSaved([{ ...document, contentHash: "hash" }]);
  const savedRequest = requests[1];
  assert.ok(savedRequest);
  assert.equal(savedRequest.url, "http://coordination:8714/api/saves");
  assert.equal((savedRequest.body.actor as { userName?: string }).userName, "Wen");
});

test("CollaborationService activity reads central editors without reading SVN BASE", async () => {
  let svnBaseReads = 0;
  const service = new CollaborationService(paths("C:/workspace"), {
    environment: { TOKEN_BUBBLE_USER: "Wen" },
    actorId: "wen",
    remoteUrl: "http://coordination:8714",
    fetch: (async () =>
      new Response(
        JSON.stringify({
          documents: [
            {
              document: { kind: "artifact", key: "LoadingCanvas", path: "LoadingCanvas/LoadingCanvas.ui.json" },
              editors: [
                {
                  actorId: "lin",
                  userName: "Lin",
                  sessionId: "tab",
                  startedAt: "2026-07-29T10:00:00Z",
                  lastSeenAt: "2026-07-29T10:01:00Z",
                },
              ],
              latestSave: null,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch,
    readSvnBase: async () => {
      svnBaseReads += 1;
      return null;
    },
  });
  const activity = await service.activity([{ kind: "artifact", key: "LoadingCanvas", path: "LoadingCanvas/LoadingCanvas.ui.json" }]);
  assert.equal(activity.connection, "connected");
  assert.equal(activity.documents[0]?.editors[0]?.userName, "Lin");
  assert.equal(svnBaseReads, 0);
});

test("CollaborationService reports remote failures without throwing", async () => {
  const service = new CollaborationService(paths("C:/workspace"), {
    environment: { TOKEN_BUBBLE_USER: "Wen" },
    actorId: "wen",
    remoteUrl: "http://coordination:8714",
    fetch: (async () => {
      throw new Error("offline");
    }) as typeof fetch,
    readSvnBase: async () => null,
  });
  const status = await service.status([{ kind: "artifact", key: "LoadingCanvas", path: "LoadingCanvas/LoadingCanvas.ui.json" }]);
  assert.equal(status.connection, "unavailable");
  assert.match(status.message ?? "", /offline/);
});

test("CollaborationService localizes request timeouts", async () => {
  const service = new CollaborationService(paths("C:/workspace"), {
    environment: { TOKEN_BUBBLE_USER: "Wen" },
    actorId: "wen",
    remoteUrl: "http://coordination:8714",
    fetch: (async () => {
      throw new DOMException("The operation was aborted due to timeout", "AbortError");
    }) as typeof fetch,
    readSvnBase: async () => null,
  });
  const status = await service.status([{ kind: "artifact", key: "LoadingCanvas", path: "LoadingCanvas/LoadingCanvas.ui.json" }]);
  assert.equal(status.message, "协作服务不可用：连接超时");
});
