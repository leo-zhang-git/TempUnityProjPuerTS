import type {
  UiCollaborationActor,
  UiCollaborationDocumentStatus,
  UiCollaborationProfile,
  UiCollaborationStatus,
} from "../../schema/ui-collaboration.js";

type CollaborationDocumentTone = "ready" | "editing" | "saved-ahead";
type CollaborationTone = "ready" | "warning" | "unavailable";

interface CollaborationDocumentPresentation {
  readonly status: UiCollaborationDocumentStatus;
  readonly tone: CollaborationDocumentTone;
  readonly otherEditors: readonly UiCollaborationActor[];
}

export interface CollaborationPresentation {
  readonly tone: CollaborationTone;
  readonly summary: string;
  readonly documents: readonly CollaborationDocumentPresentation[];
}

function normalizedUserName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function isCurrentCollaborationUser(actor: UiCollaborationActor, profile: UiCollaborationProfile): boolean {
  if (actor.actorId === profile.actorId) return true;
  const actorName = normalizedUserName(actor.userName);
  const profileName = normalizedUserName(profile.userName);
  return actorName.length > 0 && actorName === profileName;
}

export function presentCollaborationStatus(status: UiCollaborationStatus | null): CollaborationPresentation {
  if (!status || status.connection === "unavailable") {
    return { tone: "unavailable", summary: status?.message || "协作服务不可用", documents: [] };
  }
  const documents = status.documents.map((document): CollaborationDocumentPresentation => {
    const otherEditors = document.editors.filter((editor) => !isCurrentCollaborationUser(editor, status.profile));
    if (otherEditors.length > 0) return { status: document, tone: "editing", otherEditors };
    const latestSave = document.latestSave;
    if (latestSave && !isCurrentCollaborationUser(latestSave, status.profile) && latestSave.contentHash !== document.svnBaseHash) {
      return { status: document, tone: "saved-ahead", otherEditors };
    }
    return { status: document, tone: "ready", otherEditors };
  });
  const editingCount = documents.filter((document) => document.tone === "editing").length;
  const savedAheadCount = documents.filter((document) => document.tone === "saved-ahead").length;
  if (editingCount > 0) return { tone: "warning", summary: `${editingCount} 个文档正在被其他人编辑`, documents };
  if (savedAheadCount > 0) return { tone: "warning", summary: `${savedAheadCount} 个文档有其他人保存的新版本`, documents };
  return { tone: "ready", summary: documents.length > 0 ? "可以编辑" : "暂无协作文档", documents };
}
