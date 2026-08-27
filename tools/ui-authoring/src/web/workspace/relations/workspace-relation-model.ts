import { unityNodeName } from "../../../kernel/naming.js";
import { buildPreviewDependencyGraph } from "../../../kernel/preview-dependency-graph.js";
import { createReferenceCatalog } from "../../../kernel/prototype.js";
import { createSourceCatalog } from "../../../kernel/source-catalog.js";
import { walkNodes } from "../../../kernel/tree.js";
import type { ArtifactDocument, PrototypeDocument, ReferenceDocument } from "../../shared/types.js";

export type WorkspaceRelationNodeKind = "artifact" | "reference" | "prototype";

export type WorkspaceRelationReason =
  | "prefabRef"
  | "variant"
  | "prototypeReference"
  | "subject"
  | "context"
  | "collectionTemplate"
  | "collectionPreset"
  | "instancePreset"
  | "mountArtifact"
  | "mountPreset";

export interface WorkspaceRelationNode {
  readonly id: string;
  readonly kind: WorkspaceRelationNodeKind;
  readonly key: string;
  readonly path?: string;
  readonly artifactType?: ArtifactDocument["artifactType"];
}

export interface WorkspaceRelationEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly reason: WorkspaceRelationReason;
  readonly path: string;
  readonly useSite?: string;
}

interface WorkspaceRelationDiagnostic {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface WorkspaceRelationGraph {
  readonly nodes: readonly WorkspaceRelationNode[];
  readonly edges: readonly WorkspaceRelationEdge[];
  readonly diagnostics: readonly WorkspaceRelationDiagnostic[];
}

export interface WorkspaceRelationReach {
  readonly node: WorkspaceRelationNode;
  readonly distance: number;
  readonly pathEdges: readonly WorkspaceRelationEdge[];
}

export interface WorkspaceRelationContext {
  readonly root: WorkspaceRelationNode;
  readonly incoming: readonly WorkspaceRelationReach[];
  readonly outgoing: readonly WorkspaceRelationReach[];
}

function workspaceRelationNodeId(kind: WorkspaceRelationNodeKind, key: string): string {
  return `${kind}:${key}`;
}

export function workspaceRelationReasonLabel(reason: WorkspaceRelationReason): string {
  if (reason === "prefabRef") return "PrefabRef";
  if (reason === "variant") return "Variant";
  if (reason === "prototypeReference") return "Reference 流程";
  if (reason === "subject") return "主体";
  if (reason === "context") return "上下文";
  if (reason === "collectionTemplate") return "集合模板";
  if (reason === "collectionPreset") return "集合预设";
  if (reason === "instancePreset") return "实例预设";
  if (reason === "mountArtifact") return "挂载";
  return "挂载预设";
}

export function buildWorkspaceRelationGraph(
  artifacts: ReadonlyMap<string, ArtifactDocument>,
  references: ReadonlyMap<string, ReferenceDocument>,
  prototypes: ReadonlyMap<string, PrototypeDocument>,
): WorkspaceRelationGraph {
  const nodes = new Map<string, WorkspaceRelationNode>();
  const edges = new Map<string, WorkspaceRelationEdge>();
  const diagnostics = new Map<string, WorkspaceRelationDiagnostic>();

  const addNode = (kind: WorkspaceRelationNodeKind, key: string): WorkspaceRelationNode => {
    const id = workspaceRelationNodeId(kind, key);
    const existing = nodes.get(id);
    if (existing) return existing;
    const artifact = kind === "artifact" ? artifacts.get(key) : undefined;
    const reference = kind === "reference" ? references.get(key) : undefined;
    const prototype = kind === "prototype" ? prototypes.get(key) : undefined;
    const node: WorkspaceRelationNode = {
      id,
      kind,
      key,
      ...(artifact ? { path: artifact.path, artifactType: artifact.artifactType } : {}),
      ...(reference ? { path: reference.path } : {}),
      ...(prototype ? { path: prototype.path } : {}),
    };
    nodes.set(id, node);
    return node;
  };
  const addEdge = (input: Omit<WorkspaceRelationEdge, "id">): void => {
    const id = `${input.from}\0${input.to}\0${input.reason}\0${input.path}`;
    edges.set(id, { id, ...input });
  };

  for (const artifact of artifacts.values()) addNode("artifact", artifact.artifactKey);
  for (const reference of references.values()) addNode("reference", reference.referenceKey);
  for (const prototype of prototypes.values()) addNode("prototype", prototype.prototypeKey);

  for (const artifact of artifacts.values()) {
    const from = workspaceRelationNodeId("artifact", artifact.artifactKey);
    if (artifact.source.sourceKind === "variant") {
      addNode("artifact", artifact.source.variantOf);
      addEdge({
        from,
        to: workspaceRelationNodeId("artifact", artifact.source.variantOf),
        reason: "variant",
        path: "/variantOf",
      });
    }
    for (const entry of walkNodes(artifact.resolvedSource)) {
      const targetKey = entry.node.components?.PrefabRef?.artifactKey;
      if (!targetKey) continue;
      addNode("artifact", targetKey);
      addEdge({
        from,
        to: workspaceRelationNodeId("artifact", targetKey),
        reason: "prefabRef",
        path: `/${entry.path.join("/")}/components/PrefabRef/artifactKey`,
        useSite: unityNodeName(entry.node),
      });
    }
  }

  const sourceCatalog = createSourceCatalog([...artifacts.values()].map((entry) => ({ path: entry.path, source: entry.source })));
  const referenceCatalog = createReferenceCatalog(
    [...references.values()].map((entry) => ({ path: entry.path, reference: entry.reference })),
    sourceCatalog,
  );
  const addPreviewGraph = (graph: ReturnType<typeof buildPreviewDependencyGraph>): void => {
    for (const node of graph.nodes) addNode(node.kind, node.key);
    for (const edge of graph.edges) {
      if (edge.reason === "formalArtifact") continue;
      addEdge({
        from: edge.from,
        to: edge.to,
        reason: edge.reason,
        path: edge.path,
      });
    }
    for (const diagnostic of graph.diagnostics) {
      const key = `${diagnostic.code}\0${diagnostic.path}\0${diagnostic.message}`;
      diagnostics.set(key, { code: diagnostic.code, path: diagnostic.path, message: diagnostic.message });
    }
  };

  if (references.size > 0) {
    addPreviewGraph(
      buildPreviewDependencyGraph({
        sourceCatalog,
        referenceCatalog,
        rootReferenceKeys: [...references.keys()],
      }),
    );
  }
  for (const prototype of prototypes.values()) {
    addPreviewGraph(buildPreviewDependencyGraph({ sourceCatalog, referenceCatalog, prototype: prototype.prototype }));
  }

  return {
    nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id, "en-US")),
    edges: [...edges.values()].sort(
      (left, right) =>
        left.from.localeCompare(right.from, "en-US") ||
        left.to.localeCompare(right.to, "en-US") ||
        left.reason.localeCompare(right.reason, "en-US") ||
        left.path.localeCompare(right.path, "en-US"),
    ),
    diagnostics: [...diagnostics.values()].sort(
      (left, right) => left.path.localeCompare(right.path, "en-US") || left.code.localeCompare(right.code, "en-US"),
    ),
  };
}

function reachable(
  graph: WorkspaceRelationGraph,
  rootId: string,
  direction: "incoming" | "outgoing",
  acceptsEdge: (edge: WorkspaceRelationEdge) => boolean,
): readonly WorkspaceRelationReach[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, WorkspaceRelationEdge[]>();
  for (const edge of graph.edges) {
    if (!acceptsEdge(edge)) continue;
    const owner = direction === "outgoing" ? edge.from : edge.to;
    const entries = adjacency.get(owner) ?? [];
    entries.push(edge);
    adjacency.set(owner, entries);
  }
  for (const entries of adjacency.values())
    entries.sort(
      (left, right) =>
        (direction === "outgoing" ? left.to : left.from).localeCompare(direction === "outgoing" ? right.to : right.from, "en-US") ||
        left.reason.localeCompare(right.reason, "en-US") ||
        left.path.localeCompare(right.path, "en-US"),
    );

  const distance = new Map([[rootId, 0]]);
  const paths = new Map<string, readonly WorkspaceRelationEdge[]>([[rootId, []]]);
  const queue = [rootId];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    for (const edge of adjacency.get(current) ?? []) {
      const next = direction === "outgoing" ? edge.to : edge.from;
      if (distance.has(next)) continue;
      distance.set(next, distance.get(current)! + 1);
      paths.set(next, [...(paths.get(current) ?? []), edge]);
      queue.push(next);
    }
  }

  return [...distance.entries()]
    .filter(([id]) => id !== rootId)
    .flatMap(([id, value]) => {
      const node = nodes.get(id);
      return node ? [{ node, distance: value, pathEdges: paths.get(id) ?? [] }] : [];
    })
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.node.kind.localeCompare(right.node.kind, "en-US") ||
        left.node.key.localeCompare(right.node.key, "en-US"),
    );
}

function relationContext(
  graph: WorkspaceRelationGraph,
  kind: WorkspaceRelationNodeKind,
  key: string,
  acceptsEdge: (edge: WorkspaceRelationEdge) => boolean,
): WorkspaceRelationContext | undefined {
  const id = workspaceRelationNodeId(kind, key);
  const root = graph.nodes.find((node) => node.id === id);
  return root
    ? {
        root,
        incoming: reachable(graph, id, "incoming", acceptsEdge),
        outgoing: reachable(graph, id, "outgoing", acceptsEdge),
      }
    : undefined;
}

export function workspaceRelationContext(
  graph: WorkspaceRelationGraph,
  kind: WorkspaceRelationNodeKind,
  key: string,
): WorkspaceRelationContext | undefined {
  return relationContext(graph, kind, key, () => true);
}

export function workspaceUsageRelationContext(
  graph: WorkspaceRelationGraph,
  kind: WorkspaceRelationNodeKind,
  key: string,
): WorkspaceRelationContext | undefined {
  return relationContext(graph, kind, key, (edge) => edge.reason !== "variant");
}

export function workspaceVariantRelationContext(graph: WorkspaceRelationGraph, artifactKey: string): WorkspaceRelationContext | undefined {
  return relationContext(graph, "artifact", artifactKey, (edge) => edge.reason === "variant");
}

export function workspaceRelationEdgesForReach(
  graph: WorkspaceRelationGraph,
  rootId: string,
  direction: "incoming" | "outgoing",
  reach: WorkspaceRelationReach,
): readonly WorkspaceRelationEdge[] {
  if (reach.distance !== 1) return reach.pathEdges.slice(0, 1);
  return graph.edges.filter((edge) =>
    direction === "outgoing" ? edge.from === rootId && edge.to === reach.node.id : edge.from === reach.node.id && edge.to === rootId,
  );
}
