import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  BetweenHorizontalStart,
  BetweenVerticalStart,
  Box,
  Camera,
  ChevronDown,
  ClipboardPaste,
  Component,
  Copy,
  CopyPlus,
  FileDiff,
  FolderOpen,
  GitFork,
  Grid3X3,
  Image as ImageIcon,
  Import as ImportIcon,
  Layers3,
  LayoutGrid,
  Link2,
  LoaderCircle,
  Magnet,
  MoreHorizontal,
  MousePointer2,
  MousePointerClick,
  PackageOpen,
  PackagePlus,
  PanelBottomClose,
  PanelBottomOpen,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  Redo2,
  RefreshCw,
  Rocket,
  RotateCcw,
  Rows3,
  Scissors,
  Search,
  Square,
  Trash2,
  Type as TypeIcon,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { artifactInitialSize } from "../../../kernel/artifact-size.js";
import { availableAuthoringTemplates, canRestoreAuthoringScrollbars } from "../../../kernel/authoring-templates.js";
import { applyStateRootPreviewOverrides, stateRootPreviewPatches } from "../../../kernel/preview-values.js";
import { walkNodes } from "../../../kernel/tree.js";
import { unpackPrefabReason } from "../../../kernel/unpack-prefab.js";
import { validateSourceReadiness } from "../../../kernel/validation.js";
import type { UiArtifactSvnStatus } from "../../../schema/ui-api.js";
import type { UiConcreteSource, UiNode } from "../../../schema/ui-source-schema.js";
import type { ReferencePreviewSourceAuthoring } from "../../rendering/artifact-graph/artifact-graph-view.js";
import { useWebLayoutIntrinsic, waitForWebIntrinsicFont } from "../../rendering/intrinsic/intrinsic.js";
import { ReferencePreview } from "../../rendering/reference-preview/reference-preview.js";
import { type SelectionAddress, type SelectionUpdateMode, selectionAddressKey } from "../../rendering/selection.js";
import { loadArtifactSvnStatus } from "../../shared/api/client.js";
import { gameObjectName } from "../../shared/game-object-label.js";
import { LegmaMark } from "../../shared/legma-mark.js";
import { type ProjectDragItem, prefabRefProjectDragItem } from "../../shared/project-drag.js";
import { SelectControl } from "../../shared/select-control.js";
import { ThemeToggle } from "../../shared/theme.js";
import type { ArtifactDocument } from "../../shared/types.js";
import { createWebClasses } from "../../styles/web-styles.js";
import { SaveAutoSaveControl, workspaceSavePresentation } from "../../workspace/auto-save-toggle.js";
import { ProjectPanel } from "../../workspace/project/project-panel.js";
import { useWorkspaceEditing, workspaceDocumentId } from "../../workspace/workspace-editing-context.js";
import dialogStyles from "../shared/dialog.module.css";
import { EditorHierarchyTree } from "../shared/editor-hierarchy.js";
import sharedStyles from "../shared/editor-shell.module.css";
import { ReferenceEditor } from "../shared/reference-document-inspector.js";
import { WorkbenchSidebar } from "../shared/workbench-sidebar.js";
import { ArtifactContextMenu, type ArtifactContextMenuItem } from "./artifact-context-menu.js";
import { createNodeDraft, createNodeRenameDraft, type NodeCreateDraft } from "./artifact-editor-command-session.js";
import { updateWorkspaceNode, updateWorkspaceNodes } from "./artifact-editor-commands.js";
import { defaultPreviewDocument, subjectOnlyPreviewReference } from "./artifact-editor-context-preview.js";
import { type ArtifactEditorProps, useArtifactEditorController, useSiteOverrideSelectionAddress } from "./artifact-editor-controller.js";
import { useArtifactPanelResize } from "./artifact-editor-panel-resize.js";
import artifactStyles from "./artifact-editor-shell.module.css";
import { artifactNodeChangeKinds } from "./artifact-workspace-changes.js";
import { addPreferredBinderBinding, BinderBindingsInspector } from "./binder/binder-inspector.js";
import { type CanvasArrangementRequest, CanvasView } from "./canvas/artifact-canvas.js";
import canvasStyles from "./canvas/artifact-canvas.module.css";
import { ArtifactCanvasViewport, ArtifactCanvasZoomControls } from "./canvas/artifact-canvas-viewport.js";
import { CANVAS_VIEWPORT_PRESETS } from "./canvas/artifact-viewport.js";
import { rectTransformCapabilityMap } from "./canvas/rect-transform-authoring.js";
import type { SelectionArrangement } from "./canvas/selection-arrangement.js";
import { PanelResizeHandle } from "./chrome/panel-resize-handle.js";
import { SelectionLocation, selectionLocationPathLabels } from "./chrome/selection-location.js";
import { ArtifactEditorDialogs } from "./dialogs/artifact-editor-dialogs.js";
import { UnityPublishDialog } from "./dialogs/unity-publish-dialog.js";
import { UnityReconcileDialog } from "./dialogs/unity-reconcile-dialog.js";
import { artifactPreviewSelectionEntry, previewSelectionAddress, sourceSelectionAddress } from "./hierarchy/preview-hierarchy.js";
import { Inspector as SourceInspector } from "./inspector/artifact-inspector.js";
import inspectorStyles from "./inspector/artifact-inspector.module.css";
import { BatchInspector } from "./inspector/batch-inspector.js";
import { ComponentSection } from "./inspector/component-section.js";
import { ensureTextMinimumHeight } from "./inspector/text-size-authoring.js";
import { ArtifactRelations } from "./relations/artifact-relations.js";
import { StateRootPreviewGrid, stateRootPreviewRows } from "./state-root-preview-grid.js";
import { UseSiteOverridesDropdown } from "./use-site/use-site-overrides-dropdown.js";

const webClasses = createWebClasses(sharedStyles, dialogStyles, artifactStyles, canvasStyles, inspectorStyles);
const hierarchyReadinessCache = new WeakMap<UiConcreteSource, ReadonlyMap<string, readonly string[]>>();

function readinessErrors(source: UiConcreteSource): ReadonlyMap<string, readonly string[]> {
  const cached = hierarchyReadinessCache.get(source);
  if (cached) return cached;
  const errors = new Map<string, string[]>();
  for (const issue of validateSourceReadiness(source).issues) {
    if (!issue.nodeId) continue;
    const key = `${source.artifactKey}:${issue.nodeId}`;
    errors.set(key, [...(errors.get(key) ?? []), issue.message]);
  }
  hierarchyReadinessCache.set(source, errors);
  return errors;
}
const STATE_PREVIEW_COLUMN_OPTIONS = [2, 3, 4, 6] as const;
const HIDDEN_NODES_STORAGE_PREFIX = "ui-authoring:hidden-nodes:v1:";
const SHOW_PARENT_CANVAS_STORAGE_KEY = "ui-authoring:show-parent-canvas:v1";

function storedShowParentCanvas(): boolean {
  try {
    return window.localStorage.getItem(SHOW_PARENT_CANVAS_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function storedHiddenAddresses(artifactKey: string): Set<string> {
  try {
    const value = JSON.parse(window.localStorage.getItem(`${HIDDEN_NODES_STORAGE_PREFIX}${artifactKey}`) ?? "[]") as unknown;
    return new Set(Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);
  } catch {
    return new Set();
  }
}

function effectiveHiddenAddresses(
  source: UiConcreteSource,
  artifacts: ReadonlyMap<string, ArtifactDocument>,
  explicit: ReadonlySet<string>,
): ReadonlySet<string> {
  const result = new Set<string>();
  const visit = (
    node: UiNode,
    ownerArtifactKey: string,
    instancePath: readonly string[],
    ancestorHidden: boolean,
    active: ReadonlySet<string>,
  ): void => {
    const address: SelectionAddress = { rootArtifactKey: source.artifactKey, instancePath, ownerArtifactKey, nodeId: node.id };
    const key = selectionAddressKey(address);
    const hidden = ancestorHidden || explicit.has(key);
    if (hidden) result.add(key);
    for (const child of node.children ?? []) visit(child, ownerArtifactKey, instancePath, hidden, active);
    const referencedKey = node.components?.PrefabRef?.artifactKey;
    const referenced = referencedKey && !active.has(referencedKey) ? artifacts.get(referencedKey) : undefined;
    if (referenced)
      visit(referenced.resolvedSource.root, referencedKey!, [...instancePath, node.id], hidden, new Set([...active, referencedKey!]));
  };
  visit(source.root, source.artifactKey, [], false, new Set([source.artifactKey]));
  return result;
}

function formalSyncLabel(status: string | undefined, phase: "idle" | "checking" | "ready" | "error"): string {
  if (phase === "idle") return "未检查";
  if (phase === "checking") return "检查中";
  if (phase === "error") return "检查失败";
  return (
    (
      {
        matches: "无差异",
        differs: "有差异",
        missing: "Prefab 缺失",
      } as Record<string, string>
    )[status ?? ""] ?? "状态未知"
  );
}

export function ArtifactEditor(props: ArtifactEditorProps) {
  const controller = useArtifactEditorController(props);
  const editing = useWorkspaceEditing();
  const panelResize = useArtifactPanelResize();
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const createMenu = useRef<HTMLDivElement>(null);
  const [publishMenuOpen, setPublishMenuOpen] = useState(false);
  const publishMenu = useRef<HTMLDivElement>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenu = useRef<HTMLDivElement>(null);
  const [svnStatus, setSvnStatus] = useState<UiArtifactSvnStatus | null>(null);
  const [svnStatusError, setSvnStatusError] = useState("");
  const [svnStatusLoading, setSvnStatusLoading] = useState(true);
  const [svnRevertOpen, setSvnRevertOpen] = useState(false);
  const [svnRevertBusy, setSvnRevertBusy] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    readonly x: number;
    readonly y: number;
    readonly anchoredPosition?: readonly [number, number] | undefined;
  } | null>(null);
  const [addComponentRequest, setAddComponentRequest] = useState(0);
  const [arrangementRequest, setArrangementRequest] = useState<CanvasArrangementRequest>();
  const [statePreviewOpen, setStatePreviewOpen] = useState(false);
  const [statePreviewMaximumColumns, setStatePreviewMaximumColumns] = useState(4);
  const [showParentCanvas, setShowParentCanvas] = useState(storedShowParentCanvas);
  const workspacePanel = useRef<HTMLElement>(null);
  const {
    selection: {
      selected,
      selectedNodes,
      selectedAddresses,
      selection,
      hoveredSelection,
      setHoveredSelection,
      selectionVisible,
      selectionIsLocal,
      selectionIsPreviewGenerated,
      selectionIsPreviewDirect,
      selectionUseSiteRootArtifactKey,
      selectionOwner,
      selectionNode,
      selectionPreviewSource,
      selectAddress,
      selectAddresses,
    },
    previewHierarchy,
    preview,
    canvas: {
      viewportIndex,
      onViewport,
      zoom,
      onZoom,
      viewport,
      safeArea,
      zoomPolicy,
      isCanvas,
      rectCapabilities,
      viewportController,
      stateOverrides,
      setStateOverrides,
      applyAssetDrop,
    },
    dialogs,
    inspector: {
      componentClipboard,
      selectedUseSiteNode,
      useSiteOverrideCandidates,
      binderBindings,
      binderBindingCandidates,
      binderLocalWidgetType,
      binderEffectiveWidgetType,
      binderCanAdd,
      binderWidgetTypeError,
      bindingTargets,
      externalBindingTargets,
      copyComponent,
      pasteSelectedComponent,
      updateSelected,
      updateArtifactSize,
      updateArtifactMetadata,
      updateSelectedUseSiteNode,
      updateSelectedMany,
      useSiteBatchSource,
      useSiteBatchNodes,
      updateUseSiteSelectedMany,
      continuousEdit,
      inspectorOverrideState,
      resetSelectedOverride,
      resetSelectedRectOverrides,
      applySelectedUseSiteModifications,
      revertSelectedUseSiteModifications,
      updateUseSiteSelected,
      updatePreviewExternalSelected,
      resetUseSiteSelectedField,
      resetUseSiteSelectedRectFields,
      useSiteFieldState,
      useSiteComponentState,
      addBinding,
      renameBinding,
      removeBinding,
      retargetBinding,
      resetBindingTarget,
      reorderBinding,
      setBinderWidgetType,
    },
    commands: {
      artifact,
      workspace,
      artifacts,
      catalog,
      assets,
      onRefreshAssets,
      onOpenDirectory,
      onOpenReference,
      onOpenPrototype,
      onSave,
      nodeClipboard,
      copySelectedSummary,
      copyIdentity,
      publishPrefab,
      pullUnityChanges,
      unityBusy,
      unityReconcileJob,
      unityPublishJob,
      unityPublishOptions,
      setUnityPublishOption,
      unitySyncState,
      unitySyncPhase,
      unitySyncError,
      refreshFormalSync,
      closeUnityReconcile,
      closeUnityPublish,
      applyUnityPublishScaffold,
      applyUnityReconcile,
      retryUnityReconcile,
      retryUnityPublish,
      openArtifact,
      copySelectedNode,
      cutSelectedNode,
      pasteClipboardNode,
      duplicateSelectedNodes,
      previewNodeDisplayName,
      renameNodeDisplayName,
      createCanvasNode,
      createProjectItem,
      createTemplateNode,
      restoreSelectedScrollbars,
      unpackSelectedPrefab,
      moveNodeInHierarchy,
      canExtractWidget,
      canExtractFragment,
      openExtractWidget,
      openExtractFragment,
      openCreateVariant,
    },
    view: {
      source,
      nodeCount,
      notice,
      onNotice,
      displayMode,
      onDisplayMode,
      treeCollapsed,
      setTreeCollapsed,
      inspectorCollapsed,
      setInspectorCollapsed,
      sidebarLayout,
      selectSidebarView,
      focusSidebarView,
      setSidebarSplit,
      bottomProjectOpen,
      setBottomProjectOpen,
      gridVisible,
      setGridVisible,
      snapEnabled,
      setSnapEnabled,
      hierarchyQuery,
      setHierarchyQuery,
      canvasTool,
      setCanvasTool,
    },
  } = controller;
  const [hierarchyRevealRequest, setHierarchyRevealRequest] = useState(0);
  const variantBaseArtifact =
    artifact.source.sourceKind === "variant" && selected.id === source.root.id ? artifacts.get(artifact.source.variantOf) : undefined;
  const variantBaseInitialSize =
    variantBaseArtifact && variantBaseArtifact.resolvedSource.artifactType !== "Canvas"
      ? variantBaseArtifact.resolvedSource.initialSize
      : undefined;
  const selectInspectorNode = (address: SelectionAddress): void => {
    selectAddress(address);
    setHierarchyRevealRequest((current) => current + 1);
  };
  const fitCanvas = viewportController.fit;
  const [hiddenState, setHiddenState] = useState<{ readonly artifactKey: string; readonly addresses: ReadonlySet<string> }>(() => ({
    artifactKey: source.artifactKey,
    addresses: storedHiddenAddresses(source.artifactKey),
  }));
  const explicitHiddenAddresses =
    hiddenState.artifactKey === source.artifactKey ? hiddenState.addresses : storedHiddenAddresses(source.artifactKey);
  useEffect(
    () => setHiddenState({ artifactKey: source.artifactKey, addresses: storedHiddenAddresses(source.artifactKey) }),
    [source.artifactKey],
  );
  useEffect(() => {
    if (hiddenState.artifactKey !== source.artifactKey) return;
    try {
      window.localStorage.setItem(`${HIDDEN_NODES_STORAGE_PREFIX}${source.artifactKey}`, JSON.stringify([...explicitHiddenAddresses]));
    } catch {
      // Editor visibility remains available for the current session when storage is blocked.
    }
  }, [explicitHiddenAddresses, hiddenState.artifactKey, source.artifactKey]);
  useEffect(() => {
    try {
      window.localStorage.setItem(SHOW_PARENT_CANVAS_STORAGE_KEY, String(showParentCanvas));
    } catch {
      // Parent context visibility remains available for the current session when storage is blocked.
    }
  }, [showParentCanvas]);
  const hiddenAddresses = useMemo(
    () => effectiveHiddenAddresses(previewHierarchy.source, previewHierarchy.artifacts, explicitHiddenAddresses),
    [previewHierarchy, explicitHiddenAddresses],
  );
  const textIntrinsic = useWebLayoutIntrinsic(source);
  const toggleHiddenAddress = (address: SelectionAddress): void =>
    setHiddenState((current) => {
      const key = selectionAddressKey(address);
      const next = new Set(current.artifactKey === source.artifactKey ? current.addresses : storedHiddenAddresses(source.artifactKey));
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { artifactKey: source.artifactKey, addresses: next };
    });
  useEffect(() => {
    const root = workspacePanel.current;
    if (!root) return;
    const hiddenClass = webClasses("is-authoring-hidden");
    const elements = [...root.querySelectorAll<HTMLElement>("[data-selection-address]")];
    for (const element of elements) element.classList.toggle(hiddenClass, hiddenAddresses.has(element.dataset.selectionAddress ?? ""));
    return () => {
      for (const element of elements) element.classList.remove(hiddenClass);
    };
  }, [hiddenAddresses, source]);
  const {
    setCaptureOpen,
    setDeleteArtifactOpen,
    setNodeCreateDraft,
    prefabRefArtifacts,
    setRenameDraft,
    setDeleteNodeIds,
    showBlockingMessage,
  } = dialogs;
  const showBlockedOperation = useCallback(
    (message: string): void => {
      console.warn(`[Legma][Blocked] ${message}`);
      showBlockingMessage(message);
    },
    [showBlockingMessage],
  );
  const defaultPreview = useMemo(() => defaultPreviewDocument(props.references, artifact), [props.references, artifact]);
  const documentIds = new Set([
    workspaceDocumentId("artifact", source.artifactKey),
    ...(defaultPreview ? [workspaceDocumentId("reference", defaultPreview.referenceKey)] : []),
  ]);
  const savedArtifact = workspace.savedDocuments.get(source.artifactKey);
  const sourceDirty = editing.dirtyDocuments.has(workspaceDocumentId("artifact", source.artifactKey));
  const documentDirty = [...documentIds].some((documentId) => editing.dirtyDocuments.has(documentId));
  const hasSavableChanges = documentDirty;
  const savePresentation = workspaceSavePresentation(editing, documentIds, documentDirty, notice);
  useEffect(() => {
    let active = true;
    setSvnStatus(null);
    setSvnStatusError("");
    setSvnStatusLoading(true);
    void loadArtifactSvnStatus(artifact.path)
      .then((status) => {
        if (active) setSvnStatus(status);
      })
      .catch((reason: unknown) => {
        if (active) setSvnStatusError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setSvnStatusLoading(false);
      });
    return () => {
      active = false;
    };
  }, [artifact.path, savedArtifact?.modifiedAt]);
  const svnResetAvailable = svnStatus?.state !== "unsupported" && (sourceDirty || svnStatus?.canRevert === true);
  const svnRevertDisabled =
    svnRevertBusy ||
    svnStatusLoading ||
    editing.saveStatus.phase === "saving" ||
    workspace.transientActive ||
    Boolean(svnStatusError) ||
    !savedArtifact ||
    !svnResetAvailable;
  const svnRevertTitle =
    editing.saveStatus.phase === "saving" || workspace.transientActive
      ? "Source 正在写入，暂时不能还原 SVN 修改"
      : svnStatusLoading
        ? "正在读取当前 Source 的 SVN 状态"
        : svnStatusError ||
          (svnStatus?.state === "unsupported" ? svnStatus.message : "") ||
          (sourceDirty ? "还原当前 Source，并丢弃它的未保存修改" : svnStatus?.message) ||
          "当前 Source 的 SVN 状态不可用";
  const svnRevertMessage = sourceDirty
    ? svnStatus?.canRevert
      ? "当前 Source 的未保存改动和 SVN 本地改动将被丢弃，并还原到本地 SVN BASE。其他文档的未保存改动不受影响，编辑器撤销记录不能恢复这次操作。"
      : "当前 Source 的未保存改动将被丢弃，并恢复到本地 SVN BASE。其他文档的未保存改动不受影响，编辑器撤销记录不能恢复这次操作。"
    : "当前 Source 将还原到本地 SVN BASE，编辑器撤销记录不能恢复这次操作。";
  const revertSource = async (): Promise<void> => {
    if (!savedArtifact || !savedArtifact.revision || svnRevertDisabled) return;
    setSvnRevertBusy(true);
    try {
      await props.onRevertSource(source.artifactKey, savedArtifact.path, savedArtifact.revision);
      setSvnStatus({ path: savedArtifact.path, state: "clean", canRevert: false, message: "当前 Source 没有 SVN 本地修改" });
      setSvnRevertOpen(false);
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSvnRevertBusy(false);
    }
  };
  const statePreviewContexts = defaultPreview?.reference.statePreviewContexts;
  const statePreviewRows = useMemo(() => stateRootPreviewRows(source, statePreviewContexts), [source, statePreviewContexts]);
  const previewSource = source;
  const localStatePreviewBase = displayMode === "preview" ? (previewHierarchy.subjectInstance?.effectiveLayoutSource ?? source) : source;
  const localStatePreviewSource = useMemo(
    () => applyStateRootPreviewOverrides(localStatePreviewBase, stateOverrides),
    [localStatePreviewBase, stateOverrides],
  );
  const externalStatePreviewSource = useMemo(
    () =>
      selectionPreviewSource
        ? applyStateRootPreviewOverrides(selectionPreviewSource, {})
        : selectionOwner
          ? applyStateRootPreviewOverrides(selectionOwner, {})
          : undefined,
    [selectionOwner, selectionPreviewSource],
  );
  const subjectStatePreviewPatches = useMemo(() => stateRootPreviewPatches(source, stateOverrides), [source, stateOverrides]);
  const showStatePreview =
    statePreviewOpen && source.artifactType !== "Fragment" && displayMode !== "editPreview" && statePreviewRows.length > 0;
  const showPreviewOverview = showStatePreview;
  const showReferencePreview = source.artifactType !== "Fragment" && displayMode !== "unityBaseline" && !showPreviewOverview;
  const previewReference = useMemo(
    () => defaultPreview?.reference ?? { referenceKey: source.artifactKey, subjectArtifactKey: source.artifactKey },
    [defaultPreview, source.artifactKey],
  );
  const parentCanvasAvailable = source.artifactType === "Widget" && previewReference.context?.parentArtifactKey !== undefined;
  const displayedPreviewReference = useMemo(
    () => (parentCanvasAvailable && !showParentCanvas ? subjectOnlyPreviewReference(previewReference) : previewReference),
    [parentCanvasAvailable, previewReference, showParentCanvas],
  );
  const contextViewport = useMemo((): readonly [number, number] => {
    if (!showReferencePreview || source.artifactType === "Canvas") return viewport;
    if (parentCanvasAvailable && !showParentCanvas) return artifactInitialSize(source);
    const root = artifacts.get(
      displayedPreviewReference.context?.parentArtifactKey ?? displayedPreviewReference.subjectArtifactKey,
    )?.resolvedSource;
    return displayedPreviewReference.viewport ?? (root ? artifactInitialSize(root) : viewport);
  }, [artifacts, displayedPreviewReference, parentCanvasAvailable, showParentCanvas, showReferencePreview, source, viewport]);
  const resolvedSelection = displayMode === "preview" ? previewSelectionAddress(previewHierarchy, selection) : selection;
  const resolvedHover =
    displayMode === "preview" && hoveredSelection ? previewSelectionAddress(previewHierarchy, hoveredSelection) : hoveredSelection;
  const resolvedSelectionEntry = artifactPreviewSelectionEntry(previewHierarchy, resolvedSelection);
  const previewValueLabels = [
    ...new Set((resolvedSelectionEntry?.valueProvenance ?? []).map((entry) => `${entry.bindingField}.${entry.capability}`)),
  ];
  const previewGeneratedKind = resolvedSelectionEntry?.generated ? resolvedSelectionEntry.instance.placement.kind : undefined;
  const previewGeneratedReason =
    previewGeneratedKind === "collection"
      ? "Reference 集合实例是只读场景数据；请打开对应 Widget Source，或切换到“编辑预览”修改集合。"
      : previewGeneratedKind === "mount"
        ? "Reference 挂载实例是只读场景数据；请打开对应 Widget Source，或切换到“编辑预览”修改挂载。"
        : "Reference 生成的实例不能修改 Artifact Source。";
  const selectionUseSiteRootIsVariant = selectionUseSiteRootArtifactKey
    ? workspace.documents.get(selectionUseSiteRootArtifactKey)?.source.sourceKind === "variant"
    : artifact.source.sourceKind === "variant";
  const selectReferenceAddress = (address: SelectionAddress, mode: SelectionUpdateMode = "replace"): void =>
    selectAddress(sourceSelectionAddress(previewHierarchy, address), mode);
  const selectReferenceAddresses = (addresses: readonly SelectionAddress[], mode: SelectionUpdateMode = "replace"): void =>
    selectAddresses(
      addresses.map((address) => sourceSelectionAddress(previewHierarchy, address)),
      mode,
    );
  const hoverReferenceAddress = (address: SelectionAddress | undefined): void =>
    setHoveredSelection(address ? sourceSelectionAddress(previewHierarchy, address) : undefined);
  const nodeChanges = useMemo(
    () => artifactNodeChangeKinds(workspace.savedDocuments, workspace.documents, source.artifactKey),
    [workspace.savedDocuments, workspace.documents, source.artifactKey],
  );
  const hierarchyErrors = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const entry of artifacts.values()) {
      const artifactSource = entry.artifactKey === source.artifactKey ? source : entry.resolvedSource;
      for (const [key, messages] of readinessErrors(artifactSource)) result.set(key, [...messages]);
    }
    return result;
  }, [artifacts, source]);
  const multipleSelected = selectedNodes.length > 1;
  const useSiteBatchRectCapabilities = useMemo(
    () => (useSiteBatchSource ? rectTransformCapabilityMap(useSiteBatchSource) : new Map()),
    [useSiteBatchSource],
  );
  const selectedEntry = walkNodes(source).find((entry) => entry.node.id === selected.id);
  const selectedInLocalVisualSubtree = Boolean(
    selectedEntry?.path
      .slice(0, -1)
      .some((ancestorId) => walkNodes(source).find((entry) => entry.node.id === ancestorId)?.node.components?.PrefabRef),
  );
  const canArrangeHorizontal = multipleSelected && selectedNodes.every((node) => rectCapabilities.get(node.id)?.position[0] === undefined);
  const canArrangeVertical = multipleSelected && selectedNodes.every((node) => rectCapabilities.get(node.id)?.position[1] === undefined);
  const requestArrangement = (arrangement: SelectionArrangement): void =>
    setArrangementRequest((current) => ({ id: (current?.id ?? 0) + 1, arrangement }));
  const structuralDisabled =
    displayMode === "editPreview" || artifact.source.sourceKind === "variant" || !selectionIsLocal || multipleSelected;
  const structuralDisabledReason =
    displayMode === "editPreview"
      ? "编辑预览只修改 Reference 数据"
      : artifact.source.sourceKind === "variant"
        ? "Variant 不支持结构修改"
        : !selectionIsLocal
          ? "继承节点不能修改结构"
          : multipleSelected
            ? "多选时不能创建子节点"
            : undefined;
  const boundBindingTargets = new Set(
    binderBindings.map((binding) =>
      JSON.stringify([binding.target.instancePath ?? [], binding.target.nodeId, binding.target.componentType]),
    ),
  );
  const selectedBindingCandidates = binderBindingCandidates.filter(
    (candidate) =>
      !boundBindingTargets.has(candidate.key) &&
      candidate.target.nodeId === selection.nodeId &&
      (candidate.target.instancePath ?? []).join("\0") === selection.instancePath.join("\0"),
  );
  const bindingTargetDisabledReason =
    source.artifactType === "Fragment"
      ? "Fragment 没有 Binder"
      : !binderCanAdd
        ? "继承 Widget identity 的 Variant 不能新增 Binding"
        : multipleSelected
          ? "一次只能为一个节点添加 Binding"
          : selectedBindingCandidates.length === 0
            ? "当前节点没有可加入此 Binder 的组件"
            : undefined;
  const inheritedCommandReason = !selectionIsLocal ? "继承节点不能重命名、移动或删除" : undefined;
  const structureCommandReason = artifact.source.sourceKind === "variant" ? "Variant 不支持结构修改" : inheritedCommandReason;
  const rootCommandReason = selected.id === source.root.id ? "Artifact 根节点不能执行该操作" : undefined;
  const selectedPrefabTarget = selected.components?.PrefabRef
    ? artifacts.get(selected.components.PrefabRef.artifactKey)?.resolvedSource
    : undefined;
  const availableTemplates = availableAuthoringTemplates(source, (artifactKey) => artifacts.get(artifactKey)?.resolvedSource);
  const unpackReason =
    artifact.source.sourceKind === "variant"
      ? "Variant 不能解包 PrefabRef"
      : !selectionIsLocal
        ? "只能解包本地 PrefabRef"
        : multipleSelected
          ? "请选择一个要解包的 PrefabRef"
          : unpackPrefabReason(selected, selectedPrefabTarget);
  const templateDisabledReason =
    structuralDisabledReason ??
    (selected.components?.PrefabRef || selectedInLocalVisualSubtree ? "PrefabRef 本地视觉范围不能创建该模板" : undefined);
  const canRestoreScrollbars = !structuralDisabled && canRestoreAuthoringScrollbars(selected);
  const dropProjectItem = async (
    address: SelectionAddress,
    item: ProjectDragItem,
    anchoredPosition?: readonly [number, number],
  ): Promise<void> => {
    if (address.ownerArtifactKey !== source.artifactKey || address.instancePath.length > 0) {
      props.onNotice("不能把 Project 内容拖入继承层级");
      return;
    }
    const targetEntry = walkNodes(source).find((entry) => entry.node.id === address.nodeId);
    if (!targetEntry) return;
    if (item.kind === "asset" && item.assetKind === "font") {
      if (!targetEntry.node.components?.Text) {
        props.onNotice("字体只能拖到 TMP Text 节点");
        return;
      }
      props.onNotice("正在读取字体尺寸");
      try {
        await waitForWebIntrinsicFont(item.path);
      } catch (reason) {
        props.onNotice(reason instanceof Error ? reason.message : String(reason));
        return;
      }
      updateWorkspaceNode(workspace, artifact.artifactKey, address.nodeId, (node) => {
        if (!node.components?.Text) return node;
        const updated = { ...node, components: { ...node.components, Text: { ...node.components.Text, font: item.path } } };
        return ensureTextMinimumHeight(
          updated,
          Math.max(0, updated.rect.sizeDelta[0]),
          textIntrinsic.provider,
          rectCapabilities.get(node.id),
        );
      });
      props.onNotice(`已更新 ${gameObjectName(targetEntry.node)} 的字体`);
      return;
    }
    const prefabRefItem = prefabRefProjectDragItem(item, (artifactKey) => artifacts.get(artifactKey)?.artifactType);
    if (prefabRefItem) {
      const prefabAncestor = targetEntry.path.some(
        (nodeId) => walkNodes(source).find((entry) => entry.node.id === nodeId)?.node.components?.PrefabRef,
      );
      if (prefabAncestor) {
        props.onNotice("PrefabRef 本地视觉范围不能再嵌套 PrefabRef");
        return;
      }
    }
    void createProjectItem(address.nodeId, prefabRefItem ?? item, anchoredPosition);
  };
  const renderCanvasView = (
    canvasSource: UiConcreteSource,
    canvasViewport: readonly [number, number],
    interactionOverlay = false,
    canvasPreviewSource?: UiConcreteSource,
  ) => (
    <CanvasView
      source={canvasSource}
      previewSource={canvasPreviewSource}
      stateOverrides={stateOverrides}
      selectedId={selectionIsLocal ? selected.id : ""}
      selectedIds={selectedNodes.map((node) => node.id)}
      selectedAddresses={selectedAddresses}
      selectedAddress={selection}
      hoveredAddress={hoveredSelection}
      viewport={canvasViewport}
      safeArea={canvasViewport[0] === viewport[0] && canvasViewport[1] === viewport[1] ? safeArea : undefined}
      zoom={interactionOverlay ? 1 : zoom}
      gridVisible={gridVisible}
      snapEnabled={snapEnabled}
      artifacts={artifacts}
      showDebug={false}
      capabilities={rectCapabilities}
      tool={canvasTool}
      onToolChange={setCanvasTool}
      onSelect={interactionOverlay ? selectReferenceAddress : selectAddress}
      onSelectMany={interactionOverlay ? selectReferenceAddresses : selectAddresses}
      onHover={interactionOverlay ? hoverReferenceAddress : setHoveredSelection}
      onTransformStart={workspace.beginTransient}
      onTransform={(updates, initialSize) => {
        if (updates.length === 1) {
          const update = updates[0]!;
          updateWorkspaceNode(workspace, artifact.artifactKey, update.id, () => update.node, true, initialSize);
          return;
        }
        const byId = new Map(updates.map((update) => [update.id, update.node]));
        updateWorkspaceNodes(
          workspace,
          artifact.artifactKey,
          updates.map((update) => update.id),
          (node) => byId.get(node.id) ?? node,
          true,
        );
      }}
      onTransformEnd={workspace.endTransient}
      onTransformCancel={workspace.cancelTransient}
      arrangementRequest={arrangementRequest}
      onArrange={(updates) => {
        const byId = new Map(updates.map((update) => [update.id, update.node]));
        updateWorkspaceNodes(
          workspace,
          artifact.artifactKey,
          updates.map((update) => update.id),
          (node) => byId.get(node.id) ?? node,
        );
      }}
      onCreateNode={createCanvasNode}
      onTextCommit={(nodeId, text) =>
        updateWorkspaceNode(workspace, artifact.artifactKey, nodeId, (node) => {
          const current = node.components?.Text;
          if (!current || current.text === text) return node;
          const updated = { ...node, components: { ...node.components, Text: { ...current, text } } };
          return ensureTextMinimumHeight(
            updated,
            Math.max(0, updated.rect.sizeDelta[0]),
            textIntrinsic.provider,
            rectCapabilities.get(nodeId),
          );
        })
      }
      onAssetDrop={(request) => void applyAssetDrop(request)}
      onProjectDrop={dropProjectItem}
      onContextMenu={(_nodeId, x, y, anchoredPosition) => setContextMenu({ x, y, anchoredPosition })}
      interactionOverlay={interactionOverlay}
    />
  );
  const previewSourceAuthoring: ReferencePreviewSourceAuthoring | undefined =
    displayMode === "preview" && previewHierarchy.subjectInstance
      ? {
          artifactKey: source.artifactKey,
          instancePath: previewHierarchy.subjectInstance.instancePath,
          renderSurface: (effectiveSource, surfaceViewport) => renderCanvasView(source, surfaceViewport, true, effectiveSource),
        }
      : undefined;
  const openNodeCreate = (kind: NodeCreateDraft["kind"]): void => {
    setCreateMenuOpen(false);
    setNodeCreateDraft(createNodeDraft(source, kind, "", contextMenu?.anchoredPosition));
  };
  const templateIcon = (category: "Control" | "Layout", size: number) =>
    category === "Control" ? <MousePointerClick size={size} /> : <Rows3 size={size} />;
  const createFromTemplate = (templateId: string, anchoredPosition?: readonly [number, number]): void => {
    setCreateMenuOpen(false);
    createTemplateNode(templateId, anchoredPosition);
  };
  useEffect(() => {
    if (!createMenuOpen) return;
    const close = (event: PointerEvent): void => {
      if (!createMenu.current?.contains(event.target as Node)) setCreateMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [createMenuOpen]);
  useEffect(() => {
    if (!publishMenuOpen) return;
    const close = (event: PointerEvent): void => {
      if (!publishMenu.current?.contains(event.target as Node)) setPublishMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setPublishMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [publishMenuOpen]);
  useEffect(() => {
    if (!moreMenuOpen) return;
    const close = (event: PointerEvent): void => {
      if (!moreMenu.current?.contains(event.target as Node)) setMoreMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setMoreMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [moreMenuOpen]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest("input, textarea, [contenteditable='true'], [contenteditable='']") ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        !event.shiftKey
      )
        return;
      if (event.key === "1") {
        fitCanvas();
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fitCanvas]);
  const contextItems: readonly ArtifactContextMenuItem[] = [
    {
      key: "create-empty",
      label: "新建空节点",
      icon: <Plus size={14} />,
      disabled: structuralDisabled,
      disabledReason: structuralDisabledReason,
      onSelect: () => openNodeCreate("Node"),
    },
    {
      key: "create-image",
      label: "新建自定义图片...",
      icon: <ImageIcon size={14} />,
      disabled: structuralDisabled,
      disabledReason: structuralDisabledReason,
      onSelect: () => openNodeCreate("Image"),
    },
    {
      key: "create-text",
      label: "新建自定义 TMP 文字...",
      icon: <TypeIcon size={14} />,
      disabled: structuralDisabled,
      disabledReason: structuralDisabledReason,
      onSelect: () => openNodeCreate("Text"),
    },
    {
      key: "create-prefab",
      label: "新建 PrefabRef",
      icon: <Box size={14} />,
      disabled:
        structuralDisabled || Boolean(selected.components?.PrefabRef) || selectedInLocalVisualSubtree || prefabRefArtifacts.length === 0,
      disabledReason:
        structuralDisabledReason ??
        (selected.components?.PrefabRef || selectedInLocalVisualSubtree
          ? "PrefabRef 本地视觉子树不能再嵌套 PrefabRef"
          : prefabRefArtifacts.length === 0
            ? "没有兼容的 Artifact"
            : undefined),
      onSelect: () => openNodeCreate("PrefabRef"),
    },
    {
      key: "create-template",
      label: "从模板新建",
      icon: <Rows3 size={14} />,
      dividerBefore: true,
      disabled: Boolean(templateDisabledReason),
      disabledReason: templateDisabledReason,
      children: availableTemplates.map(
        (template): ArtifactContextMenuItem => ({
          key: `template-${template.id}`,
          label: template.label,
          icon: templateIcon(template.category, 14),
          onSelect: () => createFromTemplate(template.id, contextMenu?.anchoredPosition),
        }),
      ),
    },
    ...(canRestoreScrollbars
      ? [
          {
            key: "restore-scrollbars",
            label: "恢复默认滚动条",
            icon: <RotateCcw size={14} />,
            dividerBefore: true,
            onSelect: () => {
              restoreSelectedScrollbars();
            },
          } satisfies ArtifactContextMenuItem,
        ]
      : []),
    {
      key: "add-component",
      label: "添加组件...",
      icon: <Component size={14} />,
      dividerBefore: true,
      disabled: displayMode === "editPreview" || artifact.source.sourceKind === "variant",
      disabledReason:
        displayMode === "editPreview"
          ? "编辑预览只修改 Reference 数据"
          : artifact.source.sourceKind === "variant"
            ? "Variant 只能新增 Binder 引用或修改白名单字段"
            : undefined,
      onSelect: () => setAddComponentRequest((value) => value + 1),
    },
    {
      key: "add-binding",
      label: "添加到 Binder",
      icon: <Link2 size={14} />,
      disabled: Boolean(bindingTargetDisabledReason),
      disabledReason: bindingTargetDisabledReason,
      onSelect: () => {
        if (!addPreferredBinderBinding(selectedBindingCandidates, binderBindings, selection, addBinding))
          props.onNotice("当前节点没有可加入此 Binder 的组件");
      },
    },
    ...(selected.components?.PrefabRef
      ? [
          {
            key: "unpack-prefab",
            label: "解包 Prefab",
            icon: <PackageOpen size={14} />,
            disabled: Boolean(unpackReason),
            disabledReason: unpackReason,
            onSelect: () => {
              unpackSelectedPrefab();
            },
          } satisfies ArtifactContextMenuItem,
        ]
      : []),
    {
      key: "copy",
      label: "复制",
      icon: <Copy size={14} />,
      dividerBefore: true,
      onSelect: () => {
        copySelectedNode();
      },
    },
    {
      key: "cut",
      label: "剪切",
      icon: <Scissors size={14} />,
      disabled: artifact.source.sourceKind === "variant" || !selectionIsLocal || selected.id === source.root.id,
      disabledReason: structureCommandReason ?? rootCommandReason,
      onSelect: () => {
        cutSelectedNode();
      },
    },
    {
      key: "paste",
      label: "粘贴为子节点",
      icon: <ClipboardPaste size={14} />,
      disabled: !nodeClipboard || structuralDisabled,
      disabledReason: structuralDisabledReason ?? (!nodeClipboard ? "节点剪贴板为空" : undefined),
      onSelect: () => {
        pasteClipboardNode();
      },
    },
    {
      key: "duplicate",
      label: "创建副本",
      icon: <CopyPlus size={14} />,
      disabled: artifact.source.sourceKind === "variant" || !selectionIsLocal || selected.id === source.root.id,
      disabledReason: structureCommandReason ?? rootCommandReason,
      onSelect: () => {
        duplicateSelectedNodes();
      },
    },
    {
      key: "rename",
      label: "重命名",
      icon: <Pencil size={14} />,
      dividerBefore: true,
      disabled: artifact.source.sourceKind === "variant" || !selectionIsLocal || multipleSelected || selected.id === source.root.id,
      disabledReason: structureCommandReason ?? rootCommandReason ?? (multipleSelected ? "多选时不能重命名" : undefined),
      onSelect: () => setRenameDraft(createNodeRenameDraft(selected)),
    },
    {
      key: "delete",
      label: "删除",
      icon: <Trash2 size={14} />,
      danger: true,
      disabled: artifact.source.sourceKind === "variant" || !selectionIsLocal || selected.id === source.root.id,
      disabledReason: structureCommandReason ?? rootCommandReason,
      onSelect: () => setDeleteNodeIds(selectedNodes.map((node) => node.id)),
    },
  ];
  const binderBindingsSection =
    source.artifactType !== "Fragment" && selectionIsLocal && selected.id === source.root.id ? (
      <BinderBindingsInspector
        bindings={binderBindings}
        candidates={binderBindingCandidates}
        artifactType={source.artifactType}
        localWidgetType={binderLocalWidgetType}
        effectiveWidgetType={binderEffectiveWidgetType}
        widgetTypeError={binderWidgetTypeError}
        canAdd={binderCanAdd}
        onWidgetType={setBinderWidgetType}
        onAdd={addBinding}
        onRename={renameBinding}
        onRemove={removeBinding}
        onRetarget={retargetBinding}
        onResetTarget={resetBindingTarget}
        onReorder={reorderBinding}
        onDropDenied={props.onNotice}
        onSelectTarget={(target) =>
          selectAddress({
            rootArtifactKey: source.artifactKey,
            instancePath: target.target.instancePath ?? [],
            ownerArtifactKey: target.targetOwnerArtifactKey,
            nodeId: target.target.nodeId,
          })
        }
        onHoverTarget={(target) =>
          setHoveredSelection(
            target
              ? {
                  rootArtifactKey: source.artifactKey,
                  instancePath: target.target.instancePath ?? [],
                  ownerArtifactKey: target.targetOwnerArtifactKey,
                  nodeId: target.target.nodeId,
                }
              : undefined,
          )
        }
      />
    ) : null;
  const selectionIsReferencedRoot =
    !selectionIsPreviewGenerated &&
    !selectionIsLocal &&
    artifacts.get(selection.ownerArtifactKey)?.resolvedSource.root.id === selection.nodeId;
  const prefabRefCompanionSection =
    selectionIsReferencedRoot && selectedUseSiteNode?.components?.PrefabRef ? (
      <ComponentSection
        type="PrefabRef"
        source={source}
        node={selectedUseSiteNode}
        catalog={catalog}
        assets={assets}
        onUpdate={updateSelectedUseSiteNode}
        onOpenArtifact={openArtifact}
        openAssetPicker={() => {}}
        onNotice={props.onNotice}
        onBlocked={showBlockedOperation}
        continuousEdit={continuousEdit}
      />
    ) : null;
  const useSiteOverridesControl =
    !selectionIsPreviewGenerated &&
    !selectionIsPreviewDirect &&
    !selectionUseSiteRootIsVariant &&
    selectedUseSiteNode?.components?.PrefabRef &&
    applySelectedUseSiteModifications &&
    revertSelectedUseSiteModifications ? (
      <UseSiteOverridesDropdown
        key={selectedUseSiteNode.id}
        artifactKey={selectedUseSiteNode.components.PrefabRef.artifactKey}
        candidates={useSiteOverrideCandidates}
        overrides={selectedUseSiteNode.components.PrefabRef.overrides ?? []}
        componentAdditions={selectedUseSiteNode.components.PrefabRef.componentAdditions ?? []}
        onApply={applySelectedUseSiteModifications}
        onRevert={revertSelectedUseSiteModifications}
        onSelectTarget={(target) => {
          const address = useSiteOverrideSelectionAddress(source.artifactKey, selectedUseSiteNode, target, artifacts);
          if (address) selectAddress(address);
        }}
        onHoverTarget={(target) =>
          setHoveredSelection(
            target ? useSiteOverrideSelectionAddress(source.artifactKey, selectedUseSiteNode, target, artifacts) : undefined,
          )
        }
      />
    ) : null;
  const useSiteOwnerSections = prefabRefCompanionSection;
  useEffect(() => {
    if (source.artifactType === "Fragment" && displayMode !== "unityBaseline") onDisplayMode("unityBaseline");
  }, [displayMode, onDisplayMode, source.artifactType]);
  return (
    <main
      className={webClasses(
        `editor-shell ${displayMode === "editPreview" ? "is-editing-preview" : ""} ${treeCollapsed ? "is-tree-collapsed" : ""} ${inspectorCollapsed ? "is-inspector-collapsed" : ""} ${bottomProjectOpen ? "is-project-bottom-open" : ""}`,
      )}
      style={panelResize.panelStyle}
    >
      <header className={webClasses("topbar")}>
        <div className={webClasses("brand-block")}>
          <LegmaMark className={webClasses("legma-mark")} />
          <strong>
            {source.artifactKey}
            {documentDirty ? " *" : ""}
          </strong>
          {artifact.source.sourceKind === "variant" ? (
            <>
              <span className={webClasses("brand-separator")}>/</span>
              <span>{artifact.source.variantOf}</span>
            </>
          ) : null}
        </div>
        <div className={webClasses("toolbar-group")}>
          <div className={webClasses("mode-segments")} role="group" aria-label="预览显示模式">
            <button
              className={webClasses(displayMode === "preview" ? "is-active" : "")}
              type="button"
              disabled={source.artifactType === "Fragment"}
              onClick={() => onDisplayMode("preview")}
            >
              预览
            </button>
            <button
              className={webClasses(displayMode === "editPreview" ? "is-active" : "")}
              type="button"
              disabled={source.artifactType === "Fragment"}
              onClick={() => {
                setStatePreviewOpen(false);
                onDisplayMode("editPreview");
              }}
            >
              编辑预览
            </button>
            <button
              className={webClasses(displayMode === "unityBaseline" ? "is-active" : "")}
              type="button"
              onClick={() => onDisplayMode("unityBaseline")}
            >
              Unity 基线
            </button>
          </div>
          <span className={webClasses("toolbar-divider")} />
          <button
            className={webClasses("icon-button")}
            type="button"
            onClick={() => setTreeCollapsed((value) => !value)}
            title={treeCollapsed ? "展开左侧栏" : "折叠左侧栏"}
          >
            {treeCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <button
            className={webClasses(`icon-button ${bottomProjectOpen ? "is-active" : ""}`)}
            type="button"
            onClick={() => setBottomProjectOpen((value) => !value)}
            title={bottomProjectOpen ? "关闭底部 Project" : "打开底部 Project"}
          >
            {bottomProjectOpen ? <PanelBottomClose size={16} /> : <PanelBottomOpen size={16} />}
          </button>
          <SaveAutoSaveControl
            hasSavableChanges={hasSavableChanges}
            documentIds={documentIds}
            onSave={onSave}
            saveTitle="保存"
            saveButtonClassName={webClasses("icon-button")}
            iconSize={17}
          />
          <button
            className={webClasses("icon-button")}
            type="button"
            onClick={workspace.undo}
            disabled={displayMode === "editPreview" || !workspace.canUndo}
            title="撤销"
          >
            <Undo2 size={17} />
          </button>
          <button
            className={webClasses("icon-button")}
            type="button"
            onClick={workspace.redo}
            disabled={displayMode === "editPreview" || !workspace.canRedo}
            title="重做"
          >
            <Redo2 size={17} />
          </button>
          <span className={webClasses("toolbar-divider")} />
          <button
            className={webClasses(`svn-revert-button ${svnRevertBusy ? "is-busy" : ""}`)}
            type="button"
            disabled={svnRevertDisabled}
            onClick={() => setSvnRevertOpen(true)}
            title={svnRevertTitle}
          >
            {svnRevertBusy ? <LoaderCircle size={15} /> : <RotateCcw size={15} />}
            <span>SVN</span>
          </button>
          {source.artifactType !== "Fragment" ? (
            <button
              className={webClasses(`icon-button ${showStatePreview ? "is-active" : ""}`)}
              type="button"
              disabled={displayMode === "editPreview" || statePreviewRows.length === 0}
              onClick={() => setStatePreviewOpen((value) => !value)}
              title={
                displayMode === "editPreview"
                  ? "编辑预览暂不支持状态总览"
                  : statePreviewRows.length === 0
                    ? "当前界面没有 StateRoot"
                    : showStatePreview
                      ? "返回编辑画布"
                      : "展开所有 StateRoot 状态"
              }
            >
              <LayoutGrid size={16} />
            </button>
          ) : null}
          <div className={webClasses("toolbar-more")} ref={moreMenu}>
            <button
              className={webClasses(`icon-button ${moreMenuOpen ? "is-active" : ""}`)}
              type="button"
              onClick={() => setMoreMenuOpen((open) => !open)}
              title="更多工具"
              aria-label="更多工具"
              aria-expanded={moreMenuOpen}
            >
              <MoreHorizontal size={17} />
            </button>
            {moreMenuOpen ? (
              <div className={webClasses("toolbar-more-menu")} role="menu" aria-label="更多工具">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    editing.onOpenChanges();
                  }}
                  disabled={editing.dirtyDocuments.size === 0}
                  title="查看改动"
                >
                  <FileDiff size={14} />
                  查看改动
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    copySelectedNode();
                  }}
                  disabled={!selectionIsLocal}
                  title={!selectionIsLocal ? "继承节点不能复制为本地结构；请打开所属 Artifact" : "复制"}
                >
                  <Copy size={14} />
                  复制节点
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    pasteClipboardNode();
                  }}
                  disabled={!selectionIsLocal || !nodeClipboard || artifact.source.sourceKind === "variant"}
                  title={
                    !selectionIsLocal
                      ? "继承节点不能粘贴子节点"
                      : artifact.source.sourceKind === "variant"
                        ? "Variant 不支持结构修改"
                        : !nodeClipboard
                          ? "节点剪贴板为空"
                          : "粘贴"
                  }
                >
                  <ClipboardPaste size={14} />
                  粘贴节点
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    openExtractWidget();
                  }}
                  disabled={!canExtractWidget}
                >
                  <PackagePlus size={14} />
                  抽取 Widget
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    openExtractFragment();
                  }}
                  disabled={!canExtractFragment}
                >
                  <PackagePlus size={14} />
                  抽取 Fragment
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    openCreateVariant();
                  }}
                >
                  <GitFork size={14} />
                  创建 Variant
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    setCaptureOpen(true);
                  }}
                >
                  <Camera size={14} />
                  截图
                </button>
              </div>
            ) : null}
          </div>
          <ThemeToggle className={webClasses("icon-button")} />
        </div>
        {isCanvas ? (
          <div className={webClasses("viewport-segments")} role="group" aria-label="Canvas 预览尺寸">
            {CANVAS_VIEWPORT_PRESETS.map((item, index) => (
              <button
                key={item.label}
                className={webClasses(viewportIndex === index ? "is-active" : "")}
                type="button"
                onClick={() => onViewport(index)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : (
          <div className={webClasses("local-viewport")} aria-label="本地尺寸">
            <strong>本地</strong>
            <span>
              {artifactInitialSize(source)[0]} x {artifactInitialSize(source)[1]}
            </span>
          </div>
        )}
        <div className={webClasses("topbar-actions")}>
          <button
            className={webClasses("icon-button")}
            type="button"
            disabled={unityBusy !== null || unitySyncPhase === "checking"}
            onClick={() => void refreshFormalSync()}
            title={
              unitySyncPhase === "error"
                ? `Prefab Diff 检查失败，点击重试：${unitySyncError}`
                : `Prefab Diff：${formalSyncLabel(unitySyncState?.status, unitySyncPhase)}`
            }
          >
            <RefreshCw size={15} />
          </button>
          <span
            className={webClasses("sync-status")}
            data-ui="sync-status"
            data-status={unitySyncPhase === "ready" ? unitySyncState?.status : unitySyncPhase}
            title={unitySyncError || undefined}
          >
            {formalSyncLabel(unitySyncState?.status, unitySyncPhase)}
          </span>
          <div className={webClasses("publish-control")} ref={publishMenu}>
            <button
              className={webClasses("projection-button publish-primary")}
              type="button"
              disabled={unityBusy !== null}
              onClick={() => void publishPrefab("current")}
              title="发布当前文件"
            >
              <Rocket size={15} />
              发布
            </button>
            <button
              className={webClasses("projection-button publish-options-button")}
              type="button"
              disabled={unityBusy !== null}
              onClick={() => setPublishMenuOpen((open) => !open)}
              title="选择发布范围"
              aria-label="发布选项"
              aria-expanded={publishMenuOpen}
            >
              <ChevronDown size={14} />
            </button>
            {publishMenuOpen ? (
              <div className={webClasses("publish-menu")} role="menu" aria-label="发布范围">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPublishMenuOpen(false);
                    void publishPrefab("current");
                  }}
                >
                  <Rocket size={13} />
                  发布当前文件
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPublishMenuOpen(false);
                    void publishPrefab("dependencies");
                  }}
                >
                  <Layers3 size={13} />
                  发布当前文件及依赖
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPublishMenuOpen(false);
                    void publishPrefab("changes");
                  }}
                >
                  <FileDiff size={13} />
                  发布改动及依赖
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPublishMenuOpen(false);
                    void publishPrefab("all");
                  }}
                >
                  <PackageOpen size={13} />
                  发布全部
                </button>
                <div className={webClasses("publish-options")} role="group" aria-label="发布确认">
                  <label title="发布时自动补齐程序接入，无需二次点击">
                    <input
                      type="checkbox"
                      checked={unityPublishOptions.confirmScaffold}
                      onChange={(event) => setUnityPublishOption("confirmScaffold", event.currentTarget.checked)}
                    />
                    <span>自动补齐程序接入</span>
                  </label>
                </div>
                <span className={webClasses("publish-menu-divider")} role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPublishMenuOpen(false);
                    void pullUnityChanges("current");
                  }}
                >
                  <ImportIcon size={13} />
                  回写当前文件
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPublishMenuOpen(false);
                    void pullUnityChanges("dependencies");
                  }}
                >
                  <Layers3 size={13} />
                  回写当前文件及依赖
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPublishMenuOpen(false);
                    void pullUnityChanges("all");
                  }}
                >
                  <PackageOpen size={13} />
                  回写全部
                </button>
              </div>
            ) : null}
          </div>
          <button
            className={webClasses("icon-button")}
            type="button"
            disabled={unityBusy !== null}
            onClick={() => void pullUnityChanges("current")}
            title="从 Prefab 回写当前 Source"
          >
            <ImportIcon size={16} />
          </button>
          <button className={webClasses("icon-button")} type="button" onClick={() => setDeleteArtifactOpen(true)} title="删除 Artifact">
            <Trash2 size={16} />
          </button>
          <button
            className={webClasses("icon-button")}
            type="button"
            onClick={() => setInspectorCollapsed((value) => !value)}
            title={inspectorCollapsed ? "展开 Inspector" : "折叠 Inspector"}
          >
            {inspectorCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
          </button>
        </div>
      </header>

      <aside
        className={webClasses(`tree-panel ${sidebarLayout.views.includes("hierarchy") ? "is-hierarchy-view" : ""}`)}
        data-ui="tree-panel"
        data-sidebar-view={sidebarLayout.focused}
      >
        <WorkbenchSidebar
          label="Artifact 侧栏"
          layout={sidebarLayout}
          onSelect={selectSidebarView}
          onFocus={focusSidebarView}
          onSplit={setSidebarSplit}
          tabs={[
            { value: "project", label: "Project", icon: <FolderOpen size={13} /> },
            { value: "hierarchy", label: "Hierarchy", icon: <Layers3 size={13} />, title: `${nodeCount} 个节点` },
            { value: "relations", label: "关系", icon: <GitFork size={13} />, title: "Artifact 引用关系" },
          ]}
          render={(sidebarView, focused) =>
            sidebarView === "project" ? (
              <ProjectPanel
                dock="left"
                catalog={catalog}
                assets={assets}
                selectedDocumentPath={artifact.path}
                frameShortcutEnabled={focused}
                onRefreshAssets={onRefreshAssets}
                onOpenDirectory={onOpenDirectory}
                onOpenArtifact={openArtifact}
                onOpenReference={onOpenReference}
                onOpenPrototype={onOpenPrototype}
                onNotice={props.onNotice}
              />
            ) : sidebarView === "hierarchy" ? (
              <>
                <div className={webClasses("hierarchy-controls")}>
                  <label>
                    <Search size={13} />
                    <input
                      value={hierarchyQuery}
                      onChange={(event) => setHierarchyQuery(event.target.value)}
                      placeholder="Node ID / GameObject 名称 / Component / Binding"
                    />
                  </label>
                  <div className={webClasses("create-node-control")} ref={createMenu}>
                    <button
                      className={webClasses("icon-button")}
                      type="button"
                      disabled={structuralDisabled}
                      onClick={() => setCreateMenuOpen((open) => !open)}
                      title={structuralDisabledReason ?? "新建子节点"}
                    >
                      <Plus size={14} />
                    </button>
                    {createMenuOpen ? (
                      <div className={webClasses("create-node-menu")} data-ui="create-node-menu">
                        <button type="button" onClick={() => openNodeCreate("Node")}>
                          <Plus size={13} />
                          空节点
                        </button>
                        <button type="button" onClick={() => openNodeCreate("Image")}>
                          <ImageIcon size={13} />
                          自定义 Image...
                        </button>
                        <button type="button" onClick={() => openNodeCreate("Text")}>
                          <TypeIcon size={13} />
                          自定义 TMP...
                        </button>
                        <button
                          type="button"
                          onClick={() => openNodeCreate("PrefabRef")}
                          disabled={
                            prefabRefArtifacts.length === 0 || Boolean(selected.components?.PrefabRef) || selectedInLocalVisualSubtree
                          }
                          title={
                            selected.components?.PrefabRef || selectedInLocalVisualSubtree
                              ? "PrefabRef 本地视觉子树不能再嵌套 PrefabRef"
                              : undefined
                          }
                        >
                          <Box size={13} />
                          PrefabRef
                        </button>
                        {availableTemplates.map((template) => (
                          <button
                            key={template.id}
                            type="button"
                            disabled={Boolean(templateDisabledReason)}
                            title={templateDisabledReason}
                            onClick={() => createFromTemplate(template.id)}
                          >
                            {templateIcon(template.category, 13)}
                            {template.label}
                          </button>
                        ))}
                        {canRestoreScrollbars ? (
                          <button
                            type="button"
                            onClick={() => {
                              setCreateMenuOpen(false);
                              restoreSelectedScrollbars();
                            }}
                          >
                            <RotateCcw size={13} />
                            恢复 Scrollbar
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <button
                    className={webClasses("icon-button")}
                    type="button"
                    disabled={artifact.source.sourceKind === "variant" || !selectionIsLocal || selected.id === source.root.id}
                    onClick={duplicateSelectedNodes}
                    title={structureCommandReason ?? rootCommandReason ?? "复制选中节点"}
                  >
                    <CopyPlus size={14} />
                  </button>
                  <button
                    className={webClasses("icon-button")}
                    type="button"
                    disabled={
                      artifact.source.sourceKind === "variant" || !selectionIsLocal || multipleSelected || selected.id === source.root.id
                    }
                    onClick={() => setRenameDraft(createNodeRenameDraft(selected))}
                    title={structureCommandReason ?? rootCommandReason ?? (multipleSelected ? "多选时不能重命名" : "重命名节点")}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className={webClasses("icon-button")}
                    type="button"
                    disabled={artifact.source.sourceKind === "variant" || !selectionIsLocal || selected.id === source.root.id}
                    onClick={() => setDeleteNodeIds(selectedNodes.map((node) => node.id))}
                    title={structureCommandReason ?? rootCommandReason ?? "删除选中节点"}
                  >
                    <Trash2 size={14} />
                  </button>
                  <button
                    className={webClasses("icon-button")}
                    type="button"
                    onClick={() => void copySelectedSummary()}
                    title="复制当前节点结构摘要"
                  >
                    <Copy size={14} />
                  </button>
                </div>
                <EditorHierarchyTree
                  source={previewHierarchy.source}
                  selectedAddresses={selectedAddresses}
                  primaryAddress={selection}
                  hoveredAddress={hoveredSelection}
                  artifacts={previewHierarchy.artifacts}
                  previewGeneratedNodeIds={previewHierarchy.generatedNodeIds}
                  previewInstanceLabels={previewHierarchy.instanceLabels}
                  previewRootArtifactKey={previewHierarchy.previewRootArtifactKey}
                  resolvedSourceInstance={previewHierarchy.subjectInstance}
                  evaluatedSource={localStatePreviewSource}
                  bindingTargets={bindingTargets}
                  externalBindingTargets={externalBindingTargets}
                  changes={nodeChanges}
                  errors={hierarchyErrors}
                  query={hierarchyQuery.trim().toLowerCase()}
                  frameShortcutEnabled={focused}
                  revealRequest={hierarchyRevealRequest}
                  onClearQuery={() => setHierarchyQuery("")}
                  authoringEnabled={displayMode !== "editPreview"}
                  structureEditable={displayMode !== "editPreview" && artifact.source.sourceKind === "artifact"}
                  hiddenAddresses={hiddenAddresses}
                  onToggleHidden={toggleHiddenAddress}
                  onDenied={showBlockedOperation}
                  onSelect={selectAddress}
                  onSelectMany={selectAddresses}
                  onHover={setHoveredSelection}
                  onMove={moveNodeInHierarchy}
                  onProjectDrop={dropProjectItem}
                  onContextMenu={displayMode !== "editPreview" ? (_address, x, y) => setContextMenu({ x, y }) : undefined}
                  onRenamePreview={(address, displayName) => previewNodeDisplayName(address.nodeId, displayName)}
                  onRename={(address, displayName) => renameNodeDisplayName(address.nodeId, displayName)}
                  onOpenArtifact={openArtifact}
                />
              </>
            ) : (
              <ArtifactRelations
                artifact={artifact}
                artifacts={artifacts}
                references={props.references}
                prototypes={props.prototypes}
                onOpenArtifact={openArtifact}
                onOpenReference={onOpenReference}
                onOpenPrototype={onOpenPrototype}
                onOpenGraph={() => props.onOpenRelations(artifact.artifactKey)}
              />
            )
          }
        />
      </aside>
      <PanelResizeHandle panel="tree" resize={panelResize} />

      <section ref={workspacePanel} className={webClasses("workspace-panel")}>
        <div className={webClasses("canvas-meta")} data-ui="canvas-meta">
          <span>{showStatePreview ? `${statePreviewRows.length} 个 StateRoot` : `${contextViewport[0]} x ${contextViewport[1]}`}</span>
          <div className={webClasses("canvas-controls")}>
            {!showPreviewOverview && showReferencePreview && parentCanvasAvailable ? (
              <button
                className={webClasses(`parent-canvas-toggle ${showParentCanvas ? "is-active" : ""}`)}
                type="button"
                aria-label="显示父级 Canvas"
                aria-pressed={showParentCanvas}
                onClick={() => setShowParentCanvas((current) => !current)}
                title={showParentCanvas ? "隐藏父级 Canvas" : "显示父级 Canvas"}
              >
                <Layers3 size={13} />
              </button>
            ) : null}
            {!showPreviewOverview ? (
              <ArtifactCanvasZoomControls source={source} zoom={zoom} zoomPolicy={zoomPolicy} onZoom={onZoom} onFit={fitCanvas} />
            ) : null}
            {showPreviewOverview ? (
              <label className={webClasses("state-preview-columns")}>
                <span>每行最多</span>
                <SelectControl
                  ariaLabel="每行最多预览数"
                  value={String(statePreviewMaximumColumns)}
                  options={STATE_PREVIEW_COLUMN_OPTIONS.map((value) => ({ value: String(value), label: String(value) }))}
                  onValueChange={(value) => setStatePreviewMaximumColumns(Number(value))}
                />
              </label>
            ) : displayMode === "editPreview" ? (
              defaultPreview ? (
                <button
                  className={webClasses("icon-button")}
                  type="button"
                  onClick={() => onOpenReference(defaultPreview.referenceKey)}
                  title={`打开默认预览 ${defaultPreview.referenceKey}`}
                >
                  <Link2 size={13} />
                </button>
              ) : null
            ) : (
              <>
                <div className={webClasses("canvas-tool-group")} role="toolbar" aria-label="Canvas 工具">
                  <button
                    className={webClasses(canvasTool === "select" ? "is-active" : "")}
                    type="button"
                    aria-pressed={canvasTool === "select"}
                    aria-keyshortcuts="V"
                    onClick={() => setCanvasTool("select")}
                    title="选择工具"
                  >
                    <MousePointer2 size={13} />
                  </button>
                  <button
                    className={webClasses(canvasTool === "rect" ? "is-active" : "")}
                    type="button"
                    aria-pressed={canvasTool === "rect"}
                    aria-keyshortcuts="R"
                    disabled={structuralDisabled}
                    onClick={() => setCanvasTool("rect")}
                    title={structuralDisabledReason ?? "矩形工具"}
                  >
                    <Square size={13} />
                  </button>
                  <button
                    className={webClasses(canvasTool === "text" ? "is-active" : "")}
                    type="button"
                    aria-pressed={canvasTool === "text"}
                    aria-keyshortcuts="T"
                    disabled={structuralDisabled}
                    onClick={() => setCanvasTool("text")}
                    title={structuralDisabledReason ?? "文本工具"}
                  >
                    <TypeIcon size={13} />
                  </button>
                </div>
                <div className={webClasses("canvas-tool-group")} role="toolbar" aria-label="Canvas 吸附">
                  <button
                    className={webClasses(gridVisible ? "is-active" : "")}
                    type="button"
                    aria-label="显示网格"
                    aria-pressed={gridVisible}
                    onClick={() => setGridVisible((current) => !current)}
                    title={gridVisible ? "隐藏 8 单位网格" : "显示 8 单位网格"}
                  >
                    <Grid3X3 size={13} />
                  </button>
                  <button
                    className={webClasses(snapEnabled ? "is-active" : "")}
                    type="button"
                    aria-label="启用吸附"
                    aria-pressed={snapEnabled}
                    onClick={() => setSnapEnabled((current) => !current)}
                    title={snapEnabled ? "关闭网格与节点吸附" : "启用网格与节点吸附"}
                  >
                    <Magnet size={13} />
                  </button>
                </div>
                {showReferencePreview && defaultPreview ? (
                  <button
                    className={webClasses("icon-button")}
                    type="button"
                    onClick={() => onOpenReference(defaultPreview.referenceKey)}
                    title={`打开默认预览 ${defaultPreview.referenceKey}`}
                  >
                    <Link2 size={13} />
                  </button>
                ) : null}
              </>
            )}
            {!showPreviewOverview && displayMode !== "editPreview" && multipleSelected ? (
              <div className={webClasses("arrangement-toolbar")} role="toolbar" aria-label="排列选中节点">
                <button type="button" disabled={!canArrangeHorizontal} onClick={() => requestArrangement("alignLeft")} title="左对齐">
                  <AlignHorizontalJustifyStart size={13} />
                </button>
                <button
                  type="button"
                  disabled={!canArrangeHorizontal}
                  onClick={() => requestArrangement("alignHorizontalCenter")}
                  title="水平居中"
                >
                  <AlignHorizontalJustifyCenter size={13} />
                </button>
                <button type="button" disabled={!canArrangeHorizontal} onClick={() => requestArrangement("alignRight")} title="右对齐">
                  <AlignHorizontalJustifyEnd size={13} />
                </button>
                <i />
                <button type="button" disabled={!canArrangeVertical} onClick={() => requestArrangement("alignTop")} title="顶部对齐">
                  <AlignVerticalJustifyStart size={13} />
                </button>
                <button
                  type="button"
                  disabled={!canArrangeVertical}
                  onClick={() => requestArrangement("alignVerticalCenter")}
                  title="垂直居中"
                >
                  <AlignVerticalJustifyCenter size={13} />
                </button>
                <button type="button" disabled={!canArrangeVertical} onClick={() => requestArrangement("alignBottom")} title="底部对齐">
                  <AlignVerticalJustifyEnd size={13} />
                </button>
                <i />
                <button
                  type="button"
                  disabled={!canArrangeHorizontal || selectedNodes.length < 3}
                  onClick={() => requestArrangement("distributeHorizontal")}
                  title="水平等距分布"
                >
                  <BetweenHorizontalStart size={13} />
                </button>
                <button
                  type="button"
                  disabled={!canArrangeVertical || selectedNodes.length < 3}
                  onClick={() => requestArrangement("distributeVertical")}
                  title="垂直等距分布"
                >
                  <BetweenVerticalStart size={13} />
                </button>
              </div>
            ) : null}
          </div>
          <span>
            {showReferencePreview
              ? defaultPreview
                ? `Reference · ${defaultPreview.referenceKey}`
                : "Reference · Unity 基线"
              : source.artifactType}
          </span>
        </div>
        {showStatePreview ? (
          <StateRootPreviewGrid
            source={source}
            artifacts={artifacts}
            references={props.references}
            reference={displayedPreviewReference}
            referencePath={defaultPreview?.path}
            displayMode={displayMode === "unityBaseline" ? "unityBaseline" : "preview"}
            maximumColumns={statePreviewMaximumColumns}
            contexts={statePreviewContexts}
          />
        ) : (
          <ArtifactCanvasViewport
            controller={viewportController}
            onPointerDown={
              showReferencePreview
                ? undefined
                : () =>
                    selectAddress({
                      rootArtifactKey: source.artifactKey,
                      instancePath: [],
                      ownerArtifactKey: source.artifactKey,
                      nodeId: source.root.id,
                    })
            }
          >
            {showReferencePreview ? (
              <ReferencePreview
                reference={displayedPreviewReference}
                referencePath={defaultPreview?.path}
                references={props.references}
                artifacts={artifacts}
                viewport={contextViewport}
                embeddedScale={zoom}
                selectedAddress={displayMode === "preview" ? resolvedSelection : undefined}
                hoveredAddress={displayMode === "preview" ? resolvedHover : undefined}
                onSelectAddress={displayMode === "preview" ? selectReferenceAddress : undefined}
                onHoverAddress={displayMode === "preview" ? hoverReferenceAddress : undefined}
                onResolved={preview.onResolved}
                subjectSessionPatches={subjectStatePreviewPatches}
                sourceAuthoring={previewSourceAuthoring}
              />
            ) : (
              renderCanvasView(previewSource, viewport)
            )}
          </ArtifactCanvasViewport>
        )}
      </section>
      {bottomProjectOpen ? (
        <>
          <PanelResizeHandle panel="project" resize={panelResize} />
          <ProjectPanel
            dock="bottom"
            catalog={catalog}
            assets={assets}
            selectedDocumentPath={artifact.path}
            onRefreshAssets={onRefreshAssets}
            onOpenDirectory={onOpenDirectory}
            onOpenArtifact={openArtifact}
            onOpenReference={onOpenReference}
            onOpenPrototype={onOpenPrototype}
            onNotice={props.onNotice}
            onClose={() => setBottomProjectOpen(false)}
          />
        </>
      ) : null}
      <PanelResizeHandle panel="inspector" resize={panelResize} />

      {displayMode === "editPreview" ? (
        defaultPreview ? (
          <aside className={webClasses("inspector-panel reference-document-inspector")} data-ui="inspector-panel">
            <ReferenceEditor
              key={defaultPreview.path}
              document={defaultPreview}
              savedReference={props.savedReferences.get(defaultPreview.referenceKey)?.reference ?? defaultPreview.reference}
              artifacts={artifacts}
              references={props.references}
              onDraftChange={(reference) => props.onReferenceDraftChange(defaultPreview.referenceKey, reference)}
            />
          </aside>
        ) : (
          <aside className={webClasses("inspector-panel")} data-ui="inspector-panel">
            <div className={webClasses("baseline-notice")}>当前 Artifact 未配置默认 Reference。</div>
          </aside>
        )
      ) : selectionIsLocal && selectedNodes.length > 1 ? (
        <BatchInspector
          source={source}
          nodes={selectedNodes}
          catalog={catalog}
          assets={assets}
          onRefreshAssets={onRefreshAssets}
          capabilities={rectCapabilities}
          onUpdate={updateSelectedMany}
          onOpenArtifact={openArtifact}
          onSelectNode={(nodeId) =>
            selectInspectorNode({ rootArtifactKey: source.artifactKey, instancePath: [], ownerArtifactKey: source.artifactKey, nodeId })
          }
          canAddComponents={artifact.source.sourceKind === "artifact"}
          openAddComponentRequest={addComponentRequest}
          continuousEdit={continuousEdit}
        />
      ) : useSiteBatchSource && useSiteBatchNodes.length > 1 ? (
        <BatchInspector
          source={useSiteBatchSource}
          nodes={useSiteBatchNodes}
          catalog={catalog}
          assets={assets}
          onRefreshAssets={onRefreshAssets}
          capabilities={useSiteBatchRectCapabilities}
          onUpdate={updateUseSiteSelectedMany}
          onOpenArtifact={openArtifact}
          onSelectNode={(nodeId) => selectInspectorNode({ ...selection, nodeId })}
          canAddComponents
          useSite
          openAddComponentRequest={addComponentRequest}
          continuousEdit={continuousEdit}
        />
      ) : !selectionIsLocal && selectionOwner && selectionNode ? (
        <SourceInspector
          source={selectionOwner}
          node={selectionNode}
          stateRootPreviewSource={externalStatePreviewSource}
          rectTransformPresentation={selectionIsReferencedRoot ? "authored" : "evaluated"}
          catalog={catalog}
          assets={assets}
          onRefreshAssets={onRefreshAssets}
          onUpdate={
            selectionIsPreviewGenerated
              ? () => {
                  showBlockedOperation(previewGeneratedReason);
                  return false;
                }
              : selectionIsPreviewDirect
                ? updatePreviewExternalSelected
                : selectionUseSiteRootIsVariant
                  ? () => {
                      showBlockedOperation("Variant 不能修改嵌套继承节点字段");
                      return false;
                    }
                  : updateUseSiteSelected
          }
          stateOverrides={stateOverrides}
          onStatePreview={() => {}}
          onOpenArtifact={openArtifact}
          useSite={!selectionIsPreviewGenerated && !selectionIsPreviewDirect && !selectionUseSiteRootIsVariant}
          readOnly={selectionIsPreviewGenerated || (!selectionIsPreviewDirect && selectionUseSiteRootIsVariant)}
          overrideState={
            selectionIsPreviewGenerated || selectionIsPreviewDirect || selectionUseSiteRootIsVariant ? undefined : useSiteFieldState
          }
          onResetOverride={
            selectionIsPreviewGenerated || selectionIsPreviewDirect || selectionUseSiteRootIsVariant ? undefined : resetUseSiteSelectedField
          }
          onResetRectOverrides={
            selectionIsPreviewGenerated || selectionIsPreviewDirect || selectionUseSiteRootIsVariant
              ? undefined
              : resetUseSiteSelectedRectFields
          }
          componentState={
            selectionIsPreviewGenerated || selectionIsPreviewDirect || selectionUseSiteRootIsVariant ? undefined : useSiteComponentState
          }
          openAddComponentRequest={selectionIsPreviewGenerated || selectionUseSiteRootIsVariant ? 0 : addComponentRequest}
          onCopyNodeId={() => void copyIdentity("node id", selectionNode.id)}
          onNotice={props.onNotice}
          onBlocked={showBlockedOperation}
          onSelectNode={(nodeId) =>
            selectInspectorNode({
              rootArtifactKey: source.artifactKey,
              instancePath: selection.instancePath,
              ownerArtifactKey: selectionOwner.artifactKey,
              nodeId,
            })
          }
          continuousEdit={continuousEdit}
          headerContent={
            <>
              <SelectionLocation
                address={selection}
                pathLabels={selectionLocationPathLabels(source, artifacts, selection)}
                localArtifactKey={source.artifactKey}
                variant={selectionUseSiteRootIsVariant}
                visible={selectionVisible}
                onOpenOwner={openArtifact}
                onCopyOwner={(value) => void copyIdentity("Widget", value)}
                onHover={setHoveredSelection}
                overrideControl={useSiteOverridesControl}
              />
              {selectionIsPreviewGenerated ? (
                <div className={webClasses("baseline-notice")}>{previewGeneratedReason}</div>
              ) : previewValueLabels.length > 0 ? (
                <div className={webClasses("baseline-notice")}>
                  Reference 覆盖 {previewValueLabels.join("、")}；当前 Inspector 编辑 Unity 基线。
                </div>
              ) : null}
            </>
          }
          extraSections={selectionIsPreviewGenerated ? null : useSiteOwnerSections}
        />
      ) : artifact.source.sourceKind === "variant" ? (
        <SourceInspector
          source={source}
          node={selected}
          stateRootPreviewSource={localStatePreviewSource}
          artifactSize={selected.id === source.root.id && source.artifactType !== "Canvas" ? source.initialSize : undefined}
          artifactMetadata={selected.id === source.root.id ? artifact.source : undefined}
          onArtifactMetadataChange={selected.id === source.root.id ? updateArtifactMetadata : undefined}
          onArtifactSizeChange={selected.id === source.root.id && source.artifactType !== "Canvas" ? updateArtifactSize : undefined}
          artifactSizeState={selected.id === source.root.id ? (artifact.source.initialSize ? "overridden" : "inherited") : undefined}
          onResetArtifactSize={
            selected.id === source.root.id && variantBaseInitialSize ? () => updateArtifactSize(variantBaseInitialSize) : undefined
          }
          rectCapabilities={rectCapabilities.get(selected.id)}
          catalog={catalog}
          assets={assets}
          onRefreshAssets={onRefreshAssets}
          onUpdate={updateSelected}
          stateOverrides={stateOverrides}
          onStatePreview={(nodeId, stateName) => setStateOverrides((current) => ({ ...current, [nodeId]: stateName }))}
          stateRootSelectionMode="current"
          onOpenArtifact={openArtifact}
          variant
          overrideState={inspectorOverrideState}
          onResetOverride={resetSelectedOverride}
          onResetRectOverrides={resetSelectedRectOverrides}
          componentClipboard={componentClipboard}
          onCopyComponent={(componentType) => copyComponent(selected, componentType)}
          onPasteComponent={pasteSelectedComponent}
          onCopyNodeId={() => void copyIdentity("node id", selected.id)}
          onNotice={props.onNotice}
          onBlocked={showBlockedOperation}
          onSelectNode={(nodeId) =>
            selectInspectorNode({ rootArtifactKey: source.artifactKey, instancePath: [], ownerArtifactKey: source.artifactKey, nodeId })
          }
          continuousEdit={continuousEdit}
          extraSections={binderBindingsSection}
          headerContent={
            <SelectionLocation
              address={selection}
              pathLabels={selectionLocationPathLabels(source, artifacts, selection)}
              localArtifactKey={source.artifactKey}
              variant
              {...(variantBaseArtifact
                ? {
                    baseArtifact: {
                      artifactKey: variantBaseArtifact.artifactKey,
                      rootNodeId: variantBaseArtifact.resolvedSource.root.id,
                    },
                  }
                : {})}
              visible={selectionVisible}
              onOpenOwner={openArtifact}
              onCopyOwner={(value) => void copyIdentity("Widget", value)}
              onHover={setHoveredSelection}
              overrideControl={useSiteOverridesControl}
            />
          }
        />
      ) : (
        <SourceInspector
          source={source}
          node={selected}
          stateRootPreviewSource={localStatePreviewSource}
          artifactSize={selected.id === source.root.id && source.artifactType !== "Canvas" ? source.initialSize : undefined}
          artifactMetadata={selected.id === source.root.id ? artifact.source : undefined}
          onArtifactMetadataChange={selected.id === source.root.id ? updateArtifactMetadata : undefined}
          onArtifactSizeChange={selected.id === source.root.id && source.artifactType !== "Canvas" ? updateArtifactSize : undefined}
          rectCapabilities={rectCapabilities.get(selected.id)}
          catalog={catalog}
          assets={assets}
          onRefreshAssets={onRefreshAssets}
          onUpdate={updateSelected}
          stateOverrides={stateOverrides}
          onStatePreview={(nodeId, stateName) => {
            setStateOverrides((current) => ({ ...current, [nodeId]: stateName }));
          }}
          stateRootSelectionMode="current"
          onOpenArtifact={openArtifact}
          localVisual={selectedInLocalVisualSubtree}
          componentState={selectedInLocalVisualSubtree ? () => "added" : undefined}
          componentClipboard={componentClipboard}
          onCopyComponent={(componentType) => copyComponent(selected, componentType)}
          onPasteComponent={pasteSelectedComponent}
          onCopyNodeId={() => void copyIdentity("node id", selected.id)}
          headerContent={
            <>
              <SelectionLocation
                address={selection}
                pathLabels={selectionLocationPathLabels(source, artifacts, selection)}
                localArtifactKey={source.artifactKey}
                visible={selectionVisible}
                onOpenOwner={openArtifact}
                onCopyOwner={(value) => void copyIdentity("Widget", value)}
                onHover={setHoveredSelection}
                overrideControl={useSiteOverridesControl}
              />
              {previewValueLabels.length > 0 ? (
                <div className={webClasses("baseline-notice")}>
                  Reference 覆盖 {previewValueLabels.join("、")}；当前 Inspector 编辑 Unity 基线。
                </div>
              ) : null}
            </>
          }
          onSelectNode={(nodeId) =>
            selectInspectorNode({ rootArtifactKey: source.artifactKey, instancePath: [], ownerArtifactKey: source.artifactKey, nodeId })
          }
          onHoverNode={(nodeId) =>
            setHoveredSelection(
              nodeId ? { rootArtifactKey: source.artifactKey, instancePath: [], ownerArtifactKey: source.artifactKey, nodeId } : undefined,
            )
          }
          openAddComponentRequest={addComponentRequest}
          onNotice={props.onNotice}
          onBlocked={showBlockedOperation}
          continuousEdit={continuousEdit}
          extraSections={binderBindingsSection ?? useSiteOwnerSections}
        />
      )}
      <footer className={webClasses("statusbar")}>
        <span className={webClasses(`dirty-dot is-${savePresentation.state}`)} />
        <span title={savePresentation.title}>{savePresentation.label}</span>
        {documentDirty && savePresentation.state === "modified" ? (
          <span className={webClasses("status-notice")} data-ui="status-notice" title={notice}>
            {notice}
          </span>
        ) : null}
        <span className={webClasses("status-path")}>{artifact.path}</span>
      </footer>
      <ArtifactEditorDialogs controller={dialogs} />
      {svnRevertOpen ? (
        <div
          className={webClasses("modal-backdrop")}
          onPointerDown={() => {
            if (!svnRevertBusy) setSvnRevertOpen(false);
          }}
        >
          <section
            className={webClasses("authoring-dialog svn-revert-dialog")}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="svn-revert-title"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <RotateCcw size={15} />
                <strong id="svn-revert-title">还原 SVN 本地改动</strong>
              </div>
              <button
                className={webClasses("icon-button")}
                type="button"
                disabled={svnRevertBusy}
                onClick={() => setSvnRevertOpen(false)}
                title="取消"
              >
                <X size={15} />
              </button>
            </header>
            <div className={webClasses("svn-revert-message")}>
              <p>{svnRevertMessage}</p>
              <code>{artifact.path}</code>
            </div>
            <footer>
              <button
                className={webClasses("dialog-secondary")}
                type="button"
                disabled={svnRevertBusy}
                onClick={() => setSvnRevertOpen(false)}
              >
                取消
              </button>
              <button
                className={webClasses(`dialog-danger ${svnRevertBusy ? "is-busy" : ""}`)}
                type="button"
                disabled={svnRevertBusy}
                onClick={() => void revertSource()}
              >
                {svnRevertBusy ? <LoaderCircle size={14} /> : <RotateCcw size={14} />}还原到 SVN BASE
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      {unityReconcileJob ? (
        <UnityReconcileDialog
          job={unityReconcileJob}
          onClose={closeUnityReconcile}
          onRetry={() => void retryUnityReconcile()}
          onApply={applyUnityReconcile}
        />
      ) : null}
      {unityPublishJob ? (
        <UnityPublishDialog
          job={unityPublishJob}
          onClose={closeUnityPublish}
          onRetry={() => void retryUnityPublish()}
          onApplyScaffold={() => void applyUnityPublishScaffold()}
        />
      ) : null}
      {contextMenu && displayMode !== "editPreview" ? (
        <ArtifactContextMenu x={contextMenu.x} y={contextMenu.y} items={contextItems} onClose={() => setContextMenu(null)} />
      ) : null}
    </main>
  );
}
