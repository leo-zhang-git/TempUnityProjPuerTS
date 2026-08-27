import { AlertTriangle, Bug, Check, RefreshCw } from "lucide-react";
import type { WorkspaceSaveMode } from "../../schema/ui-api.js";
import type { UiDiagnostic } from "../../schema/ui-diagnostics.js";
import sharedStyles from "../editors/shared/dialog.module.css";
import { createWebClasses } from "../styles/web-styles.js";

const webClasses = createWebClasses(sharedStyles);

export interface WorkspaceSaveFailure {
  readonly documentId: string;
  readonly message: string;
  readonly diagnostics: readonly UiDiagnostic[];
}

export interface WorkspaceSaveResultNotice {
  readonly mode: WorkspaceSaveMode;
  readonly requestedCount: number;
  readonly savedDocumentIds: readonly string[];
  readonly failures: readonly WorkspaceSaveFailure[];
  readonly unexecutedDocumentIds: readonly string[];
}

export function WorkspaceSaveResultDialog({
  result,
  onClose,
  onRetry,
  onOpenProblems,
  retrying = false,
}: {
  readonly result: WorkspaceSaveResultNotice;
  readonly onClose: () => void;
  readonly onRetry: () => void;
  readonly onOpenProblems: () => void;
  readonly retrying?: boolean;
}) {
  const reloadBeforeRetry = result.failures.some((failure) =>
    failure.diagnostics.some((diagnostic) => diagnostic.code === "save.externalModification"),
  );
  return (
    <div className={webClasses("modal-backdrop")}>
      <section
        className={webClasses("authoring-dialog")}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="save-result-title"
        aria-describedby="save-result-summary"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <AlertTriangle size={16} />
            <strong id="save-result-title">保存未完成</strong>
            <span>{result.failures.length} 个文档存在问题</span>
          </div>
        </header>
        <div className={webClasses("dialog-fields")}>
          <p id="save-result-summary" className={webClasses("dialog-message")}>
            本次请求包含 {result.requestedCount} 个文档，已保存 {result.savedDocumentIds.length} 个，失败 {result.failures.length}{" "}
            个，未执行 {result.unexecutedDocumentIds.length} 个。未保存改动仍保留，可修复后重试。
          </p>
          {result.failures.map((failure) => (
            <p key={failure.documentId} className={webClasses("dialog-feedback is-error")}>
              <strong>{failure.documentId}</strong>
              {failure.diagnostics[0] ? (
                <>
                  <br />
                  <small>
                    {failure.diagnostics[0].path} · {failure.diagnostics[0].code}
                  </small>
                </>
              ) : null}
              <br />
              {failure.message}
            </p>
          ))}
          {result.unexecutedDocumentIds.length > 0 ? (
            <p className={webClasses("dialog-feedback")}>
              <strong>未执行</strong>
              <br />
              {result.unexecutedDocumentIds.join("、")}
            </p>
          ) : null}
        </div>
        <footer>
          <button className={webClasses("dialog-secondary")} type="button" onClick={onOpenProblems}>
            <Bug size={14} />
            打开问题列表
          </button>
          <button className={webClasses("dialog-secondary")} type="button" onClick={onRetry} disabled={retrying}>
            <RefreshCw size={14} />
            {retrying ? "正在处理" : reloadBeforeRetry ? "重新读取并重试" : "重试未保存文档"}
          </button>
          <button className={webClasses("dialog-primary")} type="button" autoFocus onClick={onClose}>
            <Check size={14} />
            确认
          </button>
        </footer>
      </section>
    </div>
  );
}
