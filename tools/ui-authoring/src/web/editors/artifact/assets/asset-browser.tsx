import { ChevronDown, ChevronRight, FileType2, Folder, FolderOpen, Image as ImageIcon, Layers3, RefreshCw, Search, X } from "lucide-react";
import { type DragEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AuthoringAssetEntry, AuthoringAssetKind } from "../../../../schema/asset-catalog.js";
import { assetUrl } from "../../../shared/api/client.js";
import { PROJECT_ASSET_DRAG_TYPE, readProjectDragData, setProjectDragData } from "../../../shared/project-drag.js";
import { SelectControl } from "../../../shared/select-control.js";
import { createWebClasses } from "../../../styles/web-styles.js";
import artifactStyles from "../../../workspace/project/project-panel.module.css";
import dialogStyles from "../dialogs/artifact-dialogs.module.css";
import {
  type AssetDirectoryNode,
  assetDirectoryAncestors,
  buildAssetDirectoryTree,
  childAssetDirectories,
  filterAssets,
} from "./asset-browser-model.js";

const webClasses = createWebClasses(dialogStyles, artifactStyles);

export const ASSET_DRAG_TYPE = PROJECT_ASSET_DRAG_TYPE;

function setAssetDragData(dataTransfer: DataTransfer, asset: AuthoringAssetEntry): void {
  setProjectDragData(dataTransfer, { kind: "asset", assetKind: asset.kind, path: asset.path });
}

export function readAssetDragData(dataTransfer: DataTransfer): Pick<AuthoringAssetEntry, "kind" | "path"> | null {
  const item = readProjectDragData(dataTransfer);
  return item?.kind === "asset" ? { kind: item.assetKind, path: item.path } : null;
}

export interface AssetBrowserProps {
  readonly assets: readonly AuthoringAssetEntry[];
  readonly kind?: AuthoringAssetKind;
  readonly selectedPath?: string | undefined;
  readonly onChoose?: (asset: AuthoringAssetEntry) => void;
  readonly onAssetDoubleClick?: ((asset: AuthoringAssetEntry) => void) | undefined;
  readonly onRefresh?: () => Promise<void> | void;
  readonly compact?: boolean;
  readonly view?: "list" | "grid";
  readonly directoryPath?: string;
  readonly showDirectoryTree?: boolean;
  readonly onDirectoryChange?: (path: string) => void;
  readonly onAssetContextMenu?: ((event: MouseEvent<HTMLElement>, asset: AuthoringAssetEntry) => void) | undefined;
  readonly onDirectoryContextMenu?: ((event: MouseEvent<HTMLElement>, path: string) => void) | undefined;
  readonly onDropAssetToDirectory?: ((asset: Pick<AuthoringAssetEntry, "kind" | "path">, directory: string) => void) | undefined;
}

function assetKindLabel(kind: AuthoringAssetKind): string {
  if (kind === "image") return "Sprite";
  if (kind === "font") return "TMP Font";
  if (kind === "animationClip") return "Animation Clip";
  return "Animator";
}

function assetMetricLabel(asset: AuthoringAssetEntry): string {
  if ("width" in asset.metrics && "height" in asset.metrics) return `${asset.metrics.width} x ${asset.metrics.height}`;
  if ("pointSize" in asset.metrics && "characterCount" in asset.metrics)
    return `${asset.metrics.pointSize} pt · ${asset.metrics.characterCount} glyphs`;
  if (asset.kind === "animationClip") return "Animation Clip";
  return "Animator Controller";
}

interface AssetDirectoryTreeNodeProps {
  readonly node: AssetDirectoryNode;
  readonly depth: number;
  readonly expanded: ReadonlySet<string>;
  readonly selectedPath: string;
  readonly onToggle: (path: string) => void;
  readonly onSelect: (path: string) => void;
  readonly onContextMenu?: ((event: MouseEvent<HTMLElement>, path: string) => void) | undefined;
  readonly onDropAssetToDirectory?: ((asset: Pick<AuthoringAssetEntry, "kind" | "path">, directory: string) => void) | undefined;
}

function AssetDirectoryTreeNode({
  node,
  depth,
  expanded,
  selectedPath,
  onToggle,
  onSelect,
  onContextMenu,
  onDropAssetToDirectory,
}: AssetDirectoryTreeNodeProps) {
  const isExpanded = expanded.has(node.path);
  const hasChildren = node.directories.length > 0;
  const handleDragOver = (event: DragEvent<HTMLElement>): void => {
    if (!onDropAssetToDirectory || !event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };
  const handleDrop = (event: DragEvent<HTMLElement>): void => {
    if (!onDropAssetToDirectory) return;
    const asset = readAssetDragData(event.dataTransfer);
    if (!asset) return;
    event.preventDefault();
    onDropAssetToDirectory(asset, node.path);
  };
  return (
    <>
      <div
        className={webClasses(`asset-directory-row ${selectedPath === node.path ? "is-selected" : ""}`)}
        style={{ paddingLeft: 4 + depth * 13 }}
        data-asset-directory={node.path}
        onContextMenu={(event) => onContextMenu?.(event, node.path)}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <button
          className={webClasses("asset-directory-toggle")}
          type="button"
          onClick={() => onToggle(node.path)}
          disabled={!hasChildren}
          title={hasChildren ? (isExpanded ? "折叠目录" : "展开目录") : "空目录"}
        >
          {hasChildren ? isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : <span />}
        </button>
        <button
          className={webClasses("asset-directory-select")}
          type="button"
          onClick={() => onSelect(node.path)}
          title={node.path || "Assets/Resources/UI"}
          data-asset-directory-select={node.path}
        >
          {(isExpanded && hasChildren) || selectedPath === node.path ? <FolderOpen size={14} /> : <Folder size={14} />}
          <span>{node.name}</span>
          <small>{node.count}</small>
        </button>
      </div>
      {isExpanded
        ? node.directories.map((child) => (
            <AssetDirectoryTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selectedPath={selectedPath}
              onToggle={onToggle}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              onDropAssetToDirectory={onDropAssetToDirectory}
            />
          ))
        : null}
    </>
  );
}

function AssetSelectionInfo({
  asset,
  directory,
  count,
}: {
  readonly asset: AuthoringAssetEntry | undefined;
  readonly directory: string;
  readonly count: number;
}) {
  if (!asset) {
    return (
      <div className={webClasses("asset-selection-info")} data-asset-selection="directory">
        <FolderOpen size={16} />
        <span>
          <strong>{directory || "Assets/Resources/UI"}</strong>
          <small>{count} 个直接资源</small>
        </span>
      </div>
    );
  }
  return (
    <div className={webClasses("asset-selection-info")} data-asset-selection="asset">
      <span className={webClasses("asset-selection-preview")}>
        {asset.kind === "image" ? <img src={assetUrl(asset.path)} loading="lazy" draggable={false} alt="" /> : <FileType2 size={18} />}
      </span>
      <span className={webClasses("asset-selection-copy")}>
        <strong>{asset.name}</strong>
        <small>{asset.path}</small>
      </span>
      <span className={webClasses("asset-selection-facts")}>
        <span>{assetKindLabel(asset.kind)}</span>
        <span>{assetMetricLabel(asset)}</span>
      </span>
    </div>
  );
}

export function AssetBrowser({
  assets,
  kind,
  selectedPath,
  onChoose,
  onAssetDoubleClick,
  onRefresh,
  compact = false,
  view = "grid",
  directoryPath,
  showDirectoryTree = true,
  onDirectoryChange,
  onAssetContextMenu,
  onDirectoryContextMenu,
  onDropAssetToDirectory,
}: AssetBrowserProps) {
  const [internalDirectory, setInternalDirectory] = useState("");
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<AuthoringAssetKind | "all">("all");
  const [refreshing, setRefreshing] = useState(false);
  const [activePath, setActivePath] = useState<string>();
  const [draggingPath, setDraggingPath] = useState<string>();
  const [expandedDirectories, setExpandedDirectories] = useState<ReadonlySet<string>>(() => new Set([""]));
  const contentScroll = useRef<HTMLDivElement>(null);
  const directory = directoryPath ?? internalDirectory;
  const activeKind = kind ?? (kindFilter === "all" ? undefined : kindFilter);
  const directoryTree = useMemo(() => buildAssetDirectoryTree(assets, activeKind), [assets, activeKind]);
  const breadcrumbs = useMemo(() => assetDirectoryAncestors(directory), [directory]);
  const directories = useMemo(() => childAssetDirectories(assets, directory, activeKind), [assets, directory, activeKind]);
  const filtered = useMemo(() => filterAssets(assets, directory, query, activeKind), [assets, directory, query, activeKind]);
  const selectedAssetPath = selectedPath ?? activePath;
  const selectedAsset = selectedAssetPath ? assets.find((asset) => asset.path === selectedAssetPath) : undefined;
  const refresh = async (): Promise<void> => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };
  const selectDirectory = (path: string): void => {
    setInternalDirectory(path);
    onDirectoryChange?.(path);
    setActivePath(undefined);
    setExpandedDirectories((current) => new Set([...current, ...assetDirectoryAncestors(path).map((entry) => entry.path), path]));
  };
  const toggleDirectory = (path: string): void => {
    setExpandedDirectories((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  useEffect(() => {
    setInternalDirectory("");
    setActivePath(undefined);
    setExpandedDirectories(new Set([""]));
  }, [activeKind]);
  useEffect(() => {
    if (contentScroll.current) contentScroll.current.scrollTop = 0;
  }, [directory, query, activeKind]);

  return (
    <div
      className={webClasses(`asset-browser ${compact ? "is-compact" : ""} ${showDirectoryTree ? "" : "is-flat"} is-${view}`)}
      data-ui="asset-browser"
    >
      <div className={webClasses("asset-browser-controls")}>
        <label className={webClasses("asset-search")}>
          <Search size={13} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索资源" aria-label="搜索资源" />
          {query ? (
            <button type="button" onClick={() => setQuery("")} title="清除搜索">
              <X size={12} />
            </button>
          ) : null}
        </label>
        {!kind ? (
          <label className={webClasses("asset-kind-filter")} title="资源类型筛选">
            <Layers3 size={13} />
            <SelectControl
              ariaLabel="资源类型筛选"
              value={kindFilter}
              options={[
                { value: "all", label: "全部" },
                { value: "image", label: "Sprite" },
                { value: "font", label: "TMP Font" },
                { value: "animationClip", label: "Animation Clip" },
                { value: "animatorController", label: "Animator Controller" },
              ]}
              onValueChange={(value: AuthoringAssetKind | "all") => setKindFilter(value)}
            />
          </label>
        ) : null}
        {onRefresh ? (
          <button
            className={webClasses("asset-refresh")}
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            title="刷新资源"
          >
            <RefreshCw size={14} />
          </button>
        ) : null}
      </div>
      <div className={webClasses("asset-browser-main")}>
        {showDirectoryTree ? (
          <nav className={webClasses("asset-directory-tree")} aria-label="资源目录">
            <AssetDirectoryTreeNode
              node={directoryTree}
              depth={0}
              expanded={expandedDirectories}
              selectedPath={directory}
              onToggle={toggleDirectory}
              onSelect={selectDirectory}
              onContextMenu={onDirectoryContextMenu}
              onDropAssetToDirectory={onDropAssetToDirectory}
            />
          </nav>
        ) : null}
        <section className={webClasses("asset-content-pane")} aria-label="资源内容">
          <div className={webClasses("asset-breadcrumbs")}>
            {breadcrumbs.map((entry, index) => (
              <span key={entry.path || "root"}>
                {index > 0 ? <ChevronRight size={11} /> : null}
                <button type="button" onClick={() => selectDirectory(entry.path)} title={entry.path || "Assets/Resources/UI"}>
                  {entry.name}
                </button>
              </span>
            ))}
          </div>
          <div className={webClasses("asset-content-heading")}>
            <span>
              <FolderOpen size={13} />
              <strong>{directory || "Assets/Resources/UI"}</strong>
            </span>
            <small>
              {directories.length} 个目录 · {filtered.length} 个资源
            </small>
          </div>
          <div ref={contentScroll} className={webClasses("asset-browser-scroll")} data-ui="asset-browser-scroll">
            {directories.length > 0 && !query ? (
              <div className={webClasses("asset-folders")}>
                {directories.map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    onClick={() => selectDirectory(entry.path)}
                    onContextMenu={(event) => onDirectoryContextMenu?.(event, entry.path)}
                    onDragOver={(event) => {
                      if (!onDropAssetToDirectory || !event.dataTransfer.types.includes(ASSET_DRAG_TYPE)) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      const asset = readAssetDragData(event.dataTransfer);
                      if (!asset || !onDropAssetToDirectory) return;
                      event.preventDefault();
                      onDropAssetToDirectory(asset, entry.path);
                    }}
                    title={entry.path}
                    data-asset-folder={entry.path}
                  >
                    <Folder size={15} />
                    <span>{entry.name}</span>
                    <small>{entry.count}</small>
                  </button>
                ))}
              </div>
            ) : null}
            <div className={webClasses("asset-grid")}>
              {filtered.map((asset) => (
                <button
                  key={`${asset.kind}:${asset.path}`}
                  className={webClasses(
                    `asset-card ${selectedAssetPath === asset.path ? "is-selected" : ""} ${draggingPath === asset.path ? "is-dragging" : ""}`,
                  )}
                  type="button"
                  draggable={asset.kind === "image" || asset.kind === "font" || asset.kind === "animationClip"}
                  onDragStart={(event) => {
                    setAssetDragData(event.dataTransfer, asset);
                    setActivePath(asset.path);
                    setDraggingPath(asset.path);
                  }}
                  onDragEnd={() => setDraggingPath(undefined)}
                  onClick={() => {
                    setActivePath(asset.path);
                    onChoose?.(asset);
                  }}
                  onDoubleClick={() => onAssetDoubleClick?.(asset)}
                  onContextMenu={(event) => onAssetContextMenu?.(event, asset)}
                  title={asset.path}
                  data-asset-path={asset.path}
                >
                  <span className={webClasses("asset-thumbnail")}>
                    {asset.kind === "image" ? (
                      <img src={assetUrl(asset.path)} loading="lazy" draggable={false} alt="" />
                    ) : (
                      <FileType2 size={compact ? 22 : 30} />
                    )}
                  </span>
                  <span className={webClasses("asset-name")}>
                    {asset.kind === "image" ? <ImageIcon size={10} /> : null}
                    <span>
                      <strong>{asset.name}</strong>
                      <small>{assetMetricLabel(asset)}</small>
                    </span>
                  </span>
                </button>
              ))}
            </div>
            {directories.length === 0 && filtered.length === 0 ? <div className={webClasses("asset-empty")}>没有匹配的资源</div> : null}
          </div>
          <AssetSelectionInfo asset={selectedAsset} directory={directory} count={filtered.length} />
        </section>
      </div>
    </div>
  );
}

export interface AssetPickerProps extends AssetBrowserProps {
  readonly title: string;
  readonly onClose: () => void;
}

export function AssetPicker({ title, onClose, ...browserProps }: AssetPickerProps) {
  useEffect(() => {
    const close = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div className={webClasses("asset-picker-backdrop")} role="presentation" onPointerDown={onClose}>
      <section
        className={webClasses("asset-picker")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header>
          <strong>{title}</strong>
          <button type="button" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </header>
        <AssetBrowser {...browserProps} />
      </section>
    </div>
  );
}
