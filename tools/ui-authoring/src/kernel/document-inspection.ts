import type { UiReference } from "../schema/ui-prototype-schema.js";
import type { UiComponentType, UiConcreteSource, UiNode } from "../schema/ui-source-schema.js";
import { collectBindings } from "./binding.js";
import type { SourceCatalog } from "./source-catalog.js";
import { walkNodes } from "./tree.js";

export type InspectionDetail = "rect" | "components" | "bindings" | "refs" | "state";

interface DocumentInspectionNode {
  readonly artifactKey: string;
  readonly instancePath: readonly string[];
  readonly nodeId: string;
  readonly name?: string;
  readonly parentNodeId: string | null;
  readonly depth: number;
  readonly active: boolean;
  readonly childCount: number;
  readonly componentTypes: readonly UiComponentType[];
  readonly rect?: UiNode["rect"];
  readonly components?: UiNode["components"];
  readonly bindings?: readonly string[];
  readonly artifactReference?: string;
  readonly states?: readonly string[];
  readonly currentState?: string;
}

export interface DocumentInspection {
  readonly kind: "Artifact" | "Reference";
  readonly key: string;
  readonly rootArtifactKey: string;
  readonly nodeCount: number;
  readonly nodes: readonly DocumentInspectionNode[];
}

export interface DocumentInspectionOptions {
  readonly nodeId?: string;
  readonly instancePath?: readonly string[];
  readonly depth?: number;
  readonly details?: ReadonlySet<InspectionDetail>;
}

export function inspectArtifactDocument(source: UiConcreteSource, options: DocumentInspectionOptions = {}): DocumentInspection {
  const nodes = inspectArtifactUseSite(source, [], options, 0);
  return {
    kind: "Artifact",
    key: source.artifactKey,
    rootArtifactKey: source.artifactKey,
    nodeCount: nodes.length,
    nodes,
  };
}

export function inspectReferenceDocument(
  reference: UiReference,
  catalog: SourceCatalog,
  options: DocumentInspectionOptions = {},
): DocumentInspection {
  const entries: { readonly node: DocumentInspectionNode; readonly ancestry: readonly string[] }[] = [];
  const visit = (
    artifactKey: string,
    instancePath: readonly string[],
    baseDepth: number,
    parentAncestry: readonly string[],
    active: readonly string[],
  ): void => {
    if (active.includes(artifactKey)) return;
    const entry = catalog.entries.get(artifactKey);
    if (!entry) throw new Error(`Artifact '${artifactKey}' is missing from Source Catalog`);
    const bindings = collectBindings(entry.resolvedSource);
    const visitNode = (node: UiNode, parent: UiNode | null, depth: number, ancestry: readonly string[]): void => {
      const nodeKey = `${artifactKey}\0${instancePath.join("/")}\0${node.id}`;
      const nodeAncestry = [...ancestry, nodeKey];
      entries.push({
        node: inspectionNode(entry.resolvedSource, node, parent, instancePath, depth, bindings, options.details),
        ancestry: nodeAncestry,
      });
      for (const child of node.children ?? []) visitNode(child, node, depth + 1, nodeAncestry);
      const target = node.components?.PrefabRef?.artifactKey;
      if (target) visit(target, [...instancePath, node.id], depth + 1, nodeAncestry, [...active, artifactKey]);
    };
    visitNode(entry.resolvedSource.root, null, baseDepth, parentAncestry);
  };
  visit(reference.subjectArtifactKey, [], 0, [], []);
  const requestedInstance = options.instancePath ?? [];
  const selected = options.nodeId
    ? entries.find(
        (entry) =>
          entry.node.nodeId === options.nodeId &&
          (options.instancePath === undefined || sameInstancePath(entry.node.instancePath, requestedInstance)),
      )
    : options.instancePath
      ? entries.find((entry) => entry.node.parentNodeId === null && sameInstancePath(entry.node.instancePath, requestedInstance))
      : entries[0];
  const maxDepth = options.depth ?? Number.MAX_SAFE_INTEGER;
  const nodes = selected
    ? entries
        .filter((entry) => selected.ancestry.every((part, index) => entry.ancestry[index] === part))
        .filter((entry) => entry.node.depth <= selected.node.depth + maxDepth)
        .map((entry) => entry.node)
    : [];
  return {
    kind: "Reference",
    key: reference.referenceKey,
    rootArtifactKey: reference.subjectArtifactKey,
    nodeCount: nodes.length,
    nodes,
  };
}

function sameInstancePath(left: readonly string[], right: readonly string[]): boolean {
  return left.join("\0") === right.join("\0");
}

function inspectArtifactUseSite(
  source: UiConcreteSource,
  instancePath: readonly string[],
  options: DocumentInspectionOptions,
  baseDepth: number,
): DocumentInspectionNode[] {
  const requestedInstance = options.instancePath ?? [];
  if (requestedInstance.join("\0") !== instancePath.join("\0") && (options.nodeId || requestedInstance.length > 0)) return [];
  const entries = walkNodes(source);
  const selected = options.nodeId ? entries.find((entry) => entry.node.id === options.nodeId) : entries[0];
  if (!selected) return [];
  const depth = options.depth ?? Number.MAX_SAFE_INTEGER;
  const selectedDepth = selected.path.length;
  const bindings = collectBindings(source);
  return entries
    .filter((entry) => selected.path.every((part, index) => entry.path[index] === part))
    .filter((entry) => entry.path.length <= selectedDepth + depth)
    .map(({ node, parent, path }) =>
      inspectionNode(source, node, parent, instancePath, baseDepth + path.length - 1, bindings, options.details),
    );
}

function inspectionNode(
  source: UiConcreteSource,
  node: UiNode,
  parent: UiNode | null,
  instancePath: readonly string[],
  depth: number,
  bindings: ReturnType<typeof collectBindings>,
  details: ReadonlySet<InspectionDetail> | undefined,
): DocumentInspectionNode {
  const stateRoot = node.components?.StateRoot;
  const componentTypes = Object.keys(node.components ?? {}) as UiComponentType[];
  const wants = (detail: InspectionDetail): boolean => details?.has(detail) === true;
  return {
    artifactKey: source.artifactKey,
    instancePath: [...instancePath],
    nodeId: node.id,
    ...(node.name ? { name: node.name } : {}),
    parentNodeId: parent?.id ?? null,
    depth,
    active: node.active !== false,
    childCount: node.children?.length ?? 0,
    componentTypes,
    ...(wants("rect") ? { rect: structuredClone(node.rect) } : {}),
    ...(wants("components") ? { components: structuredClone(node.components ?? {}) } : {}),
    ...(wants("bindings")
      ? { bindings: bindings.filter((binding) => binding.nodeId === node.id).map((binding) => binding.fieldName) }
      : {}),
    ...(wants("refs") && node.components?.PrefabRef ? { artifactReference: node.components.PrefabRef.artifactKey } : {}),
    ...(wants("state") && stateRoot ? { states: Object.keys(stateRoot.states), currentState: stateRoot.currentState } : {}),
  };
}

export function formatInspectionTree(inspection: DocumentInspection): string {
  const lines = [`${inspection.kind} ${inspection.key} (${inspection.nodeCount} nodes)`];
  for (const node of inspection.nodes) {
    const owner = node.instancePath.length > 0 ? ` @${node.instancePath.join("/")} -> ${node.artifactKey}` : ` @${node.artifactKey}`;
    const components = node.componentTypes.length > 0 ? ` [${node.componentTypes.join(", ")}]` : "";
    const inactive = node.active ? "" : " (inactive)";
    const bindings = node.bindings && node.bindings.length > 0 ? ` bindings=${node.bindings.join(",")}` : "";
    const reference = node.artifactReference ? ` ref=${node.artifactReference}` : "";
    const state = node.states ? ` state=${node.currentState}(${node.states.join("|")})` : "";
    lines.push(`${"  ".repeat(node.depth)}${node.nodeId}${components}${inactive}${owner}${bindings}${reference}${state}`);
  }
  return `${lines.join("\n")}\n`;
}
