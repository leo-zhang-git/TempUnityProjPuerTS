import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { formatSource } from "../../src/kernel/canonical.js";
import { formatDeliveryState } from "../../src/kernel/delivery-state.js";
import { formatPrototype, formatReference } from "../../src/kernel/prototype-canonical.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { documentRevisionFromText } from "../../src/server/document-revision.js";
import type { SourceSvnApiService } from "../../src/server/source-svn-service.js";
import { WorkspaceRepository } from "../../src/server/workspace-repository.js";
import type { WorkspaceApiService } from "../../src/server/workspace-service.js";
import { fixture, png, responseBody, source, startApi } from "./api-test-fixture.js";

test("bootstrap reports invalid directory metadata as workspace problems instead of failing", async () => {
  const { root, paths } = await fixture();
  const api = await startApi(paths);
  try {
    await writeFile(join(paths.sourceRoot, ".ui-directory.json"), "{", "utf8");

    const response = await fetch(`${api.origin}/api/bootstrap`);
    assert.equal(response.status, 200);
    const body = (await responseBody(response)) as {
      catalog: { directories?: unknown[]; problems?: Array<{ path: string; code: string; owner: string }> };
    };
    assert.deepEqual(body.catalog.directories, []);
    assert.deepEqual(
      body.catalog.problems?.map(({ path, code, owner }) => ({ path, code, owner })),
      [{ path: ".ui-directory.json", code: "directory.json.invalid", owner: "workspace" }],
    );
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("bootstrap returns config, catalog and documents from one repository snapshot and invalidates after writes", async () => {
  const { root, paths } = await fixture();
  const repository = new WorkspaceRepository(paths.sourceRoot, { freshnessIntervalMs: 60_000 });
  const api = await startApi(paths, undefined, undefined, undefined, repository);
  try {
    const firstResponse = await fetch(`${api.origin}/api/bootstrap`);
    assert.equal(firstResponse.status, 200);
    const first = (await responseBody(firstResponse)) as {
      config: { defaultArtifact: string };
      catalog: { artifacts: Array<{ artifactKey: string }> };
      documents: {
        artifacts: Array<{
          revision: string;
          source: { artifactKey: string; root: { children?: Array<{ components?: { Text?: { text?: string } } }> } };
        }>;
      };
    };
    assert.equal(first.config.defaultArtifact, "A.ui.json");
    assert.deepEqual(
      first.catalog.artifacts.map((entry) => entry.artifactKey),
      ["A"],
    );
    assert.equal(first.documents.artifacts[0]?.source.artifactKey, "A");
    assert.match(first.documents.artifacts[0]?.revision ?? "", /^json-sha256:/);
    assert.equal((await repository.snapshot()).revision, 1);

    const next = source("A", "updated");
    const baseline = await readFile(join(paths.sourceRoot, "A.ui.json"), "utf8");
    const writeResponse = await fetch(`${api.origin}/api/artifacts/transaction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ upserts: [{ path: "A.ui.json", source: next, expectedContent: baseline }], deletes: [] }),
    });
    assert.equal(writeResponse.status, 200, JSON.stringify(await writeResponse.clone().json()));
    const second = (await responseBody(await fetch(`${api.origin}/api/bootstrap`))) as typeof first;
    assert.equal(second.documents.artifacts[0]?.source.root.children?.[0]?.components?.Text?.text, "updated");
    assert.equal((await repository.snapshot()).revision, 2);

    await writeFile(join(paths.sourceRoot, "A.ui.json"), formatSource(source("A", "external")), "utf8");
    const cached = (await responseBody(await fetch(`${api.origin}/api/bootstrap`))) as typeof first;
    assert.equal(cached.documents.artifacts[0]?.source.root.children?.[0]?.components?.Text?.text, "updated");
    const fresh = (await responseBody(await fetch(`${api.origin}/api/bootstrap?fresh=true`))) as typeof first;
    assert.equal(fresh.documents.artifacts[0]?.source.root.children?.[0]?.components?.Text?.text, "external");
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace document operations rename paths, identities, and directory covers atomically", async () => {
  const { root, paths } = await fixture();
  const api = await startApi(paths);
  try {
    const response = await fetch(`${api.origin}/api/workspace/documents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "move-document", kind: "artifact", key: "A", nextKey: "B", nextPath: "Moved/B.ui.json" }),
    });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const body = await responseBody(response);
    assert.deepEqual(body.location, { kind: "artifact", key: "B" });
    assert.deepEqual(body.changedPaths, [".ui-directory.json", "A.ui.json", "Moved/B.ui.json"]);
    const moved = JSON.parse(await readFile(join(paths.sourceRoot, "Moved", "B.ui.json"), "utf8")) as {
      artifactKey: string;
      root: { id: string };
    };
    assert.equal(moved.artifactKey, "B");
    assert.equal(moved.root.id, "B");
    const metadata = JSON.parse(await readFile(join(paths.sourceRoot, ".ui-directory.json"), "utf8")) as { cover: { key: string } };
    assert.equal(metadata.cover.key, "B");
    await assert.rejects(readFile(join(paths.sourceRoot, "A.ui.json"), "utf8"), /ENOENT/);
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace document operations create Source directory metadata without overwriting existing directories", async () => {
  const { root, paths } = await fixture();
  const api = await startApi(paths);
  const create = (): Promise<Response> =>
    fetch(`${api.origin}/api/workspace/documents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "create-directory",
        path: "Screens/Inventory",
        displayName: "Inventory",
        description: "Inventory screens",
      }),
    });
  try {
    const response = await create();
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const body = await responseBody(response);
    assert.deepEqual(body.location, { kind: "directory", path: "Screens/Inventory" });
    assert.deepEqual(body.changedPaths, ["Screens/Inventory/.ui-directory.json"]);
    assert.deepEqual(JSON.parse(await readFile(join(paths.sourceRoot, "Screens", "Inventory", ".ui-directory.json"), "utf8")), {
      displayName: "Inventory",
      description: "Inventory screens",
    });

    const duplicate = await create();
    assert.equal(duplicate.status, 422);
    assert.match(JSON.stringify(await responseBody(duplicate)), /already exists/);
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("asset operations copy, block referenced deletes, and move resource references", async () => {
  const { root, paths } = await fixture();
  const api = await startApi(paths);
  const sourcePath = join(paths.sourceRoot, "A.ui.json");
  const oldAssetPath = join(paths.assetRoot, "Icons", "Old.png");
  try {
    await mkdir(join(paths.assetRoot, "Icons"), { recursive: true });
    await writeFile(oldAssetPath, png);
    await writeFile(
      `${oldAssetPath}.meta`,
      "guid: 00000000000000000000000000000001\ntextureType: 8\nspriteMode: 1\nspritePixelsToUnits: 100\nspriteBorder: {x: 0, y: 0, z: 0, w: 0}\n",
      "utf8",
    );
    const document = source("A", "current");
    document.root.children![0]!.components = { Image: { sprite: "Icons/Old.png" } };
    await writeFile(sourcePath, formatSource(document), "utf8");

    const copy = await fetch(`${api.origin}/api/assets/operation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "copy", from: "Icons/Old.png", to: "Icons/Old Copy.png" }),
    });
    assert.equal(copy.status, 200, JSON.stringify(await copy.clone().json()));
    const copiedMeta = await readFile(join(paths.assetRoot, "Icons", "Old Copy.png.meta"), "utf8");
    assert.doesNotMatch(copiedMeta, /00000000000000000000000000000001/);

    const deleteCopy = await fetch(`${api.origin}/api/assets/operation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "delete", path: "Icons/Old Copy.png" }),
    });
    assert.equal(deleteCopy.status, 200, JSON.stringify(await deleteCopy.clone().json()));
    await assert.rejects(readFile(join(paths.assetRoot, "Icons", "Old Copy.png")), /ENOENT/);

    const deleteReferenced = await fetch(`${api.origin}/api/assets/operation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "delete", path: "Icons/Old.png" }),
    });
    assert.equal(deleteReferenced.status, 422);

    const move = await fetch(`${api.origin}/api/assets/operation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "move", from: "Icons/Old.png", to: "Shared/Renamed.png" }),
    });
    assert.equal(move.status, 200, JSON.stringify(await move.clone().json()));
    await assert.rejects(readFile(oldAssetPath), /ENOENT/);
    await readFile(join(paths.assetRoot, "Shared", "Renamed.png"));
    const stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
    assert.equal(stored.root.children?.[0]?.components?.Image?.sprite, "Shared/Renamed.png");
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("createApiHandler scopes TortoiseSVN actions and exposes editor environments", async () => {
  const { root, paths } = await fixture();
  const opened: string[] = [];
  const workspaceService: WorkspaceApiService = {
    async identity() {
      return { name: "long", path: root, clusterId: 3 };
    },
    async environments() {
      return [
        { name: "long", path: root, clusterId: 3, origin: "http://127.0.0.1:14324", current: true },
        { name: "long2", path: `${root}2`, clusterId: 4, origin: "http://127.0.0.1:14325", current: false },
      ];
    },
    async openVersionControl(action) {
      opened.push(action);
      return { action, paths: [paths.sourceRoot, paths.assetRoot] };
    },
  };
  const api = await startApi(paths, undefined, undefined, workspaceService);
  try {
    const environments = (await responseBody(await fetch(`${api.origin}/api/workspace/environments`))) as {
      environments: Array<{ name: string; path: string }>;
    };
    assert.deepEqual(
      environments.environments.map(({ name, path }) => ({ name, path })),
      [
        { name: "long", path: root },
        { name: "long2", path: `${root}2` },
      ],
    );

    const commit = await fetch(`${api.origin}/api/workspace/vcs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "commit" }),
    });
    assert.equal(commit.status, 200);
    assert.deepEqual(await responseBody(commit), { launched: true, action: "commit", paths: [paths.sourceRoot, paths.assetRoot] });
    assert.deepEqual(opened, ["commit"]);

    const invalid = await fetch(`${api.origin}/api/workspace/vcs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "commit", paths: [root] }),
    });
    assert.equal(invalid.status, 400);
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("createApiHandler reports and reverts the current Artifact SVN modification", async () => {
  const { root, paths } = await fixture();
  const sourcePath = join(paths.sourceRoot, "A.ui.json");
  const local = await readFile(sourcePath, "utf8");
  const reverted = formatSource(source("A", "svn-base"));
  const calls: string[] = [];
  const sourceSvnService: SourceSvnApiService = {
    async status(path) {
      calls.push(`status:${path}`);
      return { path, state: "modified", canRevert: true, message: "还原当前 Source 到 SVN BASE" };
    },
    async revert(request) {
      calls.push(`revert:${request.path}`);
      assert.equal(request.expectedRevision, documentRevisionFromText("artifact", local));
      await writeFile(sourcePath, reverted, "utf8");
      return { reverted: true, path: request.path };
    },
  };
  const repository = new WorkspaceRepository(paths.sourceRoot);
  const api = await startApi(paths, undefined, undefined, undefined, repository, undefined, sourceSvnService);
  try {
    const status = await fetch(`${api.origin}/api/artifact/svn-status?path=A.ui.json`);
    assert.equal(status.status, 200);
    assert.deepEqual(await responseBody(status), {
      path: "A.ui.json",
      state: "modified",
      canRevert: true,
      message: "还原当前 Source 到 SVN BASE",
    });

    const response = await fetch(`${api.origin}/api/artifact/svn-revert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "A.ui.json", expectedRevision: documentRevisionFromText("artifact", local) }),
    });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.deepEqual(await responseBody(response), { reverted: true, path: "A.ui.json" });
    assert.equal(await readFile(sourcePath, "utf8"), reverted);
    const bootstrap = (await responseBody(await fetch(`${api.origin}/api/bootstrap`))) as {
      documents: { artifacts: Array<{ source: UiConcreteSource }> };
    };
    assert.equal(bootstrap.documents.artifacts[0]?.source.root.children?.[0]?.components?.Text?.text, "svn-base");
    assert.deepEqual(calls, ["status:A.ui.json", "revert:A.ui.json"]);

    const invalid = await fetch(`${api.origin}/api/artifact/svn-revert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "A.ui.json" }),
    });
    assert.equal(invalid.status, 400);
  } finally {
    await api.close();
    repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("createApiHandler guards Reference and Prototype writes with exact baselines", async () => {
  const { root, paths } = await fixture();
  const api = await startApi(paths);
  const referencePath = join(paths.sourceRoot, "A.ui-reference.json");
  const prototypePath = join(paths.sourceRoot, "P.ui-prototype.json");
  const reference = { referenceKey: "A", subjectArtifactKey: "A" } as const;
  const prototype = { prototypeKey: "P", startReferenceKey: "A", interactions: [] };
  try {
    const createReference = await fetch(`${api.origin}/api/reference?path=A.ui-reference.json`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: reference, expectedContent: null }),
    });
    assert.equal(createReference.status, 200);
    const referenceBaseline = await readFile(referencePath, "utf8");

    const updateReference = await fetch(`${api.origin}/api/reference?path=A.ui-reference.json`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: { ...reference, description: "saved" }, expectedContent: referenceBaseline }),
    });
    assert.equal(updateReference.status, 200);
    const externalReference = formatReference({ ...reference, description: "external" });
    await writeFile(referencePath, externalReference, "utf8");
    const staleReference = await fetch(`${api.origin}/api/reference?path=A.ui-reference.json`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: { ...reference, description: "stale" }, expectedContent: referenceBaseline }),
    });
    assert.equal(staleReference.status, 409);
    assert.equal(await readFile(referencePath, "utf8"), externalReference);

    const createPrototype = await fetch(`${api.origin}/api/prototype?path=P.ui-prototype.json`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: prototype, expectedContent: null }),
    });
    assert.equal(createPrototype.status, 200);
    const prototypeBaseline = await readFile(prototypePath, "utf8");
    const externalPrototype = formatPrototype({ ...prototype, prototypeKey: "PExternal" });
    await writeFile(prototypePath, externalPrototype, "utf8");
    const stalePrototype = await fetch(`${api.origin}/api/prototype?path=P.ui-prototype.json`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: prototype, expectedContent: prototypeBaseline }),
    });
    assert.equal(stalePrototype.status, 409);
    assert.equal(await readFile(prototypePath, "utf8"), externalPrototype);

    const staleNullReference = await fetch(`${api.origin}/api/reference?path=A.ui-reference.json`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: reference, expectedContent: null }),
    });
    assert.equal(staleNullReference.status, 409);
    const staleNullPrototype = await fetch(`${api.origin}/api/prototype?path=P.ui-prototype.json`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: prototype, expectedContent: null }),
    });
    assert.equal(staleNullPrototype.status, 409);
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace save writes Artifact, Reference, and Prototype documents", async () => {
  const { root, paths } = await fixture();
  const artifactPath = join(paths.sourceRoot, "A.ui.json");
  const baseline = await readFile(artifactPath, "utf8");
  const reference = { referenceKey: "R", subjectArtifactKey: "A" };
  const prototype = { prototypeKey: "P", startReferenceKey: "R", interactions: [] };
  const api = await startApi(paths);
  try {
    const response = await fetch(`${api.origin}/api/workspace/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifacts: {
          upserts: [
            {
              path: "A.ui.json",
              source: source("A", "changed"),
              expectedRevision: documentRevisionFromText("artifact", baseline),
            },
          ],
          deletes: [],
        },
        references: [{ path: "R.ui-reference.json", reference, expectedRevision: null }],
        prototypes: [{ path: "P.ui-prototype.json", prototype, expectedRevision: null }],
      }),
    });
    assert.equal(response.status, 200, JSON.stringify(await responseBody(response.clone())));
    assert.equal(
      (JSON.parse(await readFile(artifactPath, "utf8")) as UiConcreteSource).root.children?.[0]?.components?.Text?.text,
      "changed",
    );
    assert.deepEqual(JSON.parse(await readFile(join(paths.sourceRoot, "R.ui-reference.json"), "utf8")), reference);
    assert.deepEqual(JSON.parse(await readFile(join(paths.sourceRoot, "P.ui-prototype.json"), "utf8")), prototype);
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace save reports external modification diagnostics before writing", async () => {
  const { root, paths } = await fixture();
  const artifactPath = join(paths.sourceRoot, "A.ui.json");
  const baseline = await readFile(artifactPath, "utf8");
  const api = await startApi(paths);
  try {
    await writeFile(artifactPath, formatSource(source("A", "external")), "utf8");
    const response = await fetch(`${api.origin}/api/workspace/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifacts: {
          upserts: [
            {
              path: "A.ui.json",
              source: source("A", "local"),
              expectedRevision: documentRevisionFromText("artifact", baseline),
            },
          ],
          deletes: [],
        },
        references: [],
        prototypes: [],
      }),
    });
    assert.equal(response.status, 409, JSON.stringify(await responseBody(response.clone())));
    const result = (await responseBody(response)) as {
      diagnostics?: readonly { path: string; code: string; owner: string }[];
    };
    assert.deepEqual(result.diagnostics, [
      {
        path: "A.ui.json",
        severity: "error",
        category: "save",
        code: "save.externalModification",
        message: "文件“A.ui.json”已被其他程序或协作者修改，本次保存没有覆盖磁盘内容。请重新加载或合并后重试。",
        owner: "artifact",
        safeFixable: false,
        nextAction: "重新加载磁盘版本，合并修改后再重试保存。",
        identity: { documentKind: "artifact", documentKey: "A" },
      },
    ]);
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace save accepts semantic revisions from non-canonical Artifact, Reference, and Prototype files", async () => {
  const { root, paths } = await fixture();
  const artifactPath = join(paths.sourceRoot, "A.ui.json");
  const referencePath = join(paths.sourceRoot, "R.ui-reference.json");
  const prototypePath = join(paths.sourceRoot, "P.ui-prototype.json");
  const artifact = source("A", "before");
  const reference = { referenceKey: "R", subjectArtifactKey: "A" };
  const prototype = { prototypeKey: "P", startReferenceKey: "R", interactions: [] };
  await writeFile(artifactPath, JSON.stringify(artifact), "utf8");
  await writeFile(referencePath, JSON.stringify(reference), "utf8");
  await writeFile(prototypePath, JSON.stringify(prototype), "utf8");
  const api = await startApi(paths);
  try {
    const bootstrap = (await responseBody(await fetch(`${api.origin}/api/bootstrap`))) as {
      documents: {
        artifacts: Array<{ path: string; revision: string }>;
        references: Array<{ path: string; revision: string }>;
        prototypes: Array<{ path: string; revision: string }>;
      };
    };
    const revisionFor = (kind: "artifacts" | "references" | "prototypes", path: string): string =>
      bootstrap.documents[kind].find((document) => document.path === path)!.revision;
    const response = await fetch(`${api.origin}/api/workspace/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifacts: {
          upserts: [
            {
              path: "A.ui.json",
              source: source("A", "saved"),
              expectedRevision: revisionFor("artifacts", "A.ui.json"),
            },
          ],
          deletes: [],
        },
        references: [
          {
            path: "R.ui-reference.json",
            reference: { ...reference, description: "saved" },
            expectedRevision: revisionFor("references", "R.ui-reference.json"),
          },
        ],
        prototypes: [
          {
            path: "P.ui-prototype.json",
            prototype,
            expectedRevision: revisionFor("prototypes", "P.ui-prototype.json"),
          },
        ],
      }),
    });
    assert.equal(response.status, 200, JSON.stringify(await responseBody(response.clone())));
    const result = (await responseBody(response)) as {
      artifacts: { upserts: Array<{ revision: string }> };
      references: Array<{ revision: string }>;
      prototypes: Array<{ revision: string }>;
    };
    assert.match(result.artifacts.upserts[0]?.revision ?? "", /^json-sha256:/);
    assert.match(result.references[0]?.revision ?? "", /^json-sha256:/);
    assert.match(result.prototypes[0]?.revision ?? "", /^json-sha256:/);
    assert.equal(await readFile(artifactPath, "utf8"), formatSource(source("A", "saved")));
    assert.equal(await readFile(referencePath, "utf8"), formatReference({ ...reference, description: "saved" }));
    assert.equal(await readFile(prototypePath, "utf8"), formatPrototype(prototype));
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace save re-keys DeliveryState for a semantic Node identity operation", async () => {
  const { root, paths } = await fixture();
  const artifactPath = join(paths.sourceRoot, "A.ui.json");
  const before = source("A", "current");
  before.bindings = [{ name: "labelText", target: { nodeId: "label", componentType: "Text" } }];
  await writeFile(artifactPath, formatSource(before), "utf8");
  const baseline = await readFile(artifactPath, "utf8");
  const deliveryStateDirectory = join(root, "My project", "UIAuthoring", "DeliveryState");
  const deliveryStatePath = join(deliveryStateDirectory, "A.ui-delivery-state.json");
  await mkdir(deliveryStateDirectory, { recursive: true });
  await writeFile(deliveryStatePath, formatDeliveryState({ prefabGuid: "a".repeat(32), nodes: { label: "100" } }), "utf8");
  const after = structuredClone(before);
  after.root.children![0]!.id = "statusLabel";
  after.root.children![0]!.name = "Status Label";
  after.bindings![0]!.target.nodeId = "statusLabel";
  const operation = {
    id: "rename-label",
    mappings: [{ ownerArtifactKey: "A", beforeNodeId: "label", afterNodeId: "statusLabel" }],
  };
  const api = await startApi(paths);
  try {
    const response = await fetch(`${api.origin}/api/workspace/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifacts: {
          upserts: [{ path: "A.ui.json", source: after, expectedRevision: documentRevisionFromText("artifact", baseline) }],
          deletes: [],
        },
        references: [],
        prototypes: [],
        nodeIdentityOperations: [operation],
      }),
    });
    assert.equal(response.status, 200, JSON.stringify(await responseBody(response.clone())));
    const result = (await responseBody(response)) as {
      completedNodeIdentityOperationIds: string[];
      writtenDeliveryStatePaths: string[];
    };
    assert.deepEqual(result.completedNodeIdentityOperationIds, ["rename-label"]);
    assert.deepEqual(result.writtenDeliveryStatePaths, ["My project/UIAuthoring/DeliveryState/A.ui-delivery-state.json"]);
    assert.deepEqual((JSON.parse(await readFile(deliveryStatePath, "utf8")) as { nodes: Record<string, string> }).nodes, {
      statusLabel: "100",
    });

    const retry = await fetch(`${api.origin}/api/workspace/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifacts: { upserts: [], deletes: [] },
        references: [],
        prototypes: [],
        nodeIdentityOperations: [operation],
      }),
    });
    assert.equal(retry.status, 200, JSON.stringify(await responseBody(retry.clone())));
    const retryResult = (await responseBody(retry)) as {
      completedNodeIdentityOperationIds: string[];
      writtenDeliveryStatePaths: string[];
    };
    assert.deepEqual(retryResult.completedNodeIdentityOperationIds, ["rename-label"]);
    assert.deepEqual(retryResult.writtenDeliveryStatePaths, []);
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace save validates every candidate before writing", async () => {
  const { root, paths } = await fixture();
  const artifactPath = join(paths.sourceRoot, "A.ui.json");
  const baseline = await readFile(artifactPath, "utf8");
  const invalid = source("A", "changed");
  invalid.root.children![0]!.components = { ButtonEx: { targetGraphic: "" } };
  const api = await startApi(paths);
  try {
    const response = await fetch(`${api.origin}/api/workspace/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifacts: {
          upserts: [{ path: "A.ui.json", source: invalid, expectedRevision: documentRevisionFromText("artifact", baseline) }],
          deletes: [],
        },
        references: [{ path: "R.ui-reference.json", reference: { referenceKey: "R", subjectArtifactKey: "A" }, expectedRevision: null }],
        prototypes: [
          {
            path: "P.ui-prototype.json",
            prototype: { prototypeKey: "P", startReferenceKey: "R", interactions: [] },
            expectedRevision: null,
          },
        ],
      }),
    });
    assert.equal(response.status, 422);
    assert.equal(await readFile(artifactPath, "utf8"), baseline);
    await assert.rejects(readFile(join(paths.sourceRoot, "R.ui-reference.json"), "utf8"), { code: "ENOENT" });
    await assert.rejects(readFile(join(paths.sourceRoot, "P.ui-prototype.json"), "utf8"), { code: "ENOENT" });
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Artifact saves block unresolved PrefabRef layout impacts and allow a complete workspace transaction", async () => {
  const { root, paths } = await fixture();
  const ownerPath = join(paths.sourceRoot, "A.ui.json");
  const progressPath = join(paths.sourceRoot, "ProgressFragment.ui.json");
  const progress = source("ProgressFragment", "progress");
  progress.artifactType = "Fragment";
  delete progress.widgetType;
  progress.root.children![0]!.id = "track";
  const owner = source("A", "current");
  owner.root.children!.push({
    id: "progressUse",
    rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [100, 20] },
    components: {
      PrefabRef: {
        artifactKey: progress.artifactKey,
        overrides: [
          { target: { nodeId: "track", componentType: "RectTransform", fieldPath: "anchoredPosition" }, value: [0, 0] },
          { target: { nodeId: "track", componentType: "RectTransform", fieldPath: "sizeDelta" }, value: [240, 12] },
        ],
      },
    },
  });
  await writeFile(ownerPath, formatSource(owner), "utf8");
  await writeFile(progressPath, formatSource(progress), "utf8");
  const ownerBaseline = await readFile(ownerPath, "utf8");
  const progressBaseline = await readFile(progressPath, "utf8");
  const changedProgress = structuredClone(progress);
  changedProgress.root.children![0]!.rect.anchorMin = [0, 0];
  changedProgress.root.children![0]!.rect.anchorMax = [1, 1];
  const fixedOwner = structuredClone(owner);
  fixedOwner.root.children![1]!.components!.PrefabRef!.overrides!.push(
    { target: { nodeId: "track", componentType: "RectTransform", fieldPath: "anchorMin" }, value: [0, 1] },
    { target: { nodeId: "track", componentType: "RectTransform", fieldPath: "anchorMax" }, value: [0, 1] },
  );
  const api = await startApi(paths);
  try {
    for (const saveMode of ["strict", "repair"] as const) {
      const blocked = await fetch(`${api.origin}/api/artifacts/transaction`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          upserts: [{ path: "ProgressFragment.ui.json", source: changedProgress, expectedContent: progressBaseline }],
          deletes: [],
          saveMode,
        }),
      });
      assert.equal(blocked.status, 422, JSON.stringify(await responseBody(blocked.clone())));
      assert.match(JSON.stringify(await responseBody(blocked)), /PrefabRef layout impact/);
      assert.equal(await readFile(progressPath, "utf8"), progressBaseline);
    }

    const complete = await fetch(`${api.origin}/api/workspace/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifacts: {
          upserts: [
            {
              path: "ProgressFragment.ui.json",
              source: changedProgress,
              expectedRevision: documentRevisionFromText("artifact", progressBaseline),
            },
            {
              path: "A.ui.json",
              source: fixedOwner,
              expectedRevision: documentRevisionFromText("artifact", ownerBaseline),
            },
          ],
          deletes: [],
        },
        references: [],
        prototypes: [],
      }),
    });
    assert.equal(complete.status, 200, JSON.stringify(await responseBody(complete.clone())));
    const storedProgress = JSON.parse(await readFile(progressPath, "utf8")) as UiConcreteSource;
    const storedOwner = JSON.parse(await readFile(ownerPath, "utf8")) as UiConcreteSource;
    assert.deepEqual(storedProgress.root.children?.[0]?.rect.anchorMax, [1, 1]);
    assert.deepEqual(
      storedOwner.root.children?.[1]?.components?.PrefabRef?.overrides?.map((entry) => entry.target.fieldPath),
      ["anchoredPosition", "sizeDelta", "anchorMin", "anchorMax"],
    );
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace save ignores unavailable documents outside the changed dependency closure", async () => {
  const { root, paths } = await fixture();
  const artifactPath = join(paths.sourceRoot, "A.ui.json");
  const baseline = await readFile(artifactPath, "utf8");
  await writeFile(
    join(paths.sourceRoot, "Unrelated.ui-reference.json"),
    `${JSON.stringify({ referenceKey: "Unrelated", subjectArtifactKey: "Missing", legacyField: true }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(paths.sourceRoot, "Unrelated.ui-prototype.json"),
    `${JSON.stringify({ prototypeKey: "Unrelated", startReferenceKey: "Missing", interactions: [], legacyField: true }, null, 2)}\n`,
    "utf8",
  );
  const api = await startApi(paths);
  try {
    const response = await fetch(`${api.origin}/api/workspace/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifacts: {
          upserts: [
            {
              path: "A.ui.json",
              source: source("A", "changed"),
              expectedRevision: documentRevisionFromText("artifact", baseline),
            },
          ],
          deletes: [],
        },
        references: [],
        prototypes: [],
      }),
    });
    assert.equal(response.status, 200, JSON.stringify(await responseBody(response.clone())));
    assert.equal(
      (JSON.parse(await readFile(artifactPath, "utf8")) as UiConcreteSource).root.children?.[0]?.components?.Text?.text,
      "changed",
    );
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace save blocks unavailable reverse dependencies before writing", async () => {
  const { root, paths } = await fixture();
  const artifactPath = join(paths.sourceRoot, "A.ui.json");
  const artifactBaseline = await readFile(artifactPath, "utf8");
  const referencePath = join(paths.sourceRoot, "R.ui-reference.json");
  const reference = { referenceKey: "R", subjectArtifactKey: "A" };
  const referenceBaseline = formatReference(reference);
  await writeFile(referencePath, referenceBaseline, "utf8");
  await writeFile(
    join(paths.sourceRoot, "Broken.ui-reference.json"),
    `${JSON.stringify({ referenceKey: "Broken", subjectArtifactKey: "A", legacyField: true }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(paths.sourceRoot, "Broken.ui-prototype.json"),
    `${JSON.stringify({ prototypeKey: "Broken", startReferenceKey: "R", interactions: [], legacyField: true }, null, 2)}\n`,
    "utf8",
  );
  const api = await startApi(paths);
  try {
    const artifactResponse = await fetch(`${api.origin}/api/workspace/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifacts: {
          upserts: [
            {
              path: "A.ui.json",
              source: source("A", "changed"),
              expectedRevision: documentRevisionFromText("artifact", artifactBaseline),
            },
          ],
          deletes: [],
        },
        references: [],
        prototypes: [],
      }),
    });
    assert.equal(artifactResponse.status, 422);
    assert.equal(((await responseBody(artifactResponse)).diagnostics as Array<{ path?: unknown }>)[0]?.path, "Broken.ui-reference.json");
    assert.equal(await readFile(artifactPath, "utf8"), artifactBaseline);

    const referenceResponse = await fetch(`${api.origin}/api/workspace/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifacts: { upserts: [], deletes: [] },
        references: [
          {
            path: "R.ui-reference.json",
            reference: { ...reference, description: "changed" },
            expectedRevision: documentRevisionFromText("reference", referenceBaseline),
          },
        ],
        prototypes: [],
      }),
    });
    assert.equal(referenceResponse.status, 422);
    assert.equal(((await responseBody(referenceResponse)).diagnostics as Array<{ path?: unknown }>)[0]?.path, "Broken.ui-prototype.json");
    assert.equal(await readFile(referencePath, "utf8"), referenceBaseline);
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace save checks every baseline before its first write", async () => {
  const { root, paths } = await fixture();
  const artifactPath = join(paths.sourceRoot, "A.ui.json");
  const referencePath = join(paths.sourceRoot, "R.ui-reference.json");
  const artifactBaseline = await readFile(artifactPath, "utf8");
  const reference = { referenceKey: "R", subjectArtifactKey: "A", description: "before" };
  const referenceBaseline = formatReference(reference);
  await writeFile(referencePath, referenceBaseline, "utf8");
  const api = await startApi(paths);
  try {
    const response = await fetch(`${api.origin}/api/workspace/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifacts: {
          upserts: [
            {
              path: "A.ui.json",
              source: source("A", "changed"),
              expectedRevision: documentRevisionFromText("artifact", artifactBaseline),
            },
          ],
          deletes: [],
        },
        references: [{ path: "R.ui-reference.json", reference: { ...reference, description: "after" }, expectedRevision: "stale" }],
        prototypes: [],
      }),
    });
    assert.equal(response.status, 409);
    assert.equal(await readFile(artifactPath, "utf8"), artifactBaseline);
    assert.equal(await readFile(referencePath, "utf8"), referenceBaseline);
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("repair save isolates an unrelated invalid Source while strict save reports its field", async () => {
  const { root, paths } = await fixture();
  const artifactPath = join(paths.sourceRoot, "A.ui.json");
  const baseline = await readFile(artifactPath, "utf8");
  const invalid = { ...source("Broken", "broken"), legacyField: true };
  await writeFile(join(paths.sourceRoot, "Broken.ui.json"), `${JSON.stringify(invalid, null, 2)}\n`, "utf8");
  const api = await startApi(paths);
  try {
    const changed = source("A", "changed");
    const strict = await fetch(`${api.origin}/api/artifacts/transaction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        upserts: [{ path: "A.ui.json", source: changed, expectedContent: baseline }],
        deletes: [],
        saveMode: "strict",
      }),
    });
    assert.equal(strict.status, 422);
    const strictBody = (await responseBody(strict)) as {
      readonly path?: string;
      readonly issues?: readonly { readonly path?: string; readonly message?: string }[];
    };
    assert.equal(strictBody.path, "Broken.ui.json");
    assert.equal(strictBody.issues?.[0]?.path, "/legacyField");
    assert.match(strictBody.issues?.[0]?.message ?? "", /不支持的字段“legacyField”/);
    const strictDiagnostic = (
      strictBody as {
        readonly diagnostics?: readonly {
          readonly code?: string;
          readonly path?: string;
          readonly identity?: { readonly documentKey?: string; readonly fieldPath?: string };
          readonly nextAction?: string;
        }[];
      }
    ).diagnostics?.[0];
    assert.deepEqual(
      [
        strictDiagnostic?.code,
        strictDiagnostic?.path,
        strictDiagnostic?.identity?.documentKey,
        strictDiagnostic?.identity?.fieldPath,
        typeof strictDiagnostic?.nextAction,
      ],
      ["schema.additionalProperties", "Broken.ui.json", "Broken", "/legacyField", "string"],
    );
    assert.equal(await readFile(artifactPath, "utf8"), baseline);

    const repair = await fetch(`${api.origin}/api/artifacts/transaction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        upserts: [{ path: "A.ui.json", source: changed, expectedContent: baseline }],
        deletes: [],
        saveMode: "repair",
      }),
    });
    assert.equal(repair.status, 200);
    assert.equal(
      (JSON.parse(await readFile(artifactPath, "utf8")) as UiConcreteSource).root.children?.[0]?.components?.Text?.text,
      "changed",
    );
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("repair save blocks unavailable reverse dependencies and unparseable documents", async () => {
  const { root, paths } = await fixture();
  const artifactPath = join(paths.sourceRoot, "A.ui.json");
  const baseline = await readFile(artifactPath, "utf8");
  const dependent = { ...source("Broken", "broken"), legacyField: true };
  dependent.root.children!.push({
    id: "usesA",
    rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [10, 10] },
    components: { PrefabRef: { artifactKey: "A" } },
  });
  const brokenPath = join(paths.sourceRoot, "Broken.ui.json");
  await writeFile(brokenPath, `${JSON.stringify(dependent, null, 2)}\n`, "utf8");
  const api = await startApi(paths);
  const save = async (): Promise<Response> =>
    fetch(`${api.origin}/api/artifacts/transaction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        upserts: [{ path: "A.ui.json", source: source("A", "changed"), expectedContent: baseline }],
        deletes: [],
        saveMode: "repair",
      }),
    });
  try {
    const dependentResponse = await save();
    assert.equal(dependentResponse.status, 422);
    assert.equal(((await responseBody(dependentResponse)).diagnostics as Array<{ path?: unknown }>)[0]?.path, "Broken.ui.json");
    assert.equal(await readFile(artifactPath, "utf8"), baseline);

    await writeFile(brokenPath, "{", "utf8");
    const unparseableResponse = await save();
    assert.equal(unparseableResponse.status, 422);
    assert.equal(((await responseBody(unparseableResponse)).diagnostics as Array<{ path?: unknown }>)[0]?.path, "Broken.ui.json");
    assert.equal(await readFile(artifactPath, "utf8"), baseline);
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("save validation reports structured candidate fields for every document kind and Preview identity collisions", async () => {
  const { root, paths } = await fixture();
  const baseline = await readFile(join(paths.sourceRoot, "A.ui.json"), "utf8");
  const api = await startApi(paths);
  const save = async (candidate: unknown): Promise<Record<string, unknown>> => {
    const response = await fetch(`${api.origin}/api/artifacts/transaction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        upserts: [{ path: "A.ui.json", source: candidate, expectedContent: baseline }],
        deletes: [],
        saveMode: "repair",
      }),
    });
    assert.equal(response.status, 422);
    return responseBody(response);
  };
  try {
    const additional = await save({ ...source("A", "changed"), legacyField: true });
    const additionalDiagnostic = (
      additional.diagnostics as Array<{
        code?: unknown;
        path?: unknown;
        identity?: { documentKey?: unknown; fieldPath?: unknown };
        nextAction?: unknown;
      }>
    )[0];
    assert.deepEqual(
      [
        additionalDiagnostic?.code,
        additionalDiagnostic?.path,
        additionalDiagnostic?.identity?.documentKey,
        additionalDiagnostic?.identity?.fieldPath,
        typeof additionalDiagnostic?.nextAction,
      ],
      ["schema.additionalProperties", "A.ui.json", "A", "/legacyField", "string"],
    );

    for (const candidate of [
      {
        route: "reference",
        path: "R.ui-reference.json",
        document: { referenceKey: "R", subjectArtifactKey: "A", legacyField: true },
        key: "R",
      },
      {
        route: "prototype",
        path: "P.ui-prototype.json",
        document: { prototypeKey: "P", startReferenceKey: "R", interactions: [], legacyField: true },
        key: "P",
      },
    ] as const) {
      const response = await fetch(`${api.origin}/api/${candidate.route}?path=${candidate.path}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document: candidate.document, expectedContent: null, saveMode: "repair" }),
      });
      assert.equal(response.status, 422);
      const body = await responseBody(response);
      const diagnostic = (
        body.diagnostics as Array<{
          code?: unknown;
          path?: unknown;
          identity?: { documentKey?: unknown; fieldPath?: unknown };
          nextAction?: unknown;
        }>
      )[0];
      assert.deepEqual(
        [
          diagnostic?.code,
          diagnostic?.path,
          diagnostic?.identity?.documentKey,
          diagnostic?.identity?.fieldPath,
          typeof diagnostic?.nextAction,
        ],
        ["schema.additionalProperties", candidate.path, candidate.key, "/legacyField", "string"],
      );
    }
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("repair save preserves case-insensitive identity conflicts with unavailable Sources", async () => {
  const { root, paths } = await fixture();
  const artifactPath = join(paths.sourceRoot, "A.ui.json");
  const baseline = await readFile(artifactPath, "utf8");
  await writeFile(
    join(paths.sourceRoot, "Unavailable.ui.json"),
    `${JSON.stringify({ ...source("a", "unavailable"), legacyField: true }, null, 2)}\n`,
    "utf8",
  );
  const api = await startApi(paths);
  try {
    const response = await fetch(`${api.origin}/api/artifacts/transaction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        upserts: [{ path: "A.ui.json", source: source("A", "changed"), expectedContent: baseline }],
        deletes: [],
        saveMode: "repair",
      }),
    });
    assert.equal(response.status, 422);
    const body = (await responseBody(response)) as { readonly path?: string; readonly issues?: readonly { readonly message?: string }[] };
    assert.equal(body.path, "Unavailable.ui.json");
    assert.match(body.issues?.[0]?.message ?? "", /Unavailable\.ui\.json/);
    assert.equal(await readFile(artifactPath, "utf8"), baseline);
  } finally {
    await api.close();
    await rm(root, { recursive: true, force: true });
  }
});
