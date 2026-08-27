import { Save } from "lucide-react";
import { useEffect } from "react";
import sharedStyles from "../editors/shared/editor-shell.module.css";
import { createWebClasses } from "../styles/web-styles.js";
import { useWorkspaceEditing, type WorkspaceEditingContextValue } from "./workspace-editing-context.js";

const webClasses = createWebClasses(sharedStyles);

export interface WorkspaceSavePresentation {
  readonly label: string;
  readonly state: "modified" | "saving" | "saved" | "failed" | "idle";
  readonly title?: string | undefined;
}

interface AutoSaveToggleProps {
  readonly disabled: boolean;
  readonly disabledReason?: string | undefined;
}

export interface SaveAutoSaveControlProps {
  readonly hasSavableChanges: boolean;
  readonly documentIds: ReadonlySet<string>;
  readonly saveBlockedReason?: string | undefined;
  readonly onSave: () => void | Promise<unknown>;
  readonly saveTitle: string;
  readonly saveButtonClassName?: string | undefined;
  readonly className?: string | undefined;
  readonly iconSize?: number | undefined;
  readonly label?: string | undefined;
  readonly role?: "menuitem" | undefined;
}

export interface SaveAutoSaveInteraction {
  readonly saveDisabled: boolean;
  readonly autoSaveDisabled: boolean;
}

export function saveAutoSaveInteraction(hasSavableChanges: boolean, saveBlocked: boolean): SaveAutoSaveInteraction {
  return {
    saveDisabled: !hasSavableChanges || saveBlocked,
    autoSaveDisabled: hasSavableChanges && saveBlocked,
  };
}

export function SaveAutoSaveControl({
  hasSavableChanges,
  documentIds,
  saveBlockedReason,
  onSave,
  saveTitle,
  saveButtonClassName,
  className,
  iconSize = 16,
  label,
  role,
}: SaveAutoSaveControlProps) {
  const editing = useWorkspaceEditing();
  const interaction = saveAutoSaveInteraction(hasSavableChanges, Boolean(saveBlockedReason));
  const documentKey = [...documentIds].sort().join("\0");
  useEffect(() => {
    if (!editing.autoSaveEnabled || interaction.autoSaveDisabled || !hasSavableChanges) return;
    editing.onAutoSaveDocuments(new Set(documentIds));
  }, [
    documentKey,
    editing.autoSaveEnabled,
    editing.dirtyDocuments,
    editing.onAutoSaveDocuments,
    hasSavableChanges,
    interaction.autoSaveDisabled,
  ]);
  return (
    <div className={`${webClasses("save-auto-save-control")}${className ? ` ${className}` : ""}`}>
      <button
        className={saveButtonClassName}
        type="button"
        role={role}
        disabled={interaction.saveDisabled}
        onClick={() => void onSave()}
        title={saveBlockedReason ?? saveTitle}
      >
        <Save size={iconSize} />
        {label ? <span>{label}</span> : null}
      </button>
      <AutoSaveToggle disabled={interaction.autoSaveDisabled} disabledReason={saveBlockedReason} />
    </div>
  );
}

function isWorkspaceSaveNotice(notice: string): boolean {
  return (
    notice === "就绪" || notice === "正在保存" || notice === "节点标识元数据已保存" || /^已保存 \d+ 个 (?:Artifact|文档)$/.test(notice)
  );
}

export function workspaceSavePresentation(
  editing: WorkspaceEditingContextValue,
  documentIds: ReadonlySet<string>,
  dirty: boolean,
  fallback: string,
): WorkspaceSavePresentation {
  const relevant = [...editing.saveStatus.documentIds].some((documentId) => documentIds.has(documentId));
  if (relevant && editing.saveStatus.phase === "saving") return { label: "正在保存", state: "saving" };
  if (relevant && editing.saveStatus.phase === "failed") return { label: "保存失败", state: "failed", title: editing.saveStatus.message };
  if (dirty) return { label: "已修改", state: "modified" };
  if (editing.autoSaveEnabled && isWorkspaceSaveNotice(fallback)) return { label: "已保存", state: "saved" };
  return { label: fallback, state: "idle" };
}

function AutoSaveToggle({ disabled, disabledReason }: AutoSaveToggleProps) {
  const editing = useWorkspaceEditing();
  return (
    <label className={webClasses(`auto-save-control ${disabled ? "is-disabled" : ""}`)}>
      <span>自动保存</span>
      <button
        className={webClasses("auto-save-switch")}
        type="button"
        role="switch"
        aria-label="自动保存"
        aria-checked={editing.autoSaveEnabled}
        disabled={disabled}
        onClick={() => editing.onAutoSaveEnabled(!editing.autoSaveEnabled)}
        title={
          disabled ? `${disabledReason ?? "当前状态禁止保存"}，自动保存不可用` : editing.autoSaveEnabled ? "关闭自动保存" : "开启自动保存"
        }
      >
        <span />
      </button>
    </label>
  );
}
