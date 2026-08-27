import Pinyin from "pinyin-match";
import { pairedArtifactPathForDefaultReference } from "../../../kernel/preview-reference.js";
import type { CatalogArtifact, CatalogDirectory, CatalogPrototype, CatalogReference, DocumentCatalog } from "../../shared/api/client.js";

const pinyinMatch = Pinyin as unknown as {
  match(input: string, keys: string): [number, number] | false;
};

export type ExplorerDocumentType = CatalogArtifact["artifactType"] | "Artifact" | "Reference" | "Prototype";

export interface ExplorerDocument {
  readonly kind: "artifact" | "reference" | "prototype";
  readonly type: ExplorerDocumentType;
  readonly key: string;
  readonly displayName?: string;
  readonly description?: string;
  readonly contextArtifactKey?: string;
  readonly contextDisplayName?: string;
  readonly contextDescription?: string;
  readonly path: string;
  readonly directory: string;
  readonly modifiedAt: number;
  readonly unavailable: boolean;
  readonly problemCount: number;
}

export interface ExplorerDirectory {
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly path: string;
  readonly directories: readonly ExplorerDirectory[];
  readonly documents: readonly ExplorerDocument[];
  readonly cover?: CatalogDirectory["cover"];
  readonly modifiedAt: number;
}

function normalizedDocumentPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").toLocaleLowerCase("en-US");
}

function visibleCatalogReferences(catalog: Pick<DocumentCatalog, "artifacts" | "references">): readonly CatalogReference[] {
  const artifactsByPath = new Map(catalog.artifacts.map((artifact) => [normalizedDocumentPath(artifact.path), artifact]));
  return catalog.references.filter((reference) => {
    const artifact = artifactsByPath.get(normalizedDocumentPath(pairedArtifactPathForDefaultReference(reference.path)));
    return !artifact || reference.referenceKey !== artifact.artifactKey || reference.subjectArtifactKey !== artifact.artifactKey;
  });
}

export interface ArtifactLayoutNode {
  readonly artifactKey: string;
  readonly depth: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly isolated: boolean;
  readonly density: "canvas" | "widget" | "fragment";
  readonly section: "canvas" | "owned" | "shared" | "independent";
  readonly ownerCanvasKey?: string;
}

interface ArtifactLayoutEdge {
  readonly fromArtifactKey: string;
  readonly toArtifactKey: string;
}

interface ExternalArtifactDependency {
  readonly artifactKey: string;
  readonly requestedBy: readonly string[];
}

export interface DirectoryArtifactLayout {
  readonly nodes: readonly ArtifactLayoutNode[];
  readonly edges: readonly ArtifactLayoutEdge[];
  readonly externalDependencies: readonly ExternalArtifactDependency[];
  readonly clusters: readonly ArtifactLayoutCluster[];
  readonly sections: readonly ArtifactLayoutSection[];
  readonly width: number;
  readonly height: number;
}

interface ArtifactLayoutCluster {
  readonly canvasKey: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface ArtifactLayoutSection {
  readonly kind: "shared" | "independent";
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DirectoryArtifactGallery {
  readonly canvases: readonly CatalogArtifact[];
  readonly widgets: readonly CatalogArtifact[];
  readonly fragments: readonly CatalogArtifact[];
  readonly referenceGroups: readonly DirectoryReferenceGroup[];
  readonly prototypes: readonly CatalogPrototype[];
}

export type DirectoryViewMode = "dependency" | "list" | "grid";
export type GalleryLayoutMode = "grid" | "list";
export type GalleryScale = "2:1" | "1:1" | "1:2" | "1:3" | "1:4" | "1:6";
export type DirectorySortMode = "name" | "modified";

export const DEFAULT_LIST_SCALE: GalleryScale = "1:1";
export const DEFAULT_GRID_SCALE: GalleryScale = "1:2";
export const GALLERY_SCALES: readonly GalleryScale[] = ["2:1", "1:1", "1:2", "1:3", "1:4", "1:6"];

interface DirectoryReferenceGroup {
  readonly key: string;
  readonly label: string;
  readonly references: readonly CatalogReference[];
}

export type WorkspaceLocation =
  | { readonly kind: "overview" }
  | { readonly kind: "artifact"; readonly artifactKey: string }
  | { readonly kind: "relations"; readonly artifactKey: string }
  | { readonly kind: "reference"; readonly referenceKey: string }
  | { readonly kind: "directory"; readonly path: string; readonly view: DirectoryViewMode; readonly scale: GalleryScale }
  | { readonly kind: "prototype"; readonly prototypeKey: string; readonly referenceKey?: string };

const TYPE_ORDER: Readonly<Record<ExplorerDocumentType, number>> = {
  Canvas: 0,
  Widget: 1,
  Fragment: 2,
  Artifact: 3,
  Reference: 4,
  Prototype: 5,
};

const CANVAS_CARD_WIDTH = 320;
const CANVAS_CARD_HEIGHT = 224;
const WIDGET_CARD_WIDTH = 184;
const WIDGET_CARD_HEIGHT = 128;
const FRAGMENT_CARD_WIDTH = 168;
const FRAGMENT_CARD_HEIGHT = 104;
const CLUSTER_WIDTH = 400;
const CLUSTER_GAP = 30;
const COMPACT_GAP = 16;
const BOARD_PADDING = 32;
const SECTION_GAP = 42;
const SECTION_LABEL_HEIGHT = 24;

export function normalizeWorkspacePath(path: string): string {
  return path
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
}

export function documentDirectory(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  const separator = normalized.lastIndexOf("/");
  return separator < 0 ? "" : normalized.slice(0, separator);
}

function explorerDocuments(catalog: DocumentCatalog): ExplorerDocument[] {
  const problemCount = new Map<string, number>();
  const artifactsByKey = new Map(catalog.artifacts.map((artifact) => [artifact.artifactKey, artifact]));
  const referencesByKey = new Map(catalog.references.map((reference) => [reference.referenceKey, reference]));
  const artifactContext = (artifactKey: string): Partial<ExplorerDocument> => {
    const artifact = artifactsByKey.get(artifactKey);
    if (!artifact) return {};
    return {
      contextArtifactKey: artifact.artifactKey,
      ...(artifact.displayName ? { contextDisplayName: artifact.displayName } : {}),
      ...(artifact.description ? { contextDescription: artifact.description } : {}),
    };
  };
  for (const problem of catalog.problems ?? []) problemCount.set(problem.path, (problemCount.get(problem.path) ?? 0) + 1);
  return [
    ...catalog.artifacts.map((entry) => ({
      kind: "artifact" as const,
      type: entry.artifactType,
      key: entry.artifactKey,
      ...(entry.displayName ? { displayName: entry.displayName } : {}),
      ...(entry.description ? { description: entry.description } : {}),
      path: entry.path,
      directory: documentDirectory(entry.path),
      modifiedAt: entry.modifiedAt ?? 0,
      unavailable: false,
      problemCount: 0,
    })),
    ...visibleCatalogReferences(catalog).map((entry) => ({
      kind: "reference" as const,
      type: "Reference" as const,
      key: entry.referenceKey,
      ...artifactContext(entry.subjectArtifactKey),
      path: entry.path,
      directory: documentDirectory(entry.path),
      modifiedAt: entry.modifiedAt ?? 0,
      unavailable: false,
      problemCount: 0,
    })),
    ...catalog.prototypes.map((entry) => ({
      kind: "prototype" as const,
      type: "Prototype" as const,
      key: entry.prototypeKey,
      ...artifactContext(referencesByKey.get(entry.startReferenceKey)?.subjectArtifactKey ?? ""),
      path: entry.path,
      directory: documentDirectory(entry.path),
      modifiedAt: entry.modifiedAt ?? 0,
      unavailable: false,
      problemCount: 0,
    })),
    ...(catalog.unavailable ?? []).map(
      (entry): ExplorerDocument => ({
        kind: entry.kind,
        type: entry.kind === "artifact" ? (entry.artifactType ?? "Artifact") : entry.kind === "reference" ? "Reference" : "Prototype",
        key: entry.key,
        path: entry.path,
        directory: documentDirectory(entry.path),
        modifiedAt: entry.modifiedAt ?? 0,
        unavailable: true,
        problemCount: problemCount.get(entry.path) ?? 1,
      }),
    ),
  ];
}

interface MutableDirectory {
  readonly name: string;
  readonly path: string;
  readonly directories: Map<string, MutableDirectory>;
  readonly documents: ExplorerDocument[];
  metadata?: CatalogDirectory;
}

function compareDocuments(sort: DirectorySortMode, left: ExplorerDocument, right: ExplorerDocument): number {
  if (sort === "modified" && left.modifiedAt !== right.modifiedAt) return right.modifiedAt - left.modifiedAt;
  return left.key.localeCompare(right.key) || TYPE_ORDER[left.type] - TYPE_ORDER[right.type];
}

function compareDirectories(sort: DirectorySortMode, left: ExplorerDirectory, right: ExplorerDirectory): number {
  if (sort === "modified" && left.modifiedAt !== right.modifiedAt) return right.modifiedAt - left.modifiedAt;
  return left.displayName.localeCompare(right.displayName, "zh-CN") || left.name.localeCompare(right.name);
}

function freezeDirectory(directory: MutableDirectory, sort: DirectorySortMode): ExplorerDirectory {
  const directories = [...directory.directories.values()].map((child) => freezeDirectory(child, sort));
  const documents = [...directory.documents].sort((left, right) => compareDocuments(sort, left, right));
  const contentModifiedAt = Math.max(
    0,
    ...documents.map((document) => document.modifiedAt),
    ...directories.map((child) => child.modifiedAt),
  );
  const modifiedAt = contentModifiedAt || directory.metadata?.modifiedAt || 0;
  return {
    name: directory.name,
    displayName: directory.metadata?.displayName ?? directory.name,
    description: directory.metadata?.description ?? "",
    path: directory.path,
    directories: directories.sort((left, right) => compareDirectories(sort, left, right)),
    documents,
    ...(directory.metadata?.cover ? { cover: directory.metadata.cover } : {}),
    modifiedAt,
  };
}

function ensureDirectory(root: MutableDirectory, directoryPath: string): MutableDirectory {
  let current = root;
  for (const segment of directoryPath.split("/").filter(Boolean)) {
    const path = current.path ? `${current.path}/${segment}` : segment;
    let child = current.directories.get(segment);
    if (!child) {
      child = { name: segment, path, directories: new Map(), documents: [] };
      current.directories.set(segment, child);
    }
    current = child;
  }
  return current;
}

export function buildExplorerTree(catalog: DocumentCatalog, sort: DirectorySortMode = "name"): ExplorerDirectory {
  const root: MutableDirectory = { name: "Sources", path: "", directories: new Map(), documents: [] };
  for (const metadata of catalog.directories ?? []) ensureDirectory(root, normalizeWorkspacePath(metadata.path)).metadata = metadata;
  for (const document of explorerDocuments(catalog)) {
    ensureDirectory(root, document.directory).documents.push(document);
  }
  return freezeDirectory(root, sort);
}

export function explorerDocumentId(document: Pick<ExplorerDocument, "kind" | "key">): string {
  return `${document.kind}:${document.key}`;
}

function normalizedSearchText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export interface ExplorerSearchMatch {
  readonly start: number;
  readonly end: number;
  readonly kind: "direct" | "pinyin";
}

export function explorerTextSearchMatch(value: string, query: string): ExplorerSearchMatch | undefined {
  const needle = normalizedSearchText(query);
  if (!needle) return undefined;
  const normalizedValue = value.toLocaleLowerCase();
  const directStart = normalizedValue.indexOf(needle);
  if (directStart >= 0) return { start: directStart, end: directStart + needle.length, kind: "direct" };
  const pinyinRange = pinyinMatch.match(normalizedValue, needle);
  if (pinyinRange === false) return undefined;
  return { start: pinyinRange[0], end: pinyinRange[1] + 1, kind: "pinyin" };
}

interface SearchField {
  readonly value: string | undefined;
  readonly priority: number;
}

function documentSearchFields(document: ExplorerDocument): readonly SearchField[] {
  return [
    { value: document.displayName, priority: 100 },
    { value: document.key, priority: 95 },
    { value: document.contextDisplayName, priority: 80 },
    { value: document.contextArtifactKey, priority: 75 },
    { value: document.description, priority: 65 },
    { value: document.contextDescription, priority: 60 },
    { value: document.path, priority: 50 },
    { value: document.type, priority: 40 },
  ];
}

function directorySearchFields(directory: ExplorerDirectory): readonly SearchField[] {
  return [
    { value: directory.displayName, priority: 100 },
    { value: directory.name, priority: 95 },
    { value: directory.description, priority: 65 },
    { value: directory.path, priority: 50 },
  ];
}

function searchFieldsScore(fields: readonly SearchField[], query: string): number | undefined {
  const needle = normalizedSearchText(query);
  if (!needle) return 0;
  let score: number | undefined;
  for (const field of fields) {
    const value = field.value ? normalizedSearchText(field.value) : "";
    if (!value) continue;
    const direct =
      value === needle
        ? 3_000 + field.priority
        : value.startsWith(needle)
          ? 2_500 + field.priority
          : value.includes(needle)
            ? 2_000 + field.priority
            : 0;
    if (direct > 0) score = Math.max(score ?? 0, direct);
  }
  if (score !== undefined) return score;
  for (const field of fields) {
    const value = field.value ? normalizedSearchText(field.value) : "";
    if (value && pinyinMatch.match(value, needle) !== false) score = Math.max(score ?? 0, 1_000 + field.priority);
  }
  return score;
}

export function explorerDocumentSearchScore(document: ExplorerDocument, query: string): number | undefined {
  return searchFieldsScore(documentSearchFields(document), query);
}

export function explorerDirectorySearchScore(directory: ExplorerDirectory, query: string): number | undefined {
  return searchFieldsScore(directorySearchFields(directory), query);
}

const EMPTY_SEMANTIC_SCORES: ReadonlyMap<string, number> = new Map();

export function filterExplorerDocuments(
  documents: readonly ExplorerDocument[],
  query: string,
  types: ReadonlySet<ExplorerDocumentType>,
  semanticScores: ReadonlyMap<string, number> = EMPTY_SEMANTIC_SCORES,
): ExplorerDocument[] {
  const hasQuery = Boolean(query.trim());
  return documents
    .map((document, index) => {
      const localScore = explorerDocumentSearchScore(document, query);
      const semanticScore = hasQuery && localScore === undefined ? semanticScores.get(explorerDocumentId(document)) : undefined;
      return { document, index, localScore, semanticScore };
    })
    .filter(({ document, localScore, semanticScore }) => {
      const typeMatches = types.size === 0 || types.has(document.type);
      return typeMatches && (!hasQuery || localScore !== undefined || semanticScore !== undefined);
    })
    .sort((left, right) => {
      if (!hasQuery) return left.index - right.index;
      const leftLocal = left.localScore !== undefined;
      const rightLocal = right.localScore !== undefined;
      if (leftLocal !== rightLocal) return leftLocal ? -1 : 1;
      if (leftLocal && rightLocal && left.localScore !== right.localScore) return right.localScore! - left.localScore!;
      if (!leftLocal && !rightLocal && left.semanticScore !== right.semanticScore)
        return (right.semanticScore ?? -1) - (left.semanticScore ?? -1);
      return left.index - right.index;
    })
    .map(({ document }) => document);
}

export function filterExplorerTree(
  root: ExplorerDirectory,
  query: string,
  types: ReadonlySet<ExplorerDocumentType>,
  semanticScores: ReadonlyMap<string, number> = EMPTY_SEMANTIC_SCORES,
): ExplorerDirectory {
  const hasQuery = Boolean(query.trim());
  const visit = (directory: ExplorerDirectory): ExplorerDirectory | undefined => {
    const documents = filterExplorerDocuments(directory.documents, query, types, semanticScores);
    const directories = directory.directories.map(visit).filter((entry): entry is ExplorerDirectory => Boolean(entry));
    const directoryMatches = hasQuery && types.size === 0 && explorerDirectorySearchScore(directory, query) !== undefined;
    if (directory.path && !directoryMatches && documents.length === 0 && directories.length === 0) return undefined;
    return { ...directory, directories, documents };
  };
  return visit(root) ?? { ...root, directories: [], documents: [] };
}

function splitPascalCase(value: string): string {
  return value
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ExplorerSemanticCandidate {
  readonly id: string;
  readonly texts: readonly string[];
}

export function explorerSemanticCandidates(
  root: ExplorerDirectory,
  types: ReadonlySet<ExplorerDocumentType> = new Set(),
): readonly ExplorerSemanticCandidate[] {
  const candidates: ExplorerSemanticCandidate[] = [];
  const visit = (directory: ExplorerDirectory): void => {
    for (const document of directory.documents) {
      if (document.unavailable || (types.size > 0 && !types.has(document.type))) continue;
      const splitKey = splitPascalCase(document.key);
      const splitContextKey = document.contextArtifactKey ? splitPascalCase(document.contextArtifactKey) : undefined;
      const texts = [
        ...new Set(
          [
            document.key,
            splitKey !== document.key ? splitKey : undefined,
            document.displayName,
            document.description,
            document.contextArtifactKey,
            splitContextKey !== document.contextArtifactKey ? splitContextKey : undefined,
            document.contextDisplayName,
            document.contextDescription,
          ]
            .map((value) => value?.trim())
            .filter((value): value is string => Boolean(value)),
        ),
      ];
      if (texts.length > 0) candidates.push({ id: explorerDocumentId(document), texts });
    }
    for (const child of directory.directories) visit(child);
  };
  visit(root);
  return candidates;
}

export function documentsInDirectory(catalog: DocumentCatalog, directory: string, sort: DirectorySortMode = "name"): ExplorerDocument[] {
  const normalized = normalizeWorkspacePath(directory);
  return explorerDocuments(catalog)
    .filter((document) => document.directory === normalized)
    .sort((left, right) => compareDocuments(sort, left, right));
}

export function directoryAtPath(
  catalog: DocumentCatalog,
  directory: string,
  sort: DirectorySortMode = "name",
): ExplorerDirectory | undefined {
  const normalized = normalizeWorkspacePath(directory);
  let current: ExplorerDirectory | undefined = buildExplorerTree(catalog, sort);
  if (!normalized) return current;
  for (const segment of normalized.split("/")) current = current?.directories.find((child) => child.name === segment);
  return current;
}

function compareArtifacts(left: CatalogArtifact, right: CatalogArtifact): number {
  return TYPE_ORDER[left.artifactType] - TYPE_ORDER[right.artifactType] || left.artifactKey.localeCompare(right.artifactKey);
}

export function layoutDirectoryArtifacts(artifacts: readonly CatalogArtifact[], directory: string): DirectoryArtifactLayout {
  const local = artifacts
    .filter((artifact) => documentDirectory(artifact.path) === normalizeWorkspacePath(directory))
    .sort(compareArtifacts);
  const localByKey = new Map(local.map((artifact) => [artifact.artifactKey, artifact]));
  const internalEdges: ArtifactLayoutEdge[] = [];
  const externalByKey = new Map<string, Set<string>>();

  for (const artifact of local) {
    for (const dependency of [...artifact.dependencies].sort()) {
      if (localByKey.has(dependency)) {
        internalEdges.push({ fromArtifactKey: artifact.artifactKey, toArtifactKey: dependency });
      } else {
        const requestedBy = externalByKey.get(dependency) ?? new Set<string>();
        requestedBy.add(artifact.artifactKey);
        externalByKey.set(dependency, requestedBy);
      }
    }
  }

  const canvases = local.filter((artifact) => artifact.artifactType === "Canvas");
  const nonCanvases = local.filter((artifact) => artifact.artifactType !== "Canvas");
  const owners = new Map(nonCanvases.map((artifact) => [artifact.artifactKey, new Set<string>()]));
  const depthsByCanvas = new Map<string, Map<string, number>>();
  for (const canvas of canvases) {
    const depths = dependencyDepths(canvas, localByKey);
    depthsByCanvas.set(canvas.artifactKey, depths);
    for (const artifactKey of depths.keys()) owners.get(artifactKey)?.add(canvas.artifactKey);
  }

  const ownedByCanvas = new Map(canvases.map((canvas) => [canvas.artifactKey, [] as CatalogArtifact[]]));
  const shared: CatalogArtifact[] = [];
  const independent: CatalogArtifact[] = [];
  for (const artifact of nonCanvases) {
    const artifactOwners = owners.get(artifact.artifactKey) ?? new Set<string>();
    if (artifactOwners.size === 1) ownedByCanvas.get([...artifactOwners][0]!)!.push(artifact);
    else if (artifactOwners.size > 1) shared.push(artifact);
    else independent.push(artifact);
  }

  const clusterDrafts = canvases.map((canvas) =>
    layoutCanvasCluster(canvas, ownedByCanvas.get(canvas.artifactKey) ?? [], depthsByCanvas.get(canvas.artifactKey) ?? new Map()),
  );
  const clusterColumns = clusterDrafts.length === 0 ? 0 : Math.ceil(Math.sqrt(clusterDrafts.length));
  const clusterRows = clusterColumns === 0 ? 0 : Math.ceil(clusterDrafts.length / clusterColumns);
  const rowHeights = Array.from({ length: clusterRows }, (_, row) =>
    Math.max(...clusterDrafts.slice(row * clusterColumns, (row + 1) * clusterColumns).map((cluster) => cluster.height)),
  );
  const rowOffsets = rowHeights.map(
    (_, row) => BOARD_PADDING + rowHeights.slice(0, row).reduce((sum, height) => sum + height + CLUSTER_GAP, 0),
  );
  const nodes: ArtifactLayoutNode[] = [];
  const clusters: ArtifactLayoutCluster[] = [];
  for (const [index, draft] of clusterDrafts.entries()) {
    const column = index % clusterColumns;
    const row = Math.floor(index / clusterColumns);
    const x = BOARD_PADDING + column * (CLUSTER_WIDTH + CLUSTER_GAP);
    const y = rowOffsets[row]!;
    clusters.push({ canvasKey: draft.canvasKey, x, y, width: CLUSTER_WIDTH, height: draft.height });
    nodes.push(...draft.nodes.map((node) => ({ ...node, x: node.x + x, y: node.y + y })));
  }

  const clusterContentWidth = clusterColumns > 0 ? clusterColumns * CLUSTER_WIDTH + Math.max(0, clusterColumns - 1) * CLUSTER_GAP : 0;
  const contentWidth = Math.max(656, clusterContentWidth);
  let nextY =
    clusters.length > 0
      ? BOARD_PADDING + rowHeights.reduce((sum, height) => sum + height, 0) + Math.max(0, rowHeights.length - 1) * CLUSTER_GAP + SECTION_GAP
      : BOARD_PADDING;
  const sections: ArtifactLayoutSection[] = [];
  for (const [kind, entries, label] of [
    ["shared", shared, "共享依赖"],
    ["independent", independent, "独立 Artifact"],
  ] as const) {
    if (entries.length === 0) continue;
    const sectionNodes = layoutCompactSection(entries, contentWidth, kind === "independent");
    const sectionHeight = SECTION_LABEL_HEIGHT + sectionNodes.height;
    sections.push({ kind, label, x: BOARD_PADDING, y: nextY, width: contentWidth, height: sectionHeight });
    nodes.push(...sectionNodes.nodes.map((node) => ({ ...node, x: node.x + BOARD_PADDING, y: node.y + nextY + SECTION_LABEL_HEIGHT })));
    nextY += sectionHeight + SECTION_GAP;
  }

  return {
    nodes,
    edges: internalEdges.sort((left, right) =>
      `${left.fromArtifactKey}:${left.toArtifactKey}`.localeCompare(`${right.fromArtifactKey}:${right.toArtifactKey}`),
    ),
    externalDependencies: [...externalByKey.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([artifactKey, requestedBy]) => ({ artifactKey, requestedBy: [...requestedBy].sort() })),
    clusters,
    sections,
    width: BOARD_PADDING * 2 + contentWidth,
    height: Math.max(
      260,
      (sections.length > 0 ? nextY - SECTION_GAP : clusters.length > 0 ? nextY - SECTION_GAP : BOARD_PADDING) + BOARD_PADDING,
    ),
  };
}

export function galleryDirectoryArtifacts(
  catalog: DocumentCatalog,
  directory: string,
  sort: DirectorySortMode = "name",
): DirectoryArtifactGallery {
  const normalized = normalizeWorkspacePath(directory);
  const compareCatalogDocuments =
    <T extends { readonly modifiedAt?: number }>(name: (entry: T) => string) =>
    (left: T, right: T): number => {
      if (sort === "modified" && (left.modifiedAt ?? 0) !== (right.modifiedAt ?? 0))
        return (right.modifiedAt ?? 0) - (left.modifiedAt ?? 0);
      return name(left).localeCompare(name(right));
    };
  const local = catalog.artifacts
    .filter((artifact) => documentDirectory(artifact.path) === normalized)
    .sort(compareCatalogDocuments((entry) => entry.artifactKey));
  const localReferences = visibleCatalogReferences(catalog)
    .filter((reference) => documentDirectory(reference.path) === normalized)
    .sort(compareCatalogDocuments((entry) => entry.referenceKey));
  const prototypes = catalog.prototypes
    .filter((prototype) => documentDirectory(prototype.path) === normalized)
    .sort(compareCatalogDocuments((entry) => entry.prototypeKey));
  return {
    canvases: local.filter((artifact) => artifact.artifactType === "Canvas"),
    widgets: local.filter((artifact) => artifact.artifactType === "Widget"),
    fragments: local.filter((artifact) => artifact.artifactType === "Fragment"),
    referenceGroups: localReferences.length > 0 ? [{ key: "", label: "Reference", references: localReferences }] : [],
    prototypes,
  };
}

function dependencyDepths(canvas: CatalogArtifact, localByKey: ReadonlyMap<string, CatalogArtifact>): Map<string, number> {
  const depths = new Map<string, number>();
  const queue = [...canvas.dependencies].sort().map((artifactKey) => ({ artifactKey, depth: 1 }));
  while (queue.length > 0) {
    const current = queue.shift()!;
    const artifact = localByKey.get(current.artifactKey);
    if (!artifact || artifact.artifactType === "Canvas") continue;
    const existing = depths.get(artifact.artifactKey);
    if (existing !== undefined && existing <= current.depth) continue;
    depths.set(artifact.artifactKey, current.depth);
    queue.push(...[...artifact.dependencies].sort().map((artifactKey) => ({ artifactKey, depth: current.depth + 1 })));
  }
  return depths;
}

function cardDimensions(artifact: CatalogArtifact): readonly [number, number] {
  if (artifact.artifactType === "Canvas") return [CANVAS_CARD_WIDTH, CANVAS_CARD_HEIGHT];
  if (artifact.artifactType === "Widget") return [WIDGET_CARD_WIDTH, WIDGET_CARD_HEIGHT];
  return [FRAGMENT_CARD_WIDTH, FRAGMENT_CARD_HEIGHT];
}

function layoutCanvasCluster(
  canvas: CatalogArtifact,
  owned: readonly CatalogArtifact[],
  depths: ReadonlyMap<string, number>,
): { readonly canvasKey: string; readonly height: number; readonly nodes: readonly ArtifactLayoutNode[] } {
  const nodes: ArtifactLayoutNode[] = [
    {
      artifactKey: canvas.artifactKey,
      depth: 0,
      x: (CLUSTER_WIDTH - CANVAS_CARD_WIDTH) / 2,
      y: SECTION_LABEL_HEIGHT,
      width: CANVAS_CARD_WIDTH,
      height: CANVAS_CARD_HEIGHT,
      isolated: false,
      density: "canvas",
      section: "canvas",
      ownerCanvasKey: canvas.artifactKey,
    },
  ];
  let y = SECTION_LABEL_HEIGHT + CANVAS_CARD_HEIGHT + COMPACT_GAP;
  const layers = new Map<number, CatalogArtifact[]>();
  for (const artifact of owned) {
    const depth = depths.get(artifact.artifactKey) ?? 1;
    const entries = layers.get(depth) ?? [];
    entries.push(artifact);
    layers.set(depth, entries);
  }
  for (const [depth, entries] of [...layers.entries()].sort(([left], [right]) => left - right)) {
    entries.sort(compareArtifacts);
    for (let index = 0; index < entries.length; index += 2) {
      const row = entries.slice(index, index + 2);
      const rowWidth = row.reduce((sum, artifact) => sum + cardDimensions(artifact)[0], 0) + Math.max(0, row.length - 1) * COMPACT_GAP;
      const rowHeight = Math.max(...row.map((artifact) => cardDimensions(artifact)[1]));
      let x = (CLUSTER_WIDTH - rowWidth) / 2;
      for (const artifact of row) {
        const [width, height] = cardDimensions(artifact);
        nodes.push({
          artifactKey: artifact.artifactKey,
          depth,
          x,
          y,
          width,
          height,
          isolated: false,
          density: artifact.artifactType === "Widget" ? "widget" : "fragment",
          section: "owned",
          ownerCanvasKey: canvas.artifactKey,
        });
        x += width + COMPACT_GAP;
      }
      y += rowHeight + COMPACT_GAP;
    }
  }
  return { canvasKey: canvas.artifactKey, height: y - COMPACT_GAP + SECTION_LABEL_HEIGHT, nodes };
}

function layoutCompactSection(
  entries: readonly CatalogArtifact[],
  width: number,
  isolated: boolean,
): { readonly nodes: readonly ArtifactLayoutNode[]; readonly height: number } {
  const sorted = [...entries].sort(compareArtifacts);
  const columns = Math.max(1, Math.min(4, Math.floor((width + COMPACT_GAP) / (WIDGET_CARD_WIDTH + COMPACT_GAP))));
  const nodes: ArtifactLayoutNode[] = [];
  let y = 0;
  for (let index = 0; index < sorted.length; index += columns) {
    const row = sorted.slice(index, index + columns);
    const rowHeight = Math.max(...row.map((artifact) => cardDimensions(artifact)[1]));
    row.forEach((artifact, column) => {
      const [cardWidth, cardHeight] = cardDimensions(artifact);
      const cellWidth = width / columns;
      nodes.push({
        artifactKey: artifact.artifactKey,
        depth: 0,
        x: column * cellWidth + (cellWidth - cardWidth) / 2,
        y,
        width: cardWidth,
        height: cardHeight,
        isolated,
        density: artifact.artifactType === "Widget" ? "widget" : "fragment",
        section: isolated ? "independent" : "shared",
      });
    });
    y += rowHeight + COMPACT_GAP;
  }
  return { nodes, height: Math.max(0, y - COMPACT_GAP) };
}

export function parseWorkspaceLocation(search: string): WorkspaceLocation | undefined {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (params.get("overview") === "workspace") return { kind: "overview" };
  const relationArtifactKey = params.get("relations")?.trim();
  if (relationArtifactKey) return { kind: "relations", artifactKey: relationArtifactKey };
  const prototypeKey = params.get("prototype")?.trim();
  if (prototypeKey) {
    const referenceKey = params.get("reference")?.trim();
    return { kind: "prototype", prototypeKey, ...(referenceKey ? { referenceKey } : {}) };
  }
  const artifactKey = params.get("artifact")?.trim();
  if (artifactKey) return { kind: "artifact", artifactKey };
  const referenceKey = params.get("reference")?.trim();
  if (referenceKey) return { kind: "reference", referenceKey };
  if (params.has("directory"))
    return {
      kind: "directory",
      path: normalizeWorkspacePath(params.get("directory") ?? ""),
      view: directoryViewMode(params.get("view")),
      scale: galleryScale(params.get("scale"), directoryViewMode(params.get("view"))),
    };
  return undefined;
}

export function workspaceLocationSearch(location: WorkspaceLocation): string {
  const params = new URLSearchParams();
  if (location.kind === "overview") params.set("overview", "workspace");
  if (location.kind === "artifact") params.set("artifact", location.artifactKey);
  if (location.kind === "relations") params.set("relations", location.artifactKey);
  if (location.kind === "reference") params.set("reference", location.referenceKey);
  if (location.kind === "directory") {
    params.set("directory", normalizeWorkspacePath(location.path));
    params.set("view", location.view);
    if (location.view !== "dependency" && location.scale !== defaultDirectoryScale(location.view))
      params.set("scale", String(location.scale));
  }
  if (location.kind === "prototype") {
    params.set("prototype", location.prototypeKey);
    if (location.referenceKey) params.set("reference", location.referenceKey);
  }
  return `?${params.toString()}`;
}

function directoryViewMode(value: string | null | undefined): DirectoryViewMode {
  if (value === "list" || value === "grid") return value;
  return "dependency";
}

function defaultDirectoryScale(view: DirectoryViewMode): GalleryScale {
  return view === "list" ? DEFAULT_LIST_SCALE : DEFAULT_GRID_SCALE;
}

export function galleryScale(value: string | null | undefined, view: DirectoryViewMode = "grid"): GalleryScale {
  if (GALLERY_SCALES.includes(value as GalleryScale)) return value as GalleryScale;
  if (value === "2" || value === "3" || value === "4" || value === "6") return `1:${value}` as GalleryScale;
  return defaultDirectoryScale(view);
}

export function galleryScaleFactor(scale: GalleryScale): number {
  const [numerator, denominator] = scale.split(":").map(Number) as [number, number];
  return numerator / denominator;
}

export function catalogFromDocuments(
  artifacts: ReadonlyMap<string, CatalogArtifact>,
  references: ReadonlyMap<string, CatalogReference>,
  prototypes: ReadonlyMap<string, CatalogPrototype>,
  directories: readonly CatalogDirectory[] = [],
  unavailable: DocumentCatalog["unavailable"] = [],
  problems: DocumentCatalog["problems"] = [],
): DocumentCatalog {
  return {
    artifacts: [...artifacts.values()],
    references: [...references.values()],
    prototypes: [...prototypes.values()],
    directories,
    unavailable,
    problems,
  };
}
