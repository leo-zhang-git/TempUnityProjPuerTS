import { FileJson } from "lucide-react";
import { lazy, type ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createArtifactSource, createPrototype, createReference } from "../../kernel/authoring.js";
import { type UiNodeClipboard } from "../../kernel/node-clipboard.js";
import { createReferenceCatalog } from "../../kernel/prototype.js";
import { createSourceCatalog } from "../../kernel/source-catalog.js";
import type { AuthoringAssetEntry } from "../../schema/asset-catalog.js";
import type { UiWorkspaceIdentity, UiWorkspaceVcsAction, WorkspaceSaveMode } from "../../schema/ui-api.js";
import type { UiDiagnostic, UiDocumentKind } from "../../schema/ui-diagnostics.js";
import { resolveArtifactDocuments, validateWorkspaceDocuments } from "../editors/artifact/artifact-documents.js";
import type { UiComponentClipboard } from "../editors/artifact/inspector/component-clipboard.js";
import dialogStyles from "../editors/shared/dialog.module.css";
import sharedStyles from "../editors/shared/editor-shell.module.css";
import type { PreviewEditorMode } from "../editors/shared/preview-editor-mode.js";
import {
  apiFailureDiagnostics,
  loadAssets,
  loadBootstrap,
  openWorkspaceVersionControl,
  refreshAssets,
  saveWorkspaceDocuments,
} from "../shared/api/client.js";
import { useWebDiagnostics } from "../shared/web-diagnostics.js";
import { createWebClasses } from "../styles/web-styles.js";
import { WorkspaceDocumentCommandsProvider } from "../workspace/document-commands-context.js";
import {
  catalogFromDocuments,
  DEFAULT_GRID_SCALE,
  normalizeWorkspacePath,
  parseWorkspaceLocation,
  type WorkspaceLocation,
  workspaceLocationSearch,
} from "../workspace/explorer/artifact-explorer-model.js";
import { WorkspaceNavigationContext } from "../workspace/explorer/workspace-navigation-state.js";
import { WorkspaceProblemsProvider } from "../workspace/problems/workspace-problems.js";
import { WorkspaceEditingProvider } from "../workspace/workspace-editing-context.js";
import { ApplicationMenu } from "./application-menu.js";
import { CollaborationProfileDialog } from "./collaboration-profile-dialog.js";
import { useCollaborationSession } from "./collaboration-session.js";
import { createDocumentDraft, type DocumentCreateDraft, explainDocumentCreateDraftIssue } from "./document-create-model.js";
import { useSourceWriteSession } from "./source-write-session.js";
import { createWorkspaceChanges } from "./workspace-changes.js";
import { WorkspaceChangesDialog } from "./workspace-changes-dialog.js";
import { useWorkspaceDocumentSession, workspaceDataFromBootstrap } from "./workspace-document-session.js";
import { locationExists, useWorkspaceNavigationSession } from "./workspace-navigation.js";
import { preloadArtifactEditor, WorkspaceRoutes } from "./workspace-routes.js";
import { WorkspaceSaveAttemptError } from "./workspace-save-coordinator.js";
import { attributedSaveFailureDocumentIds } from "./workspace-save-failure.js";
import { type WorkspaceSaveFailure, WorkspaceSaveResultDialog, type WorkspaceSaveResultNotice } from "./workspace-save-result-dialog.js";
import { useWorkspaceSaveSession } from "./workspace-save-session.js";

const webClasses = createWebClasses(sharedStyles, dialogStyles);

const DocumentCreateDialog = lazy(async () => {
  const module = await import("./document-create-dialog.js");
  return { default: module.DocumentCreateDialog };
});

const PrefabImportDialog = lazy(async () => {
  const module = await import("./prefab-import-dialog.js");
  return { default: module.PrefabImportDialog };
});

const initialLocation = parseWorkspaceLocation(window.location.search);
if (!initialLocation || initialLocation.kind === "artifact") {
  preloadArtifactEditor();
}

function saveDocumentIdentity(documentId: string): { readonly kind: UiDocumentKind; readonly key: string } {
  const separator = documentId.indexOf(":");
  return { kind: documentId.slice(0, separator) as UiDocumentKind, key: documentId.slice(separator + 1) };
}

function requiredDocumentRevision(path: string, revision: string | undefined): string {
  if (!revision) throw new Error(`文档“${path}”缺少磁盘 revision，请重新读取工作区后重试`);
  return revision;
}

function uniqueDiagnostics(diagnostics: readonly UiDiagnostic[]): readonly UiDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.path}\0${diagnostic.code}\0${diagnostic.identity?.fieldPath ?? ""}\0${diagnostic.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function App() {
  const diagnostics = useWebDiagnostics();
  const [previewDisplayMode, setPreviewDisplayMode] = useState<PreviewEditorMode>("preview");
  const [saveProblems, setSaveProblems] = useState<readonly UiDiagnostic[]>([]);
  const documents = useWorkspaceDocumentSession(saveProblems);
  const {
    workspace,
    workspaceRef,
    references,
    referencesRef,
    savedReferences,
    savedReferencesRef,
    prototypes,
    prototypesRef,
    savedPrototypes,
    savedPrototypesRef,
    setDirectories,
    unavailable,
    setUnavailable,
    setWorkspaceProblems,
    artifacts,
    catalog,
    allProblems,
    dirtyDocuments,
    dirty,
    updateReferenceDraft,
    updatePrototypeDraft,
  } = documents;
  const [assets, setAssets] = useState<readonly AuthoringAssetEntry[]>([]);
  const [notice, setNotice] = useState("就绪");
  const [error, setError] = useState("");
  const [nodeClipboard, setNodeClipboard] = useState<UiNodeClipboard | null>(null);
  const [componentClipboard, setComponentClipboard] = useState<UiComponentClipboard | null>(null);
  const [documentCreate, setDocumentCreate] = useState<DocumentCreateDraft | null>(null);
  const [changesOpen, setChangesOpen] = useState(false);
  const [prefabImportOpen, setPrefabImportOpen] = useState(false);
  const [workspaceIdentity, setWorkspaceIdentity] = useState<UiWorkspaceIdentity | null>(null);
  const [vcsBusy, setVcsBusy] = useState<UiWorkspaceVcsAction | null>(null);
  const [saveRetrying, setSaveRetrying] = useState(false);
  const assetsRequested = useRef(false);
  const saveSession = useWorkspaceSaveSession();
  const {
    autoSaveEnabled,
    status: saveStatus,
    resultNotice: saveResultNotice,
    setResultNotice: setSaveResultNotice,
    mountedRef,
    attemptRef: saveAttemptRef,
    coordinator: saveCoordinator,
    saveDocuments,
    scheduleDocuments,
    setAutoSaveEnabled,
  } = saveSession;
  const navigation = useWorkspaceNavigationSession({
    catalog,
    artifacts,
    dirty,
    savePhase: saveStatus.phase,
    onNotice: setNotice,
  });
  const {
    location,
    selectedId,
    setSelectedId,
    viewportIndex,
    setViewportIndex,
    zoom,
    setZoom,
    authoringMode,
    setAuthoringMode,
    applyLocation,
    initialize: initializeLocation,
    ensureRecoveredLocation,
    queueLocation,
    openArtifact,
    openRelations,
    closeRelations,
    openDirectory,
    changeDirectoryView,
    changeGalleryScale,
    openPrototype,
    openReference,
  } = navigation;
  const {
    profile: collaborationProfile,
    presentation: collaboration,
    activity: collaborationActivity,
    activityRefreshing: collaborationActivityRefreshing,
    profileOpen: collaborationProfileOpen,
    setProfileOpen: setCollaborationProfileOpen,
    refresh: refreshCollaboration,
    refreshActivity: refreshWorkspaceActivity,
    saveProfile: saveCollaborationProfile,
  } = useCollaborationSession({ location, catalog, dirtyDocuments });
  const {
    runSourceWrite,
    revertSource: revertSourceToSvnBase,
    rebaseExternalChanges,
  } = useSourceWriteSession({
    documents,
    saveCoordinator,
    savePhase: saveStatus.phase,
    onWorkspaceReloaded: (bootstrap) => {
      setWorkspaceIdentity(bootstrap.config.workspace);
      setDirectories(bootstrap.catalog.directories ?? []);
      setUnavailable(bootstrap.catalog.unavailable ?? []);
      setWorkspaceProblems(bootstrap.catalog.problems ?? []);
      ensureRecoveredLocation(workspaceDataFromBootstrap(bootstrap));
    },
    onNotice: setNotice,
  });
  const changes = useMemo(
    () =>
      changesOpen
        ? createWorkspaceChanges(workspace.savedDocuments, workspace.documents, savedReferences, references, savedPrototypes, prototypes)
        : [],
    [changesOpen, workspace.savedDocuments, workspace.documents, savedReferences, references, savedPrototypes, prototypes],
  );
  const saveDocumentsNow = useCallback(
    async (requestedIds: ReadonlySet<string>, saveMode: WorkspaceSaveMode): Promise<void> => {
      await runSourceWrite(async () => {
        const liveDirtyDocumentIds = workspaceRef.current.readDirtyDocumentIds();
        const dirtyRequestedIds = new Set([...requestedIds].filter((id) => liveDirtyDocumentIds.has(id)));
        const documentIds = workspaceRef.current.expandSaveDocumentIds(dirtyRequestedIds);
        if (documentIds.size === 0) return;
        if (mountedRef.current) setNotice("正在保存");
        const savedDocumentIds = new Set<string>();
        const retryRequiredDocumentIds = new Set<string>();
        const failureByDocumentId = new Map<string, WorkspaceSaveFailure>();
        const fallbackDiagnostic = (documentId: string, message: string): UiDiagnostic => {
          const identity = saveDocumentIdentity(documentId);
          const artifact = workspaceRef.current.documents.get(identity.key) ?? workspaceRef.current.savedDocuments.get(identity.key);
          const reference = referencesRef.current.get(identity.key) ?? savedReferencesRef.current.get(identity.key);
          const prototype = prototypesRef.current.get(identity.key) ?? savedPrototypesRef.current.get(identity.key);
          return {
            path: artifact?.path ?? reference?.path ?? prototype?.path ?? ".",
            severity: "error",
            category: "save",
            code: "save.unexpected",
            message,
            owner: identity.kind,
            safeFixable: false,
            nextAction: "检查诊断、文件权限和磁盘状态后重试保存。",
            identity: { documentKind: identity.kind, documentKey: identity.key },
          };
        };
        const documentIdForDiagnostic = (diagnostic: UiDiagnostic): string | undefined => {
          if (diagnostic.identity) return `${diagnostic.identity.documentKind}:${diagnostic.identity.documentKey}`;
          for (const documentId of documentIds) {
            const identity = saveDocumentIdentity(documentId);
            const document =
              identity.kind === "artifact"
                ? (workspaceRef.current.documents.get(identity.key) ?? workspaceRef.current.savedDocuments.get(identity.key))
                : identity.kind === "reference"
                  ? (referencesRef.current.get(identity.key) ?? savedReferencesRef.current.get(identity.key))
                  : (prototypesRef.current.get(identity.key) ?? savedPrototypesRef.current.get(identity.key));
            if (document?.path === diagnostic.path) return documentId;
          }
          return undefined;
        };
        const recordFailure = (ids: readonly string[], reason: unknown): void => {
          const message =
            reason instanceof Error
              ? reason.message
              : reason && typeof reason === "object" && typeof (reason as { readonly message?: unknown }).message === "string"
                ? (reason as { readonly message: string }).message
                : String(reason);
          const responseDiagnostics = apiFailureDiagnostics(reason);
          const failureIds = attributedSaveFailureDocumentIds(ids, responseDiagnostics, documentIdForDiagnostic);
          for (const documentId of failureIds) {
            const matchingDiagnostics = responseDiagnostics.filter((diagnostic) => documentIdForDiagnostic(diagnostic) === documentId);
            failureByDocumentId.set(documentId, {
              documentId,
              message,
              diagnostics:
                matchingDiagnostics.length > 0
                  ? matchingDiagnostics
                  : responseDiagnostics.length > 0 && failureIds.size === 1
                    ? responseDiagnostics
                    : [fallbackDiagnostic(documentId, message)],
            });
          }
        };

        try {
          const workspaceSnapshot = workspaceRef.current;
          const nodeIdentityOperations = workspaceSnapshot.nodeIdentityOperationsFor(documentIds);
          const nodeIdentityDocumentIds = new Set(
            workspaceSnapshot.pendingSaveOperations
              .filter((operation) => nodeIdentityOperations.some((candidate) => candidate.id === operation.id))
              .flatMap((operation) => operation.documentIds),
          );
          const submitted = {
            artifacts: workspaceSnapshot.documents,
            references: workspaceSnapshot.references,
            prototypes: workspaceSnapshot.prototypes,
          };
          const referenceKeys = [...documentIds]
            .filter((id) => id.startsWith("reference:"))
            .map((id) => id.slice("reference:".length))
            .sort((left, right) => left.localeCompare(right));
          const prototypeKeys = [...documentIds]
            .filter((id) => id.startsWith("prototype:"))
            .map((id) => id.slice("prototype:".length))
            .sort((left, right) => left.localeCompare(right));
          const artifactKeys = new Set(
            [...documentIds].filter((id) => id.startsWith("artifact:")).map((id) => id.slice("artifact:".length)),
          );
          try {
            const result = await saveWorkspaceDocuments({
              artifacts: workspaceSnapshot.transactionFor(artifactKeys),
              references: referenceKeys.flatMap((referenceKey) => {
                const document = submitted.references.get(referenceKey);
                if (!document) return [];
                const baseline = savedReferencesRef.current.get(referenceKey);
                return [
                  {
                    path: document.path,
                    reference: document.reference,
                    expectedRevision: baseline ? requiredDocumentRevision(baseline.path, baseline.revision) : null,
                  },
                ];
              }),
              prototypes: prototypeKeys.flatMap((prototypeKey) => {
                const document = submitted.prototypes.get(prototypeKey);
                if (!document) return [];
                const baseline = savedPrototypesRef.current.get(prototypeKey);
                return [
                  {
                    path: document.path,
                    prototype: document.prototype,
                    expectedRevision: baseline ? requiredDocumentRevision(baseline.path, baseline.revision) : null,
                  },
                ];
              }),
              ...(nodeIdentityOperations.length > 0 ? { nodeIdentityOperations } : {}),
            });
            if (!mountedRef.current) return;
            workspaceRef.current.markWorkspaceSaved(submitted, result);
            for (const documentId of result.writtenDocumentIds) savedDocumentIds.add(documentId);
            if (result.failure) {
              const pendingDocumentIds = new Set([...result.failure.pendingDocumentIds, ...nodeIdentityDocumentIds]);
              for (const documentId of pendingDocumentIds) retryRequiredDocumentIds.add(documentId);
              const directFailures = documentIds.has(result.failure.documentId) ? [result.failure.documentId] : [...pendingDocumentIds];
              recordFailure(directFailures.slice(0, 1), result.failure);
            }
          } catch (reason) {
            recordFailure([...documentIds], reason);
          }

          if (failureByDocumentId.size > 0) {
            const failures = [...failureByDocumentId.values()];
            const unsavedDocumentIds = [...documentIds].filter(
              (documentId) => !savedDocumentIds.has(documentId) || retryRequiredDocumentIds.has(documentId),
            );
            const unexecutedDocumentIds = unsavedDocumentIds.filter((documentId) => !failureByDocumentId.has(documentId));
            const result = {
              mode: saveMode,
              requestedCount: documentIds.size,
              savedDocumentIds: [...savedDocumentIds],
              failures,
              unexecutedDocumentIds,
            } satisfies WorkspaceSaveResultNotice;
            if (mountedRef.current) {
              setSaveResultNotice(result);
              setSaveProblems(uniqueDiagnostics(failures.flatMap((failure) => failure.diagnostics)));
              setNotice(
                savedDocumentIds.size > 0
                  ? `部分保存：${savedDocumentIds.size} 个成功，${failures.length} 个失败`
                  : unexecutedDocumentIds.length > 0
                    ? `保存未完成：${failures.length} 个失败，${unexecutedDocumentIds.length} 个未执行`
                    : failures[0]!.message,
              );
            }
            throw new WorkspaceSaveAttemptError(
              new Set(unsavedDocumentIds),
              failures.map((failure) => `${failure.documentId}：${failure.message}`).join("\n"),
            );
          }
          if (mountedRef.current) {
            setSaveProblems([]);
            const artifactsOnly = savedDocumentIds.size > 0 && [...savedDocumentIds].every((id) => id.startsWith("artifact:"));
            setNotice(
              savedDocumentIds.size === 0 && nodeIdentityOperations.length > 0
                ? "节点标识元数据已保存"
                : artifactsOnly
                  ? `已保存 ${savedDocumentIds.size} 个 Artifact`
                  : `已保存 ${savedDocumentIds.size} 个文档`,
            );
          }
        } catch (reason) {
          if (failureByDocumentId.size === 0 && mountedRef.current) setNotice(reason instanceof Error ? reason.message : String(reason));
          throw reason;
        }
      });
    },
    [runSourceWrite],
  );
  saveAttemptRef.current = saveDocumentsNow;

  const retrySaveResult = useCallback(async (): Promise<void> => {
    const result = saveResultNotice;
    if (!result || saveRetrying) return;
    const documentIds = new Set([...result.failures.map((failure) => failure.documentId), ...result.unexecutedDocumentIds]);
    const hasExternalModification = result.failures.some((failure) =>
      failure.diagnostics.some((diagnostic) => diagnostic.code === "save.externalModification"),
    );
    setSaveRetrying(true);
    try {
      if (hasExternalModification) await rebaseExternalChanges(documentIds);
      setSaveResultNotice(null);
      await saveCoordinator.flush(documentIds, result.mode);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setNotice(message);
      setSaveResultNotice({
        ...result,
        failures: result.failures.map((failure) =>
          failure.diagnostics.some((diagnostic) => diagnostic.code === "save.externalModification") ? { ...failure, message } : failure,
        ),
      });
    } finally {
      setSaveRetrying(false);
    }
  }, [rebaseExternalChanges, saveCoordinator, saveResultNotice, saveRetrying, setSaveResultNotice]);

  useEffect(() => {
    let active = true;
    void loadBootstrap()
      .then((bootstrap) => {
        if (!active) return;
        const { config, catalog } = bootstrap;
        setWorkspaceIdentity(config.workspace);
        document.title = `Legma - ${config.workspace.name}`;
        const loaded = workspaceDataFromBootstrap(bootstrap);
        const artifactMap = resolveArtifactDocuments(loaded.artifacts);
        const referenceMap = loaded.references;
        const prototypeMap = loaded.prototypes;
        const defaultArtifact =
          [...artifactMap.values()].find((entry) => entry.path === config.defaultArtifact) ?? artifactMap.values().next().value;
        const loadedCatalog = catalogFromDocuments(
          artifactMap,
          referenceMap,
          prototypeMap,
          catalog.directories ?? [],
          catalog.unavailable ?? [],
          catalog.problems ?? [],
        );
        const requested = parseWorkspaceLocation(window.location.search);
        const fallback: WorkspaceLocation = defaultArtifact
          ? { kind: "artifact", artifactKey: defaultArtifact.artifactKey }
          : { kind: "directory", path: "", view: "dependency", scale: DEFAULT_GRID_SCALE };
        const resolved = requested && locationExists(requested, loadedCatalog) ? requested : fallback;
        workspace.replaceWorkspace(loaded);
        setDirectories(catalog.directories ?? []);
        setUnavailable(catalog.unavailable ?? []);
        setWorkspaceProblems(catalog.problems ?? []);
        const initialArtifact = resolved.kind === "artifact" ? artifactMap.get(resolved.artifactKey) : undefined;
        initializeLocation(resolved, defaultArtifact, initialArtifact);
        if (requested && !locationExists(requested, loadedCatalog)) setNotice("找不到请求打开的 Legma 文档");
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    return () => {
      active = false;
    };
  }, [initializeLocation, workspace.replaceWorkspace]);

  useEffect(() => {
    if (!location || assetsRequested.current) return;
    assetsRequested.current = true;
    const load = (): void => {
      void loadAssets()
        .then(setAssets)
        .catch((reason: unknown) => setNotice(reason instanceof Error ? reason.message : String(reason)));
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(load, { timeout: 2_000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(load, 0);
    return () => window.clearTimeout(id);
  }, [location]);

  if (error)
    return (
      <main className={webClasses("fatal-state")}>
        <FileJson size={28} />
        <h1>无法打开 UI Source</h1>
        <pre>{error}</pre>
      </main>
    );
  if (!location)
    return (
      <main className={webClasses("loading-state")}>
        <div className={webClasses("loading-mark")} />
        <span>正在加载工作区</span>
      </main>
    );
  const reloadAssets = async (): Promise<void> => {
    setNotice("正在刷新资源");
    try {
      await refreshAssets();
      setAssets(await loadAssets());
      setNotice("资源已刷新");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const openVersionControl = async (action: UiWorkspaceVcsAction): Promise<void> => {
    if (dirty || vcsBusy !== null) {
      if (dirty) setNotice("请先保存工作区改动，再打开 TortoiseSVN");
      return;
    }
    setVcsBusy(action);
    setNotice(action === "commit" ? "正在打开 TortoiseSVN 提交" : "正在打开 TortoiseSVN 更新");
    try {
      await openWorkspaceVersionControl(action);
      setNotice(action === "commit" ? "已打开 TortoiseSVN 提交" : "已打开 TortoiseSVN 更新；完成后请刷新工作区");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setVcsBusy(null);
    }
  };
  const discardDocuments = (documentIds: ReadonlySet<string>): void => {
    workspace.discardDocuments(documentIds);
  };
  const discardWorkspaceDocument = (documentId: string): void => {
    if (saveStatus.phase === "saving") return;
    saveCoordinator.cancelScheduled();
    discardDocuments(new Set([documentId]));
    setNotice(`已放弃 ${documentId} 的未保存改动`);
  };
  const submitCreateDocument = async (): Promise<string | undefined> => {
    if (!documentCreate) return "当前没有待创建的文档";
    const draftIssue = explainDocumentCreateDraftIssue(documentCreate);
    if (draftIssue) return draftIssue;
    const key = documentCreate.key.trim();
    const path = normalizeWorkspacePath(documentCreate.sourcePath);
    const allPaths = new Set([
      ...[...workspace.documents.values()].map((document) => document.path),
      ...[...references.values()].map((document) => document.path),
      ...[...prototypes.values()].map((document) => document.path),
      ...unavailable.map((document) => document.path),
    ]);
    const allKeys = new Set([
      ...workspace.documents.keys(),
      ...references.keys(),
      ...prototypes.keys(),
      ...unavailable.map((document) => document.key),
    ]);
    try {
      if (allKeys.has(key)) throw new Error(`文档 Key“${key}”已存在`);
      if (allPaths.has(path)) throw new Error(`文档路径“${path}”已存在`);
      const sourceCatalog = createSourceCatalog(
        [...workspace.documents.values()].map((document) => ({ path: document.path, source: document.source })),
      );
      if (documentCreate.kind === "Reference") {
        const reference = createReference({ referenceKey: key, subjectArtifactKey: documentCreate.rootArtifactKey }, sourceCatalog);
        workspace.commitWorkspace((draft) => {
          draft.references.set(key, {
            referenceKey: key,
            subjectArtifactKey: reference.subjectArtifactKey,
            path,
            modifiedAt: Date.now(),
            reference,
          });
        });
        queueLocation({ kind: "reference", referenceKey: key });
      } else if (documentCreate.kind === "Prototype") {
        const referenceCatalog = createReferenceCatalog(
          [...references.values()].map((document) => ({ path: document.path, reference: document.reference })),
        );
        const prototype = createPrototype(key, documentCreate.startReferenceKey, referenceCatalog, sourceCatalog);
        workspace.commitWorkspace((draft) => {
          draft.prototypes.set(key, {
            prototypeKey: key,
            startReferenceKey: prototype.startReferenceKey,
            path,
            interactionCount: 0,
            modifiedAt: Date.now(),
            prototype,
          });
        });
        queueLocation({ kind: "prototype", prototypeKey: key });
      } else {
        const source = createArtifactSource({
          artifactKey: key,
          artifactType: documentCreate.kind,
          initialSize: [documentCreate.width, documentCreate.height],
        });
        const candidate = new Map(workspace.documents);
        candidate.set(key, { path, source, modifiedAt: Date.now() });
        validateWorkspaceDocuments(candidate, references, prototypes);
        workspace.commit((documents) => documents.set(key, { path, source, modifiedAt: Date.now() }));
        queueLocation({ kind: "artifact", artifactKey: key });
      }
      setDocumentCreate(null);
      setNotice(`已创建 ${key}`);
      return undefined;
    } catch (reason) {
      return reason instanceof Error ? reason.message : String(reason);
    }
  };

  const navigationContext = navigation.context;
  const editingContext = {
    dirtyDocuments,
    autoSaveEnabled,
    saveStatus,
    onAutoSaveEnabled: setAutoSaveEnabled,
    onAutoSaveDocuments: scheduleDocuments,
    onOpenChanges: () => setChangesOpen(true),
  } as const;
  const workspaceRoute = (content: ReactNode): ReactNode => (
    <WorkspaceProblemsProvider problems={allProblems}>
      <WorkspaceEditingProvider value={editingContext}>
        <WorkspaceNavigationContext.Provider value={navigationContext}>
          <WorkspaceDocumentCommandsProvider
            catalog={catalog}
            dirty={dirty}
            onCreate={(directory) => setDocumentCreate(createDocumentDraft(directory, "Canvas", catalog))}
            onNotice={setNotice}
          >
            {workspaceIdentity ? (
              <ApplicationMenu
                workspace={workspaceIdentity}
                recent={navigation.recent}
                dirty={dirty}
                vcsBusy={vcsBusy}
                collaborationProfile={collaborationProfile}
                collaboration={collaboration}
                onOpenChanges={() => setChangesOpen(true)}
                onImportPrefab={() => setPrefabImportOpen(true)}
                onOpenOverview={() => {
                  applyLocation({ kind: "overview" });
                }}
                onOpenRecent={(next) => {
                  applyLocation(next);
                }}
                onVersionControl={openVersionControl}
                onOpenProfile={() => setCollaborationProfileOpen(true)}
                onRefreshCollaboration={() => void refreshCollaboration()}
              />
            ) : null}
            {content}
            {changesOpen ? (
              <WorkspaceChangesDialog
                changes={changes}
                discardDisabled={saveStatus.phase === "saving"}
                onClose={() => setChangesOpen(false)}
                onDiscard={discardWorkspaceDocument}
                onSave={saveDocuments}
              />
            ) : null}
            {collaborationProfileOpen && collaborationProfile ? (
              <CollaborationProfileDialog
                profile={collaborationProfile}
                onClose={() => setCollaborationProfileOpen(false)}
                onSave={saveCollaborationProfile}
              />
            ) : null}
            {saveResultNotice ? (
              <WorkspaceSaveResultDialog
                result={saveResultNotice}
                onClose={() => setSaveResultNotice(null)}
                onRetry={() => void retrySaveResult()}
                retrying={saveRetrying}
                onOpenProblems={() => {
                  setSaveResultNotice(null);
                  diagnostics.openProblems();
                }}
              />
            ) : null}
            {prefabImportOpen ? (
              <Suspense fallback={null}>
                <PrefabImportDialog
                  catalog={catalog}
                  onClose={() => setPrefabImportOpen(false)}
                  onImported={(artifactKey) => window.location.assign(workspaceLocationSearch({ kind: "artifact", artifactKey }))}
                />
              </Suspense>
            ) : null}
            {documentCreate ? (
              <Suspense fallback={null}>
                <DocumentCreateDialog
                  draft={documentCreate}
                  catalog={catalog}
                  onDraft={setDocumentCreate}
                  onClose={() => setDocumentCreate(null)}
                  onSubmit={submitCreateDocument}
                />
              </Suspense>
            ) : null}
          </WorkspaceDocumentCommandsProvider>
        </WorkspaceNavigationContext.Provider>
      </WorkspaceEditingProvider>
    </WorkspaceProblemsProvider>
  );

  return workspaceRoute(
    <WorkspaceRoutes
      location={location}
      workspace={workspace}
      artifacts={artifacts}
      references={references}
      savedReferences={savedReferences}
      prototypes={prototypes}
      savedPrototypes={savedPrototypes}
      catalog={catalog}
      assets={assets}
      dirtyDocuments={dirtyDocuments}
      collaborationActivity={collaborationActivity}
      collaborationActivityRefreshing={collaborationActivityRefreshing}
      authoringMode={authoringMode}
      setAuthoringMode={setAuthoringMode}
      previewDisplayMode={previewDisplayMode}
      setPreviewDisplayMode={setPreviewDisplayMode}
      selectedId={selectedId}
      setSelectedId={setSelectedId}
      viewportIndex={viewportIndex}
      setViewportIndex={setViewportIndex}
      zoom={zoom}
      setZoom={setZoom}
      notice={notice}
      onNotice={setNotice}
      nodeClipboard={nodeClipboard}
      onCopyNode={setNodeClipboard}
      componentClipboard={componentClipboard}
      onCopyComponent={setComponentClipboard}
      onRefreshActivity={() => void refreshWorkspaceActivity()}
      onOpenArtifact={openArtifact}
      onOpenRelations={openRelations}
      onCloseRelations={closeRelations}
      onOpenDirectory={openDirectory}
      onOpenReference={openReference}
      onOpenPrototype={openPrototype}
      onDirectoryView={changeDirectoryView}
      onGalleryScale={changeGalleryScale}
      onReloadAssets={reloadAssets}
      onCreateDocument={() => setDocumentCreate(createDocumentDraft(location.kind === "directory" ? location.path : "", "Canvas", catalog))}
      onReferenceDraftChange={updateReferenceDraft}
      onPrototypeDraftChange={updatePrototypeDraft}
      onSave={saveDocuments}
      onRevertSource={revertSourceToSvnBase}
    />,
  );
}
