import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  Box,
  GitBranch,
  GitFork,
  Maximize2,
  Monitor,
  MousePointer2,
  Puzzle,
} from "lucide-react";
import { useMemo } from "react";
import type { ArtifactDocument, PrototypeDocument, ReferenceDocument } from "../../../shared/types.js";
import { createWebClasses } from "../../../styles/web-styles.js";
import {
  buildWorkspaceRelationGraph,
  type WorkspaceRelationContext,
  type WorkspaceRelationGraph,
  type WorkspaceRelationNode,
  type WorkspaceRelationNodeKind,
  type WorkspaceRelationReach,
  workspaceRelationContext,
  workspaceRelationEdgesForReach,
  workspaceRelationReasonLabel,
  workspaceUsageRelationContext,
  workspaceVariantRelationContext,
} from "../../../workspace/relations/workspace-relation-model.js";
import artifactStyles from "../artifact-editor-shell.module.css";

const webClasses = createWebClasses(artifactStyles);

interface RelationGroupDefinition {
  readonly title: string;
  readonly direction: "incoming" | "outgoing";
  readonly kind: WorkspaceRelationNodeKind;
  readonly variant?: boolean;
}

const VARIANT_GROUPS: readonly RelationGroupDefinition[] = [
  { title: "基础 Artifact", direction: "outgoing", kind: "artifact", variant: true },
  { title: "派生 Variant", direction: "incoming", kind: "artifact", variant: true },
];

const USAGE_GROUPS: readonly RelationGroupDefinition[] = [
  { title: "使用的 Artifact", direction: "outgoing", kind: "artifact" },
  { title: "被 Artifact 使用", direction: "incoming", kind: "artifact" },
  { title: "被 Reference 使用", direction: "incoming", kind: "reference" },
  { title: "被 Prototype 使用", direction: "incoming", kind: "prototype" },
];

function RelationIcon({ node }: { readonly node: WorkspaceRelationNode }) {
  if (node.kind === "reference") return <BookOpen size={14} />;
  if (node.kind === "prototype") return <MousePointer2 size={14} />;
  if (node.artifactType === "Canvas") return <Monitor size={14} />;
  if (node.artifactType === "Fragment") return <Puzzle size={14} />;
  return <Box size={14} />;
}

function relationType(node: WorkspaceRelationNode): string {
  if (node.kind === "artifact") return node.artifactType ?? "Artifact";
  return node.kind === "reference" ? "Reference" : "Prototype";
}

function relationDetail(
  graph: WorkspaceRelationGraph,
  context: WorkspaceRelationContext,
  direction: "incoming" | "outgoing",
  relation: WorkspaceRelationReach,
): string {
  if (relation.distance > 1) {
    const nearestEdge = relation.pathEdges[0];
    const nearestId = nearestEdge ? (direction === "outgoing" ? nearestEdge.to : nearestEdge.from) : undefined;
    const nearest = nearestId ? graph.nodes.find((node) => node.id === nearestId) : undefined;
    return `${relation.distance} 层${nearest ? ` · 经由 ${nearest.key}` : ""}`;
  }
  const details = workspaceRelationEdgesForReach(graph, context.root.id, direction, relation).map((edge) =>
    edge.useSite ? `${workspaceRelationReasonLabel(edge.reason)} · ${edge.useSite}` : workspaceRelationReasonLabel(edge.reason),
  );
  return [...new Set(details)].join(", ");
}

function RelationRows({
  graph,
  context,
  direction,
  relations,
  onOpen,
}: {
  readonly graph: WorkspaceRelationGraph;
  readonly context: WorkspaceRelationContext;
  readonly direction: "incoming" | "outgoing";
  readonly relations: readonly WorkspaceRelationReach[];
  readonly onOpen: (node: WorkspaceRelationNode) => void;
}) {
  if (relations.length === 0) return null;
  return (
    <ul>
      {relations.map((relation) => (
        <li key={relation.node.id}>
          <button
            type="button"
            data-relation-key={relation.node.key}
            data-relation-kind={relation.node.kind}
            data-relation-distance={relation.distance}
            onClick={() => onOpen(relation.node)}
            title={`打开 ${relation.node.key}`}
          >
            <RelationIcon node={relation.node} />
            <span>
              <strong>{relation.node.key}</strong>
              <em>{relationDetail(graph, context, direction, relation)}</em>
            </span>
            <span className={webClasses(`relation-depth ${relation.distance === 1 ? "is-direct" : ""}`)}>
              {relation.distance === 1 ? "直接" : "间接"}
            </span>
            <small>{relationType(relation.node)}</small>
          </button>
        </li>
      ))}
    </ul>
  );
}

function RelationSection({
  definition,
  graph,
  context,
  onOpen,
}: {
  readonly definition: RelationGroupDefinition;
  readonly graph: WorkspaceRelationGraph;
  readonly context: WorkspaceRelationContext;
  readonly onOpen: (node: WorkspaceRelationNode) => void;
}) {
  const relations = context[definition.direction].filter((entry) => entry.node.kind === definition.kind);
  const direct = relations.filter((entry) => entry.distance === 1);
  const indirect = relations.filter((entry) => entry.distance > 1);
  const Icon = definition.variant ? GitBranch : definition.direction === "outgoing" ? ArrowUpFromLine : ArrowDownToLine;
  return (
    <section className={webClasses("artifact-relations-section")} data-relation-group={definition.title}>
      <h2>
        <Icon size={14} />
        {definition.title}
        <span>{relations.length}</span>
      </h2>
      {relations.length === 0 ? (
        <p>无关系</p>
      ) : (
        <>
          {direct.length > 0 ? <h3>直接 · {direct.length}</h3> : null}
          <RelationRows graph={graph} context={context} direction={definition.direction} relations={direct} onOpen={onOpen} />
          {indirect.length > 0 ? <h3>间接 · {indirect.length}</h3> : null}
          <RelationRows graph={graph} context={context} direction={definition.direction} relations={indirect} onOpen={onOpen} />
        </>
      )}
    </section>
  );
}

export function ArtifactRelations({
  artifact,
  artifacts,
  references,
  prototypes,
  onOpenArtifact,
  onOpenReference,
  onOpenPrototype,
  onOpenGraph,
}: {
  readonly artifact: ArtifactDocument;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypes: ReadonlyMap<string, PrototypeDocument>;
  readonly onOpenArtifact: (artifactKey: string) => void;
  readonly onOpenReference: (referenceKey: string) => void;
  readonly onOpenPrototype: (prototypeKey: string) => void;
  readonly onOpenGraph: () => void;
}) {
  const result = useMemo(() => {
    try {
      const graph = buildWorkspaceRelationGraph(artifacts, references, prototypes);
      return {
        graph,
        context: workspaceRelationContext(graph, "artifact", artifact.artifactKey),
        usageContext: workspaceUsageRelationContext(graph, "artifact", artifact.artifactKey),
        variantContext: workspaceVariantRelationContext(graph, artifact.artifactKey),
        error: "",
      };
    } catch (error) {
      return {
        graph: undefined,
        context: undefined,
        usageContext: undefined,
        variantContext: undefined,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [artifact.artifactKey, artifacts, prototypes, references]);
  const open = (node: WorkspaceRelationNode): void => {
    if (node.kind === "artifact") onOpenArtifact(node.key);
    else if (node.kind === "reference") onOpenReference(node.key);
    else onOpenPrototype(node.key);
  };
  return (
    <div className={webClasses("artifact-relations")}>
      <header>
        <GitFork size={15} />
        <strong>关系</strong>
        <span>Source + 预览关系图</span>
        <button type="button" onClick={onOpenGraph} title="打开全屏关系图" aria-label="打开全屏关系图">
          <Maximize2 size={14} />
        </button>
      </header>
      {result.graph && result.context && result.usageContext && result.variantContext ? (
        <>
          {result.variantContext.incoming.length > 0 || result.variantContext.outgoing.length > 0
            ? VARIANT_GROUPS.map((definition) => (
                <RelationSection
                  key={definition.title}
                  definition={definition}
                  graph={result.graph!}
                  context={result.variantContext!}
                  onOpen={open}
                />
              ))
            : null}
          {USAGE_GROUPS.map((definition) => (
            <RelationSection
              key={definition.title}
              definition={definition}
              graph={result.graph!}
              context={result.usageContext!}
              onOpen={open}
            />
          ))}
        </>
      ) : (
        <p className={webClasses("artifact-relations-error")}>{result.error || "Artifact 关系根节点不可用"}</p>
      )}
      {result.graph && result.graph.diagnostics.length > 0 ? (
        <ul className={webClasses("artifact-relations-diagnostics")}>
          {result.graph.diagnostics.map((entry) => (
            <li key={`${entry.code}:${entry.path}`}>{entry.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
