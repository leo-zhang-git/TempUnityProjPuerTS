import { Save, UserRound, X } from "lucide-react";
import { useState } from "react";
import type { UiCollaborationProfile } from "../../schema/ui-collaboration.js";
import dialogStyles from "../editors/shared/dialog.module.css";
import sharedStyles from "../editors/shared/editor-shell.module.css";
import { createWebClasses } from "../styles/web-styles.js";
import applicationStyles from "./application-menu.module.css";

const webClasses = createWebClasses(sharedStyles, dialogStyles, applicationStyles);

export function CollaborationProfileDialog({
  profile,
  onClose,
  onSave,
}: {
  readonly profile: UiCollaborationProfile;
  readonly onClose: () => void;
  readonly onSave: (userName: string) => Promise<void>;
}) {
  const [userName, setUserName] = useState(profile.userName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async (): Promise<void> => {
    if (!profile.editable || !userName.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave(userName);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className={webClasses("modal-backdrop")} onPointerDown={onClose}>
      <form
        className={webClasses("authoring-dialog collaboration-profile-dialog")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="collaboration-profile-title"
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <header>
          <div>
            <UserRound size={16} />
            <strong id="collaboration-profile-title">Legma 昵称</strong>
          </div>
          <button className={webClasses("icon-button")} type="button" onClick={onClose} title="稍后设置">
            <X size={16} />
          </button>
        </header>
        <div className={webClasses("collaboration-profile-body")}>
          <label htmlFor="collaboration-user-name">昵称</label>
          <input
            id="collaboration-user-name"
            value={userName}
            disabled={!profile.editable || saving}
            autoFocus
            onChange={(event) => setUserName(event.target.value)}
            maxLength={128}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "collaboration-profile-error" : undefined}
          />
          {!profile.editable ? <small>当前环境不允许修改昵称</small> : null}
          {error ? <p id="collaboration-profile-error">{error}</p> : null}
        </div>
        <footer>
          <button className={webClasses("dialog-secondary")} type="button" onClick={onClose}>
            稍后
          </button>
          <button className={webClasses("dialog-primary")} type="submit" disabled={!profile.editable || !userName.trim() || saving}>
            <Save size={15} />
            保存
          </button>
        </footer>
      </form>
    </div>
  );
}
