import { AlertTriangle, BookOpen, Box, ChevronRight, Folder, Monitor, MousePointer2, Puzzle } from "lucide-react";
import { type CSSProperties, useMemo } from "react";
import { artifactInitialSize } from "../../../kernel/artifact-size.js";
import { defaultReferencePathForArtifact } from "../../../kernel/preview-reference.js";
import sharedStyles from "../../editors/shared/editor-shell.module.css";
import { ArtifactPreview } from "../../rendering/artifact-renderer/artifact-rendering.js";
import { ReferencePreview } from "../../rendering/reference-preview/reference-preview.js";
import type { CatalogArtifact, DocumentCatalog } from "../../shared/api/client.js";
import type { ArtifactDocument, PrototypeDocument, ReferenceDocument } from "../../shared/types.js";
import { createWebClasses } from "../../styles/web-styles.js";
import { useWorkspaceDocumentCommands } from "../document-commands-context.js";
import workspaceStyles from "../workspace.module.css";
import explorerStyles from "./artifact-explorer.module.css";
import {
  type ArtifactLayoutNode,
  type DirectoryViewMode,
  directoryAtPath,
  type ExplorerDirectory,
  type ExplorerDocument,
  type ExplorerDocumentType,
  type GalleryLayoutMode,
  type GalleryScale,
  galleryDirectoryArtifacts,
  galleryScaleFactor,
  layoutDirectoryArtifacts,
} from "./artifact-explorer-model.js";
import { useWorkspaceNavigation } from "./workspace-navigation-state.js";

const webClasses = createWebClasses(sharedStyles, explorerStyles, workspaceStyles);

function DocumentIcon({ type, size = 13 }: { readonly type: ExplorerDocumentType; readonly size?: number }) {
  if (type === "Canvas") return <Monitor size={size} />;
  if (type === "Widget") return <Box size={size} />;
  if (type === "Fragment") return <Puzzle size={size} />;
  if (type === "Artifact") return <AlertTriangle size={size} />;
  if (type === "Reference") return <BookOpen size={size} />;
  return <MousePointer2 size={size} />;
}

function defaultReferenceForArtifact(
  references: ReadonlyMap<string, ReferenceDocument>,
  artifact: ArtifactDocument,
): ReferenceDocument | undefined {
  const document = references.get(artifact.artifactKey);
  if (!document || document.subjectArtifactKey !== artifact.artifactKey) return undefined;
  const expectedPath = defaultReferencePathForArtifact(artifact.path).replaceAll("\\", "/").toLocaleLowerCase("en-US");
  return document.path.replaceAll("\\", "/").toLocaleLowerCase("en-US") === expectedPath ? document : undefined;
}

function previewSize(
  artifact: ArtifactDocument,
  artifacts: ReadonlyMap<string, ArtifactDocument>,
  reference: ReferenceDocument | undefined,
): readonly [number, number] {
  if (!reference) return artifactInitialSize(artifact.resolvedSource);
  if (reference.reference.viewport) return reference.reference.viewport;
  const rootArtifactKey = reference.reference.context?.parentArtifactKey ?? reference.subjectArtifactKey;
  const root = artifacts.get(rootArtifactKey);
  return root ? artifactInitialSize(root.resolvedSource) : artifactInitialSize(artifact.resolvedSource);
}

function previewScale(size: readonly [number, number], density: ArtifactLayoutNode["density"]): number {
  const bounds = density === "canvas" ? [286, 154] : density === "widget" ? [158, 72] : [142, 48];
  return Math.min(1, bounds[0]! / size[0], bounds[1]! / size[1]);
}

function edgePath(
  from: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  to: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): string {
  if (to.y >= from.y + from.height) {
    const startX = from.x + from.width / 2;
    const startY = from.y + from.height;
    const endX = to.x + to.width / 2;
    const endY = to.y;
    const middleY = startY + (endY - startY) / 2;
    return `M ${startX} ${startY} V ${middleY} H ${endX} V ${endY}`;
  }
  const startX = from.x + from.width;
  const startY = from.y + from.height / 2;
  const endX = to.x;
  const endY = to.y + to.height / 2;
  const middleX = startX + (endX - startX) / 2;
  return `M ${startX} ${startY} H ${middleX} V ${endY} H ${endX}`;
}

export interface DirectoryOverviewProps {
  readonly directory: string;
  readonly view: DirectoryViewMode;
  readonly scale: GalleryScale;
  readonly catalog: DocumentCatalog;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypes: ReadonlyMap<string, PrototypeDocument>;
  readonly onOpenDirectory: (path: string) => void;
  readonly onOpenArtifact: (artifactKey: string) => void;
  readonly onOpenReference: (referenceKey: string) => void;
  readonly onOpenPrototype: (prototypeKey: string, referenceKey?: string) => void;
}

function ArtifactCard({
  artifact,
  artifacts,
  references,
  density,
  layout,
  galleryScale,
  style,
  onOpen,
}: {
  readonly artifact: ArtifactDocument;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly density: ArtifactLayoutNode["density"];
  readonly layout?: GalleryLayoutMode;
  readonly galleryScale?: GalleryScale;
  readonly style?: CSSProperties;
  readonly onOpen: () => void;
}) {
  const commands = useWorkspaceDocumentCommands();
  const target = { kind: "artifact", key: artifact.artifactKey, path: artifact.path } as const;
  const defaultReference = defaultReferenceForArtifact(references, artifact);
  const scale = galleryScale ? galleryScaleFactor(galleryScale) : previewScale(previewSize(artifact, artifacts, defaultReference), density);
  const size = artifactInitialSize(artifact.resolvedSource);
  const preview = (
    <div className={webClasses("artifact-card-preview")}>
      {defaultReference ? (
        <ReferencePreview
          reference={defaultReference.reference}
          referencePath={defaultReference.path}
          references={references}
          artifacts={artifacts}
          fixedScale={scale}
          className={webClasses("gallery-reference-preview")}
        />
      ) : (
        <div style={{ width: size[0] * scale, height: size[1] * scale }}>
          <div style={{ width: size[0], height: size[1], transform: `scale(${scale})`, transformOrigin: "0 0" }}>
            <ArtifactPreview source={artifact.resolvedSource} artifacts={artifacts} />
          </div>
        </div>
      )}
    </div>
  );
  if (layout)
    return (
      <button
        className={webClasses(`gallery-preview-item density-${density} layout-${layout}`)}
        data-gallery-kind="artifact"
        type="button"
        onClick={onOpen}
        onContextMenu={(event) => commands.open(event, target)}
        onKeyDown={(event) => commands.open(event, target)}
        title={artifact.path}
      >
        {preview}
        {layout === "list" ? (
          <span className={webClasses("gallery-item-summary gallery-item-summary-name")}>
            <span>{artifact.artifactKey}</span>
          </span>
        ) : null}
        <div className={webClasses("gallery-item-meta")}>
          <span className={webClasses("gallery-item-identity")} data-ui="gallery-item-identity">
            <DocumentIcon type={artifact.artifactType} size={14} />
            <strong>{artifact.artifactKey}</strong>
            <small>{artifact.artifactType}</small>
          </span>
          <span className={webClasses("gallery-item-facts")}>
            <span>
              {size[0]} x {size[1]}
            </span>
            <span>{artifact.dependencies.length} 个引用</span>
          </span>
        </div>
      </button>
    );
  return (
    <button
      className={webClasses(`artifact-card density-${density}`)}
      style={style}
      type="button"
      onClick={onOpen}
      onContextMenu={(event) => commands.open(event, target)}
      onKeyDown={(event) => commands.open(event, target)}
      title={artifact.path}
    >
      <div className={webClasses("artifact-card-heading")}>
        <DocumentIcon type={artifact.artifactType} size={14} />
        <strong>{artifact.artifactKey}</strong>
        <small>{artifact.artifactType}</small>
      </div>
      {preview}
      <div className={webClasses("artifact-card-footer")}>
        <span>
          {size[0]} x {size[1]}
        </span>
        <span>{artifact.dependencies.length} 个引用</span>
      </div>
    </button>
  );
}

function ReferenceCard({
  document,
  artifacts,
  references,
  layout,
  scale,
  onOpen,
}: {
  readonly document: ReferenceDocument;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly layout: GalleryLayoutMode;
  readonly scale: GalleryScale;
  readonly onOpen: () => void;
}) {
  const commands = useWorkspaceDocumentCommands();
  const description = document.reference.description?.trim();
  const summary = description || document.referenceKey;
  const rootArtifactKey = document.reference.context?.parentArtifactKey ?? document.subjectArtifactKey;
  const rootSource = artifacts.get(rootArtifactKey)?.resolvedSource;
  const viewport = document.reference.viewport ?? (rootSource ? artifactInitialSize(rootSource) : [1, 1]);
  return (
    <button
      className={webClasses(`gallery-preview-item layout-${layout}`)}
      data-gallery-kind="reference"
      type="button"
      onClick={onOpen}
      onContextMenu={(event) => commands.open(event, { kind: "reference", key: document.referenceKey, path: document.path })}
      onKeyDown={(event) => commands.open(event, { kind: "reference", key: document.referenceKey, path: document.path })}
      title={document.path}
    >
      <ReferencePreview
        reference={document.reference}
        referencePath={document.path}
        references={references}
        artifacts={artifacts}
        fixedScale={galleryScaleFactor(scale)}
        className={webClasses("gallery-reference-preview")}
      />
      {layout === "list" ? (
        <span
          className={webClasses(`gallery-item-summary ${description ? "gallery-item-summary-description" : "gallery-item-summary-name"}`)}
        >
          <span>{summary}</span>
        </span>
      ) : null}
      <div className={webClasses("gallery-item-meta")}>
        <span className={webClasses("gallery-item-identity")} data-ui="gallery-item-identity">
          <DocumentIcon type="Reference" size={14} />
          <strong>{document.referenceKey}</strong>
          <small>Reference</small>
        </span>
        <span className={webClasses("gallery-item-facts")}>
          <span>{document.subjectArtifactKey}</span>
          <span>
            {viewport[0]} x {viewport[1]}
          </span>
        </span>
        {description ? <p>{description}</p> : null}
      </div>
    </button>
  );
}

function PrototypeCard({
  document,
  startReference,
  artifacts,
  references,
  layout,
  scale,
  onOpen,
}: {
  readonly document: PrototypeDocument;
  readonly startReference: ReferenceDocument | undefined;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly layout: GalleryLayoutMode;
  readonly scale: GalleryScale;
  readonly onOpen: () => void;
}) {
  const commands = useWorkspaceDocumentCommands();
  return (
    <button
      className={webClasses(`gallery-preview-item layout-${layout}`)}
      data-gallery-kind="prototype"
      type="button"
      onClick={onOpen}
      onContextMenu={(event) => commands.open(event, { kind: "prototype", key: document.prototypeKey, path: document.path })}
      onKeyDown={(event) => commands.open(event, { kind: "prototype", key: document.prototypeKey, path: document.path })}
      title={document.path}
    >
      {startReference ? (
        <ReferencePreview
          reference={startReference.reference}
          referencePath={startReference.path}
          references={references}
          artifacts={artifacts}
          fixedScale={galleryScaleFactor(scale)}
          className={webClasses("gallery-reference-preview")}
        />
      ) : (
        <span className={webClasses("prototype-preview-missing")}>
          <MousePointer2 size={22} />
        </span>
      )}
      {layout === "list" ? (
        <span className={webClasses("gallery-item-summary gallery-item-summary-name")}>
          <span>{document.prototypeKey}</span>
        </span>
      ) : null}
      <div className={webClasses("gallery-item-meta")}>
        <span className={webClasses("gallery-item-identity")} data-ui="gallery-item-identity">
          <DocumentIcon type="Prototype" size={14} />
          <strong>{document.prototypeKey}</strong>
          <small>Prototype</small>
        </span>
        <span className={webClasses("gallery-item-facts")}>
          <span>{document.startReferenceKey}</span>
          <span>{document.interactionCount} 个交互</span>
        </span>
      </div>
    </button>
  );
}

function descendantDocuments(directory: ExplorerDirectory): ExplorerDocument[] {
  return [...directory.documents, ...directory.directories.flatMap(descendantDocuments)];
}

function directoryCover(directory: ExplorerDirectory): ExplorerDocument | undefined {
  const documents = descendantDocuments(directory).filter((document) => !document.unavailable);
  if (directory.cover) {
    const kind = directory.cover.kind.toLocaleLowerCase();
    const configured = documents.find((document) => document.kind === kind && document.key === directory.cover?.key);
    if (configured) return configured;
  }
  const rank: Readonly<Record<ExplorerDocumentType, number>> = {
    Reference: 0,
    Canvas: 1,
    Prototype: 2,
    Widget: 3,
    Fragment: 4,
    Artifact: 5,
  };
  return [...documents].sort((left, right) => rank[left.type] - rank[right.type] || left.key.localeCompare(right.key))[0];
}

function DirectoryCover({
  document,
  view,
  artifacts,
  references,
  prototypes,
}: {
  readonly document: ExplorerDocument | undefined;
  readonly view: DirectoryViewMode;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypes: ReadonlyMap<string, PrototypeDocument>;
}) {
  const bounds: readonly [number, number] = view === "grid" ? [280, 156] : view === "list" ? [170, 96] : [100, 72];
  if (!document)
    return (
      <div className={webClasses("directory-cover-empty")}>
        <Folder size={26} />
      </div>
    );
  if (document.kind === "artifact") {
    const artifact = artifacts.get(document.key);
    if (!artifact)
      return (
        <div className={webClasses("directory-cover-empty")}>
          <Folder size={26} />
        </div>
      );
    const defaultReference = defaultReferenceForArtifact(references, artifact);
    if (defaultReference)
      return (
        <ReferencePreview
          reference={defaultReference.reference}
          referencePath={defaultReference.path}
          references={references}
          artifacts={artifacts}
          maxSize={bounds}
          className={webClasses("directory-cover-preview")}
        />
      );
    const size = artifactInitialSize(artifact.resolvedSource);
    const scale = Math.min(1, bounds[0] / size[0], bounds[1] / size[1]);
    return (
      <div className={webClasses("directory-cover-preview")}>
        <div style={{ width: size[0] * scale, height: size[1] * scale }}>
          <div style={{ width: size[0], height: size[1], transform: `scale(${scale})`, transformOrigin: "0 0" }}>
            <ArtifactPreview source={artifact.resolvedSource} artifacts={artifacts} />
          </div>
        </div>
      </div>
    );
  }
  const reference =
    document.kind === "reference" ? references.get(document.key) : references.get(prototypes.get(document.key)?.startReferenceKey ?? "");
  return reference ? (
    <ReferencePreview
      reference={reference.reference}
      referencePath={reference.path}
      references={references}
      artifacts={artifacts}
      maxSize={bounds}
      className={webClasses("directory-cover-preview")}
    />
  ) : (
    <div className={webClasses("directory-cover-empty")}>
      <Folder size={26} />
    </div>
  );
}

function DirectoryFolders({
  directories,
  view,
  artifacts,
  references,
  prototypes,
  onOpenDirectory,
}: {
  readonly directories: readonly ExplorerDirectory[];
  readonly view: DirectoryViewMode;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypes: ReadonlyMap<string, PrototypeDocument>;
  readonly onOpenDirectory: (path: string) => void;
}) {
  const commands = useWorkspaceDocumentCommands();
  if (directories.length === 0) return null;
  return (
    <section className={webClasses(`directory-folders layout-${view}`)}>
      <header>
        <h2>目录</h2>
        <span>{directories.length}</span>
      </header>
      <div>
        {directories.map((directory) => {
          const documents = descendantDocuments(directory);
          return (
            <button
              key={directory.path}
              type="button"
              onClick={() => onOpenDirectory(directory.path)}
              onContextMenu={(event) => commands.open(event, { kind: "directory", path: directory.path })}
              onKeyDown={(event) => commands.open(event, { kind: "directory", path: directory.path })}
              title={directory.path}
              data-directory-card
            >
              <DirectoryCover
                document={directoryCover(directory)}
                view={view}
                artifacts={artifacts}
                references={references}
                prototypes={prototypes}
              />
              <span className={webClasses("directory-folder-copy")}>
                <strong>{directory.displayName}</strong>
                <small>{directory.name}</small>
                <p>{directory.description || `${documents.length} 个文档`}</p>
              </span>
              <span className={webClasses("directory-folder-facts")}>
                <small>{documents.length}</small>
                <ChevronRight size={15} />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ExternalDependencies({
  dependencies,
  artifacts,
  onOpenArtifact,
}: {
  readonly dependencies: ReturnType<typeof layoutDirectoryArtifacts>["externalDependencies"];
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly onOpenArtifact: (artifactKey: string) => void;
}) {
  if (dependencies.length === 0) return null;
  return (
    <section className={webClasses("external-dependencies")}>
      <h2>外部依赖</h2>
      <div>
        {dependencies.map((dependency) => (
          <button
            key={dependency.artifactKey}
            type="button"
            onClick={() => onOpenArtifact(dependency.artifactKey)}
            disabled={!artifacts.has(dependency.artifactKey)}
            title={`被 ${dependency.requestedBy.join(", ")} 使用`}
          >
            <Box size={13} />
            <span>{dependency.artifactKey}</span>
            <small>{dependency.requestedBy.length}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function DependencyOverview({
  layout,
  artifacts,
  references,
  onOpenArtifact,
}: {
  readonly layout: ReturnType<typeof layoutDirectoryArtifacts>;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly onOpenArtifact: (artifactKey: string) => void;
}) {
  const nodeByKey = new Map(layout.nodes.map((node) => [node.artifactKey, node]));
  return layout.nodes.length > 0 ? (
    <div className={webClasses("artifact-board")} style={{ width: layout.width, height: layout.height }}>
      {layout.clusters.map((cluster) => (
        <div
          key={cluster.canvasKey}
          className={webClasses("artifact-cluster")}
          style={{ left: cluster.x, top: cluster.y, width: cluster.width, height: cluster.height }}
        >
          <span>{cluster.canvasKey}</span>
        </div>
      ))}
      {layout.sections.map((section) => (
        <div
          key={section.kind}
          className={webClasses(`artifact-layout-section section-${section.kind}`)}
          style={{ left: section.x, top: section.y, width: section.width, height: section.height }}
        >
          <span>{section.label}</span>
        </div>
      ))}
      <svg className={webClasses("artifact-board-edges")} width={layout.width} height={layout.height} aria-hidden="true">
        <defs>
          <marker id="artifact-edge-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" />
          </marker>
        </defs>
        {layout.edges.map((edge) => {
          const from = nodeByKey.get(edge.fromArtifactKey);
          const to = nodeByKey.get(edge.toArtifactKey);
          return from && to ? (
            <path key={`${edge.fromArtifactKey}:${edge.toArtifactKey}`} d={edgePath(from, to)} markerEnd="url(#artifact-edge-arrow)" />
          ) : null;
        })}
      </svg>
      {layout.nodes.map((node) => {
        const artifact = artifacts.get(node.artifactKey);
        return artifact ? (
          <ArtifactCard
            key={node.artifactKey}
            artifact={artifact}
            artifacts={artifacts}
            references={references}
            density={node.density}
            style={{ position: "absolute", left: node.x, top: node.y, width: node.width, height: node.height }}
            onOpen={() => onOpenArtifact(node.artifactKey)}
          />
        ) : null;
      })}
    </div>
  ) : (
    <div className={webClasses("directory-empty")}>
      <Folder size={24} />
      <span>没有直接 Artifact</span>
    </div>
  );
}

function GalleryOverview({
  groups,
  artifacts,
  references,
  prototypes,
  layout,
  scale,
  onOpenArtifact,
  onOpenReference,
  onOpenPrototype,
}: {
  readonly groups: ReturnType<typeof galleryDirectoryArtifacts>;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypes: ReadonlyMap<string, PrototypeDocument>;
  readonly layout: GalleryLayoutMode;
  readonly scale: GalleryScale;
  readonly onOpenArtifact: (artifactKey: string) => void;
  readonly onOpenReference: (referenceKey: string) => void;
  readonly onOpenPrototype: (prototypeKey: string) => void;
}) {
  const sections: readonly {
    readonly title: string;
    readonly density: ArtifactLayoutNode["density"];
    readonly entries: readonly CatalogArtifact[];
  }[] = [
    { title: "Canvas", density: "canvas", entries: groups.canvases },
    { title: "Widget", density: "widget", entries: groups.widgets },
    { title: "Fragment", density: "fragment", entries: groups.fragments },
  ];
  if (sections.every((section) => section.entries.length === 0) && groups.referenceGroups.length === 0 && groups.prototypes.length === 0)
    return (
      <div className={webClasses("directory-empty")}>
        <Folder size={24} />
        <span>没有直接文档</span>
      </div>
    );
  return (
    <div className={webClasses(`artifact-gallery layout-${layout}`)}>
      {sections
        .filter((section) => section.entries.length > 0)
        .map((section) => (
          <section key={section.title} className={webClasses(`gallery-section density-${section.density}`)}>
            <header>
              <h2>{section.title}</h2>
              <span>{section.entries.length}</span>
            </header>
            <div>
              {section.entries.map((entry) => {
                const artifact = artifacts.get(entry.artifactKey);
                return artifact ? (
                  <ArtifactCard
                    key={entry.artifactKey}
                    artifact={artifact}
                    artifacts={artifacts}
                    references={references}
                    density={section.density}
                    layout={layout}
                    galleryScale={scale}
                    onOpen={() => onOpenArtifact(entry.artifactKey)}
                  />
                ) : null;
              })}
            </div>
          </section>
        ))}
      {groups.referenceGroups.map((group) => (
        <section key={`reference:${group.key}`} className={webClasses("gallery-section")}>
          <header>
            <h2>{group.label}</h2>
            <span>{group.references.length}</span>
          </header>
          <div>
            {group.references.map((entry) => {
              const document = references.get(entry.referenceKey);
              return document ? (
                <ReferenceCard
                  key={entry.referenceKey}
                  document={document}
                  artifacts={artifacts}
                  references={references}
                  layout={layout}
                  scale={scale}
                  onOpen={() => onOpenReference(entry.referenceKey)}
                />
              ) : null;
            })}
          </div>
        </section>
      ))}
      {groups.prototypes.length > 0 ? (
        <section className={webClasses("gallery-section")}>
          <header>
            <h2>Prototype</h2>
            <span>{groups.prototypes.length}</span>
          </header>
          <div>
            {groups.prototypes.map((entry) => {
              const document = prototypes.get(entry.prototypeKey);
              return document ? (
                <PrototypeCard
                  key={entry.prototypeKey}
                  document={document}
                  startReference={references.get(entry.startReferenceKey)}
                  artifacts={artifacts}
                  references={references}
                  layout={layout}
                  scale={scale}
                  onOpen={() => onOpenPrototype(entry.prototypeKey)}
                />
              ) : null;
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function DependencyDocuments({
  groups,
  artifacts,
  references,
  prototypes,
  scale,
  onOpenReference,
  onOpenPrototype,
}: {
  readonly groups: ReturnType<typeof galleryDirectoryArtifacts>;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypes: ReadonlyMap<string, PrototypeDocument>;
  readonly scale: GalleryScale;
  readonly onOpenReference: (referenceKey: string) => void;
  readonly onOpenPrototype: (prototypeKey: string, referenceKey?: string) => void;
}) {
  if (groups.referenceGroups.length === 0 && groups.prototypes.length === 0) return null;
  return (
    <div className={webClasses("dependency-documents")}>
      <GalleryOverview
        groups={{ ...groups, canvases: [], widgets: [], fragments: [] }}
        artifacts={artifacts}
        references={references}
        prototypes={prototypes}
        layout="grid"
        scale={scale}
        onOpenArtifact={() => {}}
        onOpenReference={onOpenReference}
        onOpenPrototype={onOpenPrototype}
      />
    </div>
  );
}

export function DirectoryOverview({
  directory,
  view,
  scale,
  catalog,
  artifacts,
  references,
  prototypes,
  onOpenDirectory,
  onOpenArtifact,
  onOpenReference,
  onOpenPrototype,
}: DirectoryOverviewProps) {
  const navigation = useWorkspaceNavigation();
  const directoryNode = useMemo(() => directoryAtPath(catalog, directory, navigation.sort), [catalog, directory, navigation.sort]);
  const layout = useMemo(() => layoutDirectoryArtifacts(catalog.artifacts, directory), [catalog, directory]);
  const gallery = useMemo(() => galleryDirectoryArtifacts(catalog, directory, navigation.sort), [catalog, directory, navigation.sort]);
  const referenceCount = gallery.referenceGroups.reduce((total, group) => total + group.references.length, 0);
  const hasDirectories = Boolean(directoryNode?.directories.length);
  const hasGalleryDocuments =
    gallery.canvases.length + gallery.widgets.length + gallery.fragments.length + referenceCount + gallery.prototypes.length > 0;

  return (
    <section className={webClasses("directory-workspace")}>
      <header className={webClasses("directory-heading")}>
        <div>
          <span className={webClasses("panel-kicker")}>{directory || "UIAuthoring"}</span>
          <h1>{directoryNode?.displayName || directory || "UIAuthoring"}</h1>
        </div>
        <div className={webClasses("directory-counts")}>
          <span>{layout.nodes.length} 个 Artifact</span>
          <span>{referenceCount} 个 Reference</span>
          <span>{gallery.prototypes.length} 个 Prototype</span>
        </div>
      </header>
      <div className={webClasses("directory-scroll")}>
        <DirectoryFolders
          directories={directoryNode?.directories ?? []}
          view={view}
          artifacts={artifacts}
          references={references}
          prototypes={prototypes}
          onOpenDirectory={onOpenDirectory}
        />
        {view === "dependency" ? (
          <>
            {layout.nodes.length > 0 || !hasDirectories ? (
              <DependencyOverview layout={layout} artifacts={artifacts} references={references} onOpenArtifact={onOpenArtifact} />
            ) : null}
            <ExternalDependencies dependencies={layout.externalDependencies} artifacts={artifacts} onOpenArtifact={onOpenArtifact} />
            <DependencyDocuments
              groups={gallery}
              artifacts={artifacts}
              references={references}
              prototypes={prototypes}
              scale={scale}
              onOpenReference={onOpenReference}
              onOpenPrototype={onOpenPrototype}
            />
          </>
        ) : hasGalleryDocuments || !hasDirectories ? (
          <GalleryOverview
            groups={gallery}
            artifacts={artifacts}
            references={references}
            prototypes={prototypes}
            layout={view}
            scale={scale}
            onOpenArtifact={onOpenArtifact}
            onOpenReference={onOpenReference}
            onOpenPrototype={onOpenPrototype}
          />
        ) : null}
      </div>
    </section>
  );
}
