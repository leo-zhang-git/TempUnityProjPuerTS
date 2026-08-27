import type { IncomingMessage, ServerResponse } from "node:http";
import { sendApiError, sendApiResponse } from "./api/http.js";
import { routeApiRequest } from "./api/router.js";
import type { CaptureApiService } from "./api/services.js";
import { createApiRouteHandlers, dispatchApiRoute } from "./api/services.js";
import { AssetIndex } from "./asset-index.js";
import { type CollaborationApiService, unavailableCollaborationService } from "./collaboration-service.js";
import { RuntimeDiagnostics, type RuntimeDiagnosticsApiService } from "./runtime-diagnostics.js";
import type { SemanticSearchApiService } from "./semantic-search-service.js";
import { type SourceSvnApiService, SourceSvnService } from "./source-svn-service.js";
import { type UnityJobApiService, UnityJobService } from "./unity-job-service.js";
import type { WorkspacePaths } from "./workspace.js";
import type { WorkspaceHealthService } from "./workspace-health.js";
import { WorkspaceRepository } from "./workspace-repository.js";
import { type WorkspaceApiService, WorkspaceService } from "./workspace-service.js";

export function createApiHandler(
  paths: WorkspacePaths,
  captureService?: CaptureApiService,
  unityJobService: UnityJobApiService | undefined = undefined,
  workspaceService: WorkspaceApiService = new WorkspaceService(paths),
  diagnostics: RuntimeDiagnosticsApiService = new RuntimeDiagnostics(paths),
  repository: WorkspaceRepository = new WorkspaceRepository(paths.sourceRoot),
  assetIndex: AssetIndex = new AssetIndex(paths.assetRoot, { unityAssetsRoot: paths.unityAssetsRoot }),
  healthService?: WorkspaceHealthService,
  collaborationService: CollaborationApiService = unavailableCollaborationService(),
  sourceSvnService: SourceSvnApiService = new SourceSvnService(paths),
  semanticSearchService?: SemanticSearchApiService,
): (request: IncomingMessage, response: ServerResponse) => Promise<boolean> {
  const handlers = createApiRouteHandlers(
    paths,
    captureService,
    unityJobService ?? new UnityJobService(paths, undefined, undefined, repository),
    workspaceService,
    diagnostics,
    repository,
    assetIndex,
    healthService,
    collaborationService,
    sourceSvnService,
    semanticSearchService,
  );

  return async (request, response) => {
    try {
      const routed = await routeApiRequest(request);
      if (!routed) return false;
      sendApiResponse(response, await dispatchApiRoute(handlers, routed));
      return true;
    } catch (error) {
      if (!request.url?.startsWith("/api/")) return false;
      diagnostics.record({
        timestamp: new Date().toISOString(),
        level: "error",
        source: "server",
        message: `${request.method ?? "GET"} ${request.url}: ${error instanceof Error ? error.message : String(error)}`,
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      });
      sendApiError(response, error);
      return true;
    }
  };
}
