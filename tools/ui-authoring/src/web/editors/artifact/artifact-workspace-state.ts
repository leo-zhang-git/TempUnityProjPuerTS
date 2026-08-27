import { useCallback, useMemo, useRef, useState } from "react";
import { formatSource } from "../../../kernel/canonical.js";
import { formatPrototype, formatReference } from "../../../kernel/prototype-canonical.js";
import type {
  WorkspaceNodeIdentityMapping,
  WorkspaceNodeIdentityOperation,
  WorkspaceSaveRequest,
  WorkspaceSaveResult,
} from "../../../schema/ui-api.js";
import type { UiSource } from "../../../schema/ui-source-schema.js";
import type { ArtifactTransaction, ArtifactTransactionResult } from "../../shared/api/client.js";
import type { PrototypeDocument, ReferenceDocument } from "../../shared/types.js";

const formattedSourceCache = new WeakMap<UiSource, string>();

export interface WorkspaceArtifactDocument {
  readonly path: string;
  readonly source: UiSource;
  readonly revision?: string;
  readonly modifiedAt?: number;
}

export type WorkspaceArtifactMap = ReadonlyMap<string, WorkspaceArtifactDocument>;
type WorkspaceMutationKind = "catalog" | "local";

interface WorkspaceRevision {
  readonly version: number;
  readonly kind: WorkspaceMutationKind;
  readonly changedKeys: ReadonlySet<string>;
}

type WorkspaceUpdater = (documents: Map<string, WorkspaceArtifactDocument>) => Map<string, WorkspaceArtifactDocument> | void;
type WorkspaceValidator = (documents: WorkspaceArtifactMap) => void;

export interface WorkspaceDraftDocuments {
  readonly artifacts: WorkspaceArtifactMap;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypes: ReadonlyMap<string, PrototypeDocument>;
}

interface MutableWorkspaceDraftDocuments {
  readonly artifacts: Map<string, WorkspaceArtifactDocument>;
  readonly references: Map<string, ReferenceDocument>;
  readonly prototypes: Map<string, PrototypeDocument>;
}

type WorkspaceDraftUpdater = (documents: MutableWorkspaceDraftDocuments) => void;

export interface WorkspaceSaveGroupCommit {
  readonly nodeIdentityMappings?: readonly WorkspaceNodeIdentityMapping[];
  readonly documentIds: readonly string[];
}

interface PendingWorkspaceSaveOperation {
  readonly id: string;
  readonly documentIds: readonly string[];
  readonly nodeIdentityMappings: readonly WorkspaceNodeIdentityMapping[];
}

export interface ArtifactWorkspaceState {
  readonly documents: WorkspaceArtifactMap;
  readonly savedDocuments: WorkspaceArtifactMap;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly savedReferences: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypes: ReadonlyMap<string, PrototypeDocument>;
  readonly savedPrototypes: ReadonlyMap<string, PrototypeDocument>;
  readonly dirty: boolean;
  readonly dirtyArtifactKeys: ReadonlySet<string>;
  readonly dirtyReferenceKeys: ReadonlySet<string>;
  readonly dirtyPrototypeKeys: ReadonlySet<string>;
  readonly pendingSaveDocumentIds: ReadonlySet<string>;
  readonly pendingSaveOperations: readonly PendingWorkspaceSaveOperation[];
  readonly transientActive: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly transaction: ArtifactTransaction;
  readonly revision: WorkspaceRevision;
  readonly transactionFor: (artifactKeys: ReadonlySet<string>) => WorkspaceSaveRequest["artifacts"];
  readonly commit: (updater: WorkspaceUpdater) => void;
  readonly commitLocal: (updater: WorkspaceUpdater) => void;
  readonly commitWorkspace: (updater: WorkspaceDraftUpdater, saveGroup?: WorkspaceSaveGroupCommit) => void;
  readonly beginTransient: () => void;
  readonly updateTransient: (updater: WorkspaceUpdater) => void;
  readonly updateTransientLocal: (updater: WorkspaceUpdater) => void;
  readonly endTransient: (validate?: WorkspaceValidator, onInvalid?: (reason: unknown) => void) => void;
  readonly cancelTransient: () => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly replaceAll: (documents: WorkspaceArtifactMap) => void;
  readonly synchronizeDrafts: (documents: WorkspaceArtifactMap) => void;
  readonly replaceWorkspace: (documents: WorkspaceDraftDocuments) => void;
  readonly applyWorkspaceRebase: (drafts: WorkspaceDraftDocuments, saved: WorkspaceDraftDocuments) => void;
  readonly synchronizeWorkspaceDrafts: (documents: WorkspaceDraftDocuments) => void;
  readonly readSnapshot: () => { readonly documents: WorkspaceArtifactMap; readonly savedDocuments: WorkspaceArtifactMap };
  readonly readWorkspaceSnapshot: () => WorkspaceDraftDocuments & {
    readonly savedArtifacts: WorkspaceArtifactMap;
    readonly savedReferences: ReadonlyMap<string, ReferenceDocument>;
    readonly savedPrototypes: ReadonlyMap<string, PrototypeDocument>;
  };
  readonly readDirtyDocumentIds: () => ReadonlySet<string>;
  readonly markSaved: (submitted: WorkspaceArtifactMap, result: ArtifactTransactionResult) => void;
  readonly markWorkspaceSaved: (submitted: WorkspaceDraftDocuments, result: WorkspaceSaveResult) => void;
  readonly expandSaveDocumentIds: (documentIds: ReadonlySet<string>) => ReadonlySet<string>;
  readonly nodeIdentityOperationsFor: (documentIds: ReadonlySet<string>) => readonly WorkspaceNodeIdentityOperation[];
  readonly discard: (artifactKeys: ReadonlySet<string>) => void;
  readonly discardDocuments: (documentIds: ReadonlySet<string>) => void;
}

interface WorkspaceDraftSnapshot {
  readonly artifacts: WorkspaceArtifactMap;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypes: ReadonlyMap<string, PrototypeDocument>;
  readonly saveOperations: readonly PendingWorkspaceSaveOperation[];
}

interface ArtifactWorkspaceStore {
  readonly documents: WorkspaceArtifactMap;
  readonly saved: WorkspaceArtifactMap;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly savedReferences: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypes: ReadonlyMap<string, PrototypeDocument>;
  readonly savedPrototypes: ReadonlyMap<string, PrototypeDocument>;
  readonly saveOperations: readonly PendingWorkspaceSaveOperation[];
  readonly past: readonly WorkspaceDraftSnapshot[];
  readonly future: readonly WorkspaceDraftSnapshot[];
  readonly revision: WorkspaceRevision;
  readonly transientActive: boolean;
}

export function useArtifactWorkspaceState(): ArtifactWorkspaceState {
  const [store, setStore] = useState<ArtifactWorkspaceStore>({
    documents: new Map(),
    saved: new Map(),
    references: new Map(),
    savedReferences: new Map(),
    prototypes: new Map(),
    savedPrototypes: new Map(),
    saveOperations: [],
    past: [],
    future: [],
    revision: { version: 0, kind: "catalog", changedKeys: new Set() },
    transientActive: false,
  });
  const storeRef = useRef(store);
  storeRef.current = store;
  const transientStart = useRef<WorkspaceArtifactMap | null>(null);
  const nextSaveOperationId = useRef(1);

  const commitStore = useCallback((next: ArtifactWorkspaceStore): void => {
    storeRef.current = next;
    setStore(next);
  }, []);

  const commitMutation = useCallback(
    (updater: WorkspaceUpdater, kind: WorkspaceMutationKind): void => {
      const current = storeRef.current;
      const { documents, changedKeys } = applyWorkspaceUpdater(current.documents, updater);
      if (changedKeys.size === 0) return;
      const operation =
        changedKeys.size > 1
          ? {
              id: `workspace-change-${nextSaveOperationId.current++}`,
              documentIds: [...changedKeys].map((key) => `artifact:${key}`).sort((left, right) => left.localeCompare(right)),
              nodeIdentityMappings: [],
            }
          : undefined;
      commitStore({
        ...current,
        documents,
        saveOperations: operation ? [...current.saveOperations, operation] : current.saveOperations,
        past: [...current.past.slice(-99), currentSnapshot(current)],
        future: [],
        revision: nextRevision(current.revision, kind, changedKeys),
      });
    },
    [commitStore],
  );
  const commit = useCallback((updater: WorkspaceUpdater) => commitMutation(updater, "catalog"), [commitMutation]);
  const commitLocal = useCallback((updater: WorkspaceUpdater) => commitMutation(updater, "local"), [commitMutation]);
  const commitWorkspace = useCallback(
    (updater: WorkspaceDraftUpdater, saveGroup?: WorkspaceSaveGroupCommit): void => {
      const current = storeRef.current;
      const draft: MutableWorkspaceDraftDocuments = {
        artifacts: new Map(current.documents),
        references: new Map(current.references),
        prototypes: new Map(current.prototypes),
      };
      updater(draft);
      const changedKeys = contentChangedKeys(current.documents, draft.artifacts);
      const referencesChanged = changedDocumentKeys(current.references, draft.references, serializeReferenceDocument).size > 0;
      const prototypesChanged = changedDocumentKeys(current.prototypes, draft.prototypes, serializePrototypeDocument).size > 0;
      if (changedKeys.size === 0 && !referencesChanged && !prototypesChanged) return;
      const changedDocumentIds = workspaceChangedDocumentIds(
        { artifacts: current.documents, references: current.references, prototypes: current.prototypes },
        draft,
      );
      const operationDocumentIds = new Set([...changedDocumentIds, ...(saveGroup?.documentIds ?? [])]);
      const nodeIdentityMappings = saveGroup?.nodeIdentityMappings ?? [];
      const operation =
        operationDocumentIds.size > 1 || nodeIdentityMappings.length > 0
          ? {
              id: `${nodeIdentityMappings.length > 0 ? "node-identity" : "workspace-change"}-${nextSaveOperationId.current++}`,
              documentIds: [...operationDocumentIds].sort(),
              nodeIdentityMappings: nodeIdentityMappings.map((mapping) => ({ ...mapping })),
            }
          : undefined;
      commitStore({
        ...current,
        documents: draft.artifacts,
        references: draft.references,
        prototypes: draft.prototypes,
        saveOperations: operation ? [...current.saveOperations, operation] : current.saveOperations,
        past: [...current.past.slice(-99), currentSnapshot(current)],
        future: [],
        revision: nextRevision(current.revision, "catalog", changedKeys),
      });
    },
    [commitStore],
  );

  const beginTransient = useCallback(() => {
    const current = storeRef.current;
    transientStart.current = current.documents;
    commitStore({ ...current, transientActive: true });
  }, [commitStore]);

  const updateTransientMutation = useCallback(
    (updater: WorkspaceUpdater, kind: WorkspaceMutationKind): void => {
      const current = storeRef.current;
      const { documents, changedKeys } = applyWorkspaceUpdater(current.documents, updater, kind === "catalog");
      if (changedKeys.size === 0) return;
      commitStore({
        ...current,
        documents,
        revision: nextRevision(current.revision, kind, changedKeys),
      });
    },
    [commitStore],
  );
  const updateTransient = useCallback(
    (updater: WorkspaceUpdater) => updateTransientMutation(updater, "catalog"),
    [updateTransientMutation],
  );
  const updateTransientLocal = useCallback(
    (updater: WorkspaceUpdater) => updateTransientMutation(updater, "local"),
    [updateTransientMutation],
  );

  const endTransient = useCallback(
    (validate?: WorkspaceValidator, onInvalid?: (reason: unknown) => void) => {
      const current = storeRef.current;
      const start = transientStart.current;
      transientStart.current = null;
      if (!start || contentChangedKeys(start, current.documents).size === 0) {
        commitStore({ ...current, transientActive: false });
        return;
      }
      try {
        validate?.(current.documents);
      } catch (reason) {
        onInvalid?.(reason);
        commitStore({
          ...current,
          documents: start,
          transientActive: false,
          revision: nextRevision(current.revision, "catalog", referenceChangedKeys(current.documents, start)),
        });
        return;
      }
      commitStore({
        ...current,
        past: [...current.past.slice(-99), { ...currentSnapshot(current), artifacts: start }],
        future: [],
        transientActive: false,
      });
    },
    [commitStore],
  );

  const cancelTransient = useCallback(() => {
    const current = storeRef.current;
    const start = transientStart.current;
    transientStart.current = null;
    if (!start || start === current.documents) {
      commitStore({ ...current, transientActive: false });
      return;
    }
    commitStore({
      ...current,
      documents: start,
      transientActive: false,
      revision: nextRevision(current.revision, "catalog", referenceChangedKeys(current.documents, start)),
    });
  }, [commitStore]);

  const undo = useCallback(() => {
    const current = storeRef.current;
    const previous = current.past.at(-1);
    if (!previous) return;
    commitStore({
      ...current,
      documents: previous.artifacts,
      references: previous.references,
      prototypes: previous.prototypes,
      saveOperations: previous.saveOperations,
      past: current.past.slice(0, -1),
      future: [currentSnapshot(current), ...current.future].slice(0, 100),
      revision: nextRevision(current.revision, "catalog", referenceChangedKeys(current.documents, previous.artifacts)),
    });
  }, [commitStore]);

  const redo = useCallback(() => {
    const current = storeRef.current;
    const documents = current.future[0];
    if (!documents) return;
    commitStore({
      ...current,
      documents: documents.artifacts,
      references: documents.references,
      prototypes: documents.prototypes,
      saveOperations: documents.saveOperations,
      past: [...current.past.slice(-99), currentSnapshot(current)],
      future: current.future.slice(1),
      revision: nextRevision(current.revision, "catalog", referenceChangedKeys(current.documents, documents.artifacts)),
    });
  }, [commitStore]);

  const replaceAll = useCallback(
    (next: WorkspaceArtifactMap) => {
      const cloned = cloneDocuments(next);
      transientStart.current = null;
      const current = storeRef.current;
      commitStore({
        documents: cloned,
        saved: cloned,
        references: current.references,
        savedReferences: current.savedReferences,
        prototypes: current.prototypes,
        savedPrototypes: current.savedPrototypes,
        saveOperations: [],
        past: [],
        future: [],
        revision: nextRevision(current.revision, "catalog", new Set(cloned.keys())),
        transientActive: false,
      });
    },
    [commitStore],
  );

  const replaceWorkspace = useCallback(
    (next: WorkspaceDraftDocuments): void => {
      const current = storeRef.current;
      const snapshot = cloneWorkspaceSnapshot(next);
      transientStart.current = null;
      commitStore({
        documents: snapshot.artifacts,
        saved: snapshot.artifacts,
        references: snapshot.references,
        savedReferences: snapshot.references,
        prototypes: snapshot.prototypes,
        savedPrototypes: snapshot.prototypes,
        saveOperations: [],
        past: [],
        future: [],
        revision: nextRevision(current.revision, "catalog", new Set(snapshot.artifacts.keys())),
        transientActive: false,
      });
    },
    [commitStore],
  );

  const applyWorkspaceRebase = useCallback(
    (drafts: WorkspaceDraftDocuments, saved: WorkspaceDraftDocuments): void => {
      const current = storeRef.current;
      const nextDrafts = cloneWorkspaceSnapshot(drafts);
      const nextSaved = cloneWorkspaceSnapshot(saved);
      transientStart.current = null;
      commitStore({
        ...current,
        documents: nextDrafts.artifacts,
        saved: nextSaved.artifacts,
        references: nextDrafts.references,
        savedReferences: nextSaved.references,
        prototypes: nextDrafts.prototypes,
        savedPrototypes: nextSaved.prototypes,
        past: [],
        future: [],
        revision: nextRevision(current.revision, "catalog", referenceChangedKeys(current.documents, nextDrafts.artifacts)),
        transientActive: false,
      });
    },
    [commitStore],
  );

  const synchronizeDrafts = useCallback(
    (next: WorkspaceArtifactMap) => {
      const current = storeRef.current;
      const documents = cloneDocuments(next);
      const changedKeys = contentChangedKeys(current.documents, documents);
      if (changedKeys.size === 0) return;
      transientStart.current = null;
      commitStore({
        ...current,
        documents,
        saveOperations: [],
        past: [],
        future: [],
        revision: nextRevision(current.revision, "catalog", changedKeys),
        transientActive: false,
      });
    },
    [commitStore],
  );

  const synchronizeWorkspaceDrafts = useCallback(
    (next: WorkspaceDraftDocuments): void => {
      const current = storeRef.current;
      const snapshot = cloneWorkspaceSnapshot(next);
      const changedKeys = contentChangedKeys(current.documents, snapshot.artifacts);
      const referencesChanged = changedDocumentKeys(current.references, snapshot.references, serializeReferenceDocument).size > 0;
      const prototypesChanged = changedDocumentKeys(current.prototypes, snapshot.prototypes, serializePrototypeDocument).size > 0;
      if (changedKeys.size === 0 && !referencesChanged && !prototypesChanged) return;
      transientStart.current = null;
      commitStore({
        ...current,
        documents: snapshot.artifacts,
        references: snapshot.references,
        prototypes: snapshot.prototypes,
        saveOperations: [],
        past: [],
        future: [],
        revision: nextRevision(current.revision, "catalog", changedKeys),
        transientActive: false,
      });
    },
    [commitStore],
  );

  const readSnapshot = useCallback(
    () => ({
      documents: storeRef.current.documents,
      savedDocuments: storeRef.current.saved,
    }),
    [],
  );

  const readWorkspaceSnapshot = useCallback(() => {
    const current = storeRef.current;
    return {
      artifacts: current.documents,
      references: current.references,
      prototypes: current.prototypes,
      savedArtifacts: current.saved,
      savedReferences: current.savedReferences,
      savedPrototypes: current.savedPrototypes,
    };
  }, []);

  const readDirtyDocumentIds = useCallback((): ReadonlySet<string> => {
    const current = storeRef.current;
    return new Set([
      ...workspaceChangedDocumentIds(
        { artifacts: current.saved, references: current.savedReferences, prototypes: current.savedPrototypes },
        { artifacts: current.documents, references: current.references, prototypes: current.prototypes },
      ),
      ...current.saveOperations.flatMap((operation) => operation.documentIds),
    ]);
  }, []);

  const expandSaveDocumentIds = useCallback(
    (documentIds: ReadonlySet<string>): ReadonlySet<string> => expandSaveOperationDocumentIds(storeRef.current.saveOperations, documentIds),
    [],
  );

  const nodeIdentityOperationsFor = useCallback((documentIds: ReadonlySet<string>): readonly WorkspaceNodeIdentityOperation[] => {
    const expanded = expandSaveOperationDocumentIds(storeRef.current.saveOperations, documentIds);
    return storeRef.current.saveOperations
      .filter(
        (operation) => operation.nodeIdentityMappings.length > 0 && operation.documentIds.some((documentId) => expanded.has(documentId)),
      )
      .map(({ id, nodeIdentityMappings }) => ({ id, mappings: nodeIdentityMappings }));
  }, []);

  const markSaved = useCallback(
    (submitted: WorkspaceArtifactMap, result: ArtifactTransactionResult) => {
      const current = storeRef.current;
      const saved = cloneDocuments(current.saved);
      for (const path of result.deletes) {
        const artifactKey = [...saved].find(([, document]) => document.path === path)?.[0];
        if (artifactKey) saved.delete(artifactKey);
      }
      for (const upsert of result.upserts)
        saved.set(upsert.source.artifactKey, { path: upsert.path, source: upsert.source, modifiedAt: Date.now() });
      const documents = cloneDocuments(current.documents);
      for (const upsert of result.upserts) {
        const submittedDocument = submitted.get(upsert.source.artifactKey);
        const currentDocument = current.documents.get(upsert.source.artifactKey);
        if (submittedDocument && currentDocument && serializeDocument(submittedDocument) === serializeDocument(currentDocument)) {
          documents.set(upsert.source.artifactKey, { path: upsert.path, source: upsert.source, modifiedAt: Date.now() });
        }
      }
      commitStore({
        ...current,
        documents,
        saved,
        revision: nextRevision(current.revision, "catalog", referenceChangedKeys(current.documents, documents)),
      });
    },
    [commitStore],
  );

  const markWorkspaceSaved = useCallback(
    (submitted: WorkspaceDraftDocuments, result: WorkspaceSaveResult): void => {
      const current = storeRef.current;
      const artifactState = applyArtifactSaveResult(current.documents, current.saved, submitted.artifacts, result.artifacts);
      const referenceState = applyReferenceSaveResult(current.references, current.savedReferences, submitted.references, result.references);
      const prototypeState = applyPrototypeSaveResult(current.prototypes, current.savedPrototypes, submitted.prototypes, result.prototypes);
      const completedOperationIds = new Set(result.completedNodeIdentityOperationIds);
      const remainingDirtyDocumentIds = workspaceChangedDocumentIds(
        { artifacts: artifactState.saved, references: referenceState.saved, prototypes: prototypeState.saved },
        { artifacts: artifactState.documents, references: referenceState.documents, prototypes: prototypeState.documents },
      );
      for (const operation of current.saveOperations) {
        if (
          operation.nodeIdentityMappings.length === 0 &&
          operation.documentIds.every((documentId) => !remainingDirtyDocumentIds.has(documentId))
        ) {
          completedOperationIds.add(operation.id);
        }
      }
      const completedOperations = current.saveOperations.filter((operation) => completedOperationIds.has(operation.id));
      const settledDocumentIds = new Set(completedOperations.flatMap((operation) => operation.documentIds));
      const settledBaseline: WorkspaceDraftSnapshot = {
        artifacts: artifactState.saved,
        references: referenceState.saved,
        prototypes: prototypeState.saved,
        saveOperations: [],
      };
      commitStore({
        ...current,
        documents: artifactState.documents,
        saved: artifactState.saved,
        references: referenceState.documents,
        savedReferences: referenceState.saved,
        prototypes: prototypeState.documents,
        savedPrototypes: prototypeState.saved,
        saveOperations: current.saveOperations.filter((operation) => !completedOperationIds.has(operation.id)),
        past:
          settledDocumentIds.size === 0
            ? current.past
            : current.past.map((snapshot) =>
                settleSaveOperationSnapshot(snapshot, settledBaseline, settledDocumentIds, completedOperationIds),
              ),
        future:
          settledDocumentIds.size === 0
            ? current.future
            : current.future.map((snapshot) =>
                settleSaveOperationSnapshot(snapshot, settledBaseline, settledDocumentIds, completedOperationIds),
              ),
        revision: nextRevision(current.revision, "catalog", referenceChangedKeys(current.documents, artifactState.documents)),
      });
    },
    [commitStore],
  );

  const discard = useCallback(
    (artifactKeys: ReadonlySet<string>) => {
      if (artifactKeys.size === 0) return;
      const current = storeRef.current;
      transientStart.current = null;
      commitStore({
        ...current,
        documents: restoreArtifactKeys(current.documents, current.saved, artifactKeys),
        past: current.past.map((snapshot) => ({
          ...snapshot,
          artifacts: restoreArtifactKeys(snapshot.artifacts, current.saved, artifactKeys),
        })),
        future: current.future.map((snapshot) => ({
          ...snapshot,
          artifacts: restoreArtifactKeys(snapshot.artifacts, current.saved, artifactKeys),
        })),
        revision: nextRevision(current.revision, "catalog", artifactKeys),
        transientActive: false,
      });
    },
    [commitStore],
  );

  const discardDocuments = useCallback(
    (documentIds: ReadonlySet<string>): void => {
      if (documentIds.size === 0) return;
      const current = storeRef.current;
      const expandedDocumentIds = expandSaveOperationDocumentIds(current.saveOperations, documentIds);
      const discardedOperationIds = new Set(
        current.saveOperations
          .filter((operation) => operation.documentIds.some((documentId) => expandedDocumentIds.has(documentId)))
          .map((operation) => operation.id),
      );
      const artifactKeys = documentKeys(expandedDocumentIds, "artifact");
      const referenceKeys = documentKeys(expandedDocumentIds, "reference");
      const prototypeKeys = documentKeys(expandedDocumentIds, "prototype");
      const restore = (snapshot: WorkspaceDraftSnapshot): WorkspaceDraftSnapshot => ({
        artifacts: restoreArtifactKeys(snapshot.artifacts, current.saved, artifactKeys),
        references: restoreDocumentKeys(snapshot.references, current.savedReferences, referenceKeys),
        prototypes: restoreDocumentKeys(snapshot.prototypes, current.savedPrototypes, prototypeKeys),
        saveOperations: snapshot.saveOperations.filter((operation) => !discardedOperationIds.has(operation.id)),
      });
      transientStart.current = null;
      const restored = restore(currentSnapshot(current));
      commitStore({
        ...current,
        documents: restored.artifacts,
        references: restored.references,
        prototypes: restored.prototypes,
        saveOperations: restored.saveOperations,
        past: current.past.map(restore),
        future: current.future.map(restore),
        revision: nextRevision(current.revision, "catalog", artifactKeys),
        transientActive: false,
      });
    },
    [commitStore],
  );

  const {
    documents,
    saved,
    references,
    savedReferences,
    prototypes,
    savedPrototypes,
    saveOperations,
    past,
    future,
    revision,
    transientActive,
  } = store;
  const transaction = useMemo(() => createTransaction(saved, documents), [saved, documents]);
  const dirtyArtifactKeys = useMemo(() => dirtyKeys(saved, documents), [saved, documents]);
  const dirtyReferenceKeys = useMemo(
    () => changedDocumentKeys(savedReferences, references, serializeReferenceDocument),
    [savedReferences, references],
  );
  const dirtyPrototypeKeys = useMemo(
    () => changedDocumentKeys(savedPrototypes, prototypes, serializePrototypeDocument),
    [savedPrototypes, prototypes],
  );
  const pendingSaveDocumentIds = useMemo(() => new Set(saveOperations.flatMap((operation) => operation.documentIds)), [saveOperations]);
  const dirty =
    transaction.upserts.length > 0 ||
    transaction.deletes.length > 0 ||
    dirtyReferenceKeys.size > 0 ||
    dirtyPrototypeKeys.size > 0 ||
    saveOperations.length > 0;
  const transactionFor = useCallback(
    (artifactKeys: ReadonlySet<string>) => createWorkspaceSaveTransactionForKeys(saved, documents, artifactKeys),
    [saved, documents],
  );
  return useMemo(
    () => ({
      documents,
      savedDocuments: saved,
      references,
      savedReferences,
      prototypes,
      savedPrototypes,
      dirty,
      dirtyArtifactKeys,
      dirtyReferenceKeys,
      dirtyPrototypeKeys,
      pendingSaveDocumentIds,
      pendingSaveOperations: saveOperations,
      transientActive,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      transaction,
      revision,
      transactionFor,
      commit,
      commitLocal,
      commitWorkspace,
      beginTransient,
      updateTransient,
      updateTransientLocal,
      endTransient,
      cancelTransient,
      undo,
      redo,
      replaceAll,
      synchronizeDrafts,
      replaceWorkspace,
      applyWorkspaceRebase,
      synchronizeWorkspaceDrafts,
      readSnapshot,
      readWorkspaceSnapshot,
      readDirtyDocumentIds,
      markSaved,
      markWorkspaceSaved,
      expandSaveDocumentIds,
      nodeIdentityOperationsFor,
      discard,
      discardDocuments,
    }),
    [
      documents,
      saved,
      references,
      savedReferences,
      prototypes,
      savedPrototypes,
      dirty,
      dirtyArtifactKeys,
      dirtyReferenceKeys,
      dirtyPrototypeKeys,
      pendingSaveDocumentIds,
      saveOperations,
      transientActive,
      past.length,
      future.length,
      transaction,
      revision,
      transactionFor,
      commit,
      commitLocal,
      commitWorkspace,
      beginTransient,
      updateTransient,
      updateTransientLocal,
      endTransient,
      cancelTransient,
      undo,
      redo,
      replaceAll,
      synchronizeDrafts,
      replaceWorkspace,
      applyWorkspaceRebase,
      synchronizeWorkspaceDrafts,
      readSnapshot,
      readWorkspaceSnapshot,
      readDirtyDocumentIds,
      markSaved,
      markWorkspaceSaved,
      expandSaveDocumentIds,
      nodeIdentityOperationsFor,
      discard,
      discardDocuments,
    ],
  );
}

function currentSnapshot(store: ArtifactWorkspaceStore): WorkspaceDraftSnapshot {
  return {
    artifacts: store.documents,
    references: store.references,
    prototypes: store.prototypes,
    saveOperations: store.saveOperations,
  };
}

function cloneWorkspaceSnapshot(documents: WorkspaceDraftDocuments): WorkspaceDraftSnapshot {
  return {
    artifacts: cloneDocuments(documents.artifacts),
    references: cloneReferenceDocuments(documents.references),
    prototypes: clonePrototypeDocuments(documents.prototypes),
    saveOperations: [],
  };
}

function applyArtifactSaveResult(
  currentDocuments: WorkspaceArtifactMap,
  currentSaved: WorkspaceArtifactMap,
  submitted: WorkspaceArtifactMap,
  result: WorkspaceSaveResult["artifacts"],
): { readonly documents: WorkspaceArtifactMap; readonly saved: WorkspaceArtifactMap } {
  const saved = cloneDocuments(currentSaved);
  for (const path of result.deletes) {
    const artifactKey = [...saved].find(([, document]) => document.path === path)?.[0];
    if (artifactKey) saved.delete(artifactKey);
  }
  for (const upsert of result.upserts)
    saved.set(upsert.source.artifactKey, {
      path: upsert.path,
      source: upsert.source,
      revision: upsert.revision,
      modifiedAt: Date.now(),
    });
  const documents = cloneDocuments(currentDocuments);
  for (const upsert of result.upserts) {
    const submittedDocument = submitted.get(upsert.source.artifactKey);
    const currentDocument = currentDocuments.get(upsert.source.artifactKey);
    if (submittedDocument && currentDocument && serializeDocument(submittedDocument) === serializeDocument(currentDocument)) {
      documents.set(upsert.source.artifactKey, {
        path: upsert.path,
        source: upsert.source,
        revision: upsert.revision,
        modifiedAt: Date.now(),
      });
    }
  }
  return { documents, saved };
}

function applyReferenceSaveResult(
  currentDocuments: ReadonlyMap<string, ReferenceDocument>,
  currentSaved: ReadonlyMap<string, ReferenceDocument>,
  submitted: ReadonlyMap<string, ReferenceDocument>,
  result: WorkspaceSaveResult["references"],
): { readonly documents: ReadonlyMap<string, ReferenceDocument>; readonly saved: ReadonlyMap<string, ReferenceDocument> } {
  const saved = new Map(currentSaved);
  const documents = new Map(currentDocuments);
  for (const entry of result) {
    const submittedDocument = [...submitted.values()].find((document) => document.path === entry.path);
    if (!submittedDocument) continue;
    const savedDocument: ReferenceDocument = {
      ...submittedDocument,
      reference: entry.reference,
      subjectArtifactKey: entry.reference.subjectArtifactKey,
      revision: entry.revision,
      modifiedAt: Date.now(),
    };
    saved.set(entry.reference.referenceKey, savedDocument);
    const currentDocument = currentDocuments.get(entry.reference.referenceKey);
    if (currentDocument && serializeReferenceDocument(currentDocument) === serializeReferenceDocument(submittedDocument)) {
      documents.set(entry.reference.referenceKey, savedDocument);
    }
  }
  return { documents, saved };
}

function applyPrototypeSaveResult(
  currentDocuments: ReadonlyMap<string, PrototypeDocument>,
  currentSaved: ReadonlyMap<string, PrototypeDocument>,
  submitted: ReadonlyMap<string, PrototypeDocument>,
  result: WorkspaceSaveResult["prototypes"],
): { readonly documents: ReadonlyMap<string, PrototypeDocument>; readonly saved: ReadonlyMap<string, PrototypeDocument> } {
  const saved = new Map(currentSaved);
  const documents = new Map(currentDocuments);
  for (const entry of result) {
    const submittedDocument = [...submitted.values()].find((document) => document.path === entry.path);
    if (!submittedDocument) continue;
    const savedDocument: PrototypeDocument = {
      ...submittedDocument,
      prototype: entry.prototype,
      startReferenceKey: entry.prototype.startReferenceKey,
      interactionCount: entry.prototype.interactions.length,
      revision: entry.revision,
      modifiedAt: Date.now(),
    };
    saved.set(entry.prototype.prototypeKey, savedDocument);
    const currentDocument = currentDocuments.get(entry.prototype.prototypeKey);
    if (currentDocument && serializePrototypeDocument(currentDocument) === serializePrototypeDocument(submittedDocument)) {
      documents.set(entry.prototype.prototypeKey, savedDocument);
    }
  }
  return { documents, saved };
}

function changedDocumentKeys<T>(
  saved: ReadonlyMap<string, T>,
  current: ReadonlyMap<string, T>,
  serialize: (document: T) => string,
): ReadonlySet<string> {
  const changed = new Set<string>();
  for (const key of new Set([...saved.keys(), ...current.keys()])) {
    const previous = saved.get(key);
    const next = current.get(key);
    if (!previous || !next || serialize(previous) !== serialize(next)) changed.add(key);
  }
  return changed;
}

function serializeReferenceDocument(document: ReferenceDocument): string {
  return `${document.path}\0${formatReference(document.reference)}`;
}

function serializePrototypeDocument(document: PrototypeDocument): string {
  return `${document.path}\0${formatPrototype(document.prototype)}`;
}

function cloneReferenceDocuments(documents: ReadonlyMap<string, ReferenceDocument>): Map<string, ReferenceDocument> {
  return new Map([...documents].map(([key, document]) => [key, { ...document, reference: structuredClone(document.reference) }]));
}

function clonePrototypeDocuments(documents: ReadonlyMap<string, PrototypeDocument>): Map<string, PrototypeDocument> {
  return new Map([...documents].map(([key, document]) => [key, { ...document, prototype: structuredClone(document.prototype) }]));
}

function workspaceChangedDocumentIds(before: WorkspaceDraftDocuments, after: WorkspaceDraftDocuments): ReadonlySet<string> {
  return new Set([
    ...[...dirtyKeys(before.artifacts, after.artifacts)].map((key) => `artifact:${key}`),
    ...[...changedDocumentKeys(before.references, after.references, serializeReferenceDocument)].map((key) => `reference:${key}`),
    ...[...changedDocumentKeys(before.prototypes, after.prototypes, serializePrototypeDocument)].map((key) => `prototype:${key}`),
  ]);
}

function expandSaveOperationDocumentIds(
  operations: readonly PendingWorkspaceSaveOperation[],
  documentIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const expanded = new Set(documentIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const operation of operations) {
      if (!operation.documentIds.some((documentId) => expanded.has(documentId))) continue;
      for (const documentId of operation.documentIds) {
        if (expanded.has(documentId)) continue;
        expanded.add(documentId);
        changed = true;
      }
    }
  }
  return expanded;
}

function settleSaveOperationSnapshot(
  snapshot: WorkspaceDraftSnapshot,
  baseline: WorkspaceDraftSnapshot,
  documentIds: ReadonlySet<string>,
  operationIds: ReadonlySet<string>,
): WorkspaceDraftSnapshot {
  return {
    artifacts: restoreArtifactKeys(snapshot.artifacts, baseline.artifacts, documentKeys(documentIds, "artifact")),
    references: restoreDocumentKeys(snapshot.references, baseline.references, documentKeys(documentIds, "reference")),
    prototypes: restoreDocumentKeys(snapshot.prototypes, baseline.prototypes, documentKeys(documentIds, "prototype")),
    saveOperations: snapshot.saveOperations.filter((operation) => !operationIds.has(operation.id)),
  };
}

function documentKeys(documentIds: ReadonlySet<string>, kind: "artifact" | "reference" | "prototype"): ReadonlySet<string> {
  const prefix = `${kind}:`;
  return new Set([...documentIds].filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length)));
}

function restoreDocumentKeys<T>(
  current: ReadonlyMap<string, T>,
  saved: ReadonlyMap<string, T>,
  keys: ReadonlySet<string>,
): ReadonlyMap<string, T> {
  const restored = new Map(current);
  for (const key of keys) {
    const previous = saved.get(key);
    if (previous) restored.set(key, structuredClone(previous));
    else restored.delete(key);
  }
  return restored;
}

function nextRevision(current: WorkspaceRevision, kind: WorkspaceMutationKind, changedKeys: ReadonlySet<string>): WorkspaceRevision {
  return { version: current.version + 1, kind, changedKeys };
}

export function createTransaction(saved: WorkspaceArtifactMap, current: WorkspaceArtifactMap): ArtifactTransaction {
  const upserts: Array<ArtifactTransaction["upserts"][number]> = [];
  const deletes: Array<ArtifactTransaction["deletes"][number]> = [];
  for (const [artifactKey, previous] of saved) {
    const next = current.get(artifactKey);
    if (!next) {
      deletes.push({ path: previous.path, expectedContent: formatCachedSource(previous.source) });
      continue;
    }
    if (previous.path !== next.path) deletes.push({ path: previous.path, expectedContent: formatCachedSource(previous.source) });
  }
  for (const [artifactKey, next] of current) {
    const previous = saved.get(artifactKey);
    if (!previous || serializeDocument(previous) !== serializeDocument(next)) {
      upserts.push(
        previous?.path === next.path
          ? { path: next.path, source: next.source, expectedContent: formatCachedSource(previous.source) }
          : { path: next.path, source: next.source, expectedContent: null },
      );
    }
  }
  upserts.sort((left, right) => left.path.localeCompare(right.path));
  deletes.sort((left, right) => left.path.localeCompare(right.path));
  return { upserts, deletes };
}

export function createTransactionForKeys(
  saved: WorkspaceArtifactMap,
  current: WorkspaceArtifactMap,
  artifactKeys: ReadonlySet<string>,
): ArtifactTransaction {
  return createTransaction(filterDocuments(saved, artifactKeys), filterDocuments(current, artifactKeys));
}

export function createWorkspaceSaveTransactionForKeys(
  saved: WorkspaceArtifactMap,
  current: WorkspaceArtifactMap,
  artifactKeys: ReadonlySet<string>,
): WorkspaceSaveRequest["artifacts"] {
  const previousDocuments = filterDocuments(saved, artifactKeys);
  const currentDocuments = filterDocuments(current, artifactKeys);
  const upserts: Array<WorkspaceSaveRequest["artifacts"]["upserts"][number]> = [];
  const deletes: Array<WorkspaceSaveRequest["artifacts"]["deletes"][number]> = [];
  for (const [artifactKey, previous] of previousDocuments) {
    const next = currentDocuments.get(artifactKey);
    if (!next || previous.path !== next.path) {
      deletes.push({ path: previous.path, expectedRevision: requiredRevision(previous) });
    }
  }
  for (const [artifactKey, next] of currentDocuments) {
    const previous = previousDocuments.get(artifactKey);
    if (!previous || serializeDocument(previous) !== serializeDocument(next)) {
      upserts.push({
        path: next.path,
        source: next.source,
        expectedRevision: previous?.path === next.path ? requiredRevision(previous) : null,
      });
    }
  }
  upserts.sort((left, right) => left.path.localeCompare(right.path));
  deletes.sort((left, right) => left.path.localeCompare(right.path));
  return { upserts, deletes };
}

export function dirtyKeys(saved: WorkspaceArtifactMap, current: WorkspaceArtifactMap): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const artifactKey of new Set([...saved.keys(), ...current.keys()])) {
    const previous = saved.get(artifactKey);
    const next = current.get(artifactKey);
    if (!previous || !next || serializeDocument(previous) !== serializeDocument(next)) keys.add(artifactKey);
  }
  return keys;
}

function referenceChangedKeys(previous: WorkspaceArtifactMap, next: WorkspaceArtifactMap): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const artifactKey of new Set([...previous.keys(), ...next.keys()])) {
    if (previous.get(artifactKey) !== next.get(artifactKey)) keys.add(artifactKey);
  }
  return keys;
}

function filterDocuments(documents: WorkspaceArtifactMap, artifactKeys: ReadonlySet<string>): Map<string, WorkspaceArtifactDocument> {
  const filtered = new Map<string, WorkspaceArtifactDocument>();
  for (const artifactKey of artifactKeys) {
    const document = documents.get(artifactKey);
    if (document) filtered.set(artifactKey, document);
  }
  return filtered;
}

function restoreArtifactKeys(
  current: WorkspaceArtifactMap,
  saved: WorkspaceArtifactMap,
  artifactKeys: ReadonlySet<string>,
): Map<string, WorkspaceArtifactDocument> {
  const restored = cloneDocuments(current);
  for (const artifactKey of artifactKeys) {
    const previous = saved.get(artifactKey);
    if (previous) restored.set(artifactKey, cloneDocument(previous));
    else restored.delete(artifactKey);
  }
  return restored;
}

function cloneDocuments(documents: WorkspaceArtifactMap): Map<string, WorkspaceArtifactDocument> {
  return new Map([...documents].map(([artifactKey, document]) => [artifactKey, cloneDocument(document)]));
}

function cloneDocument(document: WorkspaceArtifactDocument): WorkspaceArtifactDocument {
  return {
    path: document.path,
    source: structuredClone(document.source),
    ...(document.revision === undefined ? {} : { revision: document.revision }),
    ...(document.modifiedAt === undefined ? {} : { modifiedAt: document.modifiedAt }),
  };
}

function requiredRevision(document: WorkspaceArtifactDocument): string {
  if (!document.revision) throw new Error(`文档“${document.path}”缺少磁盘 revision，请重新加载工作区后重试`);
  return document.revision;
}

function serializeDocument(document: WorkspaceArtifactDocument): string {
  return `${document.path}\0${formatCachedSource(document.source)}`;
}

function contentChangedKeys(previous: WorkspaceArtifactMap, next: WorkspaceArtifactMap): ReadonlySet<string> {
  const changed = new Set(referenceChangedKeys(previous, next));
  for (const artifactKey of [...changed]) {
    const before = previous.get(artifactKey);
    const after = next.get(artifactKey);
    if (before && after && serializeDocument(before) === serializeDocument(after)) changed.delete(artifactKey);
  }
  return changed;
}

function applyWorkspaceUpdater(
  previous: WorkspaceArtifactMap,
  updater: WorkspaceUpdater,
  compareContent = true,
): {
  readonly documents: Map<string, WorkspaceArtifactDocument>;
  readonly changedKeys: ReadonlySet<string>;
} {
  const draft = new Map(previous);
  const updated = updater(draft) ?? draft;
  // Local transient gestures already suppress unchanged samples. Keep their hot path
  // identity-based and defer canonical no-op comparison until endTransient.
  const changedKeysFor = compareContent ? contentChangedKeys : referenceChangedKeys;
  const updaterChangedKeys = changedKeysFor(previous, updated);
  let documents = updated;
  for (const artifactKey of updaterChangedKeys) {
    const document = documents.get(artifactKey);
    if (!document || document.source.sourceKind !== "artifact") continue;
    const source = document.source;
    if (source === document.source) continue;
    if (documents === updated) documents = new Map(updated);
    documents.set(artifactKey, { ...document, source });
  }
  return { documents, changedKeys: changedKeysFor(previous, documents) };
}

function formatCachedSource(source: UiSource): string {
  const cached = formattedSourceCache.get(source);
  if (cached !== undefined) return cached;
  const formatted = formatSource(source);
  formattedSourceCache.set(source, formatted);
  return formatted;
}
