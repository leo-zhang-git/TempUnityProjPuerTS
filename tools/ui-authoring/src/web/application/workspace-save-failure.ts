import type { UiDiagnostic } from "../../schema/ui-diagnostics.js";

export function attributedSaveFailureDocumentIds(
  candidateIds: readonly string[],
  diagnostics: readonly UiDiagnostic[],
  documentIdForDiagnostic: (diagnostic: UiDiagnostic) => string | undefined,
): ReadonlySet<string> {
  const candidates = new Set(candidateIds);
  const attributed = new Set(
    diagnostics
      .map(documentIdForDiagnostic)
      .filter((documentId): documentId is string => documentId !== undefined && candidates.has(documentId)),
  );
  return attributed.size > 0 ? attributed : candidates;
}
