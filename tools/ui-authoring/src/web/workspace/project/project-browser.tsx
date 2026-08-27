import {
  AlertTriangle,
  ArrowDownAZ,
  BookOpen,
  Box,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileJson,
  Folder,
  FolderOpen,
  ListFilter,
  LoaderCircle,
  MousePointer2,
  Puzzle,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AuthoringAssetEntry } from "../../../schema/asset-catalog.js";
import { AssetBrowser } from "../../editors/artifact/assets/asset-browser.js";
import { type AssetDirectoryNode, buildAssetDirectoryTree } from "../../editors/artifact/assets/asset-browser-model.js";
import sharedStyles from "../../editors/shared/editor-shell.module.css";
import { type DocumentCatalog, searchWorkspaceDocumentsSemantically } from "../../shared/api/client.js";
import { PROJECT_ITEM_DRAG_TYPE, type ProjectDragItem, readProjectDragData, setProjectDragData } from "../../shared/project-drag.js";
import { SelectedItemEdgeButton, useSelectedItemReveal } from "../../shared/selected-item-reveal.js";
import { createWebClasses } from "../../styles/web-styles.js";
import { useWorkspaceDocumentCommands, type WorkspaceCommandTarget } from "../document-commands-context.js";
import {
  buildExplorerTree,
  type ExplorerDirectory,
  type ExplorerDocument,
  type ExplorerDocumentType,
  explorerDirectorySearchScore,
  explorerDocumentId,
  explorerDocumentSearchScore,
  explorerSemanticCandidates,
  explorerTextSearchMatch,
  filterExplorerDocuments,
  filterExplorerTree,
  type WorkspaceLocation,
} from "../explorer/artifact-explorer-model.js";
import { useWorkspaceNavigation } from "../explorer/workspace-navigation-state.js";
import { useWorkspaceProblems } from "../problems/workspace-problems.js";
import { useWorkspaceEditing, workspaceDocumentId } from "../workspace-editing-context.js";
import projectStyles from "./project-panel.module.css";

const webClasses = createWebClasses(projectStyles, sharedStyles);
const PROJECT_DOCUMENT_TYPES: readonly ExplorerDocumentType[] = ["Canvas", "Widget", "Fragment", "Artifact", "Reference", "Prototype"];
const SEMANTIC_SEARCH_DEBOUNCE_MS = 350;
const EMPTY_SEMANTIC_SCORES: ReadonlyMap<string, number> = new Map();

export type ProjectRoot = "assets" | "source";
type ProjectView = "list" | "grid";

export interface ProjectSelection {
  readonly root: ProjectRoot;
  readonly path: string;
}

export interface ProjectBrowserProps {
  readonly catalog: DocumentCatalog;
  readonly assets: readonly AuthoringAssetEntry[];
  readonly dock: "left" | "bottom";
  readonly orientation: "single" | "horizontal" | "vertical";
  readonly selection: ProjectSelection;
  readonly selectedDocumentPath?: string | undefined;
  readonly frameSelectedRequest?: number | undefined;
  readonly view: ProjectView;
  readonly onSelect: (selection: ProjectSelection) => void;
  readonly onOpenDirectory: (path: string) => void;
  readonly onOpenArtifact: (artifactKey: string) => void;
  readonly onOpenReference: (referenceKey: string) => void;
  readonly onOpenPrototype: (prototypeKey: string, referenceKey?: string) => void;
  readonly onRefreshAssets: () => Promise<void> | void;
  readonly onAssetContextMenu: (event: MouseEvent<HTMLElement>, asset: AuthoringAssetEntry) => void;
  readonly onAssetDirectoryContextMenu: (event: MouseEvent<HTMLElement>, path: string) => void;
  readonly onMoveItem: (root: ProjectRoot, item: ProjectDragItem, directory: string) => void;
  readonly onUnsupportedOpen: (label: string) => void;
}

const PROJECT_BROWSER_SPLIT_MIN = 0.2;
const PROJECT_BROWSER_SPLIT_MAX = 0.78;

function projectBrowserSplitStorageKey(dock: "left" | "bottom", orientation: "horizontal" | "vertical"): string {
  return `ui-authoring:project-browser:${dock}:${orientation}:v3`;
}

function loadProjectBrowserSplit(dock: "left" | "bottom", orientation: "horizontal" | "vertical"): number {
  const stored = Number(window.localStorage.getItem(projectBrowserSplitStorageKey(dock, orientation)));
  if (Number.isFinite(stored) && stored >= PROJECT_BROWSER_SPLIT_MIN && stored <= PROJECT_BROWSER_SPLIT_MAX) return stored;
  if (dock === "bottom" && orientation === "vertical") return 0.24;
  return orientation === "horizontal" ? 0.28 : 0.42;
}

function documentIcon(document: ExplorerDocument, size = 15) {
  if (document.unavailable) return <AlertTriangle size={size} />;
  if (document.kind === "reference") return <BookOpen size={size} />;
  if (document.kind === "prototype") return <MousePointer2 size={size} />;
  if (document.type === "Canvas") return <Box size={size} />;
  if (document.type === "Widget") return <Puzzle size={size} />;
  return <FileJson size={size} />;
}

function documentTarget(document: ExplorerDocument): WorkspaceCommandTarget {
  if (document.unavailable) return { kind: "unavailable", key: document.key, path: document.path };
  return { kind: document.kind, key: document.key, path: document.path };
}

function sourceDocumentCount(directory: ExplorerDirectory): number {
  return directory.documents.length + directory.directories.reduce((count, child) => count + sourceDocumentCount(child), 0);
}

function collectSourceDocuments(directory: ExplorerDirectory): ExplorerDocument[] {
  return [...directory.documents, ...directory.directories.flatMap(collectSourceDocuments)];
}

function collectSourceDirectoryPaths(directory: ExplorerDirectory): string[] {
  return [directory.path, ...directory.directories.flatMap(collectSourceDirectoryPaths)];
}

function collectSourceDirectories(directory: ExplorerDirectory): ExplorerDirectory[] {
  return [directory, ...directory.directories.flatMap(collectSourceDirectories)];
}

function ProjectSearchText({ value, query }: { readonly value: string; readonly query: string }) {
  const match = explorerTextSearchMatch(value, query);
  if (!match) return value;
  return (
    <>
      {value.slice(0, match.start)}
      <mark className={webClasses("project-search-highlight")}>{value.slice(match.start, match.end)}</mark>
      {value.slice(match.end)}
    </>
  );
}

function isSemanticOnlyDocument(document: ExplorerDocument, query: string, semanticScores: ReadonlyMap<string, number>): boolean {
  return Boolean(
    query.trim() && explorerDocumentSearchScore(document, query) === undefined && semanticScores.has(explorerDocumentId(document)),
  );
}

function sourceDirectoryAtPath(root: ExplorerDirectory, path: string): ExplorerDirectory | undefined {
  let current: ExplorerDirectory | undefined = root;
  for (const segment of path.split("/").filter(Boolean)) current = current?.directories.find((child) => child.name === segment);
  return current;
}

type RecentProjectEntry =
  | {
      readonly kind: "directory";
      readonly location: WorkspaceLocation;
      readonly visitedAt: number;
      readonly directory: ExplorerDirectory;
    }
  | {
      readonly kind: "document";
      readonly location: WorkspaceLocation;
      readonly visitedAt: number;
      readonly document: ExplorerDocument;
    };

function projectDirectoryKey(root: ProjectRoot, path: string): string {
  return `${root}:${path}`;
}

function useDropHandlers(
  root: ProjectRoot,
  path: string,
  onMoveItem: ProjectBrowserProps["onMoveItem"],
  setDropTarget: (key: string | undefined) => void,
) {
  const key = projectDirectoryKey(root, path);
  return {
    onDragOver: (event: DragEvent<HTMLElement>): void => {
      if (!event.dataTransfer.types.includes(PROJECT_ITEM_DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = root === "assets" ? "move" : "move";
      setDropTarget(key);
    },
    onDragLeave: (event: DragEvent<HTMLElement>): void => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(undefined);
    },
    onDrop: (event: DragEvent<HTMLElement>): void => {
      const item = readProjectDragData(event.dataTransfer);
      if (!item) return;
      event.preventDefault();
      setDropTarget(undefined);
      onMoveItem(root, item, path);
    },
  };
}

function ProjectAssetTreeNode({
  node,
  depth,
  selection,
  expanded,
  onToggle,
  onSelect,
  onContextMenu,
  onMoveItem,
  onUnsupportedOpen,
  setDropTarget,
  dropTarget,
}: {
  readonly node: AssetDirectoryNode;
  readonly depth: number;
  readonly selection: ProjectSelection;
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (path: string) => void;
  readonly onSelect: (selection: ProjectSelection) => void;
  readonly onContextMenu: (event: MouseEvent<HTMLElement>, path: string) => void;
  readonly onMoveItem: ProjectBrowserProps["onMoveItem"];
  readonly onUnsupportedOpen: ProjectBrowserProps["onUnsupportedOpen"];
  readonly setDropTarget: (key: string | undefined) => void;
  readonly dropTarget: string | undefined;
}) {
  const key = projectDirectoryKey("assets", node.path);
  const isExpanded = expanded.has(key);
  const isSelected = selection.root === "assets" && selection.path === node.path;
  const dropHandlers = useDropHandlers("assets", node.path, onMoveItem, setDropTarget);
  return (
    <div className={webClasses("project-tree-node")}>
      <div
        className={webClasses(`project-directory-row ${isSelected ? "is-selected" : ""} ${dropTarget === key ? "is-drop-target" : ""}`)}
        style={{ paddingLeft: 4 + depth * 14 }}
        data-project-directory={`assets:${node.path}`}
        data-project-selection={key}
        {...dropHandlers}
        onContextMenu={(event) => onContextMenu(event, node.path)}
      >
        <button
          className={webClasses("project-directory-toggle")}
          type="button"
          onClick={() => onToggle(node.path)}
          disabled={node.directories.length === 0}
          title={node.directories.length > 0 ? (isExpanded ? "折叠目录" : "展开目录") : "空目录"}
        >
          {node.directories.length > 0 ? isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : <span />}
        </button>
        <button
          className={webClasses("project-directory-select")}
          data-ui="project-directory-select"
          type="button"
          aria-current={isSelected ? "page" : undefined}
          onClick={() => onSelect({ root: "assets", path: node.path })}
          onDoubleClick={() => onUnsupportedOpen(`Assets/Resources/UI/${node.path}`)}
          title={node.path ? `Assets/Resources/UI/${node.path}` : "Assets/Resources/UI"}
        >
          {(isExpanded && node.directories.length > 0) || isSelected ? <FolderOpen size={14} /> : <Folder size={14} />}
          <span>{node.name}</span>
          <small>{node.count}</small>
        </button>
      </div>
      {isExpanded ? (
        <div
          className={webClasses("project-tree-children")}
          style={{ "--project-tree-guide-left": `${28 + depth * 14}px` } as CSSProperties}
        >
          {node.directories.map((child) => (
            <ProjectAssetTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selection={selection}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              onMoveItem={onMoveItem}
              onUnsupportedOpen={onUnsupportedOpen}
              setDropTarget={setDropTarget}
              dropTarget={dropTarget}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProjectSourceTreeNode({
  node,
  depth,
  selection,
  selectedDocumentPath,
  expanded,
  onToggle,
  onSelect,
  onOpenDirectory,
  onOpenDocument,
  commands,
  onMoveItem,
  setDropTarget,
  dropTarget,
  includeDocuments = false,
  openDirectoryOnSingleClick = false,
  showDirectorySelection = true,
  isDocumentDirty,
  query = "",
  semanticScores = EMPTY_SEMANTIC_SCORES,
}: {
  readonly node: ExplorerDirectory;
  readonly depth: number;
  readonly selection: ProjectSelection;
  readonly selectedDocumentPath?: string | undefined;
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (path: string) => void;
  readonly onSelect: (selection: ProjectSelection) => void;
  readonly onOpenDirectory: ProjectBrowserProps["onOpenDirectory"];
  readonly onOpenDocument?: ((document: ExplorerDocument) => void) | undefined;
  readonly commands: ReturnType<typeof useWorkspaceDocumentCommands>;
  readonly onMoveItem: ProjectBrowserProps["onMoveItem"];
  readonly setDropTarget: (key: string | undefined) => void;
  readonly dropTarget: string | undefined;
  readonly includeDocuments?: boolean | undefined;
  readonly openDirectoryOnSingleClick?: boolean | undefined;
  readonly showDirectorySelection?: boolean | undefined;
  readonly isDocumentDirty?: ((document: ExplorerDocument) => boolean) | undefined;
  readonly query?: string | undefined;
  readonly semanticScores?: ReadonlyMap<string, number> | undefined;
}) {
  const key = projectDirectoryKey("source", node.path);
  const isExpanded = expanded.has(key);
  const isSelected = showDirectorySelection && selection.root === "source" && selection.path === node.path;
  const dropHandlers = useDropHandlers("source", node.path, onMoveItem, setDropTarget);
  const label = depth === 0 ? "UIAuthoring" : node.displayName;
  return (
    <div className={webClasses("project-tree-node")}>
      <div
        className={webClasses(`project-directory-row ${isSelected ? "is-selected" : ""} ${dropTarget === key ? "is-drop-target" : ""}`)}
        style={{ paddingLeft: 4 + depth * 14 }}
        data-project-directory={`source:${node.path}`}
        data-project-selection={key}
        {...dropHandlers}
        onContextMenu={(event) => commands.open(event, { kind: "directory", path: node.path })}
      >
        <button
          className={webClasses("project-directory-toggle")}
          type="button"
          onClick={() => onToggle(node.path)}
          disabled={node.directories.length === 0}
          title={node.directories.length > 0 ? (isExpanded ? "折叠目录" : "展开目录") : "空目录"}
        >
          {node.directories.length > 0 ? isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : <span />}
        </button>
        <button
          className={webClasses("project-directory-select")}
          data-ui="project-directory-select"
          type="button"
          aria-current={isSelected ? "page" : undefined}
          onClick={() => {
            onSelect({ root: "source", path: node.path });
            if (openDirectoryOnSingleClick) onOpenDirectory(node.path);
          }}
          onDoubleClick={openDirectoryOnSingleClick ? undefined : () => onOpenDirectory(node.path)}
          title={node.path ? `UIAuthoring/${node.path}` : "UIAuthoring"}
        >
          {(isExpanded && node.directories.length > 0) || isSelected ? <FolderOpen size={14} /> : <Folder size={14} />}
          <span>
            <ProjectSearchText value={label} query={query} />
          </span>
          <small>{depth === 0 ? sourceDocumentCount(node) : node.documents.length}</small>
        </button>
      </div>
      {isExpanded ? (
        <div
          className={webClasses("project-tree-children")}
          style={{ "--project-tree-guide-left": `${28 + depth * 14}px` } as CSSProperties}
        >
          {node.directories.map((child) => (
            <ProjectSourceTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selection={selection}
              selectedDocumentPath={selectedDocumentPath}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              onOpenDirectory={onOpenDirectory}
              onOpenDocument={onOpenDocument}
              commands={commands}
              onMoveItem={onMoveItem}
              setDropTarget={setDropTarget}
              dropTarget={dropTarget}
              includeDocuments={includeDocuments}
              openDirectoryOnSingleClick={openDirectoryOnSingleClick}
              showDirectorySelection={showDirectorySelection}
              isDocumentDirty={isDocumentDirty}
              query={query}
              semanticScores={semanticScores}
            />
          ))}
          {includeDocuments
            ? node.documents.map((document) => (
                <ProjectDocumentCard
                  key={document.unavailable ? `${document.kind}:problem:${document.path}` : `${document.kind}:${document.key}`}
                  document={document}
                  view="list"
                  current={document.path === selectedDocumentPath}
                  dirty={isDocumentDirty?.(document) ?? false}
                  openOnSingleClick
                  treeDepth={depth + 1}
                  query={query}
                  semanticOnly={isSemanticOnlyDocument(document, query, semanticScores)}
                  onOpen={() => onOpenDocument?.(document)}
                  onContextMenu={(event) => commands.open(event, documentTarget(document))}
                />
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}

function ProjectRootRow({
  root,
  selected,
  expanded,
  onToggle,
  onSelect,
  onOpen,
  onContextMenu,
  onMoveItem,
  setDropTarget,
  dropTarget,
  children,
  count,
}: {
  readonly root: ProjectRoot;
  readonly selected: boolean;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onSelect: () => void;
  readonly onOpen: () => void;
  readonly onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  readonly onMoveItem: ProjectBrowserProps["onMoveItem"];
  readonly setDropTarget: (key: string | undefined) => void;
  readonly dropTarget: string | undefined;
  readonly children: ReactNode;
  readonly count: number;
}) {
  const key = projectDirectoryKey(root, "");
  const dropHandlers = useDropHandlers(root, "", onMoveItem, setDropTarget);
  const label = root === "assets" ? "Assets/Resources/UI" : "UIAuthoring";
  return (
    <div
      className={webClasses(`project-root-group ${selected ? "is-selected" : ""} ${dropTarget === key ? "is-drop-target" : ""}`)}
      data-project-root={root}
    >
      <div className={webClasses("project-root-row")} data-project-selection={key} {...dropHandlers} onContextMenu={onContextMenu}>
        <button
          className={webClasses("project-directory-toggle")}
          type="button"
          onClick={onToggle}
          title={expanded ? "折叠目录" : "展开目录"}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <button
          className={webClasses("project-root-select")}
          data-ui="project-root-select"
          type="button"
          aria-current={selected ? "page" : undefined}
          onClick={onSelect}
          onDoubleClick={onOpen}
          title={label}
        >
          {selected ? <FolderOpen size={15} /> : <Folder size={15} />}
          <strong>{label}</strong>
          <small>{count}</small>
        </button>
      </div>
      {expanded ? (
        <div className={webClasses("project-tree-children")} style={{ "--project-tree-guide-left": "28px" } as CSSProperties}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

function ProjectDocumentCard({
  document,
  view,
  current,
  dirty,
  openOnSingleClick = false,
  treeDepth,
  query = "",
  semanticOnly = false,
  onOpen,
  onContextMenu,
}: {
  readonly document: ExplorerDocument;
  readonly view: ProjectView;
  readonly current: boolean;
  readonly dirty: boolean;
  readonly openOnSingleClick?: boolean | undefined;
  readonly treeDepth?: number | undefined;
  readonly query?: string | undefined;
  readonly semanticOnly?: boolean | undefined;
  readonly onOpen: () => void;
  readonly onContextMenu: (event: MouseEvent<HTMLElement>) => void;
}) {
  const title = document.displayName ?? document.key;
  const defaultSecondary = document.displayName
    ? document.key
    : document.contextDisplayName
      ? `${document.type} · ${document.contextDisplayName}`
      : document.type;
  const secondary = query.trim()
    ? ([
        document.displayName ? document.key : undefined,
        document.contextDisplayName ? `${document.type} · ${document.contextDisplayName}` : undefined,
        document.contextArtifactKey,
        document.type,
      ].find((value): value is string => Boolean(value && explorerTextSearchMatch(value, query))) ?? defaultSecondary)
    : defaultSecondary;
  const defaultSummary = document.description ?? document.contextDescription ?? document.path;
  const summary = query.trim()
    ? ([document.description, document.contextDescription, document.path].find((value): value is string =>
        Boolean(value && explorerTextSearchMatch(value, query)),
      ) ?? defaultSummary)
    : defaultSummary;
  return (
    <button
      className={webClasses(
        `project-source-card ${treeDepth === undefined ? "" : "is-tree-row"} ${current ? "is-current" : ""} ${dirty ? "is-dirty" : ""} ${semanticOnly ? "is-semantic-result" : ""}`,
      )}
      style={treeDepth === undefined ? undefined : { paddingLeft: 28 + treeDepth * 14 }}
      type="button"
      draggable={!document.unavailable}
      onDragStart={(event) => {
        if (document.unavailable) return;
        setProjectDragData(event.dataTransfer, {
          kind: "document",
          documentKind: document.kind,
          key: document.key,
          path: document.path,
          ...(document.kind === "artifact" && ["Canvas", "Widget", "Fragment"].includes(document.type)
            ? { artifactType: document.type as "Canvas" | "Widget" | "Fragment" }
            : {}),
        });
      }}
      onClick={openOnSingleClick ? onOpen : undefined}
      onDoubleClick={openOnSingleClick ? undefined : onOpen}
      onContextMenu={onContextMenu}
      title={[title, document.displayName ? document.key : undefined, summary, document.path].filter(Boolean).join("\n")}
      aria-current={current ? "page" : undefined}
      data-project-document={document.path}
      data-unavailable-document={document.unavailable ? document.path : undefined}
      data-search-result={semanticOnly ? "semantic" : query.trim() ? "local" : undefined}
    >
      <span className={webClasses("project-source-icon")}>{documentIcon(document, view === "grid" ? 24 : 15)}</span>
      <span className={webClasses("project-source-copy")}>
        <strong>
          <ProjectSearchText value={title} query={query} />
          {dirty ? <i aria-label="未保存">*</i> : null}
          {semanticOnly ? (
            <span className={webClasses("project-semantic-label")} title="语义相近结果">
              <Sparkles size={8} />
              相近
            </span>
          ) : null}
        </strong>
        <small>{document.unavailable ? `${document.problemCount} 个问题` : <ProjectSearchText value={secondary} query={query} />}</small>
        <em>
          <ProjectSearchText value={summary} query={query} />
        </em>
      </span>
    </button>
  );
}

function SourceProjectContents({
  sourceTree,
  directory,
  single,
  selection,
  expanded,
  selectedDocumentPath,
  frameSelectedRequest = 0,
  view,
  onToggleDirectory,
  onSelectDirectory,
  onOpenDirectory,
  onOpenArtifact,
  onOpenReference,
  onOpenPrototype,
  commands,
  problems,
  onMoveItem,
  setDropTarget,
  dropTarget,
}: {
  readonly sourceTree: ExplorerDirectory;
  readonly directory: string;
  readonly single: boolean;
  readonly selection: ProjectSelection;
  readonly expanded: ReadonlySet<string>;
  readonly selectedDocumentPath?: string | undefined;
  readonly frameSelectedRequest?: number | undefined;
  readonly view: ProjectView;
  readonly onToggleDirectory: (path: string) => void;
  readonly onSelectDirectory: (path: string) => void;
  readonly onOpenDirectory: ProjectBrowserProps["onOpenDirectory"];
  readonly onOpenArtifact: (artifactKey: string) => void;
  readonly onOpenReference: (referenceKey: string) => void;
  readonly onOpenPrototype: (prototypeKey: string, referenceKey?: string) => void;
  readonly commands: ReturnType<typeof useWorkspaceDocumentCommands>;
  readonly problems: ReturnType<typeof useWorkspaceProblems>;
  readonly onMoveItem: ProjectBrowserProps["onMoveItem"];
  readonly setDropTarget: (key: string | undefined) => void;
  readonly dropTarget: string | undefined;
}) {
  const navigation = useWorkspaceNavigation();
  const editing = useWorkspaceEditing();
  const [mode, setMode] = useState<"directory" | "recent">("directory");
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<ReadonlySet<ExplorerDocumentType>>(() => new Set());
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const typeMenu = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const previousFrameRequest = useRef(frameSelectedRequest);
  const selectedDirectoryNode = sourceDirectoryAtPath(sourceTree, directory) ?? {
    name: directory.split("/").at(-1) ?? "",
    displayName: directory.split("/").at(-1) ?? "",
    description: "",
    path: directory,
    directories: [],
    documents: [],
    modifiedAt: 0,
  };
  const directoryNode = single ? sourceTree : selectedDirectoryNode;
  const breadcrumbs = [
    "",
    ...directory
      .split("/")
      .filter(Boolean)
      .reduce<string[]>((result, segment) => [...result, `${result.at(-1) ? `${result.at(-1)}/` : ""}${segment}`], []),
  ];
  const filterActive = Boolean(query.trim() || types.size > 0);
  const semanticCandidates = useMemo(() => explorerSemanticCandidates(sourceTree, types), [sourceTree, types]);
  const semanticTargetKey = useMemo(
    () => (query.trim() ? `${query.trim()}\n${JSON.stringify(semanticCandidates)}` : ""),
    [query, semanticCandidates],
  );
  const [semanticResult, setSemanticResult] = useState<{
    readonly targetKey: string;
    readonly scores: ReadonlyMap<string, number>;
  }>();
  const semanticPending = Boolean(query.trim() && semanticCandidates.length > 0 && semanticResult?.targetKey !== semanticTargetKey);
  const semanticScores = semanticResult?.targetKey === semanticTargetKey ? semanticResult.scores : EMPTY_SEMANTIC_SCORES;
  const filteredTree = useMemo(
    () => filterExplorerTree(sourceTree, query, types, semanticScores),
    [query, semanticScores, sourceTree, types],
  );
  const documents = useMemo(() => {
    if (single) return filterExplorerDocuments(collectSourceDocuments(sourceTree), query, types, semanticScores);
    const candidates = filterActive ? collectSourceDocuments(directoryNode) : directoryNode.documents;
    return filterExplorerDocuments(candidates, query, types, semanticScores);
  }, [directoryNode, filterActive, query, semanticScores, single, sourceTree, types]);
  const matchingDirectories = useMemo(() => {
    if (!query.trim() || types.size > 0) return [];
    const searchRoot = single ? sourceTree : directoryNode;
    return collectSourceDirectories(searchRoot)
      .filter((candidate) => candidate.path && explorerDirectorySearchScore(candidate, query) !== undefined)
      .sort(
        (left, right) =>
          explorerDirectorySearchScore(right, query)! - explorerDirectorySearchScore(left, query)! ||
          left.displayName.localeCompare(right.displayName, "zh-CN"),
      );
  }, [directoryNode, query, single, sourceTree, types]);
  const visibleExpanded = useMemo(
    () => (filterActive ? new Set(collectSourceDirectoryPaths(filteredTree).map((path) => projectDirectoryKey("source", path))) : expanded),
    [expanded, filterActive, filteredTree],
  );
  const documentsByLocation = useMemo(
    () => new Map(collectSourceDocuments(sourceTree).map((document) => [`${document.kind}:${document.key}`, document])),
    [sourceTree],
  );
  const recentEntries = useMemo<readonly RecentProjectEntry[]>(() => {
    const needle = query.trim().toLocaleLowerCase();
    return navigation.recent.flatMap<RecentProjectEntry>((entry) => {
      if (entry.location.kind === "overview" || entry.location.kind === "relations") return [];
      if (entry.location.kind === "directory") {
        if (types.size > 0) return [];
        const recentDirectory = sourceDirectoryAtPath(sourceTree, entry.location.path);
        if (!recentDirectory) return [];
        const matches = !needle || explorerDirectorySearchScore(recentDirectory, query) !== undefined;
        return matches ? [{ kind: "directory", ...entry, directory: recentDirectory }] : [];
      }
      const key =
        entry.location.kind === "artifact"
          ? `artifact:${entry.location.artifactKey}`
          : entry.location.kind === "reference"
            ? `reference:${entry.location.referenceKey}`
            : `prototype:${entry.location.prototypeKey}`;
      const document = documentsByLocation.get(key);
      if (!document || (types.size > 0 && !types.has(document.type))) return [];
      const matches =
        !needle || explorerDocumentSearchScore(document, query) !== undefined || semanticScores.has(`${document.kind}:${document.key}`);
      return matches ? [{ kind: "document", ...entry, document }] : [];
    });
  }, [documentsByLocation, navigation.recent, query, semanticScores, sourceTree, types]);
  useEffect(() => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery || semanticCandidates.length === 0) return;
    let active = true;
    const timeout = window.setTimeout(() => {
      void searchWorkspaceDocumentsSemantically(normalizedQuery, semanticCandidates)
        .then((result) => {
          if (!active) return;
          setSemanticResult({ targetKey: semanticTargetKey, scores: new Map(result.matches.map((match) => [match.id, match.score])) });
        })
        .catch(() => {
          if (active) setSemanticResult({ targetKey: semanticTargetKey, scores: new Map() });
        });
    }, SEMANTIC_SEARCH_DEBOUNCE_MS);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [query, semanticCandidates, semanticTargetKey]);
  useEffect(() => setQuery(""), [directory]);
  useEffect(() => {
    if (previousFrameRequest.current === frameSelectedRequest) return;
    previousFrameRequest.current = frameSelectedRequest;
    setMode("directory");
    setQuery("");
    setTypes(new Set());
  }, [frameSelectedRequest]);
  useEffect(() => {
    if (!typeMenuOpen) return;
    const close = (event: globalThis.PointerEvent): void => {
      if (!typeMenu.current?.contains(event.target as Node)) setTypeMenuOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") setTypeMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [typeMenuOpen]);
  const selectedSelector = selectedDocumentPath ? `[data-project-document="${CSS.escape(selectedDocumentPath)}"]` : undefined;
  const { edge, measure, reveal } = useSelectedItemReveal({
    containerRef: scroll,
    selectedKey: selectedDocumentPath,
    selectedSelector,
    revealRequest: frameSelectedRequest,
  });
  const previousFilterActive = useRef(filterActive);
  useLayoutEffect(() => {
    if (previousFilterActive.current && !filterActive) reveal();
    else measure();
    previousFilterActive.current = filterActive;
  }, [documents, filterActive, measure, mode, recentEntries, reveal, view]);
  const toggleType = (type: ExplorerDocumentType): void => {
    setTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };
  const openDocument = (document: ExplorerDocument): void => {
    if (document.unavailable) {
      problems.open(document.path);
      return;
    }
    if (document.kind === "artifact") onOpenArtifact(document.key);
    else if (document.kind === "reference") onOpenReference(document.key);
    else onOpenPrototype(document.key);
  };
  return (
    <div className={webClasses(`project-source-contents is-${view}`)}>
      <div className={webClasses("project-content-controls")}>
        <div className={webClasses("project-source-navigation")}>
          <div className={webClasses("project-source-mode")} role="tablist" aria-label="Source 视图">
            <button className={webClasses(mode === "directory" ? "is-active" : "")} type="button" onClick={() => setMode("directory")}>
              <FolderOpen size={12} />
              目录
            </button>
            <button className={webClasses(mode === "recent" ? "is-active" : "")} type="button" onClick={() => setMode("recent")}>
              <Clock3 size={12} />
              最近
            </button>
          </div>
          {mode === "directory" && !single ? (
            <div className={webClasses("project-content-breadcrumbs")}>
              {breadcrumbs.map((path) => (
                <button
                  key={path || "root"}
                  type="button"
                  onClick={() => onSelectDirectory(path)}
                  title={path ? `UIAuthoring/${path}` : "UIAuthoring"}
                >
                  {path ? path.split("/").at(-1) : "UIAuthoring"}
                </button>
              ))}
            </div>
          ) : mode === "recent" ? (
            <div className={webClasses("project-recent-heading")}>
              <span>{navigation.recent.length} 条记录</span>
              <button type="button" onClick={navigation.clearRecent} disabled={navigation.recent.length === 0} title="清空历史">
                <Trash2 size={12} />
              </button>
            </div>
          ) : null}
        </div>
        <div className={webClasses("project-search-row")}>
          <label>
            <Search size={12} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 Source" aria-label="搜索 Source" />
            <span className={webClasses("project-search-end")}>
              {semanticPending ? (
                <LoaderCircle className={webClasses("project-search-spinner")} size={12} aria-label="正在补充相近结果" />
              ) : null}
              {query ? (
                <button type="button" onClick={() => setQuery("")} title="清除搜索">
                  <X size={11} />
                </button>
              ) : null}
            </span>
          </label>
          <button
            className={webClasses(navigation.sort === "modified" ? "is-active" : "")}
            type="button"
            disabled={mode === "recent"}
            onClick={() => navigation.setSort(navigation.sort === "name" ? "modified" : "name")}
            title={navigation.sort === "name" ? "名称 A-Z；点击切换为最近修改" : "最近修改；点击切换为名称 A-Z"}
            aria-label={`目录排序：${navigation.sort === "name" ? "名称 A-Z" : "最近修改"}`}
          >
            {navigation.sort === "name" ? <ArrowDownAZ size={13} /> : <Clock3 size={13} />}
          </button>
          <div className={webClasses("project-type-filter")} ref={typeMenu}>
            <button
              className={webClasses(types.size > 0 ? "is-active" : "")}
              type="button"
              onClick={() => setTypeMenuOpen((open) => !open)}
              title="类型筛选"
              aria-label={`类型筛选${types.size > 0 ? `：已选 ${types.size} 项` : "：全部"}`}
              aria-expanded={typeMenuOpen}
            >
              <ListFilter size={13} />
              {types.size > 0 ? <small>{types.size}</small> : null}
            </button>
            {typeMenuOpen ? (
              <div className={webClasses("project-type-menu")} role="group" aria-label="文档类型">
                {PROJECT_DOCUMENT_TYPES.map((type) => (
                  <label key={type}>
                    <input type="checkbox" checked={types.has(type)} onChange={() => toggleType(type)} />
                    <span>{type}</span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {!single ? (
        <div className={webClasses("project-content-heading")} data-ui="project-content-heading">
          <span>
            {mode === "directory" ? <FolderOpen size={13} /> : <Clock3 size={13} />}
            <strong>{mode === "directory" ? (directory ? directoryNode.displayName : "UIAuthoring") : "最近访问"}</strong>
          </span>
          <small>
            {mode === "directory"
              ? `${filterActive ? matchingDirectories.length : directoryNode.directories.length} 个目录 · ${documents.length} 个文档`
              : `${recentEntries.length} 条记录`}
          </small>
        </div>
      ) : null}
      <div className={webClasses("selection-scroll-frame")} data-ui="selection-scroll-frame">
        <div ref={scroll} className={webClasses("project-source-scroll")} data-ui="project-source-scroll" onScroll={measure}>
          {mode === "directory" ? (
            single && view === "list" ? (
              <div className={webClasses("project-source-tree")} data-project-single-tree>
                <ProjectSourceTreeNode
                  node={filteredTree}
                  depth={0}
                  selection={selection}
                  selectedDocumentPath={selectedDocumentPath}
                  expanded={visibleExpanded}
                  onToggle={onToggleDirectory}
                  onSelect={(next) => onSelectDirectory(next.path)}
                  onOpenDirectory={onOpenDirectory}
                  onOpenDocument={openDocument}
                  commands={commands}
                  onMoveItem={onMoveItem}
                  setDropTarget={setDropTarget}
                  dropTarget={dropTarget}
                  includeDocuments
                  openDirectoryOnSingleClick
                  showDirectorySelection={selectedDocumentPath === undefined}
                  isDocumentDirty={(document) =>
                    !document.unavailable && editing.dirtyDocuments.has(workspaceDocumentId(document.kind, document.key))
                  }
                  query={query}
                  semanticScores={semanticScores}
                />
              </div>
            ) : (
              <>
                {(!filterActive ? (!single ? directoryNode.directories : []) : matchingDirectories).length > 0 ? (
                  <div className={webClasses("project-source-folders")}>
                    {(!filterActive ? directoryNode.directories : matchingDirectories).map((child) => {
                      const defaultSummary = child.description || child.path;
                      const summary = query.trim()
                        ? ([child.description, child.path].find((value) => value && explorerTextSearchMatch(value, query)) ??
                          defaultSummary)
                        : defaultSummary;
                      return (
                        <button
                          key={child.path}
                          className={webClasses(filterActive ? "is-search-result" : "")}
                          type="button"
                          data-project-content-directory={child.path}
                          onClick={() => onSelectDirectory(child.path)}
                          onDoubleClick={() => onOpenDirectory(child.path)}
                          onContextMenu={(event) => commands.open(event, { kind: "directory", path: child.path })}
                          title={[
                            child.displayName,
                            child.displayName !== child.name ? child.name : undefined,
                            child.description,
                            `UIAuthoring/${child.path}`,
                          ]
                            .filter(Boolean)
                            .join("\n")}
                        >
                          <Folder size={15} />
                          <span>
                            <strong>
                              <ProjectSearchText value={child.displayName} query={query} />
                            </strong>
                            {child.displayName !== child.name ? (
                              <small>
                                <ProjectSearchText value={child.name} query={query} />
                              </small>
                            ) : null}
                            {filterActive && summary ? (
                              <em>
                                <ProjectSearchText value={summary} query={query} />
                              </em>
                            ) : null}
                          </span>
                          <small>{sourceDocumentCount(child)}</small>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                <div className={webClasses("project-source-grid")}>
                  {documents.map((document) => (
                    <ProjectDocumentCard
                      key={document.unavailable ? `${document.kind}:problem:${document.path}` : `${document.kind}:${document.key}`}
                      document={document}
                      view={view}
                      current={document.path === selectedDocumentPath}
                      dirty={!document.unavailable && editing.dirtyDocuments.has(workspaceDocumentId(document.kind, document.key))}
                      openOnSingleClick={single}
                      query={query}
                      semanticOnly={isSemanticOnlyDocument(document, query, semanticScores)}
                      onOpen={() => openDocument(document)}
                      onContextMenu={(event) => commands.open(event, documentTarget(document))}
                    />
                  ))}
                </div>
                {(filterActive || (single ? filteredTree.directories.length === 0 : directoryNode.directories.length === 0)) &&
                documents.length === 0 &&
                matchingDirectories.length === 0 ? (
                  <div className={webClasses("project-content-empty")}>
                    <FolderOpen size={20} />
                    <span>{semanticPending ? "正在补充语义结果" : "没有 Source 文档"}</span>
                  </div>
                ) : null}
              </>
            )
          ) : (
            <div className={webClasses("project-recent-grid")}>
              {recentEntries.map((entry) =>
                entry.kind === "document" ? (
                  <ProjectDocumentCard
                    key={`${entry.visitedAt}:${entry.document.path}`}
                    document={entry.document}
                    view={view}
                    current={entry.document.path === selectedDocumentPath}
                    dirty={
                      !entry.document.unavailable &&
                      editing.dirtyDocuments.has(workspaceDocumentId(entry.document.kind, entry.document.key))
                    }
                    openOnSingleClick
                    query={query}
                    semanticOnly={isSemanticOnlyDocument(entry.document, query, semanticScores)}
                    onOpen={() => navigation.openLocation(entry.location)}
                    onContextMenu={(event) => commands.open(event, documentTarget(entry.document))}
                  />
                ) : (
                  <button
                    key={`${entry.visitedAt}:${entry.directory.path}`}
                    className={webClasses("project-recent-directory")}
                    type="button"
                    onClick={() => navigation.openLocation(entry.location)}
                    onContextMenu={(event) => commands.open(event, { kind: "directory", path: entry.directory.path })}
                    title={entry.directory.path || "UIAuthoring"}
                  >
                    <Folder size={view === "grid" ? 24 : 15} />
                    <span>
                      <strong>
                        <ProjectSearchText value={entry.directory.displayName || "UIAuthoring"} query={query} />
                      </strong>
                      <small>
                        <ProjectSearchText value={entry.directory.path || "UIAuthoring"} query={query} />
                      </small>
                    </span>
                  </button>
                ),
              )}
              {recentEntries.length === 0 ? (
                <div className={webClasses("project-content-empty")}>
                  <Clock3 size={20} />
                  <span>暂无浏览记录</span>
                </div>
              ) : null}
            </div>
          )}
        </div>
        <SelectedItemEdgeButton
          edge={edge}
          className={webClasses("selection-edge-button")}
          onReveal={() => reveal("center")}
          label="当前文档"
        />
      </div>
    </div>
  );
}

export function ProjectBrowser({
  catalog,
  assets,
  dock,
  orientation,
  selection,
  selectedDocumentPath,
  frameSelectedRequest = 0,
  view,
  onSelect,
  onOpenDirectory,
  onOpenArtifact,
  onOpenReference,
  onOpenPrototype,
  onRefreshAssets,
  onAssetContextMenu,
  onAssetDirectoryContextMenu,
  onMoveItem,
  onUnsupportedOpen,
}: ProjectBrowserProps) {
  const commands = useWorkspaceDocumentCommands();
  const problems = useWorkspaceProblems();
  const navigation = useWorkspaceNavigation();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(["assets:", "source:"]));
  const [dropTarget, setDropTarget] = useState<string>();
  const [treeRatios, setTreeRatios] = useState(() => ({
    horizontal: loadProjectBrowserSplit(dock, "horizontal"),
    vertical: loadProjectBrowserSplit(dock, "vertical"),
  }));
  const splitOrientation = orientation === "single" ? (dock === "bottom" ? "horizontal" : "vertical") : orientation;
  const treeRatio = treeRatios[splitOrientation];
  const setTreeRatio = (update: number | ((current: number) => number)): void => {
    setTreeRatios((current) => ({
      ...current,
      [splitOrientation]: typeof update === "function" ? update(current[splitOrientation]) : update,
    }));
  };
  const browserRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const assetTree = useMemo(() => buildAssetDirectoryTree(assets), [assets]);
  const sourceTree = useMemo(() => buildExplorerTree(catalog, navigation.sort), [catalog, navigation.sort]);
  const selectedView = view;
  const selectionKey = projectDirectoryKey(selection.root, selection.path);
  const selectionSelector = `[data-project-selection="${CSS.escape(selectionKey)}"]`;
  const directoryReveal = useSelectedItemReveal({
    containerRef: treeRef,
    selectedKey: selectionKey,
    selectedSelector: selectionSelector,
    revealRequest: frameSelectedRequest,
  });
  const toggle = (root: ProjectRoot, path: string): void => {
    const key = projectDirectoryKey(root, path);
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const sourceRootTarget = (event: MouseEvent<HTMLElement>): void => commands.open(event, { kind: "directory", path: "" });
  const assetRootTarget = (event: MouseEvent<HTMLElement>): void => onAssetDirectoryContextMenu(event, "");
  const resizeTree = (clientX: number, clientY: number): void => {
    const bounds = browserRef.current?.getBoundingClientRect();
    const extent = splitOrientation === "horizontal" ? bounds?.width : bounds?.height;
    if (!bounds || !extent || extent <= 0) return;
    const offset = splitOrientation === "horizontal" ? clientX - bounds.left : clientY - bounds.top;
    setTreeRatio(Math.min(PROJECT_BROWSER_SPLIT_MAX, Math.max(PROJECT_BROWSER_SPLIT_MIN, offset / extent)));
  };
  const beginResize = (event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeTree(event.clientX, event.clientY);
  };
  const moveResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) resizeTree(event.clientX, event.clientY);
  };
  const endResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const nudgeResize = (event: KeyboardEvent<HTMLDivElement>): void => {
    const decrementKey = splitOrientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
    const incrementKey = splitOrientation === "horizontal" ? "ArrowRight" : "ArrowDown";
    if (event.key !== decrementKey && event.key !== incrementKey) return;
    event.preventDefault();
    setTreeRatio((current) =>
      Math.min(PROJECT_BROWSER_SPLIT_MAX, Math.max(PROJECT_BROWSER_SPLIT_MIN, current + (event.key === incrementKey ? 0.04 : -0.04))),
    );
  };
  useEffect(() => {
    if (orientation === "single") return;
    try {
      window.localStorage.setItem(projectBrowserSplitStorageKey(dock, orientation), String(treeRatio));
    } catch {
      // The split remains adjustable for the current route when storage is blocked.
    }
  }, [dock, orientation, treeRatio]);
  useLayoutEffect(() => {
    const ancestors = new Set<string>([projectDirectoryKey(selection.root, "")]);
    let path = "";
    for (const segment of selection.path.split("/").filter(Boolean)) {
      path = path ? `${path}/${segment}` : segment;
      ancestors.add(projectDirectoryKey(selection.root, path));
    }
    setExpanded((current) => {
      if ([...ancestors].every((key) => current.has(key))) return current;
      return new Set([...current, ...ancestors]);
    });
  }, [selection.path, selection.root]);
  return (
    <div
      ref={browserRef}
      className={webClasses(`project-browser is-${orientation}`)}
      style={{ "--project-browser-tree-size": `${treeRatio * 100}%` } as CSSProperties}
      data-project-orientation={orientation}
    >
      {orientation !== "single" ? (
        <>
          <div className={webClasses("selection-scroll-frame")} data-ui="selection-scroll-frame">
            <div ref={treeRef} className={webClasses("project-browser-tree")} aria-label="Project 目录" onScroll={directoryReveal.measure}>
              <ProjectRootRow
                root="assets"
                selected={selection.root === "assets" && selection.path === ""}
                expanded={expanded.has("assets:")}
                onToggle={() => toggle("assets", "")}
                onSelect={() => onSelect({ root: "assets", path: "" })}
                onOpen={() => onUnsupportedOpen("Assets/Resources/UI")}
                onContextMenu={assetRootTarget}
                onMoveItem={onMoveItem}
                setDropTarget={setDropTarget}
                dropTarget={dropTarget}
                count={assetTree.count}
              >
                {assetTree.directories.map((node) => (
                  <ProjectAssetTreeNode
                    key={node.path}
                    node={node}
                    depth={1}
                    selection={selection}
                    expanded={expanded}
                    onToggle={(path) => toggle("assets", path)}
                    onSelect={onSelect}
                    onContextMenu={onAssetDirectoryContextMenu}
                    onMoveItem={onMoveItem}
                    onUnsupportedOpen={onUnsupportedOpen}
                    setDropTarget={setDropTarget}
                    dropTarget={dropTarget}
                  />
                ))}
              </ProjectRootRow>
              <ProjectRootRow
                root="source"
                selected={selection.root === "source" && selection.path === ""}
                expanded={expanded.has("source:")}
                onToggle={() => toggle("source", "")}
                onSelect={() => onSelect({ root: "source", path: "" })}
                onOpen={() => onOpenDirectory("")}
                onContextMenu={sourceRootTarget}
                onMoveItem={onMoveItem}
                setDropTarget={setDropTarget}
                dropTarget={dropTarget}
                count={sourceDocumentCount(sourceTree)}
              >
                {sourceTree.directories.map((node) => (
                  <ProjectSourceTreeNode
                    key={node.path}
                    node={node}
                    depth={1}
                    selection={selection}
                    expanded={expanded}
                    onToggle={(path) => toggle("source", path)}
                    onSelect={onSelect}
                    onOpenDirectory={onOpenDirectory}
                    commands={commands}
                    onMoveItem={onMoveItem}
                    setDropTarget={setDropTarget}
                    dropTarget={dropTarget}
                  />
                ))}
              </ProjectRootRow>
            </div>
            <SelectedItemEdgeButton
              edge={directoryReveal.edge}
              className={webClasses("selection-edge-button")}
              onReveal={() => directoryReveal.reveal("center")}
              label="当前目录"
            />
          </div>
          <div
            className={webClasses("project-browser-resize")}
            role="separator"
            aria-label="调整 Project 目录与内容比例"
            aria-orientation={splitOrientation === "horizontal" ? "vertical" : "horizontal"}
            aria-valuemin={20}
            aria-valuemax={78}
            aria-valuenow={Math.round(treeRatio * 100)}
            tabIndex={0}
            data-project-browser-resize
            onPointerDown={beginResize}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onKeyDown={nudgeResize}
          />
        </>
      ) : null}
      <div key="project-content" className={webClasses("project-browser-content")}>
        {orientation !== "single" && selection.root === "assets" ? (
          <AssetBrowser
            assets={assets}
            compact={dock === "left"}
            view={selectedView}
            directoryPath={selection.path}
            showDirectoryTree={false}
            onDirectoryChange={(path) => onSelect({ root: "assets", path })}
            onRefresh={onRefreshAssets}
            onAssetDoubleClick={(asset) => onUnsupportedOpen(asset.path)}
            onAssetContextMenu={onAssetContextMenu}
            onDirectoryContextMenu={onAssetDirectoryContextMenu}
            onDropAssetToDirectory={(asset, directory) =>
              onMoveItem("assets", { kind: "asset", assetKind: asset.kind, path: asset.path }, directory)
            }
          />
        ) : (
          <SourceProjectContents
            sourceTree={sourceTree}
            directory={selection.root === "source" ? selection.path : ""}
            single={orientation === "single"}
            selection={selection}
            expanded={expanded}
            selectedDocumentPath={selectedDocumentPath}
            frameSelectedRequest={frameSelectedRequest}
            view={selectedView}
            onToggleDirectory={(path) => toggle("source", path)}
            onSelectDirectory={(path) => onSelect({ root: "source", path })}
            onOpenDirectory={onOpenDirectory}
            onOpenArtifact={onOpenArtifact}
            onOpenReference={onOpenReference}
            onOpenPrototype={onOpenPrototype}
            commands={commands}
            problems={problems}
            onMoveItem={onMoveItem}
            setDropTarget={setDropTarget}
            dropTarget={dropTarget}
          />
        )}
      </div>
    </div>
  );
}
