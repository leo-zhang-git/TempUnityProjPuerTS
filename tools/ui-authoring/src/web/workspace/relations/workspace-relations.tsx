import { ArrowLeft, ArrowLeftRight, ArrowRight, BookOpen, Box, GitFork, Layers3, Monitor, MousePointer2, Puzzle } from "lucide-react";
import { type CSSProperties, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { artifactInitialSize } from "../../../kernel/artifact-size.js";
import sharedStyles from "../../editors/shared/editor-shell.module.css";
import { ArtifactPreview } from "../../rendering/artifact-renderer/artifact-rendering.js";
import { ReferencePreview } from "../../rendering/reference-preview/reference-preview.js";
import { LegmaMark } from "../../shared/legma-mark.js";
import { ThemeToggle } from "../../shared/theme.js";
import type { ArtifactDocument, PrototypeDocument, ReferenceDocument } from "../../shared/types.js";
import { createWebClasses } from "../../styles/web-styles.js";
import {
  buildWorkspaceRelationGraph,
  type WorkspaceRelationContext,
  type WorkspaceRelationEdge,
  type WorkspaceRelationGraph,
  type WorkspaceRelationNode,
  type WorkspaceRelationNodeKind,
  type WorkspaceRelationReach,
  workspaceRelationContext,
  workspaceRelationEdgesForReach,
  workspaceRelationReasonLabel,
} from "./workspace-relation-model.js";
import relationStyles from "./workspace-relations.module.css";

const webClasses = createWebClasses(sharedStyles, relationStyles);

type RelationDepth = "direct" | "two" | "all";
type RelationDirection = "both" | "incoming" | "outgoing";
type RelationTypeFilter = "all" | WorkspaceRelationNodeKind;

interface RelationLine {
  readonly id: string;
  readonly path: string;
  readonly active: boolean;
  readonly count: number;
}

function RelationNodeIcon({ node, size = 14 }: { readonly node: WorkspaceRelationNode; readonly size?: number }) {
  if (node.kind === "reference") return <BookOpen size={size} />;
  if (node.kind === "prototype") return <MousePointer2 size={size} />;
  if (node.artifactType === "Canvas") return <Monitor size={size} />;
  if (node.artifactType === "Fragment") return <Puzzle size={size} />;
  return <Box size={size} />;
}

function relationType(node: WorkspaceRelationNode): string {
  if (node.kind === "artifact") return node.artifactType ?? "Artifact";
  return node.kind === "reference" ? "Reference" : "Prototype";
}

function ArtifactThumbnail({
  document,
  artifacts,
  root = false,
}: {
  readonly document: ArtifactDocument;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly root?: boolean;
}) {
  const size = artifactInitialSize(document.resolvedSource);
  const bounds: readonly [number, number] = root ? [286, 132] : [210, 82];
  const scale = Math.min(bounds[0] / size[0], bounds[1] / size[1]);
  return (
    <span className={webClasses("relation-preview")}>
      <span style={{ width: size[0] * scale, height: size[1] * scale }}>
        <span style={{ width: size[0], height: size[1], transform: `scale(${scale})`, transformOrigin: "0 0" }}>
          <ArtifactPreview source={document.resolvedSource} artifacts={artifacts} />
        </span>
      </span>
    </span>
  );
}

function RelationThumbnail({
  node,
  artifacts,
  references,
  prototypes,
}: {
  readonly node: WorkspaceRelationNode;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypes: ReadonlyMap<string, PrototypeDocument>;
}) {
  if (node.kind === "artifact") {
    const document = artifacts.get(node.key);
    return document ? <ArtifactThumbnail document={document} artifacts={artifacts} /> : <span className={webClasses("missing-preview")} />;
  }
  const reference =
    node.kind === "reference" ? references.get(node.key) : references.get(prototypes.get(node.key)?.startReferenceKey ?? "");
  return reference ? (
    <ReferencePreview
      reference={reference.reference}
      referencePath={reference.path}
      references={references}
      artifacts={artifacts}
      maxSize={[210, 82]}
      className={webClasses("relation-preview reference-preview")}
    />
  ) : (
    <span className={webClasses("missing-preview")}>
      <RelationNodeIcon node={node} size={24} />
    </span>
  );
}

function reachDetail(
  graph: WorkspaceRelationGraph,
  context: WorkspaceRelationContext,
  direction: "incoming" | "outgoing",
  reach: WorkspaceRelationReach,
): string {
  if (reach.distance > 1) {
    const nearestEdge = reach.pathEdges[0];
    const nearestId = nearestEdge ? (direction === "outgoing" ? nearestEdge.to : nearestEdge.from) : undefined;
    const nearest = nearestId ? graph.nodes.find((node) => node.id === nearestId) : undefined;
    return `${reach.distance} 层${nearest ? ` · 经由 ${nearest.key}` : ""}`;
  }
  const details = workspaceRelationEdgesForReach(graph, context.root.id, direction, reach).map((edge) =>
    edge.useSite ? `${workspaceRelationReasonLabel(edge.reason)} · ${edge.useSite}` : workspaceRelationReasonLabel(edge.reason),
  );
  return [...new Set(details)].join(", ");
}

function RelationCard({
  graph,
  context,
  reach,
  direction,
  artifacts,
  references,
  prototypes,
  register,
  onOpen,
}: {
  readonly graph: WorkspaceRelationGraph;
  readonly context: WorkspaceRelationContext;
  readonly reach: WorkspaceRelationReach;
  readonly direction: "incoming" | "outgoing";
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypes: ReadonlyMap<string, PrototypeDocument>;
  readonly register: (id: string, element: HTMLElement | null) => void;
  readonly onOpen: (node: WorkspaceRelationNode) => void;
}) {
  return (
    <button
      ref={(element) => register(reach.node.id, element)}
      className={webClasses(`relation-card ${reach.distance === 1 ? "is-direct" : "is-indirect"}`)}
      type="button"
      data-relation-node={reach.node.id}
      data-relation-kind={reach.node.kind}
      data-relation-key={reach.node.key}
      data-relation-distance={reach.distance}
      data-relation-direction={direction}
      onClick={() => onOpen(reach.node)}
      title={reach.node.path ?? reach.node.key}
    >
      <span className={webClasses("relation-card-heading")}>
        <RelationNodeIcon node={reach.node} />
        <strong>{reach.node.key}</strong>
        <small>{relationType(reach.node)}</small>
      </span>
      <span className={webClasses("relation-card-detail")}>
        <span>{reach.distance === 1 ? "直接" : "间接"}</span>
        <em>{reachDetail(graph, context, direction, reach)}</em>
      </span>
      <RelationThumbnail node={reach.node} artifacts={artifacts} references={references} prototypes={prototypes} />
    </button>
  );
}

function RelationColumn({
  kind,
  relations,
  direction,
  graph,
  context,
  artifacts,
  references,
  prototypes,
  register,
  onOpen,
}: {
  readonly kind: "direct" | "indirect";
  readonly relations: readonly WorkspaceRelationReach[];
  readonly direction: "incoming" | "outgoing";
  readonly graph: WorkspaceRelationGraph;
  readonly context: WorkspaceRelationContext;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypes: ReadonlyMap<string, PrototypeDocument>;
  readonly register: (id: string, element: HTMLElement | null) => void;
  readonly onOpen: (node: WorkspaceRelationNode) => void;
}) {
  const label = kind === "direct" ? "直接" : "间接";
  return (
    <section className={webClasses("relation-column")} data-relation-column={`${direction}-${kind}`}>
      <header>
        <strong>
          {direction === "incoming" ? "传入" : "传出"} · {label}
        </strong>
        <span>{relations.length}</span>
      </header>
      <div>
        {relations.length > 0 ? (
          relations.map((reach) => (
            <RelationCard
              key={reach.node.id}
              graph={graph}
              context={context}
              reach={reach}
              direction={direction}
              artifacts={artifacts}
              references={references}
              prototypes={prototypes}
              register={register}
              onOpen={onOpen}
            />
          ))
        ) : (
          <span className={webClasses("empty-column")}>无</span>
        )}
      </div>
    </section>
  );
}

function filterReach(
  relations: readonly WorkspaceRelationReach[],
  depth: RelationDepth,
  type: RelationTypeFilter,
): readonly WorkspaceRelationReach[] {
  const maximum = depth === "direct" ? 1 : depth === "two" ? 2 : Number.POSITIVE_INFINITY;
  return relations.filter((entry) => entry.distance <= maximum && (type === "all" || entry.node.kind === type));
}

function SegmentButton({
  active,
  label,
  icon,
  onClick,
}: {
  readonly active: boolean;
  readonly label: string;
  readonly icon?: React.ReactNode;
  readonly onClick: () => void;
}) {
  return (
    <button type="button" className={webClasses(active ? "is-active" : "")} aria-pressed={active} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

export interface WorkspaceRelationsProps {
  readonly artifactKey: string;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypes: ReadonlyMap<string, PrototypeDocument>;
  readonly onBack: () => void;
  readonly onOpenArtifact: (artifactKey: string) => void;
  readonly onOpenReference: (referenceKey: string) => void;
  readonly onOpenPrototype: (prototypeKey: string) => void;
}

export default function WorkspaceRelations({
  artifactKey,
  artifacts,
  references,
  prototypes,
  onBack,
  onOpenArtifact,
  onOpenReference,
  onOpenPrototype,
}: WorkspaceRelationsProps) {
  const [depth, setDepth] = useState<RelationDepth>("two");
  const [direction, setDirection] = useState<RelationDirection>("both");
  const [typeFilter, setTypeFilter] = useState<RelationTypeFilter>("all");
  const [lines, setLines] = useState<readonly RelationLine[]>([]);
  const stage = useRef<HTMLDivElement>(null);
  const nodeElements = useRef(new Map<string, HTMLElement>());
  const relation = useMemo(() => {
    try {
      const graph = buildWorkspaceRelationGraph(artifacts, references, prototypes);
      return { graph, context: workspaceRelationContext(graph, "artifact", artifactKey), error: "" };
    } catch (error) {
      return { graph: undefined, context: undefined, error: error instanceof Error ? error.message : String(error) };
    }
  }, [artifactKey, artifacts, prototypes, references]);
  const register = useCallback((id: string, element: HTMLElement | null): void => {
    if (element) nodeElements.current.set(id, element);
    else nodeElements.current.delete(id);
  }, []);
  const incoming = useMemo(
    () => (relation.context && direction !== "outgoing" ? filterReach(relation.context.incoming, depth, typeFilter) : []),
    [depth, direction, relation.context, typeFilter],
  );
  const outgoing = useMemo(
    () => (relation.context && direction !== "incoming" ? filterReach(relation.context.outgoing, depth, typeFilter) : []),
    [depth, direction, relation.context, typeFilter],
  );
  const incomingDirect = incoming.filter((entry) => entry.distance === 1);
  const incomingIndirect = incoming.filter((entry) => entry.distance > 1);
  const outgoingDirect = outgoing.filter((entry) => entry.distance === 1);
  const outgoingIndirect = outgoing.filter((entry) => entry.distance > 1);
  const visibleEdges = useMemo(() => {
    if (!relation.graph || !relation.context) return [];
    const visible = new Set([
      relation.context.root.id,
      ...incoming.map((entry) => entry.node.id),
      ...outgoing.map((entry) => entry.node.id),
    ]);
    return relation.graph.edges.filter((edge) => visible.has(edge.from) && visible.has(edge.to));
  }, [incoming, outgoing, relation.context, relation.graph]);

  useLayoutEffect(() => {
    const container = stage.current;
    const currentContext = relation.context;
    if (!container || !currentContext) return;
    let frame = 0;
    const update = (): void => {
      const bounds = container.getBoundingClientRect();
      const grouped = new Map<string, { readonly edge: WorkspaceRelationEdge; count: number }>();
      for (const edge of visibleEdges) {
        const key = `${edge.from}\0${edge.to}`;
        const current = grouped.get(key);
        if (current) current.count += 1;
        else grouped.set(key, { edge, count: 1 });
      }
      const next: RelationLine[] = [];
      for (const [id, entry] of grouped) {
        const from = nodeElements.current.get(entry.edge.from)?.getBoundingClientRect();
        const to = nodeElements.current.get(entry.edge.to)?.getBoundingClientRect();
        if (!from || !to) continue;
        const leftToRight = from.left + from.width / 2 <= to.left + to.width / 2;
        const startX = (leftToRight ? from.right : from.left) - bounds.left;
        const endX = (leftToRight ? to.left : to.right) - bounds.left;
        const startY = from.top + from.height / 2 - bounds.top;
        const endY = to.top + to.height / 2 - bounds.top;
        const middleX = (startX + endX) / 2;
        next.push({
          id,
          path: `M ${startX} ${startY} H ${middleX} V ${endY} H ${endX}`,
          active: entry.edge.from === currentContext.root.id || entry.edge.to === currentContext.root.id,
          count: entry.count,
        });
      }
      setLines(next);
    };
    const schedule = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    for (const element of nodeElements.current.values()) observer.observe(element);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [relation.context, visibleEdges]);

  const open = (node: WorkspaceRelationNode): void => {
    if (node.kind === "artifact") onOpenArtifact(node.key);
    else if (node.kind === "reference") onOpenReference(node.key);
    else onOpenPrototype(node.key);
  };
  const rootDocument = artifacts.get(artifactKey);
  const maximumColumnSize = Math.max(incomingDirect.length, incomingIndirect.length, outgoingDirect.length, outgoingIndirect.length, 3);
  const stageStyle = { "--relation-stage-height": `${Math.max(650, maximumColumnSize * 166 + 110)}px` } as CSSProperties;

  if (!relation.graph || !relation.context || !rootDocument)
    return (
      <main className={webClasses("relation-shell relation-error-state")}>
        <GitFork size={28} />
        <strong>关系不可用</strong>
        <span>{relation.error || `缺少 Artifact：${artifactKey}`}</span>
        <button type="button" onClick={onBack}>
          返回
        </button>
      </main>
    );

  return (
    <main className={webClasses("relation-shell")}>
      <header className={webClasses("relation-topbar")}>
        <div className={webClasses("brand-block relation-brand")}>
          <button type="button" className={webClasses("relation-back")} onClick={onBack} title="返回 Artifact" aria-label="返回 Artifact">
            <ArrowLeft size={16} />
          </button>
          <LegmaMark className={webClasses("legma-mark")} />
          <strong>{artifactKey}</strong>
          <span className={webClasses("brand-separator")}>/</span>
          <span>关系</span>
        </div>
        <div className={webClasses("relation-topbar-meta")}>
          <span>{incoming.length} 个传入关系</span>
          <span>{outgoing.length} 个传出关系</span>
          <span>{visibleEdges.length} 条直接连线</span>
        </div>
        <ThemeToggle className={webClasses("icon-button relation-theme")} />
      </header>

      <div className={webClasses("relation-controls")}>
        <div className={webClasses("relation-control-group")}>
          <span>深度</span>
          <div className={webClasses("relation-segments")} role="group" aria-label="关系深度">
            <SegmentButton active={depth === "direct"} label="直接" onClick={() => setDepth("direct")} />
            <SegmentButton active={depth === "two"} label="2 层" onClick={() => setDepth("two")} />
            <SegmentButton active={depth === "all"} label="全部" onClick={() => setDepth("all")} />
          </div>
        </div>
        <div className={webClasses("relation-control-group")}>
          <span>方向</span>
          <div className={webClasses("relation-segments")} role="group" aria-label="关系方向">
            <SegmentButton
              active={direction === "both"}
              label="双向"
              icon={<ArrowLeftRight size={13} />}
              onClick={() => setDirection("both")}
            />
            <SegmentButton
              active={direction === "incoming"}
              label="传入"
              icon={<ArrowLeft size={13} />}
              onClick={() => setDirection("incoming")}
            />
            <SegmentButton
              active={direction === "outgoing"}
              label="传出"
              icon={<ArrowRight size={13} />}
              onClick={() => setDirection("outgoing")}
            />
          </div>
        </div>
        <div className={webClasses("relation-control-group")}>
          <span>类型</span>
          <div className={webClasses("relation-segments")} role="group" aria-label="关系类型">
            <SegmentButton active={typeFilter === "all"} label="全部" icon={<Layers3 size={13} />} onClick={() => setTypeFilter("all")} />
            <SegmentButton
              active={typeFilter === "artifact"}
              label="Artifact"
              icon={<Box size={13} />}
              onClick={() => setTypeFilter("artifact")}
            />
            <SegmentButton
              active={typeFilter === "reference"}
              label="Reference"
              icon={<BookOpen size={13} />}
              onClick={() => setTypeFilter("reference")}
            />
            <SegmentButton
              active={typeFilter === "prototype"}
              label="Prototype"
              icon={<MousePointer2 size={13} />}
              onClick={() => setTypeFilter("prototype")}
            />
          </div>
        </div>
      </div>

      <div className={webClasses("relation-scroll")}>
        <div ref={stage} className={webClasses("relation-stage")} style={stageStyle} data-relation-root={artifactKey}>
          <svg className={webClasses("relation-edges")} aria-hidden="true">
            <defs>
              <marker id="workspace-relation-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                <path d="M0,0 L7,3.5 L0,7 Z" />
              </marker>
            </defs>
            {lines.map((line) => (
              <path
                key={line.id}
                className={webClasses(line.active ? "is-active" : "")}
                data-relation-edge={line.id}
                data-relation-edge-count={line.count}
                d={line.path}
                markerEnd="url(#workspace-relation-arrow)"
              />
            ))}
          </svg>
          <RelationColumn
            kind="indirect"
            relations={incomingIndirect}
            direction="incoming"
            graph={relation.graph}
            context={relation.context}
            artifacts={artifacts}
            references={references}
            prototypes={prototypes}
            register={register}
            onOpen={open}
          />
          <RelationColumn
            kind="direct"
            relations={incomingDirect}
            direction="incoming"
            graph={relation.graph}
            context={relation.context}
            artifacts={artifacts}
            references={references}
            prototypes={prototypes}
            register={register}
            onOpen={open}
          />
          <section className={webClasses("relation-root-column")}>
            <header>
              <strong>当前</strong>
              <span>1</span>
            </header>
            <article
              ref={(element) => register(relation.context!.root.id, element)}
              className={webClasses("relation-root-card")}
              data-relation-focus={artifactKey}
            >
              <span className={webClasses("relation-card-heading")}>
                <RelationNodeIcon node={relation.context.root} size={15} />
                <strong>{artifactKey}</strong>
                <small>{rootDocument.artifactType}</small>
              </span>
              <ArtifactThumbnail document={rootDocument} artifacts={artifacts} root />
              <span className={webClasses("relation-root-facts")}>
                <span>{rootDocument.dependencies.length} 个直接依赖</span>
                <span>{incoming.length + outgoing.length} 个可见关系</span>
              </span>
            </article>
          </section>
          <RelationColumn
            kind="direct"
            relations={outgoingDirect}
            direction="outgoing"
            graph={relation.graph}
            context={relation.context}
            artifacts={artifacts}
            references={references}
            prototypes={prototypes}
            register={register}
            onOpen={open}
          />
          <RelationColumn
            kind="indirect"
            relations={outgoingIndirect}
            direction="outgoing"
            graph={relation.graph}
            context={relation.context}
            artifacts={artifacts}
            references={references}
            prototypes={prototypes}
            register={register}
            onOpen={open}
          />
        </div>
      </div>
      <footer className={webClasses("statusbar relation-statusbar")}>
        <span className={webClasses("dirty-dot")} />
        <span>就绪</span>
        <span className={webClasses("relation-legend")}>
          <span>
            <Monitor size={11} /> Canvas
          </span>
          <span>
            <Box size={11} /> Widget
          </span>
          <span>
            <Puzzle size={11} /> Fragment
          </span>
          <span>
            <BookOpen size={11} /> Reference
          </span>
          <span>
            <MousePointer2 size={11} /> Prototype
          </span>
        </span>
        <span className={webClasses("status-path")}>{rootDocument.path}</span>
      </footer>
    </main>
  );
}
