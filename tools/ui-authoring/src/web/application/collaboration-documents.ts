import type { DocumentCatalog } from "../../schema/ui-api.js";
import type { UiCollaborationDocument } from "../../schema/ui-collaboration.js";
import type { WorkspaceLocation } from "../workspace/explorer/artifact-explorer-model.js";
import { workspaceDocumentId } from "../workspace/workspace-editing-context.js";

export function currentCollaborationDocuments(
  location: WorkspaceLocation | null,
  catalog: DocumentCatalog,
): readonly UiCollaborationDocument[] {
  if (!location || location.kind === "directory" || location.kind === "overview" || location.kind === "relations") return [];
  if (location.kind === "artifact") return documentForId(workspaceDocumentId("artifact", location.artifactKey), catalog);
  if (location.kind === "reference") return documentForId(workspaceDocumentId("reference", location.referenceKey), catalog);
  const result = [...documentForId(workspaceDocumentId("prototype", location.prototypeKey), catalog)];
  const prototype = catalog.prototypes.find((entry) => entry.prototypeKey === location.prototypeKey);
  const referenceKey = location.referenceKey ?? prototype?.startReferenceKey;
  if (referenceKey) result.push(...documentForId(workspaceDocumentId("reference", referenceKey), catalog));
  return result;
}

export function allCollaborationDocuments(catalog: DocumentCatalog): readonly UiCollaborationDocument[] {
  return [
    ...catalog.artifacts.map((entry) => ({ kind: "artifact", key: entry.artifactKey, path: entry.path }) as const),
    ...catalog.references.map((entry) => ({ kind: "reference", key: entry.referenceKey, path: entry.path }) as const),
    ...catalog.prototypes.map((entry) => ({ kind: "prototype", key: entry.prototypeKey, path: entry.path }) as const),
  ].sort((left, right) => left.path.localeCompare(right.path));
}

export function dirtyCollaborationDocuments(
  dirtyDocumentIds: ReadonlySet<string>,
  catalog: DocumentCatalog,
): readonly UiCollaborationDocument[] {
  return [...dirtyDocumentIds].sort().flatMap((documentId) => documentForId(documentId, catalog));
}

function documentForId(documentId: string, catalog: DocumentCatalog): readonly UiCollaborationDocument[] {
  const separator = documentId.indexOf(":");
  if (separator <= 0) return [];
  const kind = documentId.slice(0, separator);
  const key = documentId.slice(separator + 1);
  if (kind === "artifact") {
    const entry = catalog.artifacts.find((candidate) => candidate.artifactKey === key);
    return entry ? [{ kind, key, path: entry.path }] : [];
  }
  if (kind === "reference") {
    const entry = catalog.references.find((candidate) => candidate.referenceKey === key);
    return entry ? [{ kind, key, path: entry.path }] : [];
  }
  if (kind === "prototype") {
    const entry = catalog.prototypes.find((candidate) => candidate.prototypeKey === key);
    return entry ? [{ kind, key, path: entry.path }] : [];
  }
  return [];
}
