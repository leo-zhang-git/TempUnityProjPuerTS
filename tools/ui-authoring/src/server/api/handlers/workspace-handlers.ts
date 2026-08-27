import { Value } from "@sinclair/typebox/value";
import { artifactPrefabPath, artifactSourceIdentity } from "../../../kernel/prefab-path.js";
import type {
  DocumentCatalog,
  UiApiJsonRouteKey,
  UiApiSuccess,
  UiArtifactSvnRevertRequest,
  UiWorkspaceVcsAction,
} from "../../../schema/ui-api.js";
import type {
  UiCollaborationDocument,
  UiCollaborationPresenceRequest,
  UiCollaborationSavedDocument,
} from "../../../schema/ui-collaboration.js";
import type { UiDiagnostic } from "../../../schema/ui-diagnostics.js";
import type { CollaborationApiService } from "../../collaboration-service.js";
import { type DirectoryCatalogEntry, loadDirectoryCatalogReport } from "../../directory-catalog.js";
import type { RuntimeDiagnosticsApiService } from "../../runtime-diagnostics.js";
import { type SourceSvnApiService, SourceSvnBaselineConflictError, SourceSvnStateError } from "../../source-svn-service.js";
import type { WorkspacePaths } from "../../workspace.js";
import type { PartialWorkspaceCatalog } from "../../workspace-catalog.js";
import type { WorkspaceHealthService } from "../../workspace-health.js";
import type { WorkspaceRepository } from "../../workspace-repository.js";
import type { WorkspaceApiService } from "../../workspace-service.js";
import { uiApiMutableBodySchemas } from "../body-schemas.js";
import { badRequest, conflict, unprocessable } from "../errors.js";
import type { ApiJsonResponse } from "../http.js";
import type { ApiHandlerGroup } from "./types.js";

type WorkspaceRouteKey =
  | "config"
  | "health"
  | "bootstrap"
  | "workspace.environments"
  | "workspace.vcs"
  | "artifact.svn.status"
  | "artifact.svn.revert"
  | "collaboration.profile"
  | "collaboration.profile.write"
  | "collaboration.status"
  | "collaboration.activity"
  | "collaboration.presence";

interface WorkspaceHandlerContext {
  readonly paths: WorkspacePaths;
  readonly workspaceService: WorkspaceApiService;
  readonly healthService: WorkspaceHealthService | undefined;
  readonly repository: WorkspaceRepository;
  readonly collaborationService: CollaborationApiService;
  readonly sourceSvnService: SourceSvnApiService;
  readonly diagnostics: RuntimeDiagnosticsApiService;
  readonly success: <K extends UiApiJsonRouteKey>(key: K, body: UiApiSuccess<K>) => ApiJsonResponse;
  readonly semantic: <T>(operation: () => T | Promise<T>) => Promise<T>;
  readonly transactionConflict: (error: unknown) => never;
  readonly notifyCollaborationSaved: (service: CollaborationApiService, documents: readonly UiCollaborationSavedDocument[]) => void;
  readonly changedCollaborationDocuments: (
    before: PartialWorkspaceCatalog,
    after: PartialWorkspaceCatalog,
    changedPaths: readonly string[],
  ) => readonly UiCollaborationSavedDocument[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function workspaceDocumentCatalog(
  partial: PartialWorkspaceCatalog,
  directories: readonly DirectoryCatalogEntry[],
  extraProblems: readonly UiDiagnostic[] = [],
): DocumentCatalog {
  const artifactModifiedAt = new Map(partial.documents.artifacts.map((document) => [document.source.artifactKey, document.modifiedAt]));
  const referenceModifiedAt = new Map(
    partial.documents.references.map((document) => [document.reference.referenceKey, document.modifiedAt]),
  );
  const prototypeModifiedAt = new Map(
    partial.documents.prototypes.map((document) => [document.prototype.prototypeKey, document.modifiedAt]),
  );
  return {
    artifacts: [...partial.sourceCatalog.entries.values()].map((entry) => {
      const modifiedAt = artifactModifiedAt.get(entry.source.artifactKey);
      return {
        artifactKey: entry.source.artifactKey,
        artifactType: entry.source.artifactType,
        ...(entry.source.displayName ? { displayName: entry.source.displayName } : {}),
        ...(entry.source.description ? { description: entry.source.description } : {}),
        path: entry.path,
        prefabPath: artifactPrefabPath(artifactSourceIdentity(entry)),
        dependencies: entry.dependencies,
        ...(modifiedAt === undefined ? {} : { modifiedAt }),
      };
    }),
    references: [...partial.referenceCatalog.entries.values()].map((entry) => {
      const modifiedAt = referenceModifiedAt.get(entry.reference.referenceKey);
      return {
        referenceKey: entry.reference.referenceKey,
        subjectArtifactKey: entry.reference.subjectArtifactKey,
        path: entry.path,
        ...(modifiedAt === undefined ? {} : { modifiedAt }),
      };
    }),
    prototypes: [...partial.prototypeCatalog.entries.values()].map((entry) => {
      const modifiedAt = prototypeModifiedAt.get(entry.prototype.prototypeKey);
      return {
        prototypeKey: entry.prototype.prototypeKey,
        startReferenceKey: entry.prototype.startReferenceKey,
        path: entry.path,
        interactionCount: entry.prototype.interactions.length,
        ...(modifiedAt === undefined ? {} : { modifiedAt }),
      };
    }),
    directories: directories.map((entry) => ({
      path: entry.path,
      displayName: entry.displayName,
      description: entry.description,
      ...(entry.cover ? { cover: entry.cover } : {}),
      modifiedAt: entry.modifiedAt,
    })),
    unavailable: partial.unavailable,
    problems: [...partial.problems, ...extraProblems],
  };
}

export function createWorkspaceHandlers(context: WorkspaceHandlerContext): ApiHandlerGroup<WorkspaceRouteKey> {
  const { paths, workspaceService, repository, collaborationService, sourceSvnService } = context;
  return {
    config: async () =>
      context.success("config", {
        product: "legma-ui-authoring",
        defaultArtifact: paths.defaultArtifact,
        defaultPrototype: paths.defaultPrototype,
        workspace: await workspaceService.identity(),
      }),
    health: async (request) => {
      const requested = Number(request.url.searchParams.get("waitMs") ?? "0");
      const waitMs = Number.isFinite(requested) ? Math.max(0, Math.min(30_000, requested)) : 0;
      return context.success(
        "health",
        context.healthService
          ? await context.healthService.wait(waitMs)
          : { phase: "ready", ok: true, startedAt: new Date().toISOString() },
      );
    },
    bootstrap: async (request) =>
      context.semantic(async () => {
        if (request.url.searchParams.get("fresh") === "true") repository.invalidate();
        const [partial, directories, workspace] = await Promise.all([
          repository.partial(),
          loadDirectoryCatalogReport(paths.sourceRoot),
          workspaceService.identity(),
        ]);
        return context.success("bootstrap", {
          config: {
            product: "legma-ui-authoring",
            defaultArtifact: paths.defaultArtifact,
            defaultPrototype: paths.defaultPrototype,
            workspace,
          },
          catalog: workspaceDocumentCatalog(partial, directories.entries, directories.problems),
          documents: partial.documents,
        });
      }),
    "workspace.environments": async (request) =>
      context.success("workspace.environments", {
        environments: await workspaceService.environments(request.localPort),
      }),
    "workspace.vcs": async (request) => {
      if (!Value.Check(uiApiMutableBodySchemas["workspace.vcs"], request.body))
        throw badRequest("Workspace version control request does not match the API contract");
      const action = (request.body as { readonly action: UiWorkspaceVcsAction }).action;
      try {
        const result = await workspaceService.openVersionControl(action);
        context.diagnostics.record({
          timestamp: new Date().toISOString(),
          level: "info",
          source: "workspace",
          message: `Opened TortoiseSVN ${action} for ${result.paths.join(" | ")}`,
        });
        return context.success("workspace.vcs", { launched: true, ...result });
      } catch (error) {
        throw unprocessable({ error: `Unable to open TortoiseSVN ${action}: ${errorMessage(error)}` }, { cause: error });
      }
    },
    "artifact.svn.status": async (request) => {
      const path = request.url.searchParams.get("path");
      if (!path) throw badRequest("Artifact SVN status requires a Source path");
      try {
        return context.success("artifact.svn.status", await sourceSvnService.status(path));
      } catch (error) {
        if (error instanceof SourceSvnStateError) throw unprocessable({ error: error.message }, { cause: error });
        throw error;
      }
    },
    "artifact.svn.revert": async (request) => {
      if (!Value.Check(uiApiMutableBodySchemas["artifact.svn.revert"], request.body))
        throw badRequest("Artifact SVN revert request does not match the API contract");
      const operation = request.body as UiArtifactSvnRevertRequest;
      try {
        const before = await repository.partial();
        const result = await sourceSvnService.revert(operation);
        repository.invalidate();
        const after = await repository.partial();
        context.notifyCollaborationSaved(collaborationService, context.changedCollaborationDocuments(before, after, [result.path]));
        context.diagnostics.record({
          timestamp: new Date().toISOString(),
          level: "info",
          source: "workspace",
          message: `Reverted UI Source to SVN BASE: ${result.path}`,
        });
        return context.success("artifact.svn.revert", result);
      } catch (error) {
        if (error instanceof SourceSvnBaselineConflictError) throw conflict(error.message, { cause: error });
        if (error instanceof SourceSvnStateError) throw unprocessable({ error: error.message }, { cause: error });
        throw error;
      }
    },
    "collaboration.profile": async () => context.success("collaboration.profile", await collaborationService.profile()),
    "collaboration.profile.write": async (request) => {
      if (!Value.Check(uiApiMutableBodySchemas["collaboration.profile.write"], request.body)) throw badRequest("昵称不符合 API 接口约定");
      try {
        return context.success(
          "collaboration.profile.write",
          await collaborationService.updateProfile((request.body as { readonly userName: string }).userName),
        );
      } catch (error) {
        throw unprocessable({ error: errorMessage(error) }, { cause: error });
      }
    },
    "collaboration.status": async (request) => {
      if (!Value.Check(uiApiMutableBodySchemas["collaboration.status"], request.body)) throw badRequest("协作状态请求不符合 API 接口约定");
      return context.success(
        "collaboration.status",
        await collaborationService.status((request.body as { readonly documents: readonly UiCollaborationDocument[] }).documents),
      );
    },
    "collaboration.activity": async (request) => {
      if (!Value.Check(uiApiMutableBodySchemas["collaboration.activity"], request.body))
        throw badRequest("协作活动请求不符合 API 接口约定");
      return context.success(
        "collaboration.activity",
        await collaborationService.activity((request.body as { readonly documents: readonly UiCollaborationDocument[] }).documents),
      );
    },
    "collaboration.presence": async (request) => {
      if (!Value.Check(uiApiMutableBodySchemas["collaboration.presence"], request.body))
        throw badRequest("协作编辑状态不符合 API 接口约定");
      return context.success(
        "collaboration.presence",
        await collaborationService.syncPresence(request.body as UiCollaborationPresenceRequest),
      );
    },
  };
}
