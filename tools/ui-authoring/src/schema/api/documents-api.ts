import type { UiDiagnostic, UiDocumentKind } from "../ui-diagnostics.js";
import type { UiDirectoryCover } from "../ui-directory-schema.js";
import type { UiPrototype, UiReference } from "../ui-prototype-schema.js";
import type { UiSource } from "../ui-source-schema.js";
import type { UiApiRoute, UiApiRouteDefinition } from "./contract.js";

export const documentApiRoutes = {
  "workspace.documents": { method: "POST", path: "/api/workspace/documents", responseKind: "json" },
  "workspace.save": { method: "POST", path: "/api/workspace/save", responseKind: "json" },
  "artifact.transaction": { method: "POST", path: "/api/artifacts/transaction", responseKind: "json" },
  "reference.write": { method: "PUT", path: "/api/reference", responseKind: "json" },
  "prototype.write": { method: "PUT", path: "/api/prototype", responseKind: "json" },
} as const satisfies Readonly<Record<string, UiApiRouteDefinition>>;

export interface CatalogArtifact {
  readonly artifactKey: string;
  readonly artifactType: UiSource["artifactType"];
  readonly displayName?: string;
  readonly description?: string;
  readonly path: string;
  readonly prefabPath: string;
  readonly dependencies: readonly string[];
  readonly modifiedAt?: number;
}

export interface CatalogReference {
  readonly referenceKey: string;
  readonly subjectArtifactKey: string;
  readonly path: string;
  readonly modifiedAt?: number;
}

export interface CatalogPrototype {
  readonly prototypeKey: string;
  readonly startReferenceKey: string;
  readonly path: string;
  readonly interactionCount: number;
  readonly modifiedAt?: number;
}

export interface CatalogDirectory {
  readonly path: string;
  readonly displayName: string;
  readonly description: string;
  readonly cover?: UiDirectoryCover;
  readonly modifiedAt: number;
}

export interface CatalogUnavailableDocument {
  readonly kind: UiDocumentKind;
  readonly path: string;
  readonly key: string;
  readonly artifactType?: CatalogArtifact["artifactType"];
  readonly modifiedAt?: number;
}

export interface DocumentCatalog {
  readonly artifacts: readonly CatalogArtifact[];
  readonly references: readonly CatalogReference[];
  readonly prototypes: readonly CatalogPrototype[];
  readonly directories?: readonly CatalogDirectory[];
  readonly unavailable?: readonly CatalogUnavailableDocument[];
  readonly problems?: readonly UiDiagnostic[];
}

interface ArtifactTransactionUpsert {
  readonly path: string;
  readonly source: UiSource;
  readonly expectedContent?: string | null;
}

interface ArtifactTransactionDelete {
  readonly path: string;
  readonly expectedContent: string;
}

export type WorkspaceSaveMode = "strict" | "repair";

export interface ArtifactTransaction {
  readonly upserts: readonly ArtifactTransactionUpsert[];
  readonly deletes: readonly ArtifactTransactionDelete[];
  readonly saveMode?: WorkspaceSaveMode;
}

export interface ArtifactTransactionResult {
  readonly upserts: readonly { readonly path: string; readonly source: UiSource }[];
  readonly deletes: readonly string[];
}

interface WorkspaceReferenceUpsert {
  readonly path: string;
  readonly reference: UiReference;
  readonly expectedRevision: string | null;
}

interface WorkspacePrototypeUpsert {
  readonly path: string;
  readonly prototype: UiPrototype;
  readonly expectedRevision: string | null;
}

interface WorkspaceArtifactUpsert {
  readonly path: string;
  readonly source: UiSource;
  readonly expectedRevision: string | null;
}

interface WorkspaceArtifactDelete {
  readonly path: string;
  readonly expectedRevision: string;
}

export interface WorkspaceNodeIdentityMapping {
  readonly ownerArtifactKey: string;
  readonly beforeNodeId: string;
  readonly afterNodeId: string;
}

export interface WorkspaceNodeIdentityOperation {
  readonly id: string;
  readonly mappings: readonly WorkspaceNodeIdentityMapping[];
}

export interface WorkspaceSaveRequest {
  readonly artifacts: {
    readonly upserts: readonly WorkspaceArtifactUpsert[];
    readonly deletes: readonly WorkspaceArtifactDelete[];
  };
  readonly references: readonly WorkspaceReferenceUpsert[];
  readonly prototypes: readonly WorkspacePrototypeUpsert[];
  readonly nodeIdentityOperations?: readonly WorkspaceNodeIdentityOperation[];
}

interface WorkspaceSaveFailure {
  readonly documentId: string;
  readonly path: string;
  readonly message: string;
  readonly diagnostics?: readonly UiDiagnostic[];
  readonly pendingDocumentIds: readonly string[];
  readonly pendingPaths: readonly string[];
}

export interface WorkspaceSaveResult {
  readonly artifacts: {
    readonly upserts: readonly { readonly path: string; readonly source: UiSource; readonly revision: string }[];
    readonly deletes: readonly string[];
  };
  readonly references: readonly { readonly path: string; readonly reference: UiReference; readonly revision: string }[];
  readonly prototypes: readonly { readonly path: string; readonly prototype: UiPrototype; readonly revision: string }[];
  readonly writtenDocumentIds: readonly string[];
  readonly writtenDeliveryStatePaths: readonly string[];
  readonly completedNodeIdentityOperationIds: readonly string[];
  readonly failure?: WorkspaceSaveFailure;
}

export interface GuardedDocumentWriteRequest<T> {
  readonly document: T;
  readonly expectedContent: string | null;
  readonly saveMode?: WorkspaceSaveMode;
}

export type UiWorkspaceDocumentKind = "artifact" | "reference" | "prototype";

export type UiWorkspaceDocumentOperation =
  | {
      readonly action: "move-document";
      readonly kind: UiWorkspaceDocumentKind;
      readonly key: string;
      readonly nextKey: string;
      readonly nextPath: string;
    }
  | {
      readonly action: "duplicate-document";
      readonly kind: UiWorkspaceDocumentKind;
      readonly key: string;
      readonly nextKey: string;
      readonly nextPath: string;
    }
  | { readonly action: "create-variant"; readonly artifactKey: string; readonly nextKey: string; readonly nextPath: string }
  | { readonly action: "create-reference"; readonly artifactKey: string; readonly nextKey: string; readonly nextPath: string }
  | { readonly action: "delete-document"; readonly kind: UiWorkspaceDocumentKind; readonly key: string }
  | { readonly action: "create-directory"; readonly path: string; readonly displayName: string; readonly description: string }
  | { readonly action: "move-directory"; readonly path: string; readonly nextPath: string }
  | { readonly action: "delete-directory"; readonly path: string };

export type UiWorkspaceDocumentLocation =
  | { readonly kind: UiWorkspaceDocumentKind; readonly key: string }
  | { readonly kind: "directory"; readonly path: string };

export interface DocumentApiContract {
  readonly "workspace.documents": UiApiRoute<
    "POST",
    undefined,
    UiWorkspaceDocumentOperation,
    { readonly changedPaths: readonly string[]; readonly location?: UiWorkspaceDocumentLocation }
  >;
  readonly "workspace.save": UiApiRoute<"POST", undefined, WorkspaceSaveRequest, WorkspaceSaveResult>;
  readonly "artifact.transaction": UiApiRoute<"POST", undefined, ArtifactTransaction, ArtifactTransactionResult>;
  readonly "reference.write": UiApiRoute<
    "PUT",
    { readonly path: string },
    GuardedDocumentWriteRequest<UiReference>,
    { readonly path: string; readonly reference: UiReference }
  >;
  readonly "prototype.write": UiApiRoute<
    "PUT",
    { readonly path?: string },
    GuardedDocumentWriteRequest<UiPrototype>,
    { readonly path: string; readonly prototype: UiPrototype }
  >;
}
