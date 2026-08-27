import { artifactPrefabPath, artifactSourceIdentity } from "../../../kernel/prefab-path.js";
import { assertValidPrototype, assertValidReference, createPrototypeCatalog, createReferenceCatalog } from "../../../kernel/prototype.js";
import { createSourceCatalog } from "../../../kernel/source-catalog.js";
import type { ArtifactDocument, PrototypeDocument, ReferenceDocument } from "../../shared/types.js";
import type { WorkspaceArtifactMap } from "./artifact-workspace-state.js";

export function resolveArtifactDocuments(documents: WorkspaceArtifactMap): ReadonlyMap<string, ArtifactDocument> {
  if (documents.size === 0) return new Map();
  const catalog = createSourceCatalog([...documents.values()].map((document) => ({ path: document.path, source: document.source })));
  return new Map(
    [...catalog.entries.values()].map((entry) => [
      entry.source.artifactKey,
      {
        artifactKey: entry.source.artifactKey,
        artifactType: entry.source.artifactType,
        ...(entry.source.displayName ? { displayName: entry.source.displayName } : {}),
        ...(entry.source.description ? { description: entry.source.description } : {}),
        path: entry.path,
        prefabPath: artifactPrefabPath(artifactSourceIdentity(entry)),
        dependencies: entry.dependencies,
        ...(documents.get(entry.source.artifactKey)?.revision ? { revision: documents.get(entry.source.artifactKey)!.revision } : {}),
        modifiedAt: documents.get(entry.source.artifactKey)?.modifiedAt ?? 0,
        source: entry.source,
        resolvedSource: entry.resolvedSource,
      },
    ]),
  );
}

export function resolveLocalArtifactDocuments(
  previous: ReadonlyMap<string, ArtifactDocument>,
  documents: WorkspaceArtifactMap,
  changedKeys: ReadonlySet<string>,
): ReadonlyMap<string, ArtifactDocument> {
  if (previous.size === 0 || changedKeys.size === 0) return resolveArtifactDocuments(documents);
  const next = new Map(previous);
  for (const artifactKey of changedKeys) {
    const document = documents.get(artifactKey);
    const current = previous.get(artifactKey);
    if (
      !document ||
      !current ||
      document.source.sourceKind !== "artifact" ||
      document.source.artifactKey !== current.artifactKey ||
      document.source.artifactType !== current.artifactType ||
      document.path !== current.path
    ) {
      return resolveArtifactDocuments(documents);
    }
    const { displayName: _displayName, description: _description, ...withoutMetadata } = current;
    next.set(artifactKey, {
      ...withoutMetadata,
      ...(document.source.displayName ? { displayName: document.source.displayName } : {}),
      ...(document.source.description ? { description: document.source.description } : {}),
      modifiedAt: document.modifiedAt ?? 0,
      ...(document.revision === undefined ? {} : { revision: document.revision }),
      source: document.source,
      resolvedSource: document.source,
    });
  }
  return next;
}

export function validateWorkspaceDocuments(
  documents: WorkspaceArtifactMap,
  references: ReadonlyMap<string, ReferenceDocument>,
  prototypes: ReadonlyMap<string, PrototypeDocument>,
): void {
  createSourceCatalog([...documents.values()].map((document) => ({ path: document.path, source: document.source })));
  createReferenceCatalog([...references.values()].map((document) => ({ path: document.path, reference: document.reference })));
  createPrototypeCatalog([...prototypes.values()].map((document) => ({ path: document.path, prototype: document.prototype })));
}

export function validatePreviewWorkspaceDocuments(
  documents: WorkspaceArtifactMap,
  references: ReadonlyMap<string, ReferenceDocument>,
  prototypes: ReadonlyMap<string, PrototypeDocument>,
): void {
  const sourceCatalog = createSourceCatalog([...documents.values()].map((document) => ({ path: document.path, source: document.source })));
  const referenceCatalog = createReferenceCatalog(
    [...references.values()].map((document) => ({ path: document.path, reference: document.reference })),
    sourceCatalog,
  );
  for (const document of references.values()) assertValidReference(document.reference, sourceCatalog, referenceCatalog);
  createPrototypeCatalog([...prototypes.values()].map((document) => ({ path: document.path, prototype: document.prototype })));
  for (const document of prototypes.values()) assertValidPrototype(document.prototype, referenceCatalog, sourceCatalog);
}
