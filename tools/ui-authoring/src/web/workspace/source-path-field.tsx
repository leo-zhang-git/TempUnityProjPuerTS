import { Check, Folder, FolderOpen, FolderTree, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import dialogStyles from "../editors/shared/dialog.module.css";
import sharedStyles from "../editors/shared/editor-shell.module.css";
import type { DocumentCatalog } from "../shared/api/client.js";
import { createWebClasses } from "../styles/web-styles.js";
import { documentDirectory, normalizeWorkspacePath } from "./explorer/artifact-explorer-model.js";
import styles from "./source-path-field.module.css";

const webClasses = createWebClasses(sharedStyles, dialogStyles, styles);

export function SourcePathField({
  label = "Source 路径",
  value,
  catalog,
  mode = "file",
  autoFocus,
  placeholder,
  onChange,
}: {
  readonly label?: string;
  readonly value: string;
  readonly catalog: DocumentCatalog;
  readonly mode?: "file" | "directory";
  readonly autoFocus?: boolean;
  readonly placeholder?: string;
  readonly onChange: (value: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <>
      <label className={webClasses("source-path-label")}>
        <span>{label}</span>
        <span className={webClasses("source-path-control")}>
          <input autoFocus={autoFocus} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
          <button type="button" onClick={() => setPickerOpen(true)} title="选择目录">
            <FolderTree size={14} />
          </button>
        </span>
      </label>
      {pickerOpen ? (
        <SourceDirectoryPicker
          catalog={catalog}
          selected={mode === "directory" ? value : documentDirectory(value)}
          onClose={() => setPickerOpen(false)}
          onChoose={(directory) => {
            if (mode === "directory") onChange(directory);
            else {
              const normalized = normalizeWorkspacePath(value);
              const fileName = normalized.split("/").at(-1) ?? "";
              onChange(normalizeWorkspacePath(`${directory}/${fileName}`));
            }
            setPickerOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function sourceDirectories(catalog: DocumentCatalog): readonly string[] {
  const paths = new Set<string>([""]);
  const add = (value: string): void => {
    const normalized = normalizeWorkspacePath(value);
    let current = "";
    for (const segment of normalized.split("/").filter(Boolean)) {
      current = current ? `${current}/${segment}` : segment;
      paths.add(current);
    }
  };
  for (const directory of catalog.directories ?? []) add(directory.path);
  for (const document of [...catalog.artifacts, ...catalog.references, ...catalog.prototypes, ...(catalog.unavailable ?? [])])
    add(documentDirectory(document.path));
  return [...paths].sort((left, right) => left.localeCompare(right));
}

function SourceDirectoryPicker({
  catalog,
  selected,
  onChoose,
  onClose,
}: {
  readonly catalog: DocumentCatalog;
  readonly selected: string;
  readonly onChoose: (directory: string) => void;
  readonly onClose: () => void;
}) {
  const [selection, setSelection] = useState(normalizeWorkspacePath(selected));
  const [query, setQuery] = useState("");
  const directories = useMemo(
    () =>
      sourceDirectories(catalog).filter(
        (path) => !query.trim() || (path || "UIAuthoring").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
      ),
    [catalog, query],
  );
  return (
    <div className={webClasses("modal-backdrop source-directory-backdrop")} onPointerDown={onClose}>
      <section
        className={webClasses("authoring-dialog source-directory-picker")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-directory-title"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <header>
          <div>
            <FolderTree size={15} />
            <strong id="source-directory-title">选择 Source 目录</strong>
            <span>{selection || "UIAuthoring"}</span>
          </div>
          <button className={webClasses("icon-button")} type="button" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </header>
        <div className={webClasses("source-directory-search")}>
          <Search size={14} />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索目录" />
        </div>
        <div className={webClasses("source-directory-list")} role="listbox" aria-label="Source 目录">
          {directories.map((path) => {
            const depth = path ? path.split("/").length : 0;
            const active = path === selection;
            return (
              <button
                key={path || "root"}
                className={webClasses(active ? "is-active" : "")}
                style={{ paddingLeft: 10 + depth * 15 }}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => setSelection(path)}
                onDoubleClick={() => onChoose(path)}
              >
                {active ? <FolderOpen size={14} /> : <Folder size={14} />}
                <span>{path.split("/").at(-1) || "UIAuthoring"}</span>
                <small>{path || "Source 根目录"}</small>
              </button>
            );
          })}
        </div>
        <footer>
          <button className={webClasses("dialog-secondary")} type="button" onClick={onClose}>
            取消
          </button>
          <button className={webClasses("dialog-primary")} type="button" onClick={() => onChoose(selection)}>
            <Check size={15} />
            选择
          </button>
        </footer>
      </section>
    </div>
  );
}
