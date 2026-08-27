import type { UiApiSuccess, UiWorkspaceDocumentOperation, WorkspaceSaveRequest, WorkspaceSaveResult } from "../../../schema/ui-api.js";
import { apiRequest } from "./transport.js";

export async function applyWorkspaceDocumentOperation(
  operation: UiWorkspaceDocumentOperation,
): Promise<UiApiSuccess<"workspace.documents">> {
  return apiRequest("workspace.documents", { body: operation });
}

export async function saveWorkspaceDocuments(request: WorkspaceSaveRequest): Promise<WorkspaceSaveResult> {
  return apiRequest("workspace.save", { body: request });
}
