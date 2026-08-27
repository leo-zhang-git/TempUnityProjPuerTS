import { useMemo } from "react";
import type { UiNodeClipboard } from "../../../kernel/node-clipboard.js";
import type { NodeDeletionPlan } from "../../../kernel/node-deletion.js";
import { findNode, walkNodes } from "../../../kernel/tree.js";
import type { AuthoringAssetEntry } from "../../../schema/asset-catalog.js";
import type { CaptureRequest } from "../../../schema/ui-capture.js";
import type { UiConcreteSource, UiNode, UiPropertyOverride, UiUseSiteComponentAddition } from "../../../schema/ui-source-schema.js";
import type { CaptureDialogOptions } from "../../capture/capture-dialog.js";
import type { SelectionAddress } from "../../rendering/selection.js";
import type { DocumentCatalog } from "../../shared/api/client.js";
import { resolveGameObjectPath } from "../../shared/game-object-label.js";
import type { ArtifactDocument, PrototypeDocument, ReferenceDocument } from "../../shared/types.js";
import type { PreviewEditorMode } from "../shared/preview-editor-mode.js";
import {
  type ArtifactExtractionDraft,
  type ArtifactIdentityDraft,
  type NodeCreateDraft,
  type NodeRenameDraft,
  prefabRefArtifactsFor,
  useArtifactCommandSession,
} from "./artifact-editor-command-session.js";
import { defaultPreviewCaptureTarget, defaultPreviewDocument } from "./artifact-editor-context-preview.js";
import { useArtifactInspectorSession } from "./artifact-editor-inspector-session.js";
import {
  useArtifactCanvasSession,
  useArtifactDialogSession,
  useArtifactPreviewResolutionSession,
  useArtifactSelectionSession,
  useArtifactViewSession,
} from "./artifact-editor-sessions.js";
import type { ArtifactWorkspaceState } from "./artifact-workspace-state.js";
import { createArtifactPreviewHierarchy } from "./hierarchy/preview-hierarchy.js";
import type { UiComponentClipboard } from "./inspector/component-clipboard.js";

export type { NodeCreateDraft } from "./artifact-editor-command-session.js";
export {
  explainArtifactIdentityDraftIssue,
  explainNodeCreateDraftIssue,
  validNodeCreateDraft,
} from "./artifact-editor-command-session.js";

export interface ArtifactEditorProps {
  readonly artifact: ArtifactDocument;
  readonly workspace: ArtifactWorkspaceState;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly savedReferences: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypes: ReadonlyMap<string, PrototypeDocument>;
  readonly catalog: DocumentCatalog;
  readonly assets: readonly AuthoringAssetEntry[];
  readonly onRefreshAssets: () => Promise<void>;
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
  readonly onOpenArtifact: (artifactKey: string, selectedId?: string) => void;
  readonly onOpenRelations: (artifactKey: string) => void;
  readonly onOpenDirectory: (path: string) => void;
  readonly onOpenReference: (referenceKey: string) => void;
  readonly onOpenPrototype: (prototypeKey: string, referenceKey?: string) => void;
  readonly onReferenceDraftChange: (referenceKey: string, reference: ReferenceDocument["reference"]) => void;
  readonly onPrototypeDraftChange: (prototypeKey: string, prototype: PrototypeDocument["prototype"]) => void;
  readonly onSave: () => Promise<boolean>;
  readonly onRevertSource: (artifactKey: string, path: string, expectedRevision: string) => Promise<void>;
  readonly nodeClipboard: UiNodeClipboard | null;
  readonly onCopyNode: (clipboard: UiNodeClipboard) => void;
  readonly componentClipboard: UiComponentClipboard | null;
  readonly onCopyComponent: (clipboard: UiComponentClipboard) => void;
  readonly viewportIndex: number;
  readonly onViewport: (index: number) => void;
  readonly zoom: number;
  readonly onZoom: (zoom: number) => void;
  readonly notice: string;
  readonly onNotice: (notice: string) => void;
  readonly displayMode: PreviewEditorMode;
  readonly onDisplayMode: (mode: PreviewEditorMode) => void;
}

export interface ArtifactEditorDialogsController {
  readonly catalog: DocumentCatalog;
  readonly captureOpen: boolean;
  readonly source: UiConcreteSource;
  readonly selected: UiNode;
  readonly selectedLabel: string;
  readonly captureRequest: (options: CaptureDialogOptions) => CaptureRequest;
  readonly setCaptureOpen: (open: boolean) => void;
  readonly nodeCreateDraft: NodeCreateDraft | null;
  readonly setNodeCreateDraft: (draft: NodeCreateDraft | null) => void;
  readonly submitCreateNode: () => void;
  readonly prefabRefArtifacts: readonly ArtifactDocument[];
  readonly renameDraft: NodeRenameDraft | null;
  readonly setRenameDraft: (draft: NodeRenameDraft | null) => void;
  readonly renameDraftIssue: string | null;
  readonly renameNodeIdPreview: string;
  readonly submitRenameNode: () => string | undefined;
  readonly deleteNodeIds: readonly string[] | null;
  readonly setDeleteNodeIds: (nodeIds: readonly string[] | null) => void;
  readonly confirmDeleteNodes: () => string | undefined;
  readonly deleteNodePlan: NodeDeletionPlan | null;
  readonly deleteNodePlanIssue: string | null;
  readonly deleteArtifactOpen: boolean;
  readonly setDeleteArtifactOpen: (open: boolean) => void;
  readonly confirmDeleteArtifact: () => string | undefined;
  readonly blockingMessage: string | null;
  readonly showBlockingMessage: (message: string) => void;
  readonly dismissBlockingMessage: () => void;
  readonly extractDraft: ArtifactExtractionDraft | null;
  readonly setExtractDraft: (draft: ArtifactExtractionDraft | null) => void;
  readonly submitExtractArtifact: () => string | undefined;
  readonly variantDraft: ArtifactIdentityDraft | null;
  readonly setVariantDraft: (draft: ArtifactIdentityDraft | null) => void;
  readonly submitCreateVariant: () => void;
}

export function useSiteOverrideSelectionAddress(
  rootArtifactKey: string,
  prefabRefNode: UiNode,
  target: UiPropertyOverride["target"] | UiUseSiteComponentAddition["target"],
  artifacts: ReadonlyMap<string, ArtifactDocument>,
): SelectionAddress | undefined {
  const initialOwnerArtifactKey = prefabRefNode.components?.PrefabRef?.artifactKey;
  if (!initialOwnerArtifactKey) return undefined;
  let ownerArtifactKey: string = initialOwnerArtifactKey;
  const nestedPath = target.instancePath ?? [];
  for (const prefabNodeId of nestedPath) {
    const owner: UiConcreteSource | undefined = artifacts.get(ownerArtifactKey)?.resolvedSource;
    const nextOwner: string | undefined = owner ? findNode(owner, prefabNodeId)?.components?.PrefabRef?.artifactKey : undefined;
    if (!nextOwner) return undefined;
    ownerArtifactKey = nextOwner;
  }
  return { rootArtifactKey, instancePath: [prefabRefNode.id, ...nestedPath], ownerArtifactKey, nodeId: target.nodeId };
}

export function captureOverlays(upserts: ArtifactWorkspaceState["transaction"]["upserts"]): NonNullable<CaptureRequest["overlays"]> {
  return upserts.map(({ path, source }) => ({ path, source }));
}

function assembleArtifactDialogsFacade(
  source: UiConcreteSource,
  selected: UiNode,
  selectedLabel: string,
  dialogSession: ReturnType<typeof useArtifactDialogSession>,
  dialogOperations: ReturnType<typeof useArtifactCommandSession>["dialogOperations"],
  captureRequest: (options: CaptureDialogOptions) => CaptureRequest,
  prefabRefArtifacts: readonly ArtifactDocument[],
  catalog: DocumentCatalog,
): ArtifactEditorDialogsController {
  return {
    ...dialogSession,
    ...dialogOperations,
    source,
    selected,
    selectedLabel,
    captureRequest,
    prefabRefArtifacts,
    catalog,
  };
}

function assembleArtifactCommandFacade(
  props: ArtifactEditorProps,
  commandOperations: ReturnType<typeof useArtifactCommandSession>["commandOperations"],
  inspectorSession: ReturnType<typeof useArtifactInspectorSession>,
) {
  const {
    artifact,
    workspace,
    artifacts,
    references,
    prototypes,
    catalog,
    assets,
    onRefreshAssets,
    onOpenArtifact,
    onOpenDirectory,
    onOpenReference,
    onOpenPrototype,
    onSave,
    nodeClipboard,
    onCopyNode,
  } = props;
  return {
    artifact,
    workspace,
    artifacts,
    references,
    prototypes,
    catalog,
    assets,
    onRefreshAssets,
    onOpenArtifact,
    onOpenDirectory,
    onOpenReference,
    onOpenPrototype,
    onSave,
    nodeClipboard,
    onCopyNode,
    copySelectedSummary: inspectorSession.copySelectedSummary,
    copyIdentity: inspectorSession.copyIdentity,
    ...commandOperations,
  };
}

function assembleArtifactViewFacade(
  props: ArtifactEditorProps,
  source: UiConcreteSource,
  viewSession: ReturnType<typeof useArtifactViewSession>,
) {
  return {
    source,
    nodeCount: walkNodes(source).length,
    notice: props.notice,
    onNotice: props.onNotice,
    displayMode: props.displayMode,
    onDisplayMode: props.onDisplayMode,
    ...viewSession,
  };
}

export function useArtifactEditorController(props: ArtifactEditorProps) {
  const {
    artifact,
    workspace,
    artifacts,
    references,
    prototypes,
    selectedId,
    onSelect,
    onOpenArtifact,
    onOpenDirectory,
    onSave,
    nodeClipboard,
    onCopyNode,
    componentClipboard,
    onCopyComponent,
    viewportIndex,
    onViewport,
    zoom,
    onZoom,
    onNotice,
    displayMode,
  } = props;
  const source = artifact.resolvedSource;
  const defaultPreview = useMemo(() => defaultPreviewDocument(references, artifact), [references, artifact]);
  const preview = useArtifactPreviewResolutionSession(source.artifactKey);
  const viewSession = useArtifactViewSession(artifacts, onOpenArtifact);
  const dialogSession = useArtifactDialogSession();
  const canvas = useArtifactCanvasSession({ artifact, workspace, source, viewportIndex, onViewport, zoom, onZoom, onSelect, onNotice });
  const previewHierarchy = useMemo(
    () => createArtifactPreviewHierarchy(source, artifacts, displayMode !== "unityBaseline", preview.resolved),
    [source, artifacts, displayMode, preview.resolved],
  );
  const selection = useArtifactSelectionSession({
    source,
    artifacts,
    previewHierarchy,
    selectedId,
    onSelect,
    displayMode,
    stateOverrides: canvas.stateOverrides,
    onShowHierarchy: () => viewSession.setSidebarView("hierarchy"),
    multiSelectEnabled: artifact.source.sourceKind === "artifact",
    onSelectionBlocked: onNotice,
  });
  const inspectorSession = useArtifactInspectorSession({
    artifact,
    workspace,
    source,
    selected: selection.selected,
    selectedNodes: selection.selectedNodes,
    selectionAddresses: selection.selectedAddresses,
    selectionAddress: selection.selection,
    selectionNode: selection.selectionNode,
    selectionIsPreviewGenerated: selection.selectionIsPreviewGenerated,
    selectionIsPreviewDirect: selection.selectionIsPreviewDirect,
    selectionUseSiteRootArtifactKey: selection.selectionUseSiteRootArtifactKey,
    artifacts,
    references,
    prototypes,
    componentClipboard,
    onCopyComponent,
    onNotice,
  });
  const commandSession = useArtifactCommandSession({
    artifact,
    workspace,
    source,
    selected: selection.selected,
    multipleSelected: selection.selectedNodes.length > 1,
    selectionIsLocal: selection.selectionIsLocal,
    selectedNodeIds: selection.selectedNodes.map((node) => node.id),
    artifacts,
    references,
    prototypes,
    nodeClipboard,
    onCopyNode,
    onSelect,
    onSelectNodes: (nodeIds) =>
      selection.selectAddresses(
        nodeIds.map((nodeId) => ({ rootArtifactKey: source.artifactKey, instancePath: [], ownerArtifactKey: source.artifactKey, nodeId })),
      ),
    onCanvasToolChange: viewSession.setCanvasTool,
    onNotice,
    onOpenArtifact,
    onOpenDirectory,
    onSave,
    rectCapabilities: canvas.rectCapabilities,
    ...dialogSession,
    setPendingOpenArtifactKey: viewSession.setPendingOpenArtifactKey,
    sourceEditingEnabled: displayMode !== "editPreview",
  });
  const captureRequest = (options: CaptureDialogOptions): CaptureRequest => {
    const contextTarget = defaultPreviewCaptureTarget(displayMode, options.selected, source, artifacts, defaultPreview, canvas.viewport);
    return {
      ...(contextTarget ?? { path: artifact.path, viewport: canvas.viewport }),
      overlays: captureOverlays(workspace.transaction.upserts),
      deletedPaths: workspace.transaction.deletes.map((entry) => entry.path),
      ...(workspace.dirty ? { draft: true } : {}),
      ...(options.selected ? { clip: { nodeId: selection.selected.id } } : {}),
      ...(displayMode !== "unityBaseline" && Object.keys(canvas.stateOverrides).length > 0
        ? { preview: { states: canvas.stateOverrides } }
        : {}),
      ...(displayMode === "unityBaseline" ? { displayMode: "unityBaseline" as const } : {}),
      ...(options.scale === 2 ? { scale: 2 } : {}),
      ...(options.background !== "transparent" ? { background: options.background } : {}),
      ...(options.includeDebug ? { includeDebug: true } : {}),
    };
  };

  return {
    selection,
    previewHierarchy,
    preview,
    canvas,
    dialogs: assembleArtifactDialogsFacade(
      source,
      selection.selected,
      resolveGameObjectPath(source, props.artifacts, selection.selection.instancePath, selection.selection.nodeId).namePath,
      dialogSession,
      commandSession.dialogOperations,
      captureRequest,
      prefabRefArtifactsFor(source, artifacts),
      props.catalog,
    ),
    inspector: inspectorSession.facade,
    commands: assembleArtifactCommandFacade(props, commandSession.commandOperations, inspectorSession),
    view: assembleArtifactViewFacade(props, source, viewSession),
  };
}
