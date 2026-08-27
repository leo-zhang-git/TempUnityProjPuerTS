import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiCollaborationSavedDocument } from "../../src/schema/ui-collaboration.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import type { UiPublishRequest, UiUnityJobSnapshot } from "../../src/schema/ui-unity-job.js";
import { type CaptureApiService } from "../../src/server/api/services.js";
import { createApiHandler } from "../../src/server/api.js";
import { type CollaborationApiService } from "../../src/server/collaboration-service.js";
import type { SemanticSearchApiService } from "../../src/server/semantic-search-service.js";
import type { SourceSvnApiService } from "../../src/server/source-svn-service.js";
import type { UnityJobApiService } from "../../src/server/unity-job-service.js";
import type { WorkspacePaths } from "../../src/server/workspace.js";
import { WorkspaceRepository } from "../../src/server/workspace-repository.js";
import type { WorkspaceApiService } from "../../src/server/workspace-service.js";

export const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

export function source(artifactKey: string, text: string): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey,
    artifactType: "Widget",
    widgetType: artifactKey,
    initialSize: [100, 40],
    root: {
      id: artifactKey,
      rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [100, 40] },
      children: [
        {
          id: "label",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [100, 40] },
          components: { Text: { text, fontSize: 20 } },
        },
      ],
    },
  };
}

export async function fixture(): Promise<{ readonly root: string; readonly paths: WorkspacePaths }> {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-api-"));
  const sourceRoot = join(root, "My project", "UIAuthoring", "Sources");
  const assetRoot = join(root, "My project", "Assets", "Resources", "UI");
  const runtimeRoot = join(root, "tools", "ui-authoring", ".runtime");
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(assetRoot, { recursive: true });
  await writeFile(join(sourceRoot, "A.ui.json"), formatSource(source("A", "current")), "utf8");
  await writeFile(
    join(sourceRoot, ".ui-directory.json"),
    `${JSON.stringify({ displayName: "测试目录", description: "API 目录元数据", cover: { kind: "Artifact", key: "A" } }, null, 2)}\n`,
    "utf8",
  );
  return {
    root,
    paths: {
      repoRoot: root,
      sourceRoot,
      assetRoot,
      runtimeRoot,
      defaultArtifact: "A.ui.json",
      defaultPrototype: "P.ui-prototype.json",
    },
  };
}

export async function startApi(
  paths: WorkspacePaths,
  captureService?: CaptureApiService,
  unityJobService?: UnityJobApiService,
  workspaceService?: WorkspaceApiService,
  repository?: WorkspaceRepository,
  collaborationService?: CollaborationApiService,
  sourceSvnService?: SourceSvnApiService,
  semanticSearchService?: SemanticSearchApiService,
): Promise<{ readonly origin: string; readonly close: () => Promise<void> }> {
  const handler = createApiHandler(
    paths,
    captureService,
    unityJobService,
    workspaceService,
    undefined,
    repository,
    undefined,
    undefined,
    collaborationService,
    sourceSvnService,
    semanticSearchService,
  );
  const server = createServer(async (request, response) => {
    if (!(await handler(request, response))) response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

export function unityJobService(publishRequests?: UiPublishRequest[]): UnityJobApiService {
  const snapshot: UiUnityJobSnapshot = {
    id: "job-1",
    kind: "sync",
    artifactKey: "A",
    status: "succeeded",
    stage: "complete",
    message: "Formal sync complete",
    createdAt: 1,
    updatedAt: 2,
    result: {
      kind: "sync",
      prefabPath: "Assets/Resources/UI/Prefab/Canvas/A/A.prefab",
      state: { artifactKey: "A", status: "missing", changes: [] },
      patches: [],
      issues: [],
    },
  };
  return {
    async startImport() {
      return { ...snapshot, kind: "import" };
    },
    async startReconcile() {
      return { ...snapshot, kind: "reconcile" };
    },
    async startSync() {
      return { ...snapshot, kind: "sync" };
    },
    async startPublish(request) {
      publishRequests?.push(request);
      return { ...snapshot, kind: "publish" };
    },
    job(id) {
      return id === snapshot.id ? snapshot : undefined;
    },
  };
}

export async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

export function recordingCollaborationService(saved: UiCollaborationSavedDocument[][]): CollaborationApiService {
  const profile = { actorId: "api-test", userName: "API Test", source: "token-bubble", editable: true } as const;
  return {
    profile: async () => profile,
    updateProfile: async () => profile,
    status: async (documents) => ({
      connection: "connected",
      profile,
      documents: documents.map((document) => ({ document, svnBaseHash: null, editors: [], latestSave: null })),
    }),
    activity: async (documents) => ({
      connection: "connected",
      profile,
      documents: documents.map((document) => ({ document, editors: [] })),
    }),
    syncPresence: async () => ({ connection: "connected" }),
    recordSaved: async (documents) => {
      saved.push([...documents]);
    },
  };
}
