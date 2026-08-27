import type { WorkspaceDraftDocuments } from "../editors/artifact/artifact-workspace-state.js";

interface WorkspaceRebaseConflict {
  readonly documentId: string;
  readonly fieldPaths: readonly string[];
}

export interface WorkspaceRebaseResult {
  readonly drafts: WorkspaceDraftDocuments;
  readonly saved: WorkspaceDraftDocuments;
  readonly conflicts: readonly WorkspaceRebaseConflict[];
}

interface WorkspaceRebaseInput {
  readonly current: WorkspaceDraftDocuments;
  readonly saved: WorkspaceDraftDocuments;
  readonly remote: WorkspaceDraftDocuments;
  readonly documentIds: ReadonlySet<string>;
  readonly protectedDocumentIds?: ReadonlySet<string>;
}

interface DocumentAdapter<TDocument, TValue> {
  readonly value: (document: TDocument) => TValue;
  readonly createDraft: (local: TDocument, remote: TDocument, path: string, value: TValue) => TDocument;
}

interface MergeResult<T> {
  readonly value?: T;
  readonly conflicts: readonly string[];
}

interface RebasedDocumentMap<TDocument> {
  readonly drafts: ReadonlyMap<string, TDocument>;
  readonly saved: ReadonlyMap<string, TDocument>;
}

const MISSING = Symbol("missing");

export function rebaseWorkspaceDrafts(input: WorkspaceRebaseInput): WorkspaceRebaseResult {
  const conflicts: WorkspaceRebaseConflict[] = [];
  const artifacts = rebaseDocumentMap(
    "artifact",
    input.current.artifacts,
    input.saved.artifacts,
    input.remote.artifacts,
    input.documentIds,
    input.protectedDocumentIds ?? new Set(),
    {
      value: (document) => document.source,
      createDraft: (local, remote, path, source) => ({
        ...local,
        path,
        source,
        ...(remote.revision === undefined ? {} : { revision: remote.revision }),
        ...(remote.modifiedAt === undefined ? {} : { modifiedAt: remote.modifiedAt }),
      }),
    },
    conflicts,
  );
  const references = rebaseDocumentMap(
    "reference",
    input.current.references,
    input.saved.references,
    input.remote.references,
    input.documentIds,
    input.protectedDocumentIds ?? new Set(),
    {
      value: (document) => document.reference,
      createDraft: (local, remote, path, reference) => ({
        ...local,
        path,
        reference,
        referenceKey: reference.referenceKey,
        subjectArtifactKey: reference.subjectArtifactKey,
        ...(remote.revision === undefined ? {} : { revision: remote.revision }),
        ...(remote.modifiedAt === undefined ? {} : { modifiedAt: remote.modifiedAt }),
      }),
    },
    conflicts,
  );
  const prototypes = rebaseDocumentMap(
    "prototype",
    input.current.prototypes,
    input.saved.prototypes,
    input.remote.prototypes,
    input.documentIds,
    input.protectedDocumentIds ?? new Set(),
    {
      value: (document) => document.prototype,
      createDraft: (local, remote, path, prototype) => ({
        ...local,
        path,
        prototype,
        prototypeKey: prototype.prototypeKey,
        startReferenceKey: prototype.startReferenceKey,
        interactionCount: prototype.interactions.length,
        ...(remote.revision === undefined ? {} : { revision: remote.revision }),
        ...(remote.modifiedAt === undefined ? {} : { modifiedAt: remote.modifiedAt }),
      }),
    },
    conflicts,
  );
  return {
    drafts: { artifacts: artifacts.drafts, references: references.drafts, prototypes: prototypes.drafts },
    saved: { artifacts: artifacts.saved, references: references.saved, prototypes: prototypes.saved },
    conflicts,
  };
}

function rebaseDocumentMap<TDocument, TValue>(
  kind: "artifact" | "reference" | "prototype",
  current: ReadonlyMap<string, TDocument>,
  saved: ReadonlyMap<string, TDocument>,
  remote: ReadonlyMap<string, TDocument>,
  documentIds: ReadonlySet<string>,
  protectedDocumentIds: ReadonlySet<string>,
  adapter: DocumentAdapter<TDocument, TValue>,
  conflicts: WorkspaceRebaseConflict[],
): RebasedDocumentMap<TDocument> {
  const drafts = new Map(remote);
  const nextSaved = new Map(remote);
  for (const key of new Set([...saved.keys(), ...current.keys(), ...remote.keys()])) {
    const documentId = `${kind}:${key}`;
    const baselineDocument = saved.get(key);
    const localDocument = current.get(key);
    const remoteDocument = remote.get(key);

    if (!documentIds.has(documentId)) {
      if (protectedDocumentIds.has(documentId)) {
        setOptional(drafts, key, localDocument);
        setOptional(nextSaved, key, baselineDocument);
      }
      continue;
    }

    const reconciled = reconcileDocument(baselineDocument, localDocument, remoteDocument, adapter);
    if (reconciled.conflicts.length > 0) {
      conflicts.push({ documentId, fieldPaths: reconciled.conflicts });
      continue;
    }
    setOptional(drafts, key, reconciled.value);
  }
  return { drafts, saved: nextSaved };
}

function reconcileDocument<TDocument, TValue>(
  baselineDocument: TDocument | undefined,
  localDocument: TDocument | undefined,
  remoteDocument: TDocument | undefined,
  adapter: DocumentAdapter<TDocument, TValue>,
): MergeResult<TDocument> {
  if (!baselineDocument) {
    if (!localDocument) return optionalMergeResult(remoteDocument);
    if (!remoteDocument) return { value: localDocument, conflicts: [] };
    return documentsEqual(localDocument, remoteDocument, adapter) ? { value: remoteDocument, conflicts: [] } : { conflicts: ["/"] };
  }
  if (!localDocument) {
    if (!remoteDocument || documentsEqual(baselineDocument, remoteDocument, adapter)) return { conflicts: [] };
    return { conflicts: ["/"] };
  }
  if (!remoteDocument) {
    return documentsEqual(baselineDocument, localDocument, adapter) ? { conflicts: [] } : { conflicts: ["/"] };
  }

  const path = mergeJsonValue(
    baselineDocumentPath(baselineDocument),
    baselineDocumentPath(localDocument),
    baselineDocumentPath(remoteDocument),
    "/path",
  );
  const value = mergeJsonValue(adapter.value(baselineDocument), adapter.value(localDocument), adapter.value(remoteDocument), "");
  const conflicts = [...path.conflicts, ...value.conflicts];
  if (conflicts.length > 0 || path.value === undefined || value.value === undefined) return { conflicts };
  return {
    value: adapter.createDraft(localDocument, remoteDocument, path.value as string, value.value as TValue),
    conflicts: [],
  };
}

function mergeJsonValue(baseline: unknown, local: unknown, remote: unknown, path: string): MergeResult<unknown> {
  if (jsonEqual(local, remote)) return { value: cloneJsonValue(local), conflicts: [] };
  if (jsonEqual(local, baseline)) return { value: cloneJsonValue(remote), conflicts: [] };
  if (jsonEqual(remote, baseline)) return { value: cloneJsonValue(local), conflicts: [] };
  if (!isJsonObject(baseline) || !isJsonObject(local) || !isJsonObject(remote)) {
    return { conflicts: [path || "/"] };
  }

  const result: Record<string, unknown> = {};
  const conflicts: string[] = [];
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(local), ...Object.keys(remote)])) {
    const merged = mergeJsonValue(
      Object.hasOwn(baseline, key) ? baseline[key] : MISSING,
      Object.hasOwn(local, key) ? local[key] : MISSING,
      Object.hasOwn(remote, key) ? remote[key] : MISSING,
      `${path}/${escapeJsonPointer(key)}`,
    );
    conflicts.push(...merged.conflicts);
    if (merged.value !== MISSING && merged.value !== undefined) result[key] = merged.value;
  }
  return conflicts.length > 0 ? { conflicts } : { value: result, conflicts: [] };
}

function documentsEqual<TDocument, TValue>(
  left: TDocument | undefined,
  right: TDocument | undefined,
  adapter: DocumentAdapter<TDocument, TValue>,
): boolean {
  if (!left || !right) return left === right;
  return baselineDocumentPath(left) === baselineDocumentPath(right) && jsonEqual(adapter.value(left), adapter.value(right));
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonEqual(value, right[index]))
    );
  }
  if (!isJsonObject(left) || !isJsonObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && jsonEqual(left[key], right[key]))
  );
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function baselineDocumentPath(document: unknown): string {
  return (document as { readonly path: string }).path;
}

function setOptional<T>(map: Map<string, T>, key: string, value: T | undefined): void {
  if (value === undefined) map.delete(key);
  else map.set(key, value);
}

function escapeJsonPointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function cloneJsonValue(value: unknown): unknown {
  return value === MISSING ? MISSING : structuredClone(value);
}

function optionalMergeResult<T>(value: T | undefined): MergeResult<T> {
  return value === undefined ? { conflicts: [] } : { value, conflicts: [] };
}
