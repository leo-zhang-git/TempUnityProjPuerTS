import { Columns2, Copy, FolderInput, FolderOpen, Image as ImageIcon, LayoutGrid, List, Rows2, Square, Trash2, X } from "lucide-react";
import { type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AuthoringAssetEntry } from "../../../schema/asset-catalog.js";
import type { UiWorkspaceDocumentKind } from "../../../schema/ui-api.js";
import type { UiAssetOperation } from "../../../schema/ui-asset-move.js";
import { normalizeAssetDirectory } from "../../editors/artifact/assets/asset-browser-model.js";
import dialogStyles from "../../editors/shared/dialog.module.css";
import sharedStyles from "../../editors/shared/editor-shell.module.css";
import { applyAssetOperation, applyWorkspaceDocumentOperation, type DocumentCatalog } from "../../shared/api/client.js";
import { ContextMenu, type ContextMenuItem } from "../../shared/context-menu.js";
import type { ProjectDragItem } from "../../shared/project-drag.js";
import { useFrameSelectedShortcut } from "../../shared/selected-item-reveal.js";
import { createWebClasses } from "../../styles/web-styles.js";
import { normalizeWorkspacePath } from "../explorer/artifact-explorer-model.js";
import { useWorkspaceEditing } from "../workspace-editing-context.js";
import { ProjectBrowser, type ProjectRoot, type ProjectSelection } from "./project-browser.js";
import projectStyles from "./project-panel.module.css";

const webClasses = createWebClasses(projectStyles, sharedStyles, dialogStyles);

type ProjectView = "list" | "grid";
type ProjectOrientation = "single" | "horizontal" | "vertical";

interface ProjectPreference {
  readonly sourceView: ProjectView;
  readonly assetView: ProjectView;
  readonly orientation: ProjectOrientation;
}

function preferenceKey(dock: "left" | "bottom"): string {
  return `ui-authoring:project-panel:${dock}:v2`;
}

function loadPreference(dock: "left" | "bottom"): ProjectPreference {
  try {
    const value = JSON.parse(window.localStorage.getItem(preferenceKey(dock)) ?? "null") as Partial<ProjectPreference> | null;
    return {
      sourceView: value?.sourceView === "grid" ? "grid" : "list",
      assetView: value?.assetView === "list" ? "list" : "grid",
      orientation:
        value?.orientation === "single" || value?.orientation === "horizontal" || value?.orientation === "vertical"
          ? value.orientation
          : dock === "bottom"
            ? "horizontal"
            : "vertical",
    };
  } catch {
    return { sourceView: "list", assetView: "grid", orientation: dock === "bottom" ? "horizontal" : "vertical" };
  }
}

export interface ProjectPanelProps {
  readonly dock: "left" | "bottom";
  readonly catalog: DocumentCatalog;
  readonly assets: readonly AuthoringAssetEntry[];
  readonly selectedDocumentPath?: string | undefined;
  readonly selectedDirectory?: string | undefined;
  readonly frameShortcutEnabled?: boolean | undefined;
  readonly onRefreshAssets: () => Promise<void> | void;
  readonly onOpenDirectory: (path: string) => void;
  readonly onOpenArtifact: (artifactKey: string) => void;
  readonly onOpenReference: (referenceKey: string) => void;
  readonly onOpenPrototype: (prototypeKey: string, referenceKey?: string) => void;
  readonly onNotice: (notice: string) => void;
  readonly onClose?: (() => void) | undefined;
}

type AssetDialog =
  | { readonly action: "move" | "copy"; readonly asset: AuthoringAssetEntry; readonly path: string }
  | { readonly action: "delete"; readonly asset: AuthoringAssetEntry };

function assetDirectory(path: string): string {
  return normalizeAssetDirectory(path.split("/").slice(0, -1).join("/"));
}

function assetFileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function assetSiblingPath(path: string, fileName: string): string {
  const directory = assetDirectory(path);
  return directory ? `${directory}/${fileName}` : fileName;
}

function uniqueAssetCopyPath(path: string, assets: readonly AuthoringAssetEntry[]): string {
  const used = new Set(assets.map((asset) => asset.path.toLocaleLowerCase("en-US")));
  const file = assetFileName(path);
  const dot = file.lastIndexOf(".");
  const stem = dot > 0 ? file.slice(0, dot) : file;
  const extension = dot > 0 ? file.slice(dot) : "";
  let index = 1;
  while (true) {
    const suffix = index === 1 ? " Copy" : ` Copy ${index}`;
    const candidate = assetSiblingPath(path, `${stem}${suffix}${extension}`);
    if (!used.has(candidate.toLocaleLowerCase("en-US"))) return candidate;
    index += 1;
  }
}

function assetMoveTarget(path: string, directory: string): string {
  const targetDirectory = normalizeAssetDirectory(directory);
  return targetDirectory ? `${targetDirectory}/${assetFileName(path)}` : assetFileName(path);
}

function documentKindForDrag(
  item: ProjectDragItem,
  catalog: DocumentCatalog,
): { readonly kind: UiWorkspaceDocumentKind; readonly key: string; readonly path: string } | undefined {
  if (item.kind === "document") return { kind: item.documentKind, key: item.key, path: item.path };
  if (item.kind !== "artifact") return undefined;
  const document = catalog.artifacts.find((entry) => entry.artifactKey === item.artifactKey);
  return document ? { kind: "artifact", key: item.artifactKey, path: document.path } : undefined;
}

async function copyText(value: string, label: string, onNotice: (notice: string) => void): Promise<void> {
  await navigator.clipboard.writeText(value);
  onNotice(`${label} 已复制`);
}

export function ProjectPanel({
  dock,
  catalog,
  assets,
  selectedDocumentPath,
  selectedDirectory,
  frameShortcutEnabled = dock === "left",
  onRefreshAssets,
  onOpenDirectory,
  onOpenArtifact,
  onOpenReference,
  onOpenPrototype,
  onNotice,
  onClose,
}: ProjectPanelProps) {
  const [preference, setPreference] = useState<ProjectPreference>(() => loadPreference(dock));
  const selectedDocumentDirectory = selectedDocumentPath
    ? normalizeWorkspacePath(selectedDocumentPath.split("/").slice(0, -1).join("/"))
    : undefined;
  const targetDirectory = selectedDirectory ?? selectedDocumentDirectory;
  const [selection, setSelection] = useState<ProjectSelection>(() => ({
    root: "source",
    path: targetDirectory ?? "",
  }));
  const [frameSelectedRequest, setFrameSelectedRequest] = useState(0);
  const previousTargetDirectory = useRef(targetDirectory);
  const pendingFrameSelected = useRef(false);
  const [assetMenu, setAssetMenu] = useState<{
    readonly x: number;
    readonly y: number;
    readonly target:
      | { readonly kind: "asset"; readonly asset: AuthoringAssetEntry }
      | { readonly kind: "directory"; readonly path: string };
  } | null>(null);
  const [assetDialog, setAssetDialog] = useState<AssetDialog | null>(null);
  const [assetRunning, setAssetRunning] = useState(false);
  const [assetError, setAssetError] = useState("");
  const [toast, setToast] = useState("");
  const editing = useWorkspaceEditing();
  useEffect(() => {
    try {
      window.localStorage.setItem(preferenceKey(dock), JSON.stringify(preference));
    } catch {
      // Layout preferences remain usable for the current session when storage is blocked.
    }
  }, [dock, preference]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const previous = previousTargetDirectory.current;
    previousTargetDirectory.current = targetDirectory;
    if (targetDirectory === undefined || previous === targetDirectory) return;
    setSelection((current) =>
      current.root === "source" && current.path === (previous ?? "") ? { root: "source", path: targetDirectory } : current,
    );
  }, [targetDirectory]);
  useLayoutEffect(() => {
    if (!pendingFrameSelected.current || selection.root !== "source" || selection.path !== selectedDocumentDirectory) return;
    pendingFrameSelected.current = false;
    setFrameSelectedRequest((current) => current + 1);
  }, [selectedDocumentDirectory, selection.path, selection.root]);
  useFrameSelectedShortcut(frameShortcutEnabled && Boolean(selectedDocumentPath), () => {
    if (!selectedDocumentPath || selectedDocumentDirectory === undefined) return false;
    const alreadyInSelectedDirectory = selection.root === "source" && selection.path === selectedDocumentDirectory;
    pendingFrameSelected.current = !alreadyInSelectedDirectory;
    setSelection({ root: "source", path: selectedDocumentDirectory });
    if (alreadyInSelectedDirectory) setFrameSelectedRequest((current) => current + 1);
    return true;
  });
  const activeRoot: ProjectRoot = preference.orientation === "single" ? "source" : selection.root;
  const currentView = activeRoot === "assets" ? preference.assetView : preference.sourceView;
  const setCurrentView = (view: ProjectView): void => {
    setPreference((current) => (activeRoot === "assets" ? { ...current, assetView: view } : { ...current, sourceView: view }));
  };
  const selectProject = (next: ProjectSelection): void => {
    setSelection(next);
  };
  const showUnsupportedOpen = (label: string): void => {
    const message = `暂不支持打开 ${label}`;
    setToast(message);
    onNotice(message);
  };
  const openAssetMenu = (
    event: MouseEvent<HTMLElement>,
    target: { readonly kind: "asset"; readonly asset: AuthoringAssetEntry } | { readonly kind: "directory"; readonly path: string },
  ): void => {
    event.preventDefault();
    event.stopPropagation();
    setAssetMenu({ x: event.clientX, y: event.clientY, target });
  };
  const startAssetDialog = (dialog: AssetDialog): void => {
    setAssetMenu(null);
    setAssetError("");
    setAssetDialog(dialog);
  };
  const applyAsset = async (operation: UiAssetOperation): Promise<void> => {
    if (assetRunning) return;
    setAssetRunning(true);
    setAssetError("");
    try {
      const result = await applyAssetOperation(operation);
      await onRefreshAssets();
      onNotice(
        `${result.action === "copy" ? "已复制" : result.action === "delete" ? "已删除" : "已移动"} ${result.from}${result.to ? ` -> ${result.to}` : ""}`,
      );
      setAssetDialog(null);
      if (operation.action === "move") window.location.reload();
    } catch (reason) {
      setAssetError(reason instanceof Error ? reason.message : String(reason));
      onNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setAssetRunning(false);
    }
  };
  const moveProjectItem = async (root: ProjectRoot, item: ProjectDragItem, directory: string): Promise<void> => {
    if (editing.dirtyDocuments.size > 0) {
      onNotice("请先保存当前工作区修改");
      return;
    }
    try {
      if (root === "assets") {
        if (item.kind !== "asset") throw new Error("UIAuthoring 文档不能移动到 Assets/Resources/UI");
        const to = assetMoveTarget(item.path, directory);
        if (to === item.path) return;
        await applyAssetOperation({ action: "move", from: item.path, to });
        await onRefreshAssets();
        onNotice(`已移动 ${item.path} -> ${to}`);
        window.location.reload();
        return;
      }
      const document = documentKindForDrag(item, catalog);
      if (!document) throw new Error("Assets/Resources/UI 资源不能移动到 UIAuthoring");
      const nextPath = normalizeWorkspacePath(`${directory}/${document.path.split("/").at(-1) ?? document.path}`);
      if (nextPath === document.path) return;
      await applyWorkspaceDocumentOperation({
        action: "move-document",
        kind: document.kind,
        key: document.key,
        nextKey: document.key,
        nextPath,
      });
      onNotice(`已移动 ${document.path} -> ${nextPath}`);
      window.location.reload();
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const assetMenuTarget = assetMenu?.target;
  const assetMenuItems: readonly ContextMenuItem[] =
    assetMenuTarget?.kind === "asset"
      ? [
          {
            key: "move",
            label: "重命名 / 移动",
            icon: <FolderInput size={14} />,
            onSelect: () => startAssetDialog({ action: "move", asset: assetMenuTarget.asset, path: assetMenuTarget.asset.path }),
          },
          {
            key: "copy",
            label: "制作副本",
            icon: <Copy size={14} />,
            onSelect: () =>
              startAssetDialog({
                action: "copy",
                asset: assetMenuTarget.asset,
                path: uniqueAssetCopyPath(assetMenuTarget.asset.path, assets),
              }),
          },
          {
            key: "copy-path",
            label: "复制路径",
            icon: <Copy size={14} />,
            dividerBefore: true,
            onSelect: () => void copyText(assetMenuTarget.asset.path, "路径", onNotice),
          },
          {
            key: "delete",
            label: "删除资源",
            icon: <Trash2 size={14} />,
            danger: true,
            dividerBefore: true,
            onSelect: () => startAssetDialog({ action: "delete", asset: assetMenuTarget.asset }),
          },
        ]
      : assetMenuTarget
        ? [
            {
              key: "copy-path",
              label: "复制路径",
              icon: <Copy size={14} />,
              onSelect: () => void copyText(assetMenuTarget.path ? `Assets/Resources/UI/${assetMenuTarget.path}` : "Assets/Resources/UI", "路径", onNotice),
            },
          ]
        : [];
  const content = (
    <ProjectBrowser
      catalog={catalog}
      assets={assets}
      dock={dock}
      orientation={preference.orientation}
      selection={selection}
      selectedDocumentPath={selectedDocumentPath}
      frameSelectedRequest={frameSelectedRequest}
      view={currentView}
      onSelect={selectProject}
      onOpenDirectory={onOpenDirectory}
      onOpenArtifact={onOpenArtifact}
      onOpenReference={onOpenReference}
      onOpenPrototype={onOpenPrototype}
      onRefreshAssets={onRefreshAssets}
      onAssetContextMenu={(event, asset) => openAssetMenu(event, { kind: "asset", asset })}
      onAssetDirectoryContextMenu={(event, path) => openAssetMenu(event, { kind: "directory", path })}
      onMoveItem={(root, item, directory) => void moveProjectItem(root, item, directory)}
      onUnsupportedOpen={showUnsupportedOpen}
    />
  );
  return (
    <section className={webClasses(`project-panel is-${dock}`)} aria-label={`${dock === "left" ? "左侧" : "底部"} Project`}>
      <header className={webClasses("project-panel-header")}>
        <strong>
          <FolderOpen size={14} />
          Project
        </strong>
        <div className={webClasses("project-orientation")} role="group" aria-label="Project 排布">
          <button
            className={webClasses(preference.orientation === "single" ? "is-active" : "")}
            type="button"
            aria-pressed={preference.orientation === "single"}
            onClick={() => setPreference((current) => ({ ...current, orientation: "single" }))}
            title="单栏 UIAuthoring"
          >
            <Square size={12} />
          </button>
          <button
            className={webClasses(preference.orientation === "horizontal" ? "is-active" : "")}
            type="button"
            aria-pressed={preference.orientation === "horizontal"}
            onClick={() => setPreference((current) => ({ ...current, orientation: "horizontal" }))}
            title="左右排布"
          >
            <Columns2 size={13} />
          </button>
          <button
            className={webClasses(preference.orientation === "vertical" ? "is-active" : "")}
            type="button"
            aria-pressed={preference.orientation === "vertical"}
            onClick={() => setPreference((current) => ({ ...current, orientation: "vertical" }))}
            title="上下排布"
          >
            <Rows2 size={13} />
          </button>
        </div>
        <div className={webClasses("project-view")} role="group" aria-label="Project 布局">
          <button
            className={webClasses(currentView === "list" ? "is-active" : "")}
            type="button"
            aria-pressed={currentView === "list"}
            onClick={() => setCurrentView("list")}
            title="列表"
          >
            <List size={13} />
          </button>
          <button
            className={webClasses(currentView === "grid" ? "is-active" : "")}
            type="button"
            aria-pressed={currentView === "grid"}
            onClick={() => setCurrentView("grid")}
            title="网格"
          >
            <LayoutGrid size={13} />
          </button>
        </div>
        {onClose ? (
          <button className={webClasses("project-close")} type="button" onClick={onClose} title="关闭底部 Project">
            <X size={14} />
          </button>
        ) : null}
      </header>
      <div className={webClasses("project-panel-content is-browser")}>{content}</div>
      {assetMenu ? <ContextMenu x={assetMenu.x} y={assetMenu.y} items={assetMenuItems} onClose={() => setAssetMenu(null)} /> : null}
      {assetDialog ? (
        <AssetOperationDialog
          dialog={assetDialog}
          running={assetRunning}
          error={assetError}
          onDialog={(next) => {
            setAssetError("");
            setAssetDialog(next);
          }}
          onClose={() => setAssetDialog(null)}
          onSubmit={() => {
            const issue = explainAssetDialogIssue(assetDialog);
            if (issue) setAssetError(issue);
            else void applyAsset(assetOperationFor(assetDialog));
          }}
        />
      ) : null}
      {toast ? (
        <div className={webClasses("project-toast")} role="status">
          {toast}
        </div>
      ) : null}
    </section>
  );
}

function assetOperationFor(dialog: AssetDialog): UiAssetOperation {
  if (dialog.action === "delete") return { action: "delete", path: dialog.asset.path };
  return { action: dialog.action, from: dialog.asset.path, to: normalizeAssetDirectory(dialog.path) };
}

function explainAssetDialogIssue(dialog: AssetDialog): string | undefined {
  if (dialog.action === "delete") return undefined;
  const path = normalizeAssetDirectory(dialog.path);
  if (!path) return "资源路径不能为空";
  if (path === dialog.asset.path) return "资源路径未变化";
  return undefined;
}

function AssetOperationDialog({
  dialog,
  running,
  error,
  onDialog,
  onClose,
  onSubmit,
}: {
  readonly dialog: AssetDialog;
  readonly running: boolean;
  readonly error: string;
  readonly onDialog: (dialog: AssetDialog) => void;
  readonly onClose: () => void;
  readonly onSubmit: () => void;
}) {
  const deletion = dialog.action === "delete";
  const title = dialog.action === "copy" ? "制作资源副本" : dialog.action === "move" ? "重命名 / 移动资源" : "删除资源";
  const draftIssue = explainAssetDialogIssue(dialog);
  const visibleIssue = draftIssue ?? error;
  return (
    <div className={webClasses("modal-backdrop")} onPointerDown={running ? undefined : onClose}>
      <form
        className={webClasses("authoring-dialog")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-operation-title"
        aria-describedby={visibleIssue ? "asset-operation-issue" : undefined}
        aria-invalid={Boolean(draftIssue)}
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <header>
          <div>
            <ImageIcon size={15} />
            <strong id="asset-operation-title">{title}</strong>
            <span>{dialog.asset.path}</span>
          </div>
          <button className={webClasses("icon-button")} type="button" onClick={onClose} disabled={running} title="关闭">
            <X size={16} />
          </button>
        </header>
        {deletion ? (
          <p className={webClasses("dialog-message")}>仍被 Source 引用的资源会被阻止删除；资源文件和 .meta 会一起处理。</p>
        ) : (
          <div className={webClasses("dialog-fields")}>
            <label>
              <span>资源路径</span>
              <input autoFocus value={dialog.path} onChange={(event) => onDialog({ ...dialog, path: event.target.value })} />
            </label>
          </div>
        )}
        {visibleIssue ? (
          <p className={webClasses("dialog-feedback is-error")} id="asset-operation-issue" role="alert">
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
            {deletion ? <Trash2 size={15} /> : <FolderInput size={15} />}
            {running ? "处理中" : title}
          </button>
        </footer>
      </form>
    </div>
  );
}
