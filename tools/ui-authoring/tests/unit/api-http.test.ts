import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import test from "node:test";
import { formatPrototype, formatReference } from "../../src/kernel/prototype-canonical.js";
import { type CaptureApiService, mapSemanticError } from "../../src/server/api/services.js";
import { EmbeddingCacheSemanticSearchService } from "../../src/server/semantic-search-service.js";
import { fixture, png, responseBody, source, startApi } from "./api-test-fixture.js";

test("createApiHandler preserves successful response shapes", async () => {
  const { root, paths } = await fixture();
  const api = await startApi(paths);
  try {
    const configResponse = await fetch(`${api.origin}/api/config`);
    assert.equal(configResponse.status, 200);
    assert.deepEqual(await responseBody(configResponse), {
      product: "legma-ui-authoring",
      defaultArtifact: "A.ui.json",
      defaultPrototype: "P.ui-prototype.json",
      workspace: { name: basename(root), path: root, clusterId: null },
    });

    const healthResponse = await fetch(`${api.origin}/api/health`);
    assert.equal(healthResponse.status, 200);
    const health = (await responseBody(healthResponse)) as { phase?: unknown; ok?: unknown; startedAt?: unknown };
    assert.equal(health.phase, "ready");
    assert.equal(health.ok, true);
    assert.equal(typeof health.startedAt, "string");

    const bootstrapResponse = await fetch(`${api.origin}/api/bootstrap`);
    assert.equal(bootstrapResponse.status, 200);
    const bootstrap = (await responseBody(bootstrapResponse)) as {
      catalog: {
        artifacts: Array<{ modifiedAt?: unknown }>;
        directories: Array<{ path?: unknown; displayName?: unknown; description?: unknown; cover?: unknown; modifiedAt?: unknown }>;
      };
      documents: { artifacts: Array<{ path: string; source: { artifactKey: string } }> };
    };
    assert.deepEqual(
      bootstrap.documents.artifacts.map(({ path, source }) => ({ path, artifactKey: source.artifactKey })),
      [{ path: "A.ui.json", artifactKey: "A" }],
    );
    const { catalog } = bootstrap;
    assert.equal(typeof catalog.artifacts[0]?.modifiedAt, "number");
    assert.deepEqual(catalog.directories, [
      {
        path: "",
        displayName: "测试目录",
        description: "API 目录元数据",
        cover: { kind: "Artifact", key: "A" },
        modifiedAt: catalog.directories[0]?.modifiedAt,
      },
    ]);
    assert.equal(typeof catalog.directories[0]?.modifiedAt, "number");
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("semantic search API validates requests and preserves local-search fallback", async () => {
  const { root, paths } = await fixture();
  const api = await startApi(paths, undefined, undefined, undefined, undefined, undefined, undefined, {
    search: async () => ({ status: "unavailable", matches: [] }),
  });
  try {
    const response = await fetch(`${api.origin}/api/workspace/semantic-search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "商店", candidates: [{ id: "artifact:ShopCanvas", texts: ["ShopCanvas", "Shop Canvas"] }] }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await responseBody(response), { status: "unavailable", matches: [] });

    const invalid = await fetch(`${api.origin}/api/workspace/semantic-search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "", candidates: [] }),
    });
    assert.equal(invalid.status, 400);
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("semantic search reuses normalized collections, aggregates texts, and rebuilds expired tokens", async () => {
  const calls: Array<{ readonly path: string; readonly body: Record<string, unknown> }> = [];
  let createCount = 0;
  let expireFirstToken = true;
  const fetchStub = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ path: url.pathname, body });
    if (url.pathname === "/collections") {
      createCount += 1;
      return Response.json({ token: `token-${createCount}` });
    }
    if (url.pathname === "/collections/query" && body.token === "token-1" && expireFirstToken) {
      expireFirstToken = false;
      return Response.json({ error: { type: "collection_expired" } }, { status: 410 });
    }
    if (url.pathname === "/collections/query") {
      return Response.json({
        items: [
          { text: "Shop Canvas", score: 0.61, matched_query_index: 0 },
          { text: "ShopCanvas", score: 0.55, matched_query_index: 0 },
          { text: "Inventory Canvas", score: 0.42, matched_query_index: 0 },
        ],
      });
    }
    throw new Error(`Unexpected path ${url.pathname}`);
  }) as typeof fetch;
  const service = new EmbeddingCacheSemanticSearchService({ endpoint: "http://embedding-cache.test", fetch: fetchStub });
  const candidates = [
    { id: "artifact:ShopCanvas", texts: ["ShopCanvas", "Shop Canvas"] },
    { id: "artifact:InventoryCanvas", texts: ["InventoryCanvas", "Inventory Canvas"] },
  ];
  const first = await service.search({ query: "商店", candidates });
  assert.deepEqual(first, {
    status: "ready",
    matches: [
      { id: "artifact:ShopCanvas", score: 0.61 },
      { id: "artifact:InventoryCanvas", score: 0.42 },
    ],
  });
  assert.equal(createCount, 2);

  const second = await service.search({ query: "购买", candidates: [...candidates].reverse() });
  assert.deepEqual(second, {
    status: "ready",
    matches: [
      { id: "artifact:ShopCanvas", score: 0.61 },
      { id: "artifact:InventoryCanvas", score: 0.42 },
    ],
  });
  assert.equal(createCount, 2);
  assert.deepEqual(
    calls.filter((call) => call.path === "/collections").map((call) => call.body.items),
    [
      ["Inventory Canvas", "InventoryCanvas", "Shop Canvas", "ShopCanvas"],
      ["Inventory Canvas", "InventoryCanvas", "Shop Canvas", "ShopCanvas"],
    ],
  );

  const unavailable = new EmbeddingCacheSemanticSearchService({
    endpoint: "http://embedding-cache.test",
    fetch: (async () => {
      throw new Error("offline");
    }) as typeof fetch,
  });
  assert.deepEqual(await unavailable.search({ query: "商店", candidates }), { status: "unavailable", matches: [] });
});

test("createApiHandler records, downloads, and clears runtime errors", async () => {
  const { root, paths } = await fixture();
  const api = await startApi(paths);
  try {
    const report = await fetch(`${api.origin}/api/diagnostics/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timestamp: "2026-07-22T12:00:00.000Z", message: "client exploded", stack: "stack detail" }),
    });
    assert.equal(report.status, 200);
    const diagnostics = (await responseBody(await fetch(`${api.origin}/api/diagnostics`))) as {
      entries: Array<{ message: string; source: string }>;
    };
    assert.ok(diagnostics.entries.some((entry) => entry.message === "client exploded" && entry.source === "client"));

    const download = await fetch(`${api.origin}/api/diagnostics/download`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition") ?? "", /^attachment; filename="legma-/);
    const text = await download.text();
    assert.match(text, /client exploded/);
    assert.match(text, /stack detail/);
    assert.match(text, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const newerReport = await fetch(`${api.origin}/api/diagnostics/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timestamp: "2026-07-22T12:01:00.000Z", message: "newer client failure" }),
    });
    assert.equal(newerReport.status, 200);

    const clear = await fetch(`${api.origin}/api/diagnostics/clear`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ through: "2026-07-22T12:00:00.000Z" }),
    });
    assert.equal(clear.status, 200);
    const cleared = (await responseBody(clear)) as { cleared: number; entries: Array<{ level: string; message: string }> };
    assert.equal(cleared.cleared, 1);
    assert.deepEqual(
      cleared.entries.filter((entry) => entry.level === "error").map((entry) => entry.message),
      ["newer client failure"],
    );

    const afterClear = (await responseBody(await fetch(`${api.origin}/api/diagnostics`))) as {
      entries: Array<{ level: string; message: string }>;
    };
    assert.deepEqual(afterClear.entries, cleared.entries);
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("createApiHandler serves Reference assets outside formal Unity UI assets", async () => {
  const { root, paths } = await fixture();
  const referenceAsset = join(root, "My project", "UIAuthoring", "ReferenceAssets", "Backdrops", "Main.png");
  await mkdir(join(root, "My project", "UIAuthoring", "ReferenceAssets", "Backdrops"), { recursive: true });
  await writeFile(referenceAsset, png);
  const api = await startApi(paths);
  try {
    const response = await fetch(`${api.origin}/api/reference-asset?path=Backdrops%2FMain.png`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    assert.equal((await fetch(`${api.origin}/api/reference-asset?path=..%2FMain.png`)).status, 400);
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("createApiHandler returns a partial catalog when one Source document is invalid", async () => {
  const { root, paths } = await fixture();
  const api = await startApi(paths);
  try {
    await writeFile(
      join(paths.sourceRoot, "AReference.ui-reference.json"),
      formatReference({ referenceKey: "AReference", subjectArtifactKey: "A" }),
      "utf8",
    );
    await writeFile(
      join(paths.sourceRoot, "P.ui-prototype.json"),
      formatPrototype({ prototypeKey: "P", startReferenceKey: "AReference", interactions: [] }),
      "utf8",
    );
    await writeFile(join(paths.sourceRoot, "Broken.ui.json"), "{", "utf8");

    const response = await fetch(`${api.origin}/api/bootstrap`);
    assert.equal(response.status, 200);
    const { catalog, documents } = (await responseBody(response)) as {
      catalog: {
        artifacts: Array<{ artifactKey: string }>;
        unavailable: Array<{ kind: string; path: string; key: string; modifiedAt?: unknown }>;
        problems: Array<{ path: string; severity: string; code: string }>;
      };
      documents: { references: Array<{ reference: { referenceKey: string } }>; prototypes: Array<{ prototype: { prototypeKey: string } }> };
    };
    assert.deepEqual(
      catalog.artifacts.map((entry) => entry.artifactKey),
      ["A"],
    );
    assert.deepEqual(
      catalog.unavailable.map(({ kind, path, key }) => ({ kind, path, key })),
      [{ kind: "artifact", path: "Broken.ui.json", key: "Broken" }],
    );
    assert.equal(typeof catalog.unavailable[0]?.modifiedAt, "number");
    assert.deepEqual(
      catalog.problems.map(({ path, severity, code }) => ({ path, severity, code })),
      [{ path: "Broken.ui.json", severity: "error", code: "document.json.invalid" }],
    );
    assert.deepEqual(
      documents.references.map((entry) => entry.reference.referenceKey),
      ["AReference"],
    );
    assert.deepEqual(
      documents.prototypes.map((entry) => entry.prototype.prototypeKey),
      ["P"],
    );
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("createApiHandler maps malformed JSON, missing parameters, and invalid paths to 400", async () => {
  const { root, paths } = await fixture();
  const api = await startApi(paths);
  try {
    const malformed = await fetch(`${api.origin}/api/workspace/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(malformed.status, 400);
    assert.match(String((await responseBody(malformed)).error), /invalid JSON/);

    const missing = await fetch(`${api.origin}/api/reference`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: { referenceKey: "R", subjectArtifactKey: "A" }, expectedContent: null }),
    });
    assert.equal(missing.status, 400);

    const invalidPath = await fetch(`${api.origin}/api/reference?path=..%2FA.ui-reference.json`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: { referenceKey: "R", subjectArtifactKey: "A" }, expectedContent: null }),
    });
    assert.equal(invalidPath.status, 400);
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("createApiHandler maps unknown routes and missing resources to 404", async () => {
  const { root, paths } = await fixture();
  const api = await startApi(paths);
  try {
    assert.equal((await fetch(`${api.origin}/api/unknown`)).status, 404);
    assert.equal((await fetch(`${api.origin}/api/reference-asset?path=Missing.png`)).status, 404);
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("createApiHandler maps stale baselines and duplicate identities to 409", async () => {
  const { root, paths } = await fixture();
  const api = await startApi(paths);
  try {
    const response = await fetch(`${api.origin}/api/artifacts/transaction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        upserts: [{ path: "A.ui.json", source: source("A", "changed"), expectedContent: "stale" }],
        deletes: [],
      }),
    });
    assert.equal(response.status, 409);
    const staleBody = await responseBody(response);
    assert.match(String(staleBody.error), /已被其他程序或协作者修改/);
    assert.deepEqual(
      (staleBody.diagnostics as Array<{ code?: unknown; path?: unknown; identity?: { documentKey?: unknown }; nextAction?: unknown }>).map(
        (entry) => [entry.code, entry.path, entry.identity?.documentKey, typeof entry.nextAction],
      ),
      [["save.externalModification", "A.ui.json", "A", "string"]],
    );

    const staleDelete = await fetch(`${api.origin}/api/artifacts/transaction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        upserts: [],
        deletes: [{ path: "A.ui.json", expectedContent: "stale" }],
      }),
    });
    assert.equal(staleDelete.status, 409);
    assert.match(String((await responseBody(staleDelete)).error), /已被其他程序或协作者修改/);

    const duplicate = await fetch(`${api.origin}/api/artifacts/transaction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        upserts: [
          { path: "B.ui.json", source: source("Shared", "one") },
          { path: "C.ui.json", source: source("Shared", "two") },
        ],
        deletes: [],
      }),
    });
    assert.equal(duplicate.status, 409);
    assert.match(String((await responseBody(duplicate)).error), /artifactKeys must be unique/);

    const create = await fetch(`${api.origin}/api/artifacts/transaction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        upserts: [{ path: "New.ui.json", source: source("New", "created"), expectedContent: null }],
        deletes: [],
      }),
    });
    assert.equal(create.status, 200);

    const overwrite = await fetch(`${api.origin}/api/artifacts/transaction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        upserts: [{ path: "New.ui.json", source: source("New", "overwritten"), expectedContent: null }],
        deletes: [],
      }),
    });
    assert.equal(overwrite.status, 409);
    assert.match(String((await responseBody(overwrite)).error), /已被其他程序或协作者修改/);
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("createApiHandler maps Source validation failures to 422", async () => {
  const { root, paths } = await fixture();
  const api = await startApi(paths);
  try {
    const response = await fetch(`${api.origin}/api/artifacts/transaction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ upserts: [{ path: "A.ui.json", source: {} }], deletes: [] }),
    });
    assert.equal(response.status, 422);
    const body = await responseBody(response);
    assert.equal(body.valid, false);
    assert.ok(Array.isArray(body.issues));
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("createApiHandler maps unexpected failures to opaque 500 responses", async () => {
  const { root, paths } = await fixture();
  const captureService: CaptureApiService = {
    async capture() {
      throw new Error("private capture failure");
    },
    session() {
      return undefined;
    },
  };
  const api = await startApi(paths, captureService);
  try {
    const response = await fetch(`${api.origin}/api/capture`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "A.ui.json" }),
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await responseBody(response), { error: "Internal server error" });
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("semantic error mapping leaves infrastructure and unknown failures for opaque 500 handling", () => {
  const accessDenied = Object.assign(new Error("private filesystem path"), { code: "EACCES" });
  assert.equal(mapSemanticError(accessDenied), undefined);
  assert.equal(mapSemanticError(new TypeError("private implementation detail")), undefined);
  assert.equal(mapSemanticError(new Error("unknown dependency failure")), undefined);

  const catalogError = mapSemanticError(new Error("Artifact 'A' references missing artifact 'B'"));
  assert.equal(catalogError?.status, 422);
  assert.equal("error" in catalogError!.body ? catalogError!.body.error : undefined, "Artifact 'A' references missing artifact 'B'");
  assert.equal(catalogError?.body.diagnostics?.[0]?.code, "catalog.missingDependency");
});
