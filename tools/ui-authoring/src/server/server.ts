import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { createApiHandler } from "./api.js";
import { AssetIndex } from "./asset-index.js";
import { CaptureService } from "./capture-service.js";
import { type CollaborationApiService, CollaborationService } from "./collaboration-service.js";
import { contentType } from "./mime.js";
import { RuntimeDiagnostics, type RuntimeDiagnosticsApiService } from "./runtime-diagnostics.js";
import { type SourceSvnApiService, SourceSvnService } from "./source-svn-service.js";
import { type UnityJobApiService, UnityJobService } from "./unity-job-service.js";
import { workspacePaths } from "./workspace.js";
import { WorkspaceHealthService } from "./workspace-health.js";
import { WorkspaceRepository } from "./workspace-repository.js";
import { type WorkspaceApiService, WorkspaceService } from "./workspace-service.js";

export interface UiAuthoringRuntimeOptions {
  readonly captureService?: CaptureService;
  readonly unityJobService?: UnityJobApiService;
  readonly workspaceService?: WorkspaceApiService;
  readonly diagnostics?: RuntimeDiagnosticsApiService;
  readonly collaborationService?: CollaborationApiService;
  readonly sourceSvnService?: SourceSvnApiService;
}

export interface UiAuthoringServerOptions extends UiAuthoringRuntimeOptions {
  readonly host?: string;
  readonly port?: number;
  readonly development?: boolean;
  readonly webToolRoot?: string;
}

export interface UiAuthoringRuntime {
  readonly api: (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;
  readonly captureService: CaptureService;
  setBaseUrl(url: string): void;
  close(): Promise<void>;
}

export interface UiAuthoringServer {
  readonly url: string;
  readonly port: number;
  readonly captureService: CaptureService;
  close(): Promise<void>;
}

export async function createUiAuthoringRuntime(
  paths: Awaited<ReturnType<typeof workspacePaths>>,
  options: UiAuthoringRuntimeOptions = {},
): Promise<UiAuthoringRuntime> {
  const captureService = options.captureService ?? new CaptureService(paths);
  const repository = new WorkspaceRepository(paths.sourceRoot);
  repository.startWatching();
  const assetIndex = new AssetIndex(paths.assetRoot, { unityAssetsRoot: paths.unityAssetsRoot });
  assetIndex.startWatching();
  const unityJobService = options.unityJobService ?? new UnityJobService(paths, undefined, undefined, repository);
  const workspaceService = options.workspaceService ?? new WorkspaceService(paths);
  const diagnostics = options.diagnostics ?? new RuntimeDiagnostics(paths);
  const healthService = new WorkspaceHealthService(paths, repository, diagnostics);
  const collaborationService = options.collaborationService ?? new CollaborationService(paths);
  const sourceSvnService = options.sourceSvnService ?? new SourceSvnService(paths);
  const api = createApiHandler(
    paths,
    captureService,
    unityJobService,
    workspaceService,
    diagnostics,
    repository,
    assetIndex,
    healthService,
    collaborationService,
    sourceSvnService,
  );
  const initialHealthCheck = healthService.start();
  let closed = false;
  return {
    api,
    captureService,
    setBaseUrl(url) {
      captureService.setBaseUrl(url);
      diagnostics.record({
        timestamp: new Date().toISOString(),
        level: "info",
        source: "server",
        message: `Legma listening at ${url}`,
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      await captureService.close();
      await unityJobService.close?.();
      await Promise.allSettled([initialHealthCheck]);
      repository.close();
      assetIndex.close();
    },
  };
}

export async function startUiAuthoringServer(options: UiAuthoringServerOptions = {}): Promise<UiAuthoringServer> {
  const paths = await workspacePaths();
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 4321;
  const development = options.development === true;
  const webToolRoot = options.webToolRoot ?? join(paths.repoRoot, "tools", "ui-authoring");
  const runtime = await createUiAuthoringRuntime(paths, options);
  const viteModule = development ? await import("vite") : undefined;
  const webRoot = join(webToolRoot, "dist", "web");
  let vite: Awaited<ReturnType<typeof import("vite")["createServer"]>> | null = null;
  const server = createServer(async (request, response) => {
    if (await runtime.api(request, response)) return;
    if (vite) {
      vite.middlewares(request, response, () => response.writeHead(404).end());
      return;
    }
    await serveUiAuthoringWeb(webRoot, request.url ?? "/", response);
  });
  vite = viteModule
    ? await viteModule.createServer({
        root: webToolRoot,
        configFile: join(webToolRoot, "vite.config.ts"),
        ...(requestedPort === 0 ? { logLevel: "silent" as const } : {}),
        server: {
          middlewareMode: true,
          hmr: requestedPort === 0 ? false : { server },
        },
        appType: "spa",
      })
    : null;
  await listen(server, requestedPort, host);
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : requestedPort;
  const url = `http://${host}:${port}`;
  runtime.setBaseUrl(url);
  return {
    url,
    port,
    captureService: runtime.captureService,
    async close() {
      await runtime.close();
      await vite?.close();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

export async function serveUiAuthoringWeb(webRoot: string, rawUrl: string, response: ServerResponse): Promise<void> {
  const pathname = new URL(rawUrl, "http://127.0.0.1").pathname;
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = join(webRoot, requested);
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not a file");
    response.writeHead(200, { "content-type": contentType(filePath), "content-length": info.size });
    createReadStream(filePath).pipe(response);
  } catch {
    const fallback = join(webRoot, "index.html");
    const info = await stat(fallback);
    response.writeHead(200, { "content-type": contentType(fallback), "content-length": info.size });
    createReadStream(fallback).pipe(response);
  }
}

async function listen(server: Server, port: number, host: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
}
