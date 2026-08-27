import { FilePlus2, X } from "lucide-react";
import { useState } from "react";
import dialogStyles from "../editors/shared/dialog.module.css";
import sharedStyles from "../editors/shared/editor-shell.module.css";
import { type DocumentCatalog } from "../shared/api/client.js";
import { SelectControl } from "../shared/select-control.js";
import { createWebClasses } from "../styles/web-styles.js";
import { SourcePathField } from "../workspace/source-path-field.js";
import {
  type CreateDocumentKind,
  createDocumentDraft,
  type DocumentCreateDraft,
  documentDraftWithKey,
  explainDocumentCreateDraftIssue,
} from "./document-create-model.js";

const webClasses = createWebClasses(sharedStyles, dialogStyles);

export function DocumentCreateDialog({
  draft,
  catalog,
  onDraft,
  onClose,
  onSubmit,
}: {
  readonly draft: DocumentCreateDraft;
  readonly catalog: DocumentCatalog;
  readonly onDraft: (draft: DocumentCreateDraft) => void;
  readonly onClose: () => void;
  readonly onSubmit: () => Promise<string | undefined>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [submitIssue, setSubmitIssue] = useState<string | null>(null);
  const draftIssue = explainDocumentCreateDraftIssue(draft);
  const visibleIssue = draftIssue ?? submitIssue;
  const updateDraft = (next: DocumentCreateDraft): void => {
    setSubmitIssue(null);
    onDraft(next);
  };
  const submit = async (): Promise<void> => {
    if (draftIssue || submitting) return;
    setSubmitting(true);
    const issue = await onSubmit();
    setSubmitting(false);
    setSubmitIssue(issue ?? null);
  };
  return (
    <div className={webClasses("modal-backdrop")} onPointerDown={submitting ? undefined : onClose}>
      <form
        className={webClasses("authoring-dialog")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-document-title"
        aria-describedby={visibleIssue ? "create-document-issue" : undefined}
        aria-invalid={Boolean(draftIssue)}
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <header>
          <div>
            <strong id="create-document-title">新建文档</strong>
            <span>{draft.directory || "UIAuthoring"}</span>
          </div>
          <button className={webClasses("icon-button")} type="button" onClick={onClose} disabled={submitting} title="关闭">
            <X size={16} />
          </button>
        </header>
        <div className={webClasses("dialog-fields")}>
          <label>
            <span>类型</span>
            <SelectControl
              value={draft.kind}
              options={(["Canvas", "Widget", "Fragment", "Reference", "Prototype"] as const).map((kind) => ({ value: kind, label: kind }))}
              onValueChange={(kind: CreateDocumentKind) => updateDraft(createDocumentDraft(draft.directory, kind, catalog))}
            />
          </label>
          <label>
            <span>{draft.kind === "Reference" ? "Reference Key" : draft.kind === "Prototype" ? "Prototype Key" : "Artifact Key"}</span>
            <input autoFocus value={draft.key} onChange={(event) => updateDraft(documentDraftWithKey(draft, event.target.value))} />
          </label>
          <SourcePathField value={draft.sourcePath} catalog={catalog} onChange={(sourcePath) => updateDraft({ ...draft, sourcePath })} />
          {draft.kind === "Reference" ? (
            <label>
              <span>根 Artifact</span>
              <SelectControl
                value={draft.rootArtifactKey}
                options={catalog.artifacts.map((entry) => ({ value: entry.artifactKey, label: entry.artifactKey }))}
                onValueChange={(rootArtifactKey) => updateDraft({ ...draft, rootArtifactKey })}
              />
            </label>
          ) : null}
          {draft.kind === "Prototype" ? (
            <label>
              <span>起始 Reference</span>
              <SelectControl
                value={draft.startReferenceKey}
                options={catalog.references.map((entry) => ({ value: entry.referenceKey, label: entry.referenceKey }))}
                onValueChange={(startReferenceKey) => updateDraft({ ...draft, startReferenceKey })}
              />
            </label>
          ) : null}
          {draft.kind !== "Reference" && draft.kind !== "Prototype" ? (
            <>
              <label>
                <span>宽度</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={Number.isFinite(draft.width) ? draft.width : ""}
                  onChange={(event) => updateDraft({ ...draft, width: event.currentTarget.valueAsNumber })}
                />
              </label>
              <label>
                <span>高度</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={Number.isFinite(draft.height) ? draft.height : ""}
                  onChange={(event) => updateDraft({ ...draft, height: event.currentTarget.valueAsNumber })}
                />
              </label>
            </>
          ) : null}
          {visibleIssue ? (
            <p className={webClasses("dialog-feedback is-error")} id="create-document-issue" role="alert">
              {visibleIssue}
            </p>
          ) : null}
        </div>
        <footer>
          <button className={webClasses("dialog-secondary")} type="button" onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button
            className={webClasses("dialog-primary")}
            type="submit"
            disabled={submitting || Boolean(draftIssue)}
            title={draftIssue ?? "创建文档"}
          >
            <FilePlus2 size={15} />
            {submitting ? "正在创建" : "创建"}
          </button>
        </footer>
      </form>
    </div>
  );
}
