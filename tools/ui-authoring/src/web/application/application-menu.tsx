import {
  ChevronRight,
  Download,
  FileDiff,
  FileInput,
  FolderClock,
  LayoutDashboard,
  Menu,
  RefreshCw,
  Server,
  Upload,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { UiAuthoringEnvironment, UiWorkspaceIdentity, UiWorkspaceVcsAction } from "../../schema/ui-api.js";
import type { UiCollaborationProfile } from "../../schema/ui-collaboration.js";
import { loadWorkspaceEnvironments } from "../shared/api/client.js";
import { createWebClasses } from "../styles/web-styles.js";
import type { WorkspaceLocation } from "../workspace/explorer/artifact-explorer-model.js";
import type { RecentWorkspaceLocation } from "../workspace/explorer/workspace-navigation-state.js";
import applicationStyles from "./application-menu.module.css";
import type { CollaborationPresentation } from "./collaboration-state.js";

const webClasses = createWebClasses(applicationStyles);

export interface ApplicationMenuProps {
  readonly workspace: UiWorkspaceIdentity;
  readonly recent: readonly RecentWorkspaceLocation[];
  readonly dirty: boolean;
  readonly vcsBusy: UiWorkspaceVcsAction | null;
  readonly collaborationProfile: UiCollaborationProfile | null;
  readonly collaboration: CollaborationPresentation;
  readonly onOpenChanges: () => void;
  readonly onImportPrefab: () => void;
  readonly onOpenOverview: () => void;
  readonly onOpenRecent: (location: WorkspaceLocation) => void;
  readonly onVersionControl: (action: UiWorkspaceVcsAction) => Promise<void>;
  readonly onOpenProfile: () => void;
  readonly onRefreshCollaboration: () => void;
}

export function ApplicationMenu({
  workspace,
  recent,
  dirty,
  vcsBusy,
  collaborationProfile,
  collaboration,
  onOpenChanges,
  onImportPrefab,
  onOpenOverview,
  onOpenRecent,
  onVersionControl,
  onOpenProfile,
  onRefreshCollaboration,
}: ApplicationMenuProps) {
  const [open, setOpen] = useState(false);
  const [collaborationOpen, setCollaborationOpen] = useState(false);
  const [environments, setEnvironments] = useState<readonly UiAuthoringEnvironment[]>([]);
  const [environmentError, setEnvironmentError] = useState("");
  const [loadingEnvironments, setLoadingEnvironments] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const refreshEnvironments = async (): Promise<void> => {
    if (loadingEnvironments) return;
    setLoadingEnvironments(true);
    setEnvironmentError("");
    try {
      setEnvironments(await loadWorkspaceEnvironments());
    } catch (reason) {
      setEnvironmentError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoadingEnvironments(false);
    }
  };

  useEffect(() => {
    if (!open && !collaborationOpen) return;
    if (open) void refreshEnvironments();
    const onPointerDown = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setCollaborationOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
        setCollaborationOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, collaborationOpen]);

  const runVcs = async (action: UiWorkspaceVcsAction): Promise<void> => {
    setOpen(false);
    await onVersionControl(action);
  };
  const vcsDisabled = dirty || vcsBusy !== null;
  const vcsTitle = dirty ? "存在未保存改动，SVN 操作不可用" : undefined;

  return (
    <div className={webClasses("application-actions")} ref={root}>
      <button
        className={webClasses(`${open ? "is-active" : ""} ${!collaborationProfile?.userName ? "needs-profile" : ""}`)}
        type="button"
        onClick={() => {
          setCollaborationOpen(false);
          setOpen((value) => !value);
        }}
        title="菜单"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Menu size={16} />
      </button>
      <button
        className={webClasses(`collaboration-trigger is-${collaboration.tone} ${!collaborationProfile?.userName ? "needs-profile" : ""}`)}
        type="button"
        onClick={() => {
          setOpen(false);
          setCollaborationOpen((value) => !value);
        }}
        title={!collaborationProfile?.userName ? "设置昵称" : collaboration.summary}
        aria-haspopup="dialog"
        aria-expanded={collaborationOpen}
      >
        <UsersRound size={15} />
      </button>
      <button type="button" disabled={vcsDisabled} onClick={() => void runVcs("commit")} title={vcsTitle ?? "提交 UI Source 与 Assets/Resources/UI"}>
        <Upload size={16} />
      </button>
      <button type="button" disabled={vcsDisabled} onClick={() => void runVcs("update")} title={vcsTitle ?? "更新 UI Source 与 Assets/Resources/UI"}>
        <Download size={16} />
      </button>
      {collaborationOpen ? (
        <section className={webClasses("collaboration-panel")} aria-label="协作状态">
          <header>
            <span>
              <strong>协作状态</strong>
              <small>{collaboration.summary}</small>
            </span>
            <button type="button" onClick={onRefreshCollaboration} title="刷新">
              <RefreshCw size={13} />
            </button>
          </header>
          <div className={webClasses("collaboration-documents")}>
            {collaboration.documents.map((entry) => (
              <div
                className={webClasses(`collaboration-document is-${entry.tone}`)}
                key={`${entry.status.document.kind}:${entry.status.document.key}`}
              >
                <span>
                  <strong>{entry.status.document.key}</strong>
                  <small>{entry.status.document.kind}</small>
                </span>
                <p>{collaborationDetail(entry)}</p>
              </div>
            ))}
            {collaboration.documents.length === 0 ? <p>{collaboration.summary}</p> : null}
          </div>
          <footer>
            <button
              type="button"
              disabled={!collaborationProfile?.editable}
              onClick={() => {
                setCollaborationOpen(false);
                onOpenProfile();
              }}
            >
              <UserRound size={13} />
              <span>{collaborationProfile?.userName || "设置昵称"}</span>
            </button>
          </footer>
        </section>
      ) : null}
      {open ? (
        <div className={webClasses("application-menu")} role="menu" aria-label="应用菜单">
          <div className={webClasses("menu-workspace")}>
            <strong>{workspace.name}</strong>
            <span>{workspace.path}</span>
            <small>{workspace.clusterId === null ? "未配置组号" : `组 ${workspace.clusterId}`}</small>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenOverview();
            }}
          >
            <LayoutDashboard size={14} />
            <span>工作区总览</span>
          </button>
          <span className={webClasses("menu-divider")} />
          <button
            type="button"
            role="menuitem"
            disabled={!dirty}
            onClick={() => {
              setOpen(false);
              onOpenChanges();
            }}
          >
            <FileDiff size={14} />
            <span>显示 Diff</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!collaborationProfile?.editable}
            onClick={() => {
              setOpen(false);
              onOpenProfile();
            }}
          >
            <UserRound size={14} />
            <span>{collaborationProfile?.userName || "设置昵称"}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={dirty}
            title={dirty ? "存在未保存改动，Prefab 导入不可用" : undefined}
            onClick={() => {
              setOpen(false);
              onImportPrefab();
            }}
          >
            <FileInput size={14} />
            <span>导入现有 Prefab...</span>
          </button>
          <span className={webClasses("menu-divider")} />
          <button type="button" role="menuitem" disabled={vcsDisabled} title={vcsTitle} onClick={() => void runVcs("commit")}>
            <Upload size={14} />
            <span>提交 UI...</span>
          </button>
          <button type="button" role="menuitem" disabled={vcsDisabled} title={vcsTitle} onClick={() => void runVcs("update")}>
            <Download size={14} />
            <span>更新 UI...</span>
          </button>
          <span className={webClasses("menu-divider")} />
          <div className={webClasses("menu-submenu")}>
            <button type="button" role="menuitem" aria-haspopup="menu">
              <FolderClock size={14} />
              <span>最近使用</span>
              <ChevronRight size={13} />
            </button>
            <div className={webClasses("submenu-panel")} role="menu" aria-label="最近使用文件">
              {recent.length > 0 ? (
                recent.slice(0, 10).map((entry) => (
                  <button
                    key={recentKey(entry.location)}
                    type="button"
                    role="menuitem"
                    title={recentDetail(entry.location)}
                    onClick={() => {
                      setOpen(false);
                      onOpenRecent(entry.location);
                    }}
                  >
                    <span>{recentLabel(entry.location)}</span>
                    <small>{recentDetail(entry.location)}</small>
                  </button>
                ))
              ) : (
                <p>暂无最近记录</p>
              )}
            </div>
          </div>
          <div
            className={webClasses("menu-submenu")}
            onPointerEnter={() => {
              if (environments.length === 0 && !loadingEnvironments) void refreshEnvironments();
            }}
          >
            <button type="button" role="menuitem" aria-haspopup="menu">
              <Server size={14} />
              <span>切换环境</span>
              <ChevronRight size={13} />
            </button>
            <div className={webClasses("submenu-panel environment-panel")} role="menu" aria-label="切换环境">
              <header>
                <span>Legma 环境</span>
                <button type="button" onClick={() => void refreshEnvironments()} title="刷新环境列表">
                  <RefreshCw size={13} />
                </button>
              </header>
              {loadingEnvironments && environments.length === 0 ? <p>正在查找...</p> : null}
              {environmentError ? <p className={webClasses("submenu-error")}>{environmentError}</p> : null}
              {environments.map((environment) => (
                <button
                  key={environment.origin}
                  type="button"
                  role="menuitem"
                  disabled={environment.current}
                  title={environment.path}
                  onClick={() => switchEnvironment(environment.origin)}
                >
                  <span>
                    {environment.name}
                    {environment.clusterId === null ? "" : ` · 组 ${environment.clusterId}`}
                    {environment.current ? " · 当前" : ""}
                  </span>
                  <small>{environment.path}</small>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function collaborationDetail(entry: CollaborationPresentation["documents"][number]): string {
  if (entry.tone === "editing") {
    const names = [...new Set(entry.otherEditors.map((editor) => editor.userName))].join("、");
    const latest = entry.status.editors.filter((editor) => entry.otherEditors.some((other) => other.actorId === editor.actorId)).at(-1);
    return `${names} 正在编辑${latest ? ` · ${formatTime(latest.lastSeenAt)}` : ""}`;
  }
  if (entry.tone === "saved-ahead" && entry.status.latestSave) {
    return `${entry.status.latestSave.userName} 已保存 · ${formatTime(entry.status.latestSave.savedAt)} · SVN BASE 未同步`;
  }
  return "可以编辑";
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function recentLabel(location: WorkspaceLocation): string {
  if (location.kind === "overview") return "工作区总览";
  if (location.kind === "artifact") return location.artifactKey;
  if (location.kind === "relations") return location.artifactKey;
  if (location.kind === "reference") return location.referenceKey;
  if (location.kind === "prototype") return location.prototypeKey;
  return location.path || "Sources";
}

function recentDetail(location: WorkspaceLocation): string {
  if (location.kind === "overview") return "概览";
  if (location.kind === "directory") return location.path || "目录";
  if (location.kind === "artifact") return "Artifact";
  if (location.kind === "relations") return "关系";
  if (location.kind === "reference") return "Reference";
  return location.referenceKey ? `Prototype · ${location.referenceKey}` : "Prototype";
}

function recentKey(location: WorkspaceLocation): string {
  if (location.kind === "overview") return "overview";
  if (location.kind === "directory") return `directory:${location.path}`;
  if (location.kind === "artifact") return `artifact:${location.artifactKey}`;
  if (location.kind === "relations") return `relations:${location.artifactKey}`;
  if (location.kind === "reference") return `reference:${location.referenceKey}`;
  return `prototype:${location.prototypeKey}:${location.referenceKey ?? ""}`;
}

function switchEnvironment(origin: string): void {
  window.location.assign(`${origin}${window.location.search}`);
}
