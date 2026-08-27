import {
  type UiArtifactSvnRevertRequest,
  type UiArtifactSvnStatus,
  type UiAuthoringConfig,
  type UiAuthoringEnvironment,
  type UiWorkspaceBootstrap,
  type UiWorkspaceVcsAction,
  uiApiRoutes,
} from "../../../schema/ui-api.js";
import type {
  UiCollaborationActivityStatus,
  UiCollaborationDocument,
  UiCollaborationPresenceResult,
  UiCollaborationProfile,
  UiCollaborationStatus,
} from "../../../schema/ui-collaboration.js";
import { apiRequest } from "./transport.js";

export async function loadConfig(): Promise<UiAuthoringConfig> {
  return apiRequest("config");
}

let bootstrapRequest: Promise<UiWorkspaceBootstrap> | undefined;

export async function loadBootstrap(): Promise<UiWorkspaceBootstrap> {
  bootstrapRequest ??= apiRequest("bootstrap").catch((reason: unknown) => {
    bootstrapRequest = undefined;
    throw reason;
  });
  return bootstrapRequest;
}

export async function reloadBootstrap(fresh = false): Promise<UiWorkspaceBootstrap> {
  const request = apiRequest("bootstrap", fresh ? { query: { fresh: true } } : {});
  bootstrapRequest = request;
  return request.catch((reason: unknown) => {
    if (bootstrapRequest === request) bootstrapRequest = undefined;
    throw reason;
  });
}

export async function loadWorkspaceEnvironments(): Promise<readonly UiAuthoringEnvironment[]> {
  return (await apiRequest("workspace.environments")).environments;
}

export async function openWorkspaceVersionControl(
  action: UiWorkspaceVcsAction,
): Promise<{ readonly action: UiWorkspaceVcsAction; readonly paths: readonly string[] }> {
  return apiRequest("workspace.vcs", { body: { action } });
}

export async function loadArtifactSvnStatus(path: string): Promise<UiArtifactSvnStatus> {
  return apiRequest("artifact.svn.status", { query: { path } });
}

export async function revertArtifactToSvnBase(
  request: UiArtifactSvnRevertRequest,
): Promise<{ readonly reverted: true; readonly path: string }> {
  return apiRequest("artifact.svn.revert", { body: request });
}

export async function loadCollaborationProfile(): Promise<UiCollaborationProfile> {
  return apiRequest("collaboration.profile");
}

export async function updateCollaborationProfile(userName: string): Promise<UiCollaborationProfile> {
  return apiRequest("collaboration.profile.write", { body: { userName } });
}

export async function loadCollaborationStatus(documents: readonly UiCollaborationDocument[]): Promise<UiCollaborationStatus> {
  return apiRequest("collaboration.status", { body: { documents } });
}

export async function loadCollaborationActivity(documents: readonly UiCollaborationDocument[]): Promise<UiCollaborationActivityStatus> {
  const chunkSize = 200;
  const chunks =
    documents.length === 0
      ? [[]]
      : Array.from({ length: Math.ceil(documents.length / chunkSize) }, (_, index) =>
          documents.slice(index * chunkSize, (index + 1) * chunkSize),
        );
  const results = await Promise.all(chunks.map((chunk) => apiRequest("collaboration.activity", { body: { documents: chunk } })));
  const unavailable = results.find((result) => result.connection === "unavailable");
  return {
    connection: unavailable ? "unavailable" : "connected",
    profile: results[0]!.profile,
    documents: results.flatMap((result) => result.documents),
    ...(unavailable?.message ? { message: unavailable.message } : {}),
  };
}

export async function syncCollaborationPresence(
  sessionId: string,
  documents: readonly UiCollaborationDocument[],
): Promise<UiCollaborationPresenceResult> {
  return apiRequest("collaboration.presence", { body: { sessionId, documents } });
}

export function sendCollaborationPresenceBeacon(sessionId: string): boolean {
  return window.navigator.sendBeacon(
    uiApiRoutes["collaboration.presence"].path,
    new Blob([JSON.stringify({ sessionId, documents: [] })], { type: "application/json" }),
  );
}
