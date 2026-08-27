import type {
  UiCollaborationActivityStatus,
  UiCollaborationDocument,
  UiCollaborationPresenceRequest,
  UiCollaborationPresenceResult,
  UiCollaborationProfile,
  UiCollaborationStatus,
} from "../ui-collaboration.js";
import type { UiDiagnostic, UiDoctorFileCounts, UiDoctorSummary } from "../ui-diagnostics.js";
import type { UiPrototype, UiReference } from "../ui-prototype-schema.js";
import type { UiSource } from "../ui-source-schema.js";
import type { UiApiRoute, UiApiRouteDefinition } from "./contract.js";
import type { DocumentCatalog } from "./documents-api.js";

export const workspaceApiRoutes = {
  config: { method: "GET", path: "/api/config", responseKind: "json" },
  health: { method: "GET", path: "/api/health", responseKind: "json" },
  bootstrap: { method: "GET", path: "/api/bootstrap", responseKind: "json" },
  "workspace.environments": { method: "GET", path: "/api/workspace/environments", responseKind: "json" },
  "workspace.vcs": { method: "POST", path: "/api/workspace/vcs", responseKind: "json" },
  "artifact.svn.status": { method: "GET", path: "/api/artifact/svn-status", responseKind: "json" },
  "artifact.svn.revert": { method: "POST", path: "/api/artifact/svn-revert", responseKind: "json" },
  "collaboration.profile": { method: "GET", path: "/api/collaboration/profile", responseKind: "json" },
  "collaboration.profile.write": { method: "PUT", path: "/api/collaboration/profile", responseKind: "json" },
  "collaboration.status": { method: "POST", path: "/api/collaboration/status", responseKind: "json" },
  "collaboration.activity": { method: "POST", path: "/api/collaboration/activity", responseKind: "json" },
  "collaboration.presence": { method: "POST", path: "/api/collaboration/presence", responseKind: "json" },
} as const satisfies Readonly<Record<string, UiApiRouteDefinition>>;

export interface UiWorkspaceIdentity {
  readonly name: string;
  readonly path: string;
  readonly clusterId: number | null;
}

export interface UiAuthoringConfig {
  readonly product: "legma-ui-authoring";
  readonly defaultArtifact: string;
  readonly defaultPrototype: string;
  readonly workspace: UiWorkspaceIdentity;
}

type UiWorkspaceHealthPhase = "checking" | "ready" | "error";

export interface UiWorkspaceHealth {
  readonly phase: UiWorkspaceHealthPhase;
  readonly ok: boolean;
  readonly startedAt: string;
  readonly checkedAt?: string;
  readonly durationMs?: number;
  readonly revision?: number;
  readonly files?: UiDoctorFileCounts;
  readonly summary?: UiDoctorSummary;
  readonly diagnostics?: readonly UiDiagnostic[];
  readonly error?: string;
}

export interface UiWorkspaceBootstrap {
  readonly config: UiAuthoringConfig;
  readonly catalog: DocumentCatalog;
  readonly documents: {
    readonly artifacts: readonly {
      readonly path: string;
      readonly source: UiSource;
      readonly revision: string;
      readonly modifiedAt?: number;
    }[];
    readonly references: readonly {
      readonly path: string;
      readonly reference: UiReference;
      readonly revision: string;
      readonly modifiedAt?: number;
    }[];
    readonly prototypes: readonly {
      readonly path: string;
      readonly prototype: UiPrototype;
      readonly revision: string;
      readonly modifiedAt?: number;
    }[];
  };
}

export interface UiAuthoringEnvironment extends UiWorkspaceIdentity {
  readonly origin: string;
  readonly current: boolean;
}

export type UiWorkspaceVcsAction = "commit" | "update";
type UiArtifactSvnState = "modified" | "clean" | "unsupported";

export interface UiArtifactSvnStatus {
  readonly path: string;
  readonly state: UiArtifactSvnState;
  readonly canRevert: boolean;
  readonly message: string;
}

export interface UiArtifactSvnRevertRequest {
  readonly path: string;
  readonly expectedRevision: string;
}

export interface WorkspaceApiContract {
  readonly config: UiApiRoute<"GET", undefined, undefined, UiAuthoringConfig>;
  readonly health: UiApiRoute<"GET", { readonly waitMs?: number }, undefined, UiWorkspaceHealth>;
  readonly bootstrap: UiApiRoute<"GET", { readonly fresh?: boolean }, undefined, UiWorkspaceBootstrap>;
  readonly "workspace.environments": UiApiRoute<"GET", undefined, undefined, { readonly environments: readonly UiAuthoringEnvironment[] }>;
  readonly "workspace.vcs": UiApiRoute<
    "POST",
    undefined,
    { readonly action: UiWorkspaceVcsAction },
    { readonly launched: true; readonly action: UiWorkspaceVcsAction; readonly paths: readonly string[] }
  >;
  readonly "artifact.svn.status": UiApiRoute<"GET", { readonly path: string }, undefined, UiArtifactSvnStatus>;
  readonly "artifact.svn.revert": UiApiRoute<
    "POST",
    undefined,
    UiArtifactSvnRevertRequest,
    { readonly reverted: true; readonly path: string }
  >;
  readonly "collaboration.profile": UiApiRoute<"GET", undefined, undefined, UiCollaborationProfile>;
  readonly "collaboration.profile.write": UiApiRoute<"PUT", undefined, { readonly userName: string }, UiCollaborationProfile>;
  readonly "collaboration.status": UiApiRoute<
    "POST",
    undefined,
    { readonly documents: readonly UiCollaborationDocument[] },
    UiCollaborationStatus
  >;
  readonly "collaboration.activity": UiApiRoute<
    "POST",
    undefined,
    { readonly documents: readonly UiCollaborationDocument[] },
    UiCollaborationActivityStatus
  >;
  readonly "collaboration.presence": UiApiRoute<"POST", undefined, UiCollaborationPresenceRequest, UiCollaborationPresenceResult>;
}
