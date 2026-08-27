type UiCollaborationDocumentKind = "artifact" | "reference" | "prototype";

export interface UiCollaborationDocument {
  readonly kind: UiCollaborationDocumentKind;
  readonly key: string;
  readonly path: string;
}

export interface UiCollaborationProfile {
  readonly actorId: string;
  readonly userName: string;
  readonly source: "environment" | "token-bubble" | "unset";
  readonly editable: boolean;
}

export interface UiCollaborationActor {
  readonly actorId: string;
  readonly userName: string;
}

export interface UiCollaborationEditor extends UiCollaborationActor {
  readonly sessionId: string;
  readonly startedAt: string;
  readonly lastSeenAt: string;
}

export interface UiCollaborationSave extends UiCollaborationActor {
  readonly path: string;
  readonly contentHash: string | null;
  readonly savedAt: string;
}

export interface UiCollaborationDocumentStatus {
  readonly document: UiCollaborationDocument;
  readonly svnBaseHash: string | null;
  readonly editors: readonly UiCollaborationEditor[];
  readonly latestSave: UiCollaborationSave | null;
}

interface UiCollaborationActivityDocumentStatus {
  readonly document: UiCollaborationDocument;
  readonly editors: readonly UiCollaborationEditor[];
}

export interface UiCollaborationActivityStatus {
  readonly connection: "connected" | "unavailable";
  readonly profile: UiCollaborationProfile;
  readonly documents: readonly UiCollaborationActivityDocumentStatus[];
  readonly message?: string;
}

export interface UiCollaborationStatus {
  readonly connection: "connected" | "unavailable";
  readonly profile: UiCollaborationProfile;
  readonly documents: readonly UiCollaborationDocumentStatus[];
  readonly message?: string;
}

export interface UiCollaborationPresenceRequest {
  readonly sessionId: string;
  readonly documents: readonly UiCollaborationDocument[];
}

export interface UiCollaborationPresenceResult {
  readonly connection: "connected" | "unavailable" | "identity-required";
  readonly message?: string;
}

export interface UiCollaborationSavedDocument extends UiCollaborationDocument {
  readonly contentHash: string | null;
}
