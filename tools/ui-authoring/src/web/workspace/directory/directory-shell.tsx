import { FileDiff, FilePlus2, FolderOpen, GitFork, Layers3, LayoutGrid, List, Redo2, Undo2 } from "lucide-react";
import type { AuthoringAssetEntry } from "../../../schema/asset-catalog.js";
import sharedStyles from "../../editors/shared/editor-shell.module.css";
import { useWorkbenchSidebarLayout, WorkbenchSidebar } from "../../editors/shared/workbench-sidebar.js";
import { type DocumentCatalog } from "../../shared/api/client.js";
import { LegmaMark } from "../../shared/legma-mark.js";
import { ThemeToggle } from "../../shared/theme.js";
import type { ArtifactDocument, PrototypeDocument, ReferenceDocument } from "../../shared/types.js";
import { createWebClasses } from "../../styles/web-styles.js";
import { DirectoryOverview } from "../explorer/artifact-explorer.js";
import { type DirectoryViewMode, GALLERY_SCALES, type GalleryScale } from "../explorer/artifact-explorer-model.js";
import { ProjectPanel } from "../project/project-panel.js";
import workspaceStyles from "../workspace.module.css";
import { useWorkspaceEditing } from "../workspace-editing-context.js";
import directoryStyles from "./directory-shell.module.css";

const webClasses = createWebClasses(sharedStyles, directoryStyles, workspaceStyles);
type DirectorySidebarView = "project" | "hierarchy";
const DIRECTORY_SIDEBAR_VIEWS: readonly DirectorySidebarView[] = ["project", "hierarchy"];

export interface DirectoryShellProps {
  readonly directory: string;
  readonly view: DirectoryViewMode;
  readonly scale: GalleryScale;
  readonly catalog: DocumentCatalog;
  readonly assets: readonly AuthoringAssetEntry[];
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypes: ReadonlyMap<string, PrototypeDocument>;
  readonly onOpenDirectory: (path: string) => void;
  readonly onView: (view: DirectoryViewMode) => void;
  readonly onScale: (scale: GalleryScale) => void;
  readonly onOpenArtifact: (artifactKey: string) => void;
  readonly onOpenReference: (referenceKey: string) => void;
  readonly onOpenPrototype: (prototypeKey: string, referenceKey?: string) => void;
  readonly onRefreshAssets: () => Promise<void> | void;
  readonly onNotice: (notice: string) => void;
  readonly dirty: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onCreate: () => void;
}

export function DirectoryShell({
  directory,
  view,
  scale,
  catalog,
  assets,
  artifacts,
  references,
  prototypes,
  onOpenDirectory,
  onView,
  onScale,
  onOpenArtifact,
  onOpenReference,
  onOpenPrototype,
  onRefreshAssets,
  onNotice,
  dirty,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onCreate,
}: DirectoryShellProps) {
  const editing = useWorkspaceEditing();
  const sidebar = useWorkbenchSidebarLayout(DIRECTORY_SIDEBAR_VIEWS, "project");
  return (
    <main className={webClasses("directory-shell")}>
      <header className={webClasses("directory-topbar")}>
        <div className={webClasses("brand-block directory-brand")}>
          <LegmaMark className={webClasses("legma-mark")} />
          <strong>{directory || "Legma"}</strong>
        </div>
        <div className={webClasses("toolbar-group directory-toolbar")}>
          <button className={webClasses("icon-button")} type="button" onClick={onCreate} title="新建文档">
            <FilePlus2 size={16} />
          </button>
          <button className={webClasses("icon-button")} type="button" onClick={editing.onOpenChanges} disabled={!dirty} title="查看改动">
            <FileDiff size={16} />
          </button>
          <button className={webClasses("icon-button")} type="button" onClick={onUndo} disabled={!canUndo} title="撤销">
            <Undo2 size={16} />
          </button>
          <button className={webClasses("icon-button")} type="button" onClick={onRedo} disabled={!canRedo} title="重做">
            <Redo2 size={16} />
          </button>
          <span className={webClasses("toolbar-divider")} />
          <div className={webClasses("mode-segments")} role="group" aria-label="目录视图">
            <button className={webClasses(view === "dependency" ? "is-active" : "")} type="button" onClick={() => onView("dependency")}>
              <GitFork size={12} />
              依赖
            </button>
            <button className={webClasses(view === "list" ? "is-active" : "")} type="button" onClick={() => onView("list")}>
              <List size={12} />
              列表
            </button>
            <button className={webClasses(view === "grid" ? "is-active" : "")} type="button" onClick={() => onView("grid")}>
              <LayoutGrid size={12} />
              网格
            </button>
          </div>
          {view !== "dependency" ? (
            <div className={webClasses("mode-segments directory-scale-segments")} role="group" aria-label="缩略图比例">
              {GALLERY_SCALES.map((candidate) => (
                <button
                  key={candidate}
                  className={webClasses(scale === candidate ? "is-active" : "")}
                  type="button"
                  onClick={() => onScale(candidate)}
                >
                  {candidate}
                </button>
              ))}
            </div>
          ) : null}
          <span className={webClasses("toolbar-divider")} />
          <ThemeToggle className={webClasses("icon-button")} />
        </div>
        <div className={webClasses("directory-topbar-meta directory-meta")}>
          <span>{catalog.artifacts.length} 个 Artifact</span>
          <span>{catalog.references.length} 个 Reference</span>
          <span>{catalog.prototypes.length} 个 Prototype</span>
        </div>
      </header>
      <aside
        className={webClasses(`directory-tree-panel tree-panel ${sidebar.layout.views.includes("hierarchy") ? "is-hierarchy-view" : ""}`)}
        data-ui="tree-panel"
        data-sidebar-view={sidebar.layout.focused}
      >
        <WorkbenchSidebar
          label="目录侧栏"
          layout={sidebar.layout}
          onSelect={sidebar.select}
          onFocus={sidebar.focus}
          onSplit={sidebar.setSplit}
          tabs={[
            { value: "project", label: "Project", icon: <FolderOpen size={13} /> },
            { value: "hierarchy", label: "Hierarchy", icon: <Layers3 size={13} /> },
          ]}
          render={(sidebarView, focused) =>
            sidebarView === "project" ? (
              <ProjectPanel
                dock="left"
                catalog={catalog}
                assets={assets}
                selectedDirectory={directory}
                frameShortcutEnabled={focused}
                onRefreshAssets={onRefreshAssets}
                onOpenDirectory={onOpenDirectory}
                onOpenArtifact={onOpenArtifact}
                onOpenReference={onOpenReference}
                onOpenPrototype={onOpenPrototype}
                onNotice={onNotice}
              />
            ) : (
              <div className={webClasses("directory-hierarchy-empty")}>
                <Layers3 size={18} />
                <span>未选择文档</span>
              </div>
            )
          }
        />
      </aside>
      <DirectoryOverview
        directory={directory}
        view={view}
        scale={scale}
        catalog={catalog}
        artifacts={artifacts}
        references={references}
        prototypes={prototypes}
        onOpenDirectory={onOpenDirectory}
        onOpenArtifact={onOpenArtifact}
        onOpenReference={onOpenReference}
        onOpenPrototype={onOpenPrototype}
      />
      <footer className={webClasses("statusbar")}>
        <span className={webClasses(`dirty-dot ${dirty ? "is-dirty" : ""}`)} />
        <span>{dirty ? "已修改" : "就绪"}</span>
        <span className={webClasses("status-path")}>{directory || "UIAuthoring"}</span>
      </footer>
    </main>
  );
}
