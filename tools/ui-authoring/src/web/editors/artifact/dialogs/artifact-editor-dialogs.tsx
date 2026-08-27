import { AlertTriangle, Check, GitFork, PackagePlus, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { findNode } from "../../../../kernel/tree.js";
import { CaptureDialog } from "../../../capture/capture-dialog.js";
import { gameObjectDiagnosticLabel, gameObjectName } from "../../../shared/game-object-label.js";
import { SelectControl } from "../../../shared/select-control.js";
import { createWebClasses } from "../../../styles/web-styles.js";
import { SourcePathField } from "../../../workspace/source-path-field.js";
import dialogStyles from "../../shared/dialog.module.css";
import sharedStyles from "../../shared/editor-shell.module.css";
import type { ArtifactEditorDialogsController, NodeCreateDraft } from "../artifact-editor-controller.js";
import { explainArtifactIdentityDraftIssue, explainNodeCreateDraftIssue } from "../artifact-editor-controller.js";
import artifactStyles from "./artifact-dialogs.module.css";

const webClasses = createWebClasses(sharedStyles, dialogStyles, artifactStyles);
const DELETE_IMPACT_LABELS = {
  block: "阻断",
  repair: "置空并待修复",
  remove: "自动删除",
  clear: "自动清空",
  republish: "重新发布",
} as const;

export function ArtifactEditorDialogs({ controller }: { readonly controller: ArtifactEditorDialogsController }) {
  const [nodeCreateSubmitIssue, setNodeCreateSubmitIssue] = useState<string | null>(null);
  const [renameSubmitIssue, setRenameSubmitIssue] = useState<string | null>(null);
  const [deleteNodeSubmitIssue, setDeleteNodeSubmitIssue] = useState<string | null>(null);
  const [deleteArtifactSubmitIssue, setDeleteArtifactSubmitIssue] = useState<string | null>(null);
  const [extractSubmitIssue, setExtractSubmitIssue] = useState<string | null>(null);
  const [variantSubmitIssue, setVariantSubmitIssue] = useState<string | null>(null);
  const [confirmedDeleteKey, setConfirmedDeleteKey] = useState<string | null>(null);
  const {
    captureOpen,
    source,
    selected,
    selectedLabel,
    captureRequest,
    setCaptureOpen,
    nodeCreateDraft,
    setNodeCreateDraft,
    submitCreateNode,
    prefabRefArtifacts,
    renameDraft,
    setRenameDraft,
    renameDraftIssue,
    renameNodeIdPreview,
    submitRenameNode,
    deleteNodeIds,
    setDeleteNodeIds,
    confirmDeleteNodes,
    deleteNodePlan,
    deleteNodePlanIssue,
    deleteArtifactOpen,
    setDeleteArtifactOpen,
    confirmDeleteArtifact,
    extractDraft,
    setExtractDraft,
    submitExtractArtifact,
    variantDraft,
    setVariantDraft,
    submitCreateVariant,
    blockingMessage,
    dismissBlockingMessage,
  } = controller;
  const closeRenameDialog = (): void => {
    setRenameSubmitIssue(null);
    setRenameDraft(null);
  };
  const closeNodeCreateDialog = (): void => {
    setNodeCreateSubmitIssue(null);
    setNodeCreateDraft(null);
  };
  const closeDeleteNodeDialog = (): void => {
    setDeleteNodeSubmitIssue(null);
    setConfirmedDeleteKey(null);
    setDeleteNodeIds(null);
  };
  const closeDeleteArtifactDialog = (): void => {
    setDeleteArtifactSubmitIssue(null);
    setDeleteArtifactOpen(false);
  };
  const closeExtractDialog = (): void => {
    setExtractSubmitIssue(null);
    setExtractDraft(null);
  };
  const closeVariantDialog = (): void => {
    setVariantSubmitIssue(null);
    setVariantDraft(null);
  };
  const nodeCreateDraftIssue = nodeCreateDraft ? explainNodeCreateDraftIssue(nodeCreateDraft, source) : undefined;
  const nodeCreateVisibleIssue = nodeCreateDraftIssue ?? nodeCreateSubmitIssue;
  const renameVisibleIssue = renameDraftIssue ?? renameSubmitIssue;
  const extractDraftIssue = extractDraft ? explainArtifactIdentityDraftIssue(extractDraft) : undefined;
  const extractVisibleIssue = extractDraftIssue ?? extractSubmitIssue;
  const extractArtifactLabel = extractDraft?.artifactType ?? "Artifact";
  const variantDraftIssue = variantDraft ? explainArtifactIdentityDraftIssue(variantDraft) : undefined;
  const variantVisibleIssue = variantDraftIssue ?? variantSubmitIssue;
  const deleteKey = JSON.stringify([
    deleteNodeIds,
    deleteNodePlanIssue,
    deleteNodePlan?.impacts.map(({ action, documentPath, fieldPath, summary }) => [action, documentPath, fieldPath, summary]),
  ]);
  const deleteHasImpacts = (deleteNodePlan?.impacts.length ?? 0) > 0;
  const deleteBlocked = Boolean(deleteNodePlanIssue) || (deleteNodePlan?.blockers.length ?? 0) > 0;
  const deleteSecondStep = deleteHasImpacts && confirmedDeleteKey === deleteKey;
  const deleteNodeLabels = deleteNodeIds?.map((nodeId) => {
    const node = findNode(source, nodeId);
    return node ? gameObjectDiagnosticLabel(node) : nodeId;
  });
  return (
    <>
      {captureOpen ? (
        <CaptureDialog
          title={source.artifactKey}
          selectedLabel={selectedLabel}
          buildRequest={captureRequest}
          onClose={() => setCaptureOpen(false)}
        />
      ) : null}
      {blockingMessage ? (
        <div className={webClasses("modal-backdrop")}>
          <section
            className={webClasses("authoring-dialog")}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="blocked-operation-title"
            aria-describedby="blocked-operation-message"
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              dismissBlockingMessage();
            }}
          >
            <header>
              <div>
                <AlertTriangle size={15} />
                <h2 id="blocked-operation-title">操作未执行</h2>
              </div>
            </header>
            <p className={webClasses("dialog-message")} id="blocked-operation-message">
              {blockingMessage}
            </p>
            <footer>
              <button className={webClasses("dialog-primary")} type="button" autoFocus onClick={dismissBlockingMessage}>
                <Check size={15} />
                确认
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      {nodeCreateDraft ? (
        <div className={webClasses("modal-backdrop")} onPointerDown={closeNodeCreateDialog}>
          <form
            className={webClasses("authoring-dialog")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-node-title"
            aria-describedby={nodeCreateVisibleIssue ? "create-node-issue" : undefined}
            aria-invalid={Boolean(nodeCreateDraftIssue)}
            onPointerDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              setNodeCreateSubmitIssue(submitCreateNode() ?? null);
            }}
          >
            <header>
              <div>
                <strong id="create-node-title">新建子节点</strong>
                <span title={gameObjectDiagnosticLabel(selected)}>{gameObjectName(selected)}</span>
              </div>
              <button className={webClasses("icon-button")} type="button" onClick={closeNodeCreateDialog} title="关闭">
                <X size={16} />
              </button>
            </header>
            <div className={webClasses("dialog-fields")}>
              <label>
                <span>Node ID</span>
                <input
                  autoFocus
                  value={nodeCreateDraft.id}
                  onChange={(event) => {
                    setNodeCreateSubmitIssue(null);
                    setNodeCreateDraft({ ...nodeCreateDraft, id: event.target.value });
                  }}
                />
              </label>
              <label>
                <span>类型</span>
                <SelectControl
                  value={nodeCreateDraft.kind}
                  options={[
                    { value: "Node", label: "空节点" },
                    { value: "Image", label: "Image" },
                    { value: "Text", label: "Text" },
                    { value: "PrefabRef", label: "PrefabRef" },
                  ]}
                  onValueChange={(kind: NodeCreateDraft["kind"]) => {
                    setNodeCreateSubmitIssue(null);
                    setNodeCreateDraft({ ...nodeCreateDraft, kind });
                  }}
                />
              </label>
              {nodeCreateDraft.kind === "PrefabRef" ? (
                <label>
                  <span>Widget / Fragment</span>
                  <SelectControl
                    ariaLabel="Widget / Fragment"
                    value={nodeCreateDraft.artifactKey}
                    options={prefabRefArtifacts.map((entry) => ({
                      value: entry.artifactKey,
                      label: `${entry.artifactKey} · ${entry.artifactType}`,
                    }))}
                    placeholder="搜索并选择 Artifact"
                    searchable
                    searchPlaceholder="搜索 Widget 或 Fragment"
                    emptyLabel="没有匹配的 Widget 或 Fragment"
                    showAllOptionsOnEmptySearch={false}
                    onValueChange={(artifactKey) => {
                      setNodeCreateSubmitIssue(null);
                      setNodeCreateDraft({ ...nodeCreateDraft, artifactKey });
                    }}
                  />
                </label>
              ) : null}
              <label>
                <span>宽度</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={Number.isFinite(nodeCreateDraft.width) ? nodeCreateDraft.width : ""}
                  onChange={(event) => {
                    setNodeCreateSubmitIssue(null);
                    setNodeCreateDraft({ ...nodeCreateDraft, width: event.currentTarget.valueAsNumber });
                  }}
                />
              </label>
              <label>
                <span>高度</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={Number.isFinite(nodeCreateDraft.height) ? nodeCreateDraft.height : ""}
                  onChange={(event) => {
                    setNodeCreateSubmitIssue(null);
                    setNodeCreateDraft({ ...nodeCreateDraft, height: event.currentTarget.valueAsNumber });
                  }}
                />
              </label>
              {nodeCreateVisibleIssue ? (
                <p className={webClasses("dialog-feedback is-error")} id="create-node-issue" role="alert">
                  {nodeCreateVisibleIssue}
                </p>
              ) : null}
            </div>
            <footer>
              <button className={webClasses("dialog-secondary")} type="button" onClick={closeNodeCreateDialog}>
                取消
              </button>
              <button
                className={webClasses("dialog-primary")}
                type="submit"
                disabled={Boolean(nodeCreateDraftIssue)}
                title={nodeCreateDraftIssue ?? "创建子节点"}
              >
                <Plus size={15} />
                创建
              </button>
            </footer>
          </form>
        </div>
      ) : null}
      {renameDraft !== null ? (
        <div className={webClasses("modal-backdrop")} onPointerDown={closeRenameDialog}>
          <form
            className={webClasses("authoring-dialog")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-node-title"
            onPointerDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              setRenameSubmitIssue(submitRenameNode() ?? null);
            }}
          >
            <header>
              <div>
                <strong id="rename-node-title">重命名节点</strong>
                <span title={gameObjectDiagnosticLabel(selected)}>{gameObjectName(selected)}</span>
              </div>
              <button className={webClasses("icon-button")} type="button" onClick={closeRenameDialog} title="关闭">
                <X size={16} />
              </button>
            </header>
            <div className={webClasses("dialog-fields")}>
              <label>
                <span>GameObject 名称</span>
                <input
                  autoFocus
                  value={renameDraft.displayName}
                  aria-invalid={Boolean(renameDraftIssue)}
                  aria-describedby={renameVisibleIssue ? "rename-node-issue" : undefined}
                  onChange={(event) => {
                    setRenameSubmitIssue(null);
                    setRenameDraft({ ...renameDraft, displayName: event.target.value });
                  }}
                />
              </label>
              <label>
                <span>Node ID</span>
                <input
                  value={renameNodeIdPreview}
                  aria-invalid={Boolean(renameDraftIssue)}
                  aria-describedby={renameVisibleIssue ? "rename-node-issue" : undefined}
                  onChange={(event) => {
                    setRenameSubmitIssue(null);
                    setRenameDraft({ ...renameDraft, manualNodeId: event.target.value });
                  }}
                />
              </label>
              <label className={webClasses("rename-id-mode")}>
                <input
                  type="checkbox"
                  checked={renameDraft.manualNodeId === null}
                  onChange={(event) => {
                    setRenameSubmitIssue(null);
                    setRenameDraft({
                      ...renameDraft,
                      manualNodeId: event.currentTarget.checked ? null : renameNodeIdPreview,
                    });
                  }}
                />
                <span>自动 Node ID</span>
                <code>{renameDraft.manualNodeId === null ? "自动" : "手动"}</code>
              </label>
              {renameVisibleIssue ? (
                <p className={webClasses("dialog-feedback is-error")} id="rename-node-issue" role="alert">
                  {renameVisibleIssue}
                </p>
              ) : null}
            </div>
            <footer>
              <button className={webClasses("dialog-secondary")} type="button" onClick={closeRenameDialog}>
                取消
              </button>
              <button
                className={webClasses("dialog-primary")}
                type="submit"
                disabled={Boolean(renameDraftIssue)}
                title={renameDraftIssue ?? "重命名节点"}
              >
                <Pencil size={15} />
                重命名
              </button>
            </footer>
          </form>
        </div>
      ) : null}
      {deleteNodeIds && deleteNodeIds.length > 0 ? (
        <div className={webClasses("modal-backdrop")} onPointerDown={closeDeleteNodeDialog}>
          <section
            className={webClasses("authoring-dialog")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-node-title"
            aria-describedby="delete-node-message"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <strong id="delete-node-title">{deleteNodeIds.length === 1 ? "删除节点" : `删除 ${deleteNodeIds.length} 个节点`}</strong>
                <span title={deleteNodeIds.join(", ")}>{deleteNodeLabels?.join(", ")}</span>
              </div>
              <button className={webClasses("icon-button")} type="button" onClick={closeDeleteNodeDialog} title="关闭">
                <X size={16} />
              </button>
            </header>
            <p className={webClasses("dialog-message")} id="delete-node-message">
              {deleteBlocked
                ? "删除计划包含必须先处理的结构引用。当前不会修改任何文档。"
                : deleteSecondStep
                  ? `再次确认删除完整子树，并处理 ${deleteNodePlan?.impacts.filter((impact) => impact.action === "remove" || impact.action === "clear" || impact.action === "repair").length ?? 0} 项引用；必需引用置空后会阻断保存，直到修复。`
                  : deleteHasImpacts
                    ? "删除会同步清理可确定失效的引用；必需结构引用会置空并在 Hierarchy 标红，修复前不能保存。"
                    : "删除选中节点及其完整子树。"}
            </p>
            {deleteNodePlan?.impacts.length ? (
              <div className={webClasses("delete-impact-list")} role="list" aria-label="删除影响">
                {deleteNodePlan.impacts.map((impact) => (
                  <div
                    className={webClasses(`delete-impact-row is-${impact.action}`)}
                    role="listitem"
                    data-impact-action={impact.action}
                    key={`${impact.action}:${impact.documentPath}:${impact.fieldPath}`}
                  >
                    <strong>{DELETE_IMPACT_LABELS[impact.action]}</strong>
                    <span title={`${impact.documentPath}${impact.fieldPath}`}>
                      {impact.documentKey} · {impact.fieldPath}
                    </span>
                    <p>{impact.summary}</p>
                  </div>
                ))}
              </div>
            ) : null}
            {deleteNodePlanIssue ? (
              <p className={webClasses("dialog-feedback is-error delete-dialog-error")} role="alert">
                {deleteNodePlanIssue}
              </p>
            ) : null}
            {deleteNodeSubmitIssue ? (
              <p className={webClasses("dialog-feedback is-error")} role="alert">
                {deleteNodeSubmitIssue}
              </p>
            ) : null}
            <footer>
              <button className={webClasses("dialog-secondary")} type="button" onClick={closeDeleteNodeDialog}>
                取消
              </button>
              {deleteBlocked ? (
                <button className={webClasses("dialog-danger")} type="button" disabled title="请先处理阻断项">
                  <AlertTriangle size={15} />
                  无法删除
                </button>
              ) : deleteHasImpacts && !deleteSecondStep ? (
                <button className={webClasses("dialog-danger")} type="button" onClick={() => setConfirmedDeleteKey(deleteKey)}>
                  <AlertTriangle size={15} />
                  继续
                </button>
              ) : (
                <button
                  className={webClasses("dialog-danger")}
                  type="button"
                  onClick={() => setDeleteNodeSubmitIssue(confirmDeleteNodes() ?? null)}
                >
                  <Trash2 size={15} />
                  {deleteHasImpacts ? "删除并清理" : "删除"}
                </button>
              )}
            </footer>
          </section>
        </div>
      ) : null}
      {deleteArtifactOpen ? (
        <div className={webClasses("modal-backdrop")} onPointerDown={closeDeleteArtifactDialog}>
          <section
            className={webClasses("authoring-dialog")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-artifact-title"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <strong id="delete-artifact-title">删除 Artifact</strong>
                <span>{source.artifactKey}</span>
              </div>
              <button className={webClasses("icon-button")} type="button" onClick={closeDeleteArtifactDialog} title="关闭">
                <X size={16} />
              </button>
            </header>
            <p className={webClasses("dialog-message")}>
              删除会记录为一次未保存改动，可在保存前撤销。存在 Artifact、Reference 或 Prototype 依赖时操作会被阻止。
            </p>
            {deleteArtifactSubmitIssue ? (
              <p className={webClasses("dialog-feedback is-error")} role="alert">
                {deleteArtifactSubmitIssue}
              </p>
            ) : null}
            <footer>
              <button className={webClasses("dialog-secondary")} type="button" onClick={closeDeleteArtifactDialog}>
                取消
              </button>
              <button
                className={webClasses("dialog-danger")}
                type="button"
                onClick={() => setDeleteArtifactSubmitIssue(confirmDeleteArtifact() ?? null)}
              >
                <Trash2 size={15} />
                删除
              </button>
            </footer>
          </section>
        </div>
      ) : null}
      {extractDraft ? (
        <div className={webClasses("modal-backdrop")} onPointerDown={closeExtractDialog}>
          <form
            className={webClasses("authoring-dialog")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="extract-artifact-title"
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              closeExtractDialog();
            }}
            aria-describedby={extractVisibleIssue ? "extract-artifact-issue" : undefined}
            aria-invalid={Boolean(extractDraftIssue)}
            onSubmit={(event) => {
              event.preventDefault();
              setExtractSubmitIssue(submitExtractArtifact() ?? null);
            }}
          >
            <header>
              <div>
                <strong id="extract-artifact-title">抽取 {extractArtifactLabel}</strong>
                <span title={gameObjectDiagnosticLabel(selected)}>{gameObjectName(selected)}</span>
              </div>
              <button className={webClasses("icon-button")} type="button" onClick={closeExtractDialog} title="关闭">
                <X size={16} />
              </button>
            </header>
            <div className={webClasses("dialog-fields")}>
              <label>
                <span>Artifact Key</span>
                <input
                  autoFocus
                  value={extractDraft.artifactKey}
                  onChange={(event) => {
                    setExtractSubmitIssue(null);
                    setExtractDraft({ ...extractDraft, artifactKey: event.target.value });
                  }}
                />
              </label>
              <SourcePathField
                value={extractDraft.sourcePath}
                catalog={controller.catalog}
                onChange={(sourcePath) => {
                  setExtractSubmitIssue(null);
                  setExtractDraft({ ...extractDraft, sourcePath });
                }}
              />
              {extractVisibleIssue ? (
                <p className={webClasses("dialog-feedback is-error")} id="extract-artifact-issue" role="alert">
                  {extractVisibleIssue}
                </p>
              ) : null}
            </div>
            <footer>
              <button className={webClasses("dialog-secondary")} type="button" onClick={closeExtractDialog}>
                取消
              </button>
              <button
                className={webClasses("dialog-primary")}
                type="submit"
                disabled={Boolean(extractDraftIssue)}
                title={extractDraftIssue ?? `提取 ${extractArtifactLabel}`}
              >
                <PackagePlus size={15} />
                抽取
              </button>
            </footer>
          </form>
        </div>
      ) : null}
      {variantDraft ? (
        <div className={webClasses("modal-backdrop")} onPointerDown={closeVariantDialog}>
          <form
            className={webClasses("authoring-dialog")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-variant-title"
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              setVariantDraft(null);
            }}
            aria-describedby={variantVisibleIssue ? "create-variant-issue" : undefined}
            aria-invalid={Boolean(variantDraftIssue)}
            onSubmit={(event) => {
              event.preventDefault();
              setVariantSubmitIssue(submitCreateVariant() ?? null);
            }}
          >
            <header>
              <div>
                <strong id="create-variant-title">创建 Variant</strong>
                <span>{source.artifactKey}</span>
              </div>
              <button className={webClasses("icon-button")} type="button" onClick={closeVariantDialog} title="关闭">
                <X size={16} />
              </button>
            </header>
            <div className={webClasses("dialog-fields")}>
              <label>
                <span>Artifact Key</span>
                <input
                  autoFocus
                  value={variantDraft.artifactKey}
                  onChange={(event) => {
                    setVariantSubmitIssue(null);
                    setVariantDraft({ ...variantDraft, artifactKey: event.target.value });
                  }}
                />
              </label>
              <SourcePathField
                value={variantDraft.sourcePath}
                catalog={controller.catalog}
                onChange={(sourcePath) => {
                  setVariantSubmitIssue(null);
                  setVariantDraft({ ...variantDraft, sourcePath });
                }}
              />
              {variantVisibleIssue ? (
                <p className={webClasses("dialog-feedback is-error")} id="create-variant-issue" role="alert">
                  {variantVisibleIssue}
                </p>
              ) : null}
            </div>
            <footer>
              <button className={webClasses("dialog-secondary")} type="button" onClick={closeVariantDialog}>
                取消
              </button>
              <button
                className={webClasses("dialog-primary")}
                type="submit"
                disabled={Boolean(variantDraftIssue)}
                title={variantDraftIssue ?? "创建 Variant"}
              >
                <GitFork size={15} />
                创建
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </>
  );
}
