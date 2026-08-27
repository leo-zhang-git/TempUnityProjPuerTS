import { type Dispatch, type SetStateAction, useEffect } from "react";
import type { UiNodeClipboard } from "../../../kernel/node-clipboard.js";
import type { UiConcreteSource, UiNode } from "../../../schema/ui-source-schema.js";
import type { ArtifactDocument, PrototypeDocument, ReferenceDocument } from "../../shared/types.js";
import { sameValue, updateWorkspaceNode } from "./artifact-editor-commands.js";
import type { ArtifactWorkspaceState } from "./artifact-workspace-state.js";
import type { CanvasAuthoringTool } from "./canvas/node-authoring.js";
import type { RectTransformCapabilities } from "./canvas/rect-transform-authoring.js";
import { moveRect } from "./canvas/rect-transform-authoring.js";
import {
  type ArtifactExtractionDraft,
  type ArtifactIdentityDraft,
  useArtifactIdentityCommands,
} from "./commands/artifact-identity-commands.js";
import {
  createNodeDraft,
  createNodeRenameDraft,
  type NodeCreateDraft,
  type NodeRenameDraft,
  useArtifactStructureCommands,
} from "./commands/structure-commands.js";
import { useUnityDeliverySession } from "./commands/unity-delivery-session.js";
import { resolveEditorKeyboardCommand } from "./keyboard-commands.js";

export type { ArtifactExtractionDraft, ArtifactIdentityDraft } from "./commands/artifact-identity-commands.js";
export { explainArtifactIdentityDraftIssue } from "./commands/artifact-identity-commands.js";
export type { NodeCreateDraft, NodeRenameDraft } from "./commands/structure-commands.js";
export {
  createNodeDraft,
  createNodeRenameDraft,
  explainNodeCreateDraftIssue,
  prefabRefArtifactsFor,
  validNodeCreateDraft,
} from "./commands/structure-commands.js";

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest("input, textarea, [contenteditable='true'], [contenteditable='']") !== null;
}

interface ArtifactCommandSessionOptions {
  readonly artifact: ArtifactDocument;
  readonly workspace: ArtifactWorkspaceState;
  readonly source: UiConcreteSource;
  readonly selected: UiNode;
  readonly multipleSelected: boolean;
  readonly selectionIsLocal: boolean;
  readonly selectedNodeIds: readonly string[];
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypes: ReadonlyMap<string, PrototypeDocument>;
  readonly nodeClipboard: UiNodeClipboard | null;
  readonly onCopyNode: (clipboard: UiNodeClipboard) => void;
  readonly onSelect: (id: string) => void;
  readonly onSelectNodes: (ids: readonly string[]) => void;
  readonly onCanvasToolChange: (tool: CanvasAuthoringTool) => void;
  readonly onNotice: (notice: string) => void;
  readonly onOpenArtifact: (artifactKey: string, selectedId?: string) => void;
  readonly onOpenDirectory: (path: string) => void;
  readonly onSave: () => Promise<boolean>;
  readonly rectCapabilities: ReadonlyMap<string, RectTransformCapabilities>;
  readonly nodeCreateDraft: NodeCreateDraft | null;
  readonly setNodeCreateDraft: Dispatch<SetStateAction<NodeCreateDraft | null>>;
  readonly renameDraft: NodeRenameDraft | null;
  readonly setRenameDraft: Dispatch<SetStateAction<NodeRenameDraft | null>>;
  readonly deleteNodeIds: readonly string[] | null;
  readonly setDeleteNodeIds: Dispatch<SetStateAction<readonly string[] | null>>;
  readonly setDeleteArtifactOpen: Dispatch<SetStateAction<boolean>>;
  readonly extractDraft: ArtifactExtractionDraft | null;
  readonly setExtractDraft: Dispatch<SetStateAction<ArtifactExtractionDraft | null>>;
  readonly variantDraft: ArtifactIdentityDraft | null;
  readonly setVariantDraft: Dispatch<SetStateAction<ArtifactIdentityDraft | null>>;
  readonly setPendingOpenArtifactKey: Dispatch<SetStateAction<string | null>>;
  readonly sourceEditingEnabled: boolean;
}

export function useArtifactCommandSession(options: ArtifactCommandSessionOptions) {
  const {
    artifact,
    workspace,
    source,
    selected,
    multipleSelected,
    selectionIsLocal,
    selectedNodeIds,
    artifacts,
    references,
    prototypes,
    nodeClipboard,
    onCopyNode,
    onSelect,
    onSelectNodes,
    onCanvasToolChange,
    onNotice,
    onOpenArtifact,
    onOpenDirectory,
    onSave,
    rectCapabilities,
    nodeCreateDraft,
    setNodeCreateDraft,
    renameDraft,
    setRenameDraft,
    deleteNodeIds,
    setDeleteNodeIds,
    setDeleteArtifactOpen,
    extractDraft,
    setExtractDraft,
    variantDraft,
    setVariantDraft,
    setPendingOpenArtifactKey,
    sourceEditingEnabled,
  } = options;

  const structureCommands = useArtifactStructureCommands({
    artifact,
    workspace,
    source,
    selected,
    multipleSelected,
    selectionIsLocal,
    selectedNodeIds,
    artifacts,
    references,
    prototypes,
    nodeClipboard,
    onCopyNode,
    onSelect,
    onSelectNodes,
    onNotice,
    nodeCreateDraft,
    setNodeCreateDraft,
    renameDraft,
    setRenameDraft,
    deleteNodeIds,
    setDeleteNodeIds,
  });
  const {
    copySelectedNode,
    pasteClipboardNode,
    duplicateSelectedNodes,
    cutSelectedNode,
    confirmDeleteNodes,
    deleteNodePlan,
    deleteNodePlanIssue,
    renameDraftIssue,
    renameNodeIdPreview,
    submitRenameNode,
    previewNodeDisplayName,
    renameNodeDisplayName,
    submitCreateNode,
    createCanvasNode,
    createProjectItem,
    createTemplateNode,
    restoreSelectedScrollbars,
    unpackSelectedPrefab,
    moveNodeInHierarchy,
  } = structureCommands;
  const unityDelivery = useUnityDeliverySession({ artifact, source, workspace, references, prototypes, onSave, onNotice });
  const openArtifact = (artifactKey: string, nextSelectedId?: string): void => onOpenArtifact(artifactKey, nextSelectedId);
  const identityCommands = useArtifactIdentityCommands({
    artifact,
    workspace,
    source,
    selected,
    selectionIsLocal,
    multipleSelected,
    artifacts,
    references,
    prototypes,
    onSelect,
    onOpenDirectory,
    onNotice,
    setDeleteArtifactOpen,
    extractDraft,
    setExtractDraft,
    variantDraft,
    setVariantDraft,
    setPendingOpenArtifactKey,
  });
  const {
    confirmDeleteArtifact,
    canExtractWidget,
    canExtractFragment,
    openExtractWidget,
    openExtractFragment,
    submitExtractArtifact,
    openCreateVariant,
    submitCreateVariant,
  } = identityCommands;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!sourceEditingEnabled) return;
      const textEditing = isTextEditingTarget(event.target);
      if (
        selectionIsLocal &&
        !multipleSelected &&
        !textEditing &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        const step = event.shiftKey ? 10 : 1;
        const delta: [number, number] =
          event.key === "ArrowLeft"
            ? [-step, 0]
            : event.key === "ArrowRight"
              ? [step, 0]
              : event.key === "ArrowUp"
                ? [0, -step]
                : [0, step];
        const capabilities = rectCapabilities.get(selected.id);
        if (capabilities) {
          const next = moveRect(selected, delta, capabilities);
          if (!sameValue(next.rect.anchoredPosition, selected.rect.anchoredPosition)) {
            updateWorkspaceNode(workspace, artifact.artifactKey, selected.id, () => next);
            event.preventDefault();
            return;
          }
        }
      }
      const command = resolveEditorKeyboardCommand(event, textEditing, (window.getSelection()?.toString().length ?? 0) > 0);
      if (!command) return;
      let handled = false;
      if (command === "selectTool") {
        onCanvasToolChange("select");
        handled = true;
      } else if (
        (command === "rectTool" || command === "textTool") &&
        selectionIsLocal &&
        !multipleSelected &&
        artifact.source.sourceKind === "artifact"
      ) {
        onCanvasToolChange(command === "rectTool" ? "rect" : "text");
        handled = true;
      } else if (command === "copy") handled = copySelectedNode();
      else if (command === "cut") handled = cutSelectedNode();
      else if (command === "paste" && !multipleSelected) handled = pasteClipboardNode();
      else if (command === "duplicate") handled = duplicateSelectedNodes();
      else if (
        command === "rename" &&
        selectionIsLocal &&
        !multipleSelected &&
        artifact.source.sourceKind === "artifact" &&
        selected.id !== source.root.id
      ) {
        setRenameDraft(createNodeRenameDraft(selected));
        handled = true;
      } else if (command === "createEmpty" && selectionIsLocal && !multipleSelected && artifact.source.sourceKind === "artifact") {
        setNodeCreateDraft(createNodeDraft(source, "Node"));
        handled = true;
      } else if (
        command === "delete" &&
        selectionIsLocal &&
        selectedNodeIds.length > 0 &&
        artifact.source.sourceKind === "artifact" &&
        !selectedNodeIds.includes(source.root.id)
      ) {
        setDeleteNodeIds(selectedNodeIds);
        handled = true;
      } else if (command === "redo" && workspace.canRedo) {
        workspace.redo();
        handled = true;
      } else if (command === "undo" && workspace.canUndo) {
        workspace.undo();
        handled = true;
      } else if (command === "save" && workspace.dirty) {
        void onSave();
        handled = true;
      }
      if (handled) event.preventDefault();
      else {
        const reason =
          command === "rename" || command === "delete" || command === "cut" || command === "duplicate"
            ? !selectionIsLocal
              ? "继承节点不能重命名、删除或移动"
              : artifact.source.sourceKind === "variant"
                ? "Variant 不支持结构修改"
                : "当前选择不能执行该操作"
            : command === "paste" || command === "createEmpty" || command === "rectTool" || command === "textTool"
              ? !selectionIsLocal
                ? "继承节点不能修改结构；组件和字段请在 Inspector 中覆写"
                : "当前选择不能执行该操作"
              : command === "undo"
                ? "没有可撤销的修改"
                : command === "redo"
                  ? "没有可重做的修改"
                  : command === "save"
                    ? "当前没有待保存修改"
                    : undefined;
        if (reason) {
          onNotice(reason);
          event.preventDefault();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    sourceEditingEnabled,
    source,
    selected,
    multipleSelected,
    selectionIsLocal,
    selectedNodeIds,
    rectCapabilities,
    nodeClipboard,
    workspace.canUndo,
    workspace.canRedo,
    workspace.dirty,
    workspace.undo,
    workspace.redo,
    workspace.commit,
    workspace.documents,
    onSave,
    onCopyNode,
    onSelect,
    onSelectNodes,
    onCanvasToolChange,
    onNotice,
    artifact.artifactKey,
    artifact.source.sourceKind,
  ]);

  return {
    commandOperations: {
      ...unityDelivery,
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
    dialogOperations: {
      confirmDeleteNodes,
      deleteNodePlan,
      deleteNodePlanIssue,
      renameDraftIssue,
      renameNodeIdPreview,
      submitRenameNode,
      submitCreateNode,
      confirmDeleteArtifact,
      submitExtractArtifact,
      submitCreateVariant,
    },
  };
}
