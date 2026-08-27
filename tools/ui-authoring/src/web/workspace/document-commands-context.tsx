import {
  BookOpen,
  Copy,
  FilePlus2,
  FolderInput,
  FolderOpen,
  FolderPlus,
  GitFork,
  KeyRound,
  MousePointer2,
  Move,
  Trash2,
  X,
} from "lucide-react";
import { createContext, type KeyboardEvent, type MouseEvent, type ReactNode, useContext, useMemo, useState } from "react";
import type { UiWorkspaceDocumentKind, UiWorkspaceDocumentOperation } from "../../schema/ui-api.js";
import dialogStyles from "../editors/shared/dialog.module.css";
import sharedStyles from "../editors/shared/editor-shell.module.css";
import { applyWorkspaceDocumentOperation, type DocumentCatalog } from "../shared/api/client.js";
import { ContextMenu, type ContextMenuItem } from "../shared/context-menu.js";
import { createWebClasses } from "../styles/web-styles.js";
import {
  documentDirectory,
  normalizeWorkspacePath,
  type WorkspaceLocation,
  workspaceLocationSearch,
} from "./explorer/artifact-explorer-model.js";
import { useWorkspaceNavigation } from "./explorer/workspace-navigation-state.js";
import { useWorkspaceProblems } from "./problems/workspace-problems.js";
import { SourcePathField } from "./source-path-field.js";

const webClasses = createWebClasses(sharedStyles, dialogStyles);

export type WorkspaceCommandTarget =
  | { readonly kind: "artifact"; readonly key: string; readonly path: string }
  | { readonly kind: "reference"; readonly key: string; readonly path: string }
  | { readonly kind: "prototype"; readonly key: string; readonly path: string }
  | { readonly kind: "unavailable"; readonly key: string; readonly path: string }
  | { readonly kind: "directory"; readonly path: string };

interface WorkspaceDocumentCommandsContextValue {
  readonly open: (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, target: WorkspaceCommandTarget) => void;
}

const WorkspaceDocumentCommandsContext = createContext<WorkspaceDocumentCommandsContextValue>({ open: () => {} });

export function useWorkspaceDocumentCommands(): WorkspaceDocumentCommandsContextValue {
  return useContext(WorkspaceDocumentCommandsContext);
}

type DocumentTarget = Extract<WorkspaceCommandTarget, { kind: UiWorkspaceDocumentKind }>;
type DialogState =
  | {
      readonly action: "move-document" | "duplicate-document";
      readonly target: DocumentTarget;
      readonly key: string;
      readonly path: string;
    }
  | {
      readonly action: "create-variant" | "create-reference";
      readonly target: Extract<DocumentTarget, { kind: "artifact" }>;
      readonly key: string;
      readonly path: string;
    }
  | {
      readonly action: "create-directory";
      readonly target: Extract<WorkspaceCommandTarget, { kind: "directory" }>;
      readonly path: string;
      readonly displayName: string;
      readonly description: string;
    }
  | { readonly action: "move-directory"; readonly target: Extract<WorkspaceCommandTarget, { kind: "directory" }>; readonly path: string }
  | { readonly action: "delete-document"; readonly target: DocumentTarget }
  | { readonly action: "delete-directory"; readonly target: Extract<WorkspaceCommandTarget, { kind: "directory" }> };

export function WorkspaceDocumentCommandsProvider({
  catalog,
  dirty,
  onCreate,
  onNotice,
  children,
}: {
  readonly catalog: DocumentCatalog;
  readonly dirty: boolean;
  readonly onCreate: (directory: string) => void;
  readonly onNotice: (message: string) => void;
  readonly children: ReactNode;
}) {
  const navigation = useWorkspaceNavigation();
  const problems = useWorkspaceProblems();
  const [menu, setMenu] = useState<{ readonly x: number; readonly y: number; readonly target: WorkspaceCommandTarget } | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const value = useMemo<WorkspaceDocumentCommandsContextValue>(
    () => ({
      open: (event, target) => {
        const keyboard = "key" in event;
        if (keyboard && event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
        event.preventDefault();
        event.stopPropagation();
        const bounds = event.currentTarget.getBoundingClientRect();
        setMenu({
          x: keyboard ? bounds.left + 12 : event.clientX,
          y: keyboard ? bounds.top + Math.min(28, bounds.height) : event.clientY,
          target,
        });
      },
    }),
    [],
  );

  const start = (next: DialogState): void => {
    setMenu(null);
    setError("");
    setDialog(next);
  };
  const mutationDisabledReason = dirty ? "请先保存当前工作区修改" : undefined;
  const directoryMaintenanceDisabledReason =
    mutationDisabledReason ?? (menu?.target.kind === "directory" && !menu.target.path ? "Source 根目录不可移动或删除" : undefined);
  const menuItems = menu
    ? itemsFor(menu.target, mutationDisabledReason, directoryMaintenanceDisabledReason, {
        openTarget: () =>
          menu.target.kind === "unavailable" ? problems.open(menu.target.path) : openTarget(menu.target, navigation.openLocation),
        create: () => menu.target.kind === "directory" && onCreate(menu.target.path),
        createDirectory: () => {
          if (menu.target.kind !== "directory") return;
          const path = uniqueDirectoryPath(menu.target.path, catalog);
          start({
            action: "create-directory",
            target: menu.target,
            path,
            displayName: "新建目录",
            description: "Source 目录",
          });
        },
        move: () => {
          if (menu.target.kind === "directory") start({ action: "move-directory", target: menu.target, path: menu.target.path });
          else if (menu.target.kind !== "unavailable")
            start({ action: "move-document", target: menu.target, key: menu.target.key, path: menu.target.path });
        },
        duplicate: () => {
          if (menu.target.kind === "directory" || menu.target.kind === "unavailable") return;
          const key = uniqueKey(`${menu.target.key}Copy`, catalog);
          start({
            action: "duplicate-document",
            target: menu.target,
            key,
            path: siblingPath(menu.target.path, key, extensionFor(menu.target.kind)),
          });
        },
        variant: () => {
          if (menu.target.kind !== "artifact") return;
          const key = uniqueKey(`${menu.target.key}Variant`, catalog);
          start({ action: "create-variant", target: menu.target, key, path: siblingPath(menu.target.path, key, ".ui.json") });
        },
        reference: () => {
          if (menu.target.kind !== "artifact") return;
          const key = uniqueKey(`${menu.target.key}Reference`, catalog);
          start({ action: "create-reference", target: menu.target, key, path: siblingPath(menu.target.path, key, ".ui-reference.json") });
        },
        copyKey: () => void copyText("key" in menu.target ? menu.target.key : "", "Key", onNotice),
        copyPath: () => void copyText(menu.target.path || "UIAuthoring", "路径", onNotice),
        remove: () => {
          if (menu.target.kind === "directory") start({ action: "delete-directory", target: menu.target });
          else if (menu.target.kind !== "unavailable") start({ action: "delete-document", target: menu.target });
        },
      })
    : [];

  const submit = async (): Promise<void> => {
    if (!dialog || running || dirty) return;
    const draftIssue = explainWorkspaceOperationDraftIssue(dialog, catalog);
    if (draftIssue) {
      setError(draftIssue);
      return;
    }
    const operation = operationFor(dialog);
    setRunning(true);
    setError("");
    try {
      const result = await applyWorkspaceDocumentOperation(operation);
      onNotice(`已更新 ${result.changedPaths.length} 个 Source 文件`);
      const location = result.location ? apiLocation(result.location) : fallbackLocation(dialog);
      window.location.assign(workspaceLocationSearch(location));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRunning(false);
    }
  };

  return (
    <WorkspaceDocumentCommandsContext.Provider value={value}>
      {children}
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} /> : null}
      {dialog ? (
        <WorkspaceOperationDialog
          dialog={dialog}
          catalog={catalog}
          running={running}
          error={error}
          onDialog={(next) => {
            setError("");
            setDialog(next);
          }}
          onClose={() => setDialog(null)}
          onSubmit={() => void submit()}
        />
      ) : null}
    </WorkspaceDocumentCommandsContext.Provider>
  );
}

function itemsFor(
  target: WorkspaceCommandTarget,
  mutationDisabledReason: string | undefined,
  directoryMaintenanceDisabledReason: string | undefined,
  actions: Record<
    "openTarget" | "create" | "createDirectory" | "move" | "duplicate" | "variant" | "reference" | "copyKey" | "copyPath" | "remove",
    () => void
  >,
): readonly ContextMenuItem[] {
  const disabled = Boolean(mutationDisabledReason);
  if (target.kind === "unavailable")
    return [
      { key: "open", label: "查看问题", icon: <BookOpen size={14} />, onSelect: actions.openTarget },
      { key: "copy-path", label: "复制路径", icon: <Copy size={14} />, onSelect: actions.copyPath },
    ];
  if (target.kind === "directory")
    return [
      { key: "open", label: "打开目录", icon: <FolderOpen size={14} />, onSelect: actions.openTarget },
      { key: "create", label: "在此新建文档", icon: <FilePlus2 size={14} />, onSelect: actions.create },
      {
        key: "create-directory",
        label: "新建目录",
        icon: <FolderPlus size={14} />,
        disabled,
        disabledReason: mutationDisabledReason,
        onSelect: actions.createDirectory,
      },
      {
        key: "move",
        label: "重命名 / 移动",
        icon: <FolderInput size={14} />,
        disabled: Boolean(directoryMaintenanceDisabledReason),
        disabledReason: directoryMaintenanceDisabledReason,
        dividerBefore: true,
        onSelect: actions.move,
      },
      { key: "copy-path", label: "复制路径", icon: <Copy size={14} />, onSelect: actions.copyPath },
      {
        key: "delete",
        label: "删除空目录",
        icon: <Trash2 size={14} />,
        danger: true,
        disabled: Boolean(directoryMaintenanceDisabledReason),
        disabledReason: directoryMaintenanceDisabledReason,
        dividerBefore: true,
        onSelect: actions.remove,
      },
    ];
  return [
    { key: "open", label: "打开", icon: <FolderOpen size={14} />, onSelect: actions.openTarget },
    {
      key: "move",
      label: "重命名 / 移动",
      icon: <Move size={14} />,
      disabled,
      disabledReason: mutationDisabledReason,
      onSelect: actions.move,
    },
    {
      key: "duplicate",
      label: "制作副本",
      icon: <Copy size={14} />,
      disabled,
      disabledReason: mutationDisabledReason,
      onSelect: actions.duplicate,
    },
    ...(target.kind === "artifact"
      ? ([
          {
            key: "variant",
            label: "制作 Variant",
            icon: <GitFork size={14} />,
            disabled,
            disabledReason: mutationDisabledReason,
            onSelect: actions.variant,
          },
          {
            key: "reference",
            label: "制作 Reference",
            icon: <BookOpen size={14} />,
            disabled,
            disabledReason: mutationDisabledReason,
            onSelect: actions.reference,
          },
        ] satisfies ContextMenuItem[])
      : []),
    {
      key: "copy-key",
      label: `复制 ${workspaceDocumentKeyLabel(target.kind)}`,
      icon: <KeyRound size={14} />,
      dividerBefore: true,
      onSelect: actions.copyKey,
    },
    { key: "copy-path", label: "复制路径", icon: <Copy size={14} />, onSelect: actions.copyPath },
    {
      key: "delete",
      label: "删除文档",
      icon: <Trash2 size={14} />,
      danger: true,
      disabled,
      disabledReason: mutationDisabledReason,
      dividerBefore: true,
      onSelect: actions.remove,
    },
  ];
}

function WorkspaceOperationDialog({
  dialog,
  catalog,
  running,
  error,
  onDialog,
  onClose,
  onSubmit,
}: {
  readonly dialog: DialogState;
  readonly catalog: DocumentCatalog;
  readonly running: boolean;
  readonly error: string;
  readonly onDialog: (dialog: DialogState) => void;
  readonly onClose: () => void;
  readonly onSubmit: () => void;
}) {
  const deletion = dialog.action === "delete-document" || dialog.action === "delete-directory";
  const directoryCreation = dialog.action === "create-directory";
  const title = dialogTitle(dialog.action);
  const draftIssue = explainWorkspaceOperationDraftIssue(dialog, catalog);
  const visibleIssue = draftIssue ?? error;
  return (
    <div className={webClasses("modal-backdrop")} onPointerDown={running ? undefined : onClose}>
      <form
        className={webClasses("authoring-dialog")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-operation-title"
        aria-describedby={visibleIssue ? "workspace-operation-issue" : undefined}
        aria-invalid={Boolean(draftIssue)}
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <header>
          <div>
            <MousePointer2 size={15} />
            <strong id="workspace-operation-title">{title}</strong>
            <span>{dialog.target.path || "UIAuthoring"}</span>
          </div>
          <button className={webClasses("icon-button")} type="button" onClick={onClose} disabled={running} title="关闭">
            <X size={16} />
          </button>
        </header>
        {directoryCreation ? (
          <div className={webClasses("dialog-fields")}>
            <SourcePathField
              label="Source 目录"
              value={dialog.path}
              catalog={catalog}
              mode="directory"
              autoFocus
              onChange={(path) => onDialog({ ...dialog, path })}
            />
            <label>
              <span>显示名称</span>
              <input value={dialog.displayName} onChange={(event) => onDialog({ ...dialog, displayName: event.target.value })} />
            </label>
            <label>
              <span>描述</span>
              <input value={dialog.description} onChange={(event) => onDialog({ ...dialog, description: event.target.value })} />
            </label>
          </div>
        ) : deletion ? (
          <p className={webClasses("dialog-message")}>
            {dialog.action === "delete-directory"
              ? "仅空目录可以删除。该操作会移除目录 metadata。"
              : "存在 Artifact、Reference 或 Prototype 依赖时，删除会被阻止。"}
          </p>
        ) : (
          <div className={webClasses("dialog-fields")}>
            {dialog.action !== "move-directory" ? (
              <label>
                <span>{dialogKeyLabel(dialog)}</span>
                <input autoFocus value={dialog.key} onChange={(event) => onDialog(dialogWithKey(dialog, event.target.value))} />
              </label>
            ) : null}
            <SourcePathField
              label={dialog.action === "move-directory" ? "目标目录" : "Source 路径"}
              value={dialog.path}
              catalog={catalog}
              mode={dialog.action === "move-directory" ? "directory" : "file"}
              autoFocus={dialog.action === "move-directory"}
              onChange={(path) => onDialog({ ...dialog, path } as DialogState)}
            />
          </div>
        )}
        {visibleIssue ? (
          <p className={webClasses("dialog-feedback is-error")} id="workspace-operation-issue" role="alert">
            {visibleIssue}
          </p>
        ) : null}
        <footer>
          <button className={webClasses("dialog-secondary")} type="button" onClick={onClose} disabled={running}>
            取消
          </button>
          <button
            className={webClasses(deletion ? "dialog-danger" : "dialog-primary")}
            type="submit"
            disabled={running || Boolean(draftIssue)}
            title={draftIssue ?? title}
          >
            {deletion ? <Trash2 size={15} /> : directoryCreation ? <FolderPlus size={15} /> : <Move size={15} />}
            {running ? "处理中" : title}
          </button>
        </footer>
      </form>
    </div>
  );
}

function workspaceDocumentKeyLabel(kind: UiWorkspaceDocumentKind): string {
  if (kind === "artifact") return "Artifact Key";
  if (kind === "reference") return "Reference Key";
  return "Prototype Key";
}

function dialogKeyLabel(dialog: DialogState): string {
  if (dialog.action === "create-reference") return "Reference Key";
  if (dialog.action === "create-variant") return "Artifact Key";
  if (dialog.target.kind === "directory") return "Key";
  return workspaceDocumentKeyLabel(dialog.target.kind);
}

function operationFor(dialog: DialogState): UiWorkspaceDocumentOperation {
  if (dialog.action === "move-document" || dialog.action === "duplicate-document")
    return {
      action: dialog.action,
      kind: dialog.target.kind,
      key: dialog.target.key,
      nextKey: dialog.key.trim(),
      nextPath: normalizeWorkspacePath(dialog.path),
    };
  if (dialog.action === "create-variant" || dialog.action === "create-reference")
    return {
      action: dialog.action,
      artifactKey: dialog.target.key,
      nextKey: dialog.key.trim(),
      nextPath: normalizeWorkspacePath(dialog.path),
    };
  if (dialog.action === "create-directory")
    return {
      action: dialog.action,
      path: normalizeWorkspacePath(dialog.path),
      displayName: dialog.displayName.trim(),
      description: dialog.description.trim(),
    };
  if (dialog.action === "move-directory")
    return { action: dialog.action, path: dialog.target.path, nextPath: normalizeWorkspacePath(dialog.path) };
  if (dialog.action === "delete-directory") return { action: dialog.action, path: dialog.target.path };
  return { action: dialog.action, kind: dialog.target.kind, key: dialog.target.key };
}

function explainWorkspaceOperationDraftIssue(dialog: DialogState, catalog: DocumentCatalog): string | undefined {
  if (dialog.action === "delete-document" || dialog.action === "delete-directory") return undefined;
  const path = normalizeWorkspacePath(dialog.path);
  if (!path)
    return dialog.action === "move-directory"
      ? "目标目录不能为空"
      : dialog.action === "create-directory"
        ? "Source 目录不能为空"
        : "Source 路径不能为空";
  if (path.split("/").includes("..")) return "Source 目录不能包含 '..'";
  if (dialog.action === "create-directory") {
    if (!dialog.displayName.trim()) return "显示名称不能为空";
    if (!dialog.description.trim()) return "描述不能为空";
    if (sourceDirectoryPaths(catalog).has(path.toLocaleLowerCase("en-US"))) return `Source 目录“${path}”已存在`;
    return undefined;
  }
  if (dialog.action === "move-directory") {
    if (path === dialog.target.path) return "目标目录未变化";
    return undefined;
  }
  const key = dialog.key.trim();
  if (!key) return "Key 不能为空";
  if (!/^[A-Z][A-Za-z0-9]*$/.test(key)) return "Key 必须以大写英文字母开头，且只能包含英文字母和数字";
  const extension =
    dialog.action === "create-reference"
      ? ".ui-reference.json"
      : dialog.action === "create-variant"
        ? ".ui.json"
        : extensionFor(dialog.target.kind);
  if (!path.endsWith(extension)) return `Source 路径必须以 ${extension} 结尾`;
  if (dialog.action === "move-document" && key === dialog.target.key && path === dialog.target.path) return "Key 和 Source 路径均未变化";
  const existingKeys = new Set([
    ...catalog.artifacts.map((entry) => entry.artifactKey),
    ...catalog.references.map((entry) => entry.referenceKey),
    ...catalog.prototypes.map((entry) => entry.prototypeKey),
  ]);
  const existingPaths = new Set([
    ...catalog.artifacts.map((entry) => entry.path),
    ...catalog.references.map((entry) => entry.path),
    ...catalog.prototypes.map((entry) => entry.path),
  ]);
  if ((dialog.action !== "move-document" || key !== dialog.target.key) && existingKeys.has(key)) return `文档 Key“${key}”已存在`;
  if ((dialog.action !== "move-document" || path !== dialog.target.path) && existingPaths.has(path)) return `文档路径“${path}”已存在`;
  return undefined;
}

function dialogTitle(action: DialogState["action"]): string {
  if (action === "move-document" || action === "move-directory") return "重命名 / 移动";
  if (action === "create-directory") return "新建目录";
  if (action === "duplicate-document") return "制作副本";
  if (action === "create-variant") return "创建 Variant";
  if (action === "create-reference") return "创建 Reference";
  return "删除";
}

function sourceDirectoryPaths(catalog: DocumentCatalog): ReadonlySet<string> {
  const paths = new Set<string>([""]);
  const add = (value: string): void => {
    const segments = normalizeWorkspacePath(value).split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      paths.add(current.toLocaleLowerCase("en-US"));
    }
  };
  for (const directory of catalog.directories ?? []) add(directory.path);
  for (const document of [...catalog.artifacts, ...catalog.references, ...catalog.prototypes, ...(catalog.unavailable ?? [])])
    add(documentDirectory(document.path));
  return paths;
}

function uniqueDirectoryPath(parent: string, catalog: DocumentCatalog): string {
  const used = sourceDirectoryPaths(catalog);
  let suffix = 1;
  while (true) {
    const name = suffix === 1 ? "NewDirectory" : `NewDirectory${suffix}`;
    const path = normalizeWorkspacePath(`${parent}/${name}`);
    if (!used.has(path.toLocaleLowerCase("en-US"))) return path;
    suffix += 1;
  }
}

function uniqueKey(stem: string, catalog: DocumentCatalog): string {
  const used = new Set([
    ...catalog.artifacts.map((entry) => entry.artifactKey),
    ...catalog.references.map((entry) => entry.referenceKey),
    ...catalog.prototypes.map((entry) => entry.prototypeKey),
  ]);
  let key = stem;
  let suffix = 2;
  while (used.has(key)) key = `${stem}${suffix++}`;
  return key;
}

function extensionFor(kind: UiWorkspaceDocumentKind): string {
  if (kind === "reference") return ".ui-reference.json";
  if (kind === "prototype") return ".ui-prototype.json";
  return ".ui.json";
}

function siblingPath(path: string, key: string, extension: string): string {
  return normalizeWorkspacePath(`${documentDirectory(path)}/${key}${extension}`);
}

function dialogWithKey(
  dialog: Extract<DialogState, { readonly key: string }>,
  key: string,
): Extract<DialogState, { readonly key: string }> {
  const extension =
    dialog.action === "create-reference"
      ? ".ui-reference.json"
      : dialog.action === "create-variant"
        ? ".ui.json"
        : extensionFor(dialog.target.kind);
  const normalized = normalizeWorkspacePath(dialog.path);
  const fileName = normalized.split("/").at(-1) ?? "";
  return {
    ...dialog,
    key,
    path: fileName === `${dialog.key}${extension}` ? siblingPath(normalized, key, extension) : dialog.path,
  };
}

async function copyText(value: string, label: string, onNotice: (message: string) => void): Promise<void> {
  await navigator.clipboard.writeText(value);
  onNotice(`${label} 已复制`);
}

function openTarget(target: WorkspaceCommandTarget, open: (location: WorkspaceLocation) => void): void {
  if (target.kind === "directory") open({ kind: "directory", path: target.path, view: "dependency", scale: "1:1" });
  if (target.kind === "artifact") open({ kind: "artifact", artifactKey: target.key });
  if (target.kind === "reference") open({ kind: "reference", referenceKey: target.key });
  if (target.kind === "prototype") open({ kind: "prototype", prototypeKey: target.key });
}

function apiLocation(
  location: { readonly kind: UiWorkspaceDocumentKind; readonly key: string } | { readonly kind: "directory"; readonly path: string },
): WorkspaceLocation {
  if (location.kind === "directory") return { kind: "directory", path: location.path, view: "dependency", scale: "1:1" };
  if (location.kind === "artifact") return { kind: "artifact", artifactKey: location.key };
  if (location.kind === "reference") return { kind: "reference", referenceKey: location.key };
  return { kind: "prototype", prototypeKey: location.key };
}

function fallbackLocation(dialog: DialogState): WorkspaceLocation {
  if (dialog.action === "create-directory")
    return { kind: "directory", path: normalizeWorkspacePath(dialog.path), view: "dependency", scale: "1:1" };
  const path = dialog.target.path;
  return { kind: "directory", path: documentDirectory(path), view: "dependency", scale: "1:1" };
}
