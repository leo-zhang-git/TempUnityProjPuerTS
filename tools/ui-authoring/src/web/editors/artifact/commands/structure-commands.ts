import { type Dispatch, type SetStateAction, useMemo } from "react";
import { artifactInitialSize } from "../../../../kernel/artifact-size.js";
import {
  applyAuthoringStructureOperation,
  createEmptyNode,
  createImageNode,
  createPrefabRefNode,
  createTextNode,
} from "../../../../kernel/authoring.js";
import { authoringTemplate, materializeAuthoringTemplate, restoreAuthoringScrollbars } from "../../../../kernel/authoring-templates.js";
import { measureUnityImage } from "../../../../kernel/image-intrinsic.js";
import { effectiveNodeIdMode, explainChildNodeIdIssue, unityNodeName } from "../../../../kernel/naming.js";
import {
  copyNodeSubtrees,
  cutNodeSubtrees,
  duplicateNodeSubtrees,
  pasteNodeSubtrees,
  type UiNodeClipboard,
} from "../../../../kernel/node-clipboard.js";
import { type NodeDeletionPlan, planNodeDeletion } from "../../../../kernel/node-deletion.js";
import { type NodeIdentityRefactorPlan, planRenameNode } from "../../../../kernel/node-identity-refactor.js";
import { findNode, outermostNodeIds, walkNodes } from "../../../../kernel/tree.js";
import { unpackPrefab } from "../../../../kernel/unpack-prefab.js";
import type { UiConcreteSource, UiNode } from "../../../../schema/ui-source-schema.js";
import { loadImageMetrics } from "../../../shared/api/client.js";
import { gameObjectName, gameObjectNameById } from "../../../shared/game-object-label.js";
import type { ProjectDragItem } from "../../../shared/project-drag.js";
import type { ArtifactDocument, PrototypeDocument, ReferenceDocument } from "../../../shared/types.js";
import type { HierarchyDropPosition } from "../../shared/editor-hierarchy.js";
import { validateWorkspaceDocuments } from "../artifact-documents.js";
import type { ArtifactWorkspaceState } from "../artifact-workspace-state.js";
import { type CanvasNodeCreateRequest, imageNodeBaseId, uniqueNodeId } from "../canvas/node-authoring.js";
import { moveHierarchyNodes } from "../hierarchy/hierarchy-authoring.js";
import { nodeIdentityCommitForPlans } from "../node-identity-save.js";

export interface NodeCreateDraft {
  readonly id: string;
  readonly kind: "Node" | "Image" | "Text" | "PrefabRef";
  readonly artifactKey: string;
  readonly width: number;
  readonly height: number;
  readonly anchoredPosition?: readonly [number, number] | undefined;
}

export interface NodeRenameDraft {
  readonly displayName: string;
  readonly manualNodeId: string | null;
}

interface InlineNodeRenamePreview {
  readonly nodeId: string;
  readonly issue: string | undefined;
}

export function createNodeRenameDraft(node: UiNode): NodeRenameDraft {
  return {
    displayName: unityNodeName(node),
    manualNodeId: effectiveNodeIdMode(node) === "manual" ? node.id : null,
  };
}
export function createNodeDraft(
  source: UiConcreteSource,
  kind: NodeCreateDraft["kind"],
  artifactKey = "",
  anchoredPosition?: readonly [number, number],
): NodeCreateDraft {
  const id = uniqueNodeId(source, kind === "Node" ? "newNode" : kind === "PrefabRef" ? "prefab" : kind.toLowerCase());
  return {
    id,
    kind,
    artifactKey,
    width: kind === "Text" ? 200 : 100,
    height: kind === "Text" ? 40 : 100,
    ...(anchoredPosition ? { anchoredPosition: [anchoredPosition[0], anchoredPosition[1]] } : {}),
  };
}

export function explainNodeCreateDraftIssue(draft: NodeCreateDraft, source?: UiConcreteSource): string | undefined {
  const id = draft.id.trim();
  const identityIssue = explainChildNodeIdIssue(id);
  if (identityIssue) return identityIssue;
  if (source && findNode(source, id)) return `Node ID '${id}' 已存在`;
  if (!Number.isFinite(draft.width)) return "宽度必须是有效数字";
  if (draft.width < 0) return "宽度不能小于 0";
  if (!Number.isFinite(draft.height)) return "高度必须是有效数字";
  if (draft.height < 0) return "高度不能小于 0";
  if (draft.kind === "PrefabRef" && !/^[A-Z][A-Za-z0-9]*$/.test(draft.artifactKey.trim())) return "PrefabRef 必须选择有效的 Artifact";
  return undefined;
}

export function validNodeCreateDraft(draft: NodeCreateDraft): boolean {
  return explainNodeCreateDraftIssue(draft) === undefined;
}

export function prefabRefArtifactsFor(
  source: UiConcreteSource,
  artifacts: ReadonlyMap<string, ArtifactDocument>,
): readonly ArtifactDocument[] {
  return [...artifacts.values()].filter((entry) => {
    if (entry.artifactKey === source.artifactKey || entry.artifactType === "Canvas") return false;
    if (source.artifactType === "Fragment") return entry.artifactType === "Fragment";
    return entry.artifactType === "Widget" || entry.artifactType === "Fragment";
  });
}

interface ArtifactStructureCommandsOptions {
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
  readonly onNotice: (notice: string) => void;
  readonly nodeCreateDraft: NodeCreateDraft | null;
  readonly setNodeCreateDraft: Dispatch<SetStateAction<NodeCreateDraft | null>>;
  readonly renameDraft: NodeRenameDraft | null;
  readonly setRenameDraft: Dispatch<SetStateAction<NodeRenameDraft | null>>;
  readonly deleteNodeIds: readonly string[] | null;
  readonly setDeleteNodeIds: Dispatch<SetStateAction<readonly string[] | null>>;
}

export function useArtifactStructureCommands(options: ArtifactStructureCommandsOptions) {
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
    onNotice,
    nodeCreateDraft,
    setNodeCreateDraft,
    renameDraft,
    setRenameDraft,
    deleteNodeIds,
    setDeleteNodeIds,
  } = options;

  const createRenamePlan = (nodeId: string, draft: NodeRenameDraft): NodeIdentityRefactorPlan =>
    planRenameNode(
      {
        artifacts: [...workspace.documents.values()].map((document) => ({ path: document.path, source: document.source })),
        references: [...references.values()].map((document) => ({ path: document.path, reference: document.reference })),
        prototypes: [...prototypes.values()].map((document) => ({ path: document.path, prototype: document.prototype })),
      },
      artifact.artifactKey,
      nodeId,
      {
        displayName: draft.displayName.trim(),
        identity: draft.manualNodeId === null ? { kind: "auto" } : { kind: "manual", nodeId: draft.manualNodeId.trim() },
      },
    );

  const deleteNodePlanState = useMemo<{ readonly plan: NodeDeletionPlan | null; readonly issue: string | null }>(() => {
    if (!deleteNodeIds || deleteNodeIds.length === 0 || artifact.source.sourceKind === "variant") return { plan: null, issue: null };
    try {
      return {
        plan: planNodeDeletion(
          {
            artifacts: [...workspace.documents.values()].map((document) => ({ path: document.path, source: document.source })),
            references: [...references.values()].map((document) => ({ path: document.path, reference: document.reference })),
            prototypes: [...prototypes.values()].map((document) => ({ path: document.path, prototype: document.prototype })),
          },
          artifact.artifactKey,
          deleteNodeIds,
        ),
        issue: null,
      };
    } catch (reason) {
      return { plan: null, issue: reason instanceof Error ? reason.message : String(reason) };
    }
  }, [artifact.artifactKey, artifact.source.sourceKind, deleteNodeIds, prototypes, references, workspace.revision.version]);
  const renamePlanState = useMemo<{ readonly plan: NodeIdentityRefactorPlan | null; readonly issue: string | null }>(() => {
    if (!renameDraft) return { plan: null, issue: null };
    try {
      const plan = createRenamePlan(selected.id, renameDraft);
      return { plan, issue: plan.preview.blockers[0] ?? null };
    } catch (reason) {
      return { plan: null, issue: reason instanceof Error ? reason.message : String(reason) };
    }
  }, [artifact.artifactKey, prototypes, references, renameDraft, selected.id, workspace.revision.version]);
  const copySelectedNode = (): boolean => {
    if (!selectionIsLocal) {
      onNotice("继承节点不能复制为本地结构；请打开所属 Artifact");
      return false;
    }
    try {
      const clipboard = copyNodeSubtrees(source, selectedNodeIds);
      onCopyNode(clipboard);
      onNotice(clipboard.roots.length === 1 ? `已复制 ${gameObjectName(clipboard.roots[0]!)}` : `已复制 ${clipboard.roots.length} 个节点`);
      return true;
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  };

  const pasteClipboardNode = (): boolean => {
    if (!selectionIsLocal) {
      onNotice("继承节点不能接收本地子节点；请选中 PrefabRef 使用位置节点");
      return false;
    }
    if (!nodeClipboard) {
      onNotice("节点剪贴板为空");
      return false;
    }
    if (artifact.source.sourceKind === "variant") {
      onNotice("Variant 不支持结构修改");
      return false;
    }
    try {
      const document = workspace.documents.get(artifact.artifactKey);
      if (!document || document.source.sourceKind !== "artifact") throw new Error(`Artifact '${artifact.artifactKey}' 不存在`);
      const pasted = pasteNodeSubtrees(document.source, selected.id, nodeClipboard);
      const nextSource = pasted.source;
      const candidate = new Map(workspace.documents);
      candidate.set(artifact.artifactKey, { ...document, source: nextSource });
      validateWorkspaceDocuments(candidate, references, prototypes);
      workspace.commit((documents) => documents.set(artifact.artifactKey, { ...document, source: nextSource }));
      onSelectNodes(pasted.rootIds);
      onNotice(
        pasted.rootIds.length === 1
          ? `已粘贴 ${gameObjectNameById(nextSource, pasted.rootIds[0]!)}`
          : `已粘贴 ${pasted.rootIds.length} 个节点`,
      );
      return true;
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  };

  const duplicateSelectedNodes = (): boolean => {
    if (
      !selectionIsLocal ||
      artifact.source.sourceKind === "variant" ||
      selectedNodeIds.length === 0 ||
      selectedNodeIds.includes(source.root.id)
    ) {
      onNotice(
        !selectionIsLocal
          ? "继承节点不能复制结构"
          : artifact.source.sourceKind === "variant"
            ? "Variant 不支持结构修改"
            : "Artifact 根节点不能复制",
      );
      return false;
    }
    try {
      const document = workspace.documents.get(artifact.artifactKey);
      if (!document || document.source.sourceKind !== "artifact") throw new Error(`Artifact '${artifact.artifactKey}' 不存在`);
      const duplicated = duplicateNodeSubtrees(document.source, selectedNodeIds);
      const nextSource = duplicated.source;
      const candidate = new Map(workspace.documents);
      candidate.set(artifact.artifactKey, { ...document, source: nextSource });
      validateWorkspaceDocuments(candidate, references, prototypes);
      workspace.commit((documents) => documents.set(artifact.artifactKey, { ...document, source: nextSource }));
      onSelectNodes(duplicated.rootIds);
      onNotice(
        duplicated.rootIds.length === 1
          ? `已创建副本 ${gameObjectNameById(nextSource, duplicated.rootIds[0]!)}`
          : `已创建 ${duplicated.rootIds.length} 个节点副本`,
      );
      return true;
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  };

  const cutSelectedNode = (): boolean => {
    if (!selectionIsLocal || artifact.source.sourceKind === "variant" || selected.id === source.root.id) {
      onNotice(
        !selectionIsLocal
          ? "继承节点不能剪切"
          : artifact.source.sourceKind === "variant"
            ? "Variant 不支持结构修改"
            : "Artifact 根节点不能剪切",
      );
      return false;
    }
    try {
      const rootIds = outermostNodeIds(source, selectedNodeIds);
      const firstParentId = walkNodes(source).find((entry) => entry.node.id === rootIds[0])?.parent?.id ?? source.root.id;
      const document = workspace.documents.get(artifact.artifactKey);
      if (!document || document.source.sourceKind !== "artifact") throw new Error(`Artifact '${artifact.artifactKey}' 不存在`);
      const cut = cutNodeSubtrees(document.source, rootIds);
      const candidate = new Map(workspace.documents);
      candidate.set(artifact.artifactKey, { ...document, source: cut.source });
      validateWorkspaceDocuments(candidate, references, prototypes);
      workspace.commit((documents) => documents.set(artifact.artifactKey, { ...document, source: cut.source }));
      onCopyNode(cut.clipboard);
      onSelect(findNode(cut.source, firstParentId)?.id ?? cut.source.root.id);
      onNotice(
        cut.clipboard.roots.length === 1
          ? `已剪切 ${gameObjectName(cut.clipboard.roots[0]!)}`
          : `已剪切 ${cut.clipboard.roots.length} 个节点`,
      );
      return true;
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  };

  const confirmDeleteNodes = (): string | undefined => {
    if (!deleteNodeIds || deleteNodeIds.length === 0 || artifact.source.sourceKind === "variant") return undefined;
    try {
      const plan = deleteNodePlanState.plan;
      if (!plan) throw new Error(deleteNodePlanState.issue ?? "删除计划不可用");
      if (plan.blockers.length > 0)
        throw new Error(plan.blockers.map((impact) => `${impact.documentPath}${impact.fieldPath}: ${impact.summary}`).join("\n"));
      if (!plan.result) throw new Error("删除计划没有生成可提交结果");
      const nextArtifacts = new Map(plan.result.artifacts.map((entry) => [entry.source.artifactKey, entry]));
      workspace.commitWorkspace((documents) => {
        for (const [artifactKey, next] of nextArtifacts) {
          const current = documents.artifacts.get(artifactKey);
          if (!current) throw new Error(`Artifact '${artifactKey}' 不存在`);
          documents.artifacts.set(artifactKey, { ...current, path: next.path, source: next.source });
        }
        for (const entry of plan.result!.references) {
          const current = documents.references.get(entry.reference.referenceKey);
          if (current)
            documents.references.set(entry.reference.referenceKey, {
              ...current,
              reference: entry.reference,
              subjectArtifactKey: entry.reference.subjectArtifactKey,
            });
        }
        for (const entry of plan.result!.prototypes) {
          const current = documents.prototypes.get(entry.prototype.prototypeKey);
          if (current)
            documents.prototypes.set(entry.prototype.prototypeKey, {
              ...current,
              prototype: entry.prototype,
              startReferenceKey: entry.prototype.startReferenceKey,
              interactionCount: entry.prototype.interactions.length,
            });
        }
      });
      const nextSource = nextArtifacts.get(artifact.artifactKey)?.source;
      if (!nextSource || nextSource.sourceKind !== "artifact") throw new Error(`删除后找不到 Artifact '${artifact.artifactKey}'`);
      onSelect(nextSource.root.id);
      setDeleteNodeIds(null);
      const cleanupCount = plan.impacts.filter(
        (impact) => impact.action === "remove" || impact.action === "clear" || impact.action === "repair",
      ).length;
      const repairCount = plan.impacts.filter((impact) => impact.action === "repair").length;
      const dependentCount = plan.impacts.filter((impact) => impact.action === "republish").length;
      onNotice(
        `已删除 ${plan.selectedNodeIds.length} 个节点；清理 ${cleanupCount} 处 Reference${repairCount > 0 ? `；${repairCount} 处必需 Reference 需要修复后才能保存` : ""}${dependentCount > 0 ? `；${dependentCount} 个依赖项需要重新发布` : ""}`,
      );
      return undefined;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      onNotice(message);
      return message;
    }
  };

  const commitRenamePlan = (
    plan: NodeIdentityRefactorPlan,
    beforeNode: UiNode,
    displayName: string,
    closeDialog: boolean,
  ): string | undefined => {
    try {
      if (plan.preview.blockers.length > 0) throw new Error(plan.preview.blockers.join("\n"));
      if (!plan.result) throw new Error("重命名计划未生成候选工作区");
      workspace.commitWorkspace(
        (documents) => {
          for (const entry of plan.result!.artifacts) {
            const current = documents.artifacts.get(entry.source.artifactKey);
            if (current) documents.artifacts.set(entry.source.artifactKey, { ...current, path: entry.path, source: entry.source });
          }
          for (const entry of plan.result!.references) {
            const current = documents.references.get(entry.reference.referenceKey);
            if (current) {
              documents.references.set(entry.reference.referenceKey, {
                ...current,
                reference: entry.reference,
                subjectArtifactKey: entry.reference.subjectArtifactKey,
              });
            }
          }
          for (const entry of plan.result!.prototypes) {
            const current = documents.prototypes.get(entry.prototype.prototypeKey);
            if (current) {
              documents.prototypes.set(entry.prototype.prototypeKey, {
                ...current,
                prototype: entry.prototype,
                startReferenceKey: entry.prototype.startReferenceKey,
                interactionCount: entry.prototype.interactions.length,
              });
            }
          }
        },
        nodeIdentityCommitForPlans([plan]),
      );
      const change = plan.preview.changes[0];
      if (!change) throw new Error("重命名计划中没有节点改动");
      onSelect(change.afterNodeId);
      if (closeDialog) setRenameDraft(null);
      onNotice(
        `已将 ${gameObjectName(beforeNode)} 重命名为 ${displayName}${change.beforeNodeId === change.afterNodeId ? "" : `（${change.beforeNodeId} -> ${change.afterNodeId}）`}`,
      );
      return undefined;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      onNotice(message);
      return message;
    }
  };

  const submitRenameNode = (): string | undefined => {
    if (renameDraft === null) return undefined;
    if (artifact.source.sourceKind === "variant") return "Variant 不支持结构修改";
    const plan = renamePlanState.plan;
    if (!plan) return renamePlanState.issue ?? "重命名计划不可用";
    return commitRenamePlan(plan, selected, renameDraft.displayName.trim(), true);
  };

  const previewNodeDisplayName = (nodeId: string, displayName: string): InlineNodeRenamePreview => {
    const node = findNode(source, nodeId);
    if (!node) return { nodeId, issue: `Artifact '${source.artifactKey}' 中不存在 Node '${nodeId}'` };
    try {
      const plan = createRenamePlan(nodeId, { ...createNodeRenameDraft(node), displayName });
      return {
        nodeId: plan.preview.changes[0]?.afterNodeId ?? nodeId,
        issue: plan.preview.blockers[0],
      };
    } catch (reason) {
      return { nodeId, issue: reason instanceof Error ? reason.message : String(reason) };
    }
  };

  const renameNodeDisplayName = (nodeId: string, displayName: string): string | undefined => {
    if (artifact.source.sourceKind === "variant") return "Variant 不支持结构修改";
    const node = findNode(source, nodeId);
    if (!node) return `Artifact '${source.artifactKey}' 中不存在 Node '${nodeId}'`;
    try {
      const trimmed = displayName.trim();
      return commitRenamePlan(createRenamePlan(nodeId, { ...createNodeRenameDraft(node), displayName: trimmed }), node, trimmed, false);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      onNotice(message);
      return message;
    }
  };

  const commitCreatedNode = (parentId: string, node: UiNode): string => {
    const document = workspace.documents.get(artifact.artifactKey);
    if (!document || document.source.sourceKind !== "artifact") throw new Error(`Artifact '${artifact.artifactKey}' 不存在`);
    const parent = findNode(document.source, parentId);
    if (!parent) throw new Error(`Artifact '${artifact.artifactKey}' 中不存在父节点 '${parentId}'`);
    const created = applyAuthoringStructureOperation(document.source, { kind: "insert", parentId, node });
    const candidate = new Map(workspace.documents);
    candidate.set(artifact.artifactKey, { ...document, source: created.source });
    validateWorkspaceDocuments(candidate, references, prototypes);
    workspace.commit((documents) => documents.set(artifact.artifactKey, { ...document, source: created.source }));
    onSelect(created.selectedNodeId);
    return created.selectedNodeId;
  };

  const submitCreateNode = (): string | undefined => {
    if (!nodeCreateDraft) return "当前没有待创建的节点";
    if (artifact.source.sourceKind === "variant") return "Variant 不支持结构修改";
    const draftIssue = explainNodeCreateDraftIssue(nodeCreateDraft, source);
    if (draftIssue) return draftIssue;
    try {
      const id = nodeCreateDraft.id.trim();
      const size: [number, number] = [nodeCreateDraft.width, nodeCreateDraft.height];
      const createdNode =
        nodeCreateDraft.kind === "PrefabRef"
          ? createPrefabRefNode(id, nodeCreateDraft.artifactKey.trim(), size)
          : nodeCreateDraft.kind === "Image"
            ? createImageNode(id, size)
            : nodeCreateDraft.kind === "Text"
              ? createTextNode(id, size)
              : createEmptyNode(id, size);
      const node: UiNode = nodeCreateDraft.anchoredPosition
        ? {
            ...createdNode,
            rect: {
              ...createdNode.rect,
              anchoredPosition: [nodeCreateDraft.anchoredPosition[0], nodeCreateDraft.anchoredPosition[1]] as [number, number],
            },
          }
        : createdNode;
      commitCreatedNode(selected.id, node);
      setNodeCreateDraft(null);
      onNotice(`已创建 ${gameObjectName(createdNode)}`);
      return undefined;
    } catch (reason) {
      return reason instanceof Error ? reason.message : String(reason);
    }
  };

  const createCanvasNode = (request: CanvasNodeCreateRequest): string | undefined => {
    if (artifact.source.sourceKind === "variant") {
      onNotice("Variant 不支持结构修改");
      return undefined;
    }
    try {
      const document = workspace.documents.get(artifact.artifactKey);
      if (!document || document.source.sourceKind !== "artifact") throw new Error(`Artifact '${artifact.artifactKey}' 不存在`);
      const id = uniqueNodeId(document.source, request.kind === "Text" ? "text" : "image");
      const createdNode = request.kind === "Text" ? createTextNode(id, request.size) : createImageNode(id, request.size);
      const node: UiNode = {
        ...createdNode,
        rect: { ...createdNode.rect, anchoredPosition: [request.anchoredPosition[0], request.anchoredPosition[1]] },
      };
      const createdId = commitCreatedNode(request.parentId, node);
      onNotice(`已创建 ${gameObjectName(node)}`);
      return createdId;
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
      return undefined;
    }
  };

  const createProjectItem = async (
    parentId: string,
    item: ProjectDragItem,
    anchoredPosition?: readonly [number, number],
  ): Promise<void> => {
    if (artifact.source.sourceKind === "variant") {
      onNotice("Variant 不支持结构修改");
      return;
    }
    try {
      const document = workspace.documents.get(artifact.artifactKey);
      if (!document || document.source.sourceKind !== "artifact") throw new Error(`Artifact '${artifact.artifactKey}' 不存在`);
      let node: UiNode;
      if (item.kind === "artifact") {
        const referenced = artifacts.get(item.artifactKey);
        if (!referenced || referenced.resolvedSource.artifactType === "Canvas") throw new Error("该 Artifact 不能创建为 PrefabRef");
        if (document.source.artifactType === "Fragment" && referenced.resolvedSource.artifactType !== "Fragment")
          throw new Error("Fragment 只能引用 Fragment");
        const id = uniqueNodeId(document.source, item.artifactKey[0]?.toLowerCase() + item.artifactKey.slice(1));
        const created = createPrefabRefNode(id, item.artifactKey, artifactInitialSize(referenced.resolvedSource));
        node = anchoredPosition
          ? { ...created, rect: { ...created.rect, anchoredPosition: [anchoredPosition[0], anchoredPosition[1]] } }
          : created;
      } else if (item.kind === "asset" && item.assetKind === "image") {
        const id = uniqueNodeId(document.source, imageNodeBaseId(item.path));
        const provisional = createImageNode(id, [1, 1]);
        node = { ...provisional, components: { Image: { sprite: item.path } } };
        const metrics = await loadImageMetrics(item.path);
        const intrinsic = measureUnityImage(metrics, node);
        if (!intrinsic?.preferredWidth || !intrinsic.preferredHeight) throw new Error(`无法读取图片资源尺寸：'${item.path}'`);
        node = { ...node, rect: { ...node.rect, sizeDelta: [intrinsic.preferredWidth, intrinsic.preferredHeight] } };
      } else {
        throw new Error("该 Project 内容不能创建为界面节点");
      }
      commitCreatedNode(parentId, node);
      onNotice(`已创建 ${gameObjectName(node)}`);
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const createTemplateNode = (templateId: string, anchoredPosition?: readonly [number, number]): string | undefined => {
    if (artifact.source.sourceKind === "variant" || !selectionIsLocal || multipleSelected || selected.components?.PrefabRef)
      return undefined;
    try {
      const document = workspace.documents.get(artifact.artifactKey);
      if (!document || document.source.sourceKind !== "artifact") throw new Error(`Artifact '${artifact.artifactKey}' 不存在`);
      const definition = authoringTemplate(templateId);
      const referencedArtifact =
        definition.materialization.kind === "artifactReference"
          ? artifacts.get(definition.materialization.artifactKey)?.resolvedSource
          : undefined;
      const node = materializeAuthoringTemplate(document.source, definition, { anchoredPosition, referencedArtifact });
      const createdId = commitCreatedNode(selected.id, node);
      onNotice(`已创建 ${definition.label}`);
      return createdId;
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
      return undefined;
    }
  };

  const restoreSelectedScrollbars = (): boolean => {
    if (artifact.source.sourceKind === "variant" || !selectionIsLocal || multipleSelected) return false;
    try {
      const document = workspace.documents.get(artifact.artifactKey);
      if (!document || document.source.sourceKind !== "artifact") throw new Error(`Artifact '${artifact.artifactKey}' 不存在`);
      const restored = restoreAuthoringScrollbars(document.source, selected.id);
      if (restored.addedNodeIds.length === 0) throw new Error(`Scroll Rect '${selected.id}' 已包含所有启用的滚动条`);
      const candidate = new Map(workspace.documents);
      candidate.set(artifact.artifactKey, { ...document, source: restored.source });
      validateWorkspaceDocuments(candidate, references, prototypes);
      workspace.commit((documents) => documents.set(artifact.artifactKey, { ...document, source: restored.source }));
      onNotice(`已恢复 ${restored.addedNodeIds.length} 个滚动条`);
      return true;
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  };

  const unpackSelectedPrefab = (): boolean => {
    if (artifact.source.sourceKind === "variant" || !selectionIsLocal || multipleSelected || !selected.components?.PrefabRef) return false;
    try {
      const document = workspace.documents.get(artifact.artifactKey);
      if (!document || document.source.sourceKind !== "artifact") throw new Error(`Artifact '${artifact.artifactKey}' 不存在`);
      const target = artifacts.get(selected.components.PrefabRef.artifactKey);
      if (!target) throw new Error(`Artifact '${selected.components.PrefabRef.artifactKey}' 不可用`);
      const unpacked = unpackPrefab(document.source, selected.id, target.resolvedSource);
      const candidate = new Map(workspace.documents);
      candidate.set(artifact.artifactKey, { ...document, source: unpacked.source });
      validateWorkspaceDocuments(candidate, references, prototypes);
      workspace.commit((documents) => documents.set(artifact.artifactKey, { ...document, source: unpacked.source }));
      onSelect(unpacked.rootId);
      onNotice(`已从 ${target.artifactKey} 解包 ${gameObjectName(selected)}`);
      return true;
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  };

  const moveNodeInHierarchy = (nodeId: string, targetId: string, position: HierarchyDropPosition): void => {
    if (artifact.source.sourceKind === "variant") {
      onNotice("Variant 不支持结构修改");
      return;
    }
    try {
      const document = workspace.documents.get(artifact.artifactKey);
      if (!document || document.source.sourceKind !== "artifact") throw new Error(`Artifact '${artifact.artifactKey}' 不存在`);
      const movingSelection = selectionIsLocal && selectedNodeIds.includes(nodeId);
      const movingNodeIds = movingSelection ? selectedNodeIds : [nodeId];
      const movedRootIds = outermostNodeIds(document.source, movingNodeIds);
      const nextSource = moveHierarchyNodes(document.source, movingNodeIds, targetId, position);
      const candidate = new Map(workspace.documents);
      candidate.set(artifact.artifactKey, { ...document, source: nextSource });
      validateWorkspaceDocuments(candidate, references, prototypes);
      workspace.commit((documents) => documents.set(artifact.artifactKey, { ...document, source: nextSource }));
      if (movingSelection) onSelectNodes(selectedNodeIds);
      else onSelect(nodeId);
      onNotice(
        movedRootIds.length > 1
          ? `已移动 ${movedRootIds.length} 个节点`
          : `已移动 ${gameObjectNameById(document.source, movedRootIds[0]!)}`,
      );
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return {
    copySelectedNode,
    pasteClipboardNode,
    duplicateSelectedNodes,
    cutSelectedNode,
    confirmDeleteNodes,
    deleteNodePlan: deleteNodePlanState.plan,
    deleteNodePlanIssue: deleteNodePlanState.issue,
    renameDraftIssue: renamePlanState.issue,
    renameNodeIdPreview: renamePlanState.plan?.preview.changes[0]?.afterNodeId ?? renameDraft?.manualNodeId ?? selected.id,
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
  } as const;
}
