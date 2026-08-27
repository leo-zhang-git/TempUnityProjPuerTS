import type { UiSemanticSearchCandidate, UiSemanticSearchResult } from "../../../schema/ui-api.js";
import { apiRequest } from "./transport.js";

export async function searchWorkspaceDocumentsSemantically(
  query: string,
  candidates: readonly UiSemanticSearchCandidate[],
): Promise<UiSemanticSearchResult> {
  return apiRequest("workspace.semanticSearch", { body: { query, candidates } });
}
