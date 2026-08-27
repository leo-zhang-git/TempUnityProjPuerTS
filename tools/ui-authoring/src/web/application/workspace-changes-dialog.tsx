import { FileDiff, Save, Trash2, X } from "lucide-react";
import dialogStyles from "../editors/shared/dialog.module.css";
import sharedStyles from "../editors/shared/editor-shell.module.css";
import { createWebClasses } from "../styles/web-styles.js";
import type { WorkspaceDocumentChange } from "./workspace-changes.js";

const webClasses = createWebClasses(sharedStyles, dialogStyles);

export function WorkspaceChangesDialog({
  changes,
  discardDisabled = false,
  onClose,
  onDiscard,
  onSave,
}: {
  readonly changes: readonly WorkspaceDocumentChange[];
  readonly discardDisabled?: boolean;
  readonly onClose: () => void;
  readonly onDiscard: (documentId: string) => void;
  readonly onSave: (documentIds: ReadonlySet<string>) => Promise<boolean>;
}) {
  const changeCount = changes.reduce((count, document) => count + document.changes.length, 0);
  return (
    <div className={webClasses("modal-backdrop")} onPointerDown={onClose}>
      <section
        className={webClasses("changes-dialog")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-changes-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <FileDiff size={17} />
            <span>
              <strong id="workspace-changes-title">改动</strong>
              <small>
                {changes.length} 个文档 · {changeCount} 项改动
              </small>
            </span>
          </div>
          <button className={webClasses("icon-button")} type="button" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </header>
        <div className={webClasses("changes-scroll")}>
          {changes.map((document) => (
            <section className={webClasses("change-document")} key={document.id}>
              <header>
                <span>
                  <strong>{document.key}</strong>
                  <small>{document.path}</small>
                </span>
                <em className={webClasses(`change-kind is-${document.changeKind}`)}>{document.changeKind}</em>
                <button
                  className={webClasses("icon-button")}
                  type="button"
                  disabled={discardDisabled}
                  onClick={() => onDiscard(document.id)}
                  title="放弃改动"
                >
                  <Trash2 size={14} />
                </button>
                <button
                  className={webClasses("icon-button")}
                  type="button"
                  disabled={discardDisabled}
                  onClick={() => void onSave(new Set([document.id]))}
                  title="保存"
                >
                  <Save size={14} />
                </button>
              </header>
              <div>
                {document.changes.map((change, index) => (
                  <div className={webClasses("change-line")} key={`${change.kind}:${change.nodeId ?? change.label}:${index}`}>
                    <span>{change.label}</span>
                    {change.before !== undefined || change.after !== undefined ? (
                      <code>
                        <del>{formatValue(change.before)}</del>
                        <i>变为</i>
                        <ins>{formatValue(change.after)}</ins>
                      </code>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
          {changes.length === 0 ? (
            <div className={webClasses("changes-empty")}>
              <FileDiff size={22} />
              <span>没有未保存的改动</span>
            </div>
          ) : null}
        </div>
        <footer>
          <button className={webClasses("dialog-secondary")} type="button" onClick={onClose}>
            关闭
          </button>
        </footer>
      </section>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === undefined) return "未设置";
  if (typeof value === "string") return value || '""';
  const serialized = JSON.stringify(value);
  return serialized && serialized.length > 90 ? `${serialized.slice(0, 87)}...` : (serialized ?? String(value));
}
