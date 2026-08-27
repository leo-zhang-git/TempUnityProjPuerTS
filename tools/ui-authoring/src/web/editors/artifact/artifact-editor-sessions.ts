import { useCallback, useEffect, useMemo, useState } from "react";
import type { ResolvedPreviewReference } from "../../../kernel/preview-reference-resolver.js";
import { findNode, walkNodes } from "../../../kernel/tree.js";
import type { UiConcreteSource } from "../../../schema/ui-source-schema.js";
import {
  normalizeExclusiveSelectionSet,
  type SelectionAddress,
  type SelectionSet,
  type SelectionUpdateMode,
  sameSelectionAddress,
  selectionAddressesShareScope,
  selectionAddressKey,
  updateSelectionSet,
} from "../../rendering/selection.js";
import { loadImageMetrics } from "../../shared/api/client.js";
import { gameObjectNameById } from "../../shared/game-object-label.js";
import type { ArtifactDocument } from "../../shared/types.js";
import type { PreviewEditorMode } from "../shared/preview-editor-mode.js";
import { useWorkbenchSidebarLayout } from "../shared/workbench-sidebar.js";
import type {
  ArtifactExtractionDraft,
  ArtifactIdentityDraft,
  NodeCreateDraft,
  NodeRenameDraft,
} from "./artifact-editor-command-session.js";
import { updateWorkspaceNode } from "./artifact-editor-commands.js";
import { reconcileArtifactStateOverrides } from "./artifact-state-preview.js";
import type { ArtifactWorkspaceState } from "./artifact-workspace-state.js";
import type { CanvasAssetDrop } from "./canvas/artifact-canvas.js";
import { useArtifactCanvasViewport } from "./canvas/artifact-canvas-viewport.js";
import { editorSafeArea, editorViewport, editorZoomPolicy } from "./canvas/artifact-viewport.js";
import { type CanvasAuthoringTool, createImageNode } from "./canvas/node-authoring.js";
import { rectTransformCapabilityMap } from "./canvas/rect-transform-authoring.js";
import {
  type ArtifactPreviewHierarchy,
  artifactPreviewSelectionEntry,
  selectionUsesPreviewGeneratedNode,
} from "./hierarchy/preview-hierarchy.js";
import { resolveUseSiteSelection } from "./inspector/use-site-editing.js";

type ArtifactSidebarView = "project" | "hierarchy" | "relations";

const ARTIFACT_LAYOUT_STORAGE_KEY = "ui-authoring:artifact-layout:v2";
const ARTIFACT_SIDEBAR_VIEWS: readonly ArtifactSidebarView[] = ["project", "hierarchy", "relations"];

interface ArtifactLayoutPreference {
  readonly bottomProjectOpen: boolean;
  readonly gridVisible: boolean;
  readonly snapEnabled: boolean;
}

export function useArtifactPreviewResolutionSession(artifactKey: string) {
  const [resolution, setResolution] = useState<{ readonly artifactKey: string; readonly resolved: ResolvedPreviewReference }>();
  const resolved = resolution?.artifactKey === artifactKey ? resolution.resolved : undefined;
  const onResolved = useCallback(
    (next: ResolvedPreviewReference): void => {
      setResolution((current) =>
        current?.artifactKey === artifactKey && current.resolved === next ? current : { artifactKey, resolved: next },
      );
    },
    [artifactKey],
  );
  return { resolved, onResolved };
}

function storedArtifactLayout(): ArtifactLayoutPreference {
  try {
    const value = JSON.parse(window.localStorage.getItem(ARTIFACT_LAYOUT_STORAGE_KEY) ?? "null") as {
      bottomProjectOpen?: unknown;
      gridVisible?: unknown;
      snapEnabled?: unknown;
    } | null;
    return {
      bottomProjectOpen: value?.bottomProjectOpen === true,
      gridVisible: value?.gridVisible === true,
      snapEnabled: value?.snapEnabled !== false,
    };
  } catch {
    return { bottomProjectOpen: false, gridVisible: false, snapEnabled: true };
  }
}

export function useArtifactViewSession(
  artifacts: ReadonlyMap<string, ArtifactDocument>,
  onOpenArtifact: (artifactKey: string, selectedId?: string) => void,
) {
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [layout, setLayout] = useState(storedArtifactLayout);
  const sidebar = useWorkbenchSidebarLayout(ARTIFACT_SIDEBAR_VIEWS, "project");
  const sidebarView = sidebar.layout.focused;
  const bottomProjectOpen = layout.bottomProjectOpen;
  const setSidebarView = sidebar.show;
  const setBottomProjectOpen = (value: boolean | ((current: boolean) => boolean)): void =>
    setLayout((current) => ({ ...current, bottomProjectOpen: typeof value === "function" ? value(current.bottomProjectOpen) : value }));
  const setGridVisible = (value: boolean | ((current: boolean) => boolean)): void =>
    setLayout((current) => ({ ...current, gridVisible: typeof value === "function" ? value(current.gridVisible) : value }));
  const setSnapEnabled = (value: boolean | ((current: boolean) => boolean)): void =>
    setLayout((current) => ({ ...current, snapEnabled: typeof value === "function" ? value(current.snapEnabled) : value }));
  const [hierarchyQuery, setHierarchyQuery] = useState("");
  const [showDebug, setShowDebug] = useState(false);
  const [canvasTool, setCanvasTool] = useState<CanvasAuthoringTool>("select");
  const [pendingOpenArtifactKey, setPendingOpenArtifactKey] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingOpenArtifactKey || !artifacts.has(pendingOpenArtifactKey)) return;
    setPendingOpenArtifactKey(null);
    onOpenArtifact(pendingOpenArtifactKey);
  }, [pendingOpenArtifactKey, artifacts, onOpenArtifact]);

  useEffect(() => {
    try {
      window.localStorage.setItem(ARTIFACT_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // Layout preferences remain usable for the current session when storage is blocked.
    }
  }, [layout]);

  return {
    treeCollapsed,
    setTreeCollapsed,
    inspectorCollapsed,
    setInspectorCollapsed,
    sidebarView,
    setSidebarView,
    sidebarLayout: sidebar.layout,
    selectSidebarView: sidebar.select,
    focusSidebarView: sidebar.focus,
    setSidebarSplit: sidebar.setSplit,
    bottomProjectOpen,
    setBottomProjectOpen,
    gridVisible: layout.gridVisible,
    setGridVisible,
    snapEnabled: layout.snapEnabled,
    setSnapEnabled,
    hierarchyQuery,
    setHierarchyQuery,
    showDebug,
    setShowDebug,
    canvasTool,
    setCanvasTool,
    pendingOpenArtifactKey,
    setPendingOpenArtifactKey,
  };
}

export function useArtifactDialogSession() {
  const [captureOpen, setCaptureOpen] = useState(false);
  const [extractDraft, setExtractDraft] = useState<ArtifactExtractionDraft | null>(null);
  const [variantDraft, setVariantDraft] = useState<ArtifactIdentityDraft | null>(null);
  const [nodeCreateDraft, setNodeCreateDraft] = useState<NodeCreateDraft | null>(null);
  const [renameDraft, setRenameDraft] = useState<NodeRenameDraft | null>(null);
  const [deleteNodeIds, setDeleteNodeIds] = useState<readonly string[] | null>(null);
  const [deleteArtifactOpen, setDeleteArtifactOpen] = useState(false);
  const [blockingMessage, setBlockingMessage] = useState<string | null>(null);

  return {
    captureOpen,
    setCaptureOpen,
    extractDraft,
    setExtractDraft,
    variantDraft,
    setVariantDraft,
    nodeCreateDraft,
    setNodeCreateDraft,
    renameDraft,
    setRenameDraft,
    deleteNodeIds,
    setDeleteNodeIds,
    deleteArtifactOpen,
    setDeleteArtifactOpen,
    blockingMessage,
    showBlockingMessage: setBlockingMessage,
    dismissBlockingMessage: () => setBlockingMessage(null),
  };
}

function selectionIsRendered(address: SelectionAddress): boolean {
  const key = selectionAddressKey(address);
  return [...document.querySelectorAll<HTMLElement>("[data-selection-address]")].some(
    (element) => element.dataset.selectionAddress === key,
  );
}

interface ArtifactSelectionSessionOptions {
  readonly source: UiConcreteSource;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly previewHierarchy: ArtifactPreviewHierarchy;
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
  readonly displayMode: PreviewEditorMode;
  readonly stateOverrides: Readonly<Record<string, string>>;
  readonly onShowHierarchy: () => void;
  readonly multiSelectEnabled: boolean;
  readonly onSelectionBlocked: (message: string) => void;
}

function localAddress(source: UiConcreteSource, nodeId: string): SelectionAddress {
  return { rootArtifactKey: source.artifactKey, instancePath: [], ownerArtifactKey: source.artifactKey, nodeId };
}

function ownerAtInstancePath(
  source: UiConcreteSource,
  artifacts: ReadonlyMap<string, ArtifactDocument>,
  instancePath: readonly string[],
): UiConcreteSource | undefined {
  let owner: UiConcreteSource | undefined = source;
  for (const prefabNodeId of instancePath) {
    const artifactKey: string | undefined = owner ? findNode(owner, prefabNodeId)?.components?.PrefabRef?.artifactKey : undefined;
    owner = artifactKey ? artifacts.get(artifactKey)?.resolvedSource : undefined;
    if (!owner) return undefined;
  }
  return owner;
}

function ownerAtSelectionAddress(
  source: UiConcreteSource,
  artifacts: ReadonlyMap<string, ArtifactDocument>,
  address: SelectionAddress,
): UiConcreteSource | undefined {
  if (address.rootArtifactKey !== source.artifactKey) return undefined;
  const owner = ownerAtInstancePath(source, artifacts, address.instancePath);
  return owner?.artifactKey === address.ownerArtifactKey ? owner : undefined;
}

export function useArtifactSelectionSession({
  source,
  artifacts,
  previewHierarchy,
  selectedId,
  onSelect,
  displayMode,
  stateOverrides,
  onShowHierarchy,
  multiSelectEnabled,
  onSelectionBlocked,
}: ArtifactSelectionSessionOptions) {
  const selected = findNode(source, selectedId) ?? source.root;
  const fallback = localAddress(source, source.root.id);
  const initial = localAddress(source, selected.id);
  const [storedSelectionSet, setSelectionSet] = useState<SelectionSet>({ primary: initial, addresses: [initial] });
  const normalizedStoredSelectionSet = normalizeExclusiveSelectionSet(storedSelectionSet, fallback);
  const storedPrimaryIsPreview = Boolean(artifactPreviewSelectionEntry(previewHierarchy, normalizedStoredSelectionSet.primary));
  const selectionSet =
    normalizedStoredSelectionSet.primary.rootArtifactKey === source.artifactKey || storedPrimaryIsPreview
      ? normalizedStoredSelectionSet
      : { primary: initial, addresses: [initial] };
  const selection = selectionSet.primary;
  const [hoveredSelection, setHoveredSelection] = useState<SelectionAddress>();
  const updateHoveredSelection = (address: SelectionAddress | undefined): void => {
    setHoveredSelection((current) => (sameSelectionAddress(current, address) ? current : address));
  };
  const [selectionVisible, setSelectionVisible] = useState(true);
  const previewSelection = artifactPreviewSelectionEntry(previewHierarchy, selection);
  const selectionIsPreviewGenerated = selectionUsesPreviewGeneratedNode(selection, previewHierarchy);
  const selectionIsLocal =
    !selectionIsPreviewGenerated &&
    (previewSelection?.subject === true || (selection.ownerArtifactKey === source.artifactKey && selection.instancePath.length === 0));
  const rawSelectionOwner =
    previewSelection?.source ?? ownerAtSelectionAddress(previewHierarchy.source, previewHierarchy.artifacts, selection);
  const previewUseSiteRoot =
    previewSelection && !selectionIsLocal && !selectionIsPreviewGenerated && selection.instancePath.length > 0
      ? artifacts.get(selection.rootArtifactKey)?.resolvedSource
      : undefined;
  const useSiteSelection =
    !selectionIsLocal && !selectionIsPreviewGenerated && rawSelectionOwner && (!previewSelection || previewUseSiteRoot)
      ? resolveUseSiteSelection(previewUseSiteRoot ?? source, selection, artifacts)
      : undefined;
  const selectionOwner = useSiteSelection?.source ?? rawSelectionOwner;
  const selectionNode = useSiteSelection?.node ?? (selectionOwner ? findNode(selectionOwner, selection.nodeId) : undefined);
  const selectionIsPreviewExternal = Boolean(previewSelection && !selectionIsLocal && !selectionIsPreviewGenerated);
  const selectionIsPreviewDirect = selectionIsPreviewExternal && selection.instancePath.length === 0;
  const selectedAddresses = selectionSet.addresses;
  const selectedNodes = selectedAddresses.flatMap((address) => {
    const previewEntry = artifactPreviewSelectionEntry(previewHierarchy, address);
    if (!previewEntry?.subject && (address.ownerArtifactKey !== source.artifactKey || address.instancePath.length > 0)) return [];
    const node = findNode(source, address.nodeId);
    return node ? [node] : [];
  });

  useEffect(() => {
    if (normalizedStoredSelectionSet !== storedSelectionSet) setSelectionSet(normalizedStoredSelectionSet);
  }, [normalizedStoredSelectionSet, storedSelectionSet]);

  useEffect(() => {
    const valid = selectionSet.addresses.filter((address) => {
      const previewEntry = artifactPreviewSelectionEntry(previewHierarchy, address);
      const owner = previewEntry?.source ?? ownerAtSelectionAddress(previewHierarchy.source, previewHierarchy.artifacts, address);
      return Boolean(owner && findNode(owner, address.nodeId));
    });
    if (selectionNode && valid.length === selectionSet.addresses.length) return;
    const next = localAddress(source, selected.id);
    setSelectionSet({ primary: next, addresses: [next] });
    if (selectedId !== selected.id) onSelect(selected.id);
  }, [selectionNode, selectionSet.addresses, source, previewHierarchy, selected.id, selectedId, onSelect]);

  useEffect(() => {
    if (!selectionIsLocal || selection.nodeId === selected.id) return;
    const next = localAddress(source, selected.id);
    setSelectionSet({ primary: next, addresses: [next] });
  }, [selectionIsLocal, selection.nodeId, selected.id, source.artifactKey]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setSelectionVisible(selectionIsRendered(selection)));
    return () => cancelAnimationFrame(frame);
  }, [selection, source, artifacts, displayMode, stateOverrides]);

  const addressIsLocal = (address: SelectionAddress): boolean =>
    !selectionUsesPreviewGeneratedNode(address, previewHierarchy) &&
    (artifactPreviewSelectionEntry(previewHierarchy, address)?.subject === true ||
      (address.ownerArtifactKey === source.artifactKey && address.instancePath.length === 0));
  const addressSupportsMultiSelection = (address: SelectionAddress): boolean => {
    if (addressIsLocal(address)) return true;
    if (selectionUsesPreviewGeneratedNode(address, previewHierarchy) || address.instancePath.length === 0) return false;
    const rootArtifact = artifacts.get(address.rootArtifactKey);
    if (!rootArtifact || rootArtifact.source.sourceKind !== "artifact") return false;
    try {
      resolveUseSiteSelection(rootArtifact.resolvedSource, address, artifacts);
      return true;
    } catch {
      return false;
    }
  };
  const applySelectionCandidate = (candidate: SelectionSet): void => {
    onShowHierarchy();
    if (
      candidate.addresses.length > 1 &&
      (!selectionAddressesShareScope(candidate.addresses) || candidate.addresses.some((address) => !addressSupportsMultiSelection(address)))
    ) {
      onSelectionBlocked("多选只能包含当前 Source 的本地节点，或同一 PrefabRef 实例内的引用节点");
      return;
    }
    const next = normalizeExclusiveSelectionSet(candidate, fallback);
    setSelectionSet(next);
    if (addressIsLocal(next.primary)) onSelect(next.primary.nodeId);
  };

  const selectAddress = (address: SelectionAddress, requestedMode: SelectionUpdateMode = "replace"): void => {
    const mode = multiSelectEnabled ? requestedMode : "replace";
    applySelectionCandidate(updateSelectionSet(selectionSet, address, mode, fallback));
  };

  const selectAddresses = (addresses: readonly SelectionAddress[], requestedMode: SelectionUpdateMode = "replace"): void => {
    const unique = [...new Map(addresses.map((address) => [selectionAddressKey(address), address])).values()];
    let candidate: SelectionSet;
    if (!multiSelectEnabled || unique.length === 0) {
      const primary = unique.at(-1) ?? fallback;
      candidate = { primary, addresses: [primary] };
    } else if (requestedMode === "replace") {
      candidate = { primary: unique.at(-1)!, addresses: unique };
    } else {
      candidate = unique.reduce((current, address) => updateSelectionSet(current, address, "toggle", fallback), selectionSet);
    }
    applySelectionCandidate(candidate);
  };

  const selectChild = (): boolean => {
    const child = selectionNode?.children?.[0];
    if (child) {
      selectAddress({ ...selection, nodeId: child.id });
      return true;
    }
    const referencedKey = selectionNode?.components?.PrefabRef?.artifactKey;
    const referenced = referencedKey ? artifacts.get(referencedKey)?.resolvedSource : undefined;
    if (!referenced) return false;
    selectAddress({
      rootArtifactKey: source.artifactKey,
      instancePath: [...selection.instancePath, selection.nodeId],
      ownerArtifactKey: referenced.artifactKey,
      nodeId: referenced.root.id,
    });
    return true;
  };
  const selectParent = (): boolean => {
    if (!selectionOwner || !selectionNode) return false;
    const entry = walkNodes(selectionOwner).find((candidate) => candidate.node.id === selectionNode.id);
    if (entry?.parent) {
      selectAddress({ ...selection, nodeId: entry.parent.id });
      return true;
    }
    if (selection.instancePath.length === 0) return false;
    const parentPath = selection.instancePath.slice(0, -1);
    const parentOwner = ownerAtInstancePath(previewHierarchy.source, previewHierarchy.artifacts, parentPath);
    const prefabNodeId = selection.instancePath[selection.instancePath.length - 1]!;
    if (!parentOwner || !findNode(parentOwner, prefabNodeId)) return false;
    selectAddress({
      rootArtifactKey: source.artifactKey,
      instancePath: parentPath,
      ownerArtifactKey: parentOwner.artifactKey,
      nodeId: prefabNodeId,
    });
    return true;
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent): void => {
      if (event.key !== "Enter" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (
        event.target instanceof Element &&
        event.target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']")
      )
        return;
      if (event.shiftKey ? selectParent() : selectChild()) event.preventDefault();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  return {
    selectedId,
    onSelect,
    selected,
    selectedNodes,
    selectedAddresses,
    selection,
    setSelection: (address: SelectionAddress) => selectAddress(address),
    hoveredSelection,
    setHoveredSelection: updateHoveredSelection,
    selectionVisible,
    setSelectionVisible,
    selectionIsLocal,
    selectionIsPreviewGenerated,
    selectionIsPreviewDirect,
    selectionPreviewValueProvenance: previewSelection?.valueProvenance ?? [],
    selectionPreviewSource: previewSelection?.instance.effectiveLayoutSource,
    selectionUseSiteRootArtifactKey: previewUseSiteRoot?.artifactKey,
    selectionOwner,
    selectionNode,
    selectAddress,
    selectAddresses,
    selectChild,
    selectParent,
  };
}

interface ArtifactCanvasSessionOptions {
  readonly artifact: ArtifactDocument;
  readonly workspace: ArtifactWorkspaceState;
  readonly source: UiConcreteSource;
  readonly viewportIndex: number;
  readonly onViewport: (index: number) => void;
  readonly zoom: number;
  readonly onZoom: (zoom: number) => void;
  readonly onSelect: (id: string) => void;
  readonly onNotice: (notice: string) => void;
}

export function useArtifactCanvasSession({
  artifact,
  workspace,
  source,
  viewportIndex,
  onViewport,
  zoom,
  onZoom,
  onSelect,
  onNotice,
}: ArtifactCanvasSessionOptions) {
  const viewport = editorViewport(source, viewportIndex);
  const safeArea = editorSafeArea(source, viewportIndex);
  const zoomPolicy = editorZoomPolicy(source);
  const isCanvas = source.artifactType === "Canvas";
  const rectCapabilities = useMemo(() => rectTransformCapabilityMap(source), [source]);
  const viewportController = useArtifactCanvasViewport({ source, fallbackContentSize: viewport, zoom, zoomPolicy, onZoom });
  const [stateOverrides, setStateOverrides] = useState<Readonly<Record<string, string>>>({});

  useEffect(() => setStateOverrides({}), [source.artifactKey]);
  useEffect(() => {
    setStateOverrides((current) => reconcileArtifactStateOverrides(source, current));
  }, [source]);

  const applyAssetDrop = async (request: CanvasAssetDrop): Promise<void> => {
    if (request.kind === "replace") {
      updateWorkspaceNode(workspace, artifact.artifactKey, request.nodeId, (node) => {
        const image = node.components?.Image;
        return image ? { ...node, components: { ...node.components, Image: { ...image, sprite: request.assetPath } } } : node;
      });
      onSelect(request.nodeId);
      return;
    }
    if (artifact.source.sourceKind === "variant") {
      onNotice("Variant 不支持通过资源拖放修改结构");
      return;
    }
    onNotice("正在读取图片尺寸");
    try {
      const metrics = await loadImageMetrics(request.assetPath);
      let createdId = "";
      let createdName = "";
      workspace.commit((documents) => {
        const document = documents.get(artifact.artifactKey);
        if (!document || document.source.sourceKind !== "artifact") throw new Error(`Artifact '${artifact.artifactKey}' 不存在`);
        const result = createImageNode(document.source, {
          assetPath: request.assetPath,
          parentId: request.parentId,
          parentRect: request.parentRect,
          dropPoint: request.dropPoint,
          metrics,
        });
        createdId = result.nodeId;
        createdName = gameObjectNameById(result.source, result.nodeId);
        documents.set(artifact.artifactKey, { ...document, source: result.source });
      });
      if (createdId) onSelect(createdId);
      onNotice(`已添加 ${createdName || createdId}`);
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return {
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
  };
}
