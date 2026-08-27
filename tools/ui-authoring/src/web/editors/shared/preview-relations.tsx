import { ArrowDownToLine, ArrowUpFromLine, BookOpen, Box, GitFork, MousePointer2 } from "lucide-react";
import { useMemo } from "react";
import { buildPreviewDependencyGraph } from "../../../kernel/preview-dependency-graph.js";
import { createReferenceCatalog } from "../../../kernel/prototype.js";
import { createSourceCatalog } from "../../../kernel/source-catalog.js";
import type { ArtifactDocument, PrototypeDocument, ReferenceDocument } from "../../shared/types.js";
import { createWebClasses } from "../../styles/web-styles.js";
import styles from "./preview-relations.module.css";

const webClasses = createWebClasses(styles);

type RelationNodeKind = "artifact" | "reference" | "prototype";

interface PreviewRelation {
  readonly key: string;
  readonly kind: RelationNodeKind;
  readonly reason: string;
  readonly path: string;
}

function nodeId(kind: RelationNodeKind, key: string): string {
  return `${kind}:${key}`;
}

function RelationIcon({ kind }: { readonly kind: RelationNodeKind }) {
  if (kind === "artifact") return <Box size={12} />;
  if (kind === "reference") return <BookOpen size={12} />;
  return <MousePointer2 size={12} />;
}

function relationKindLabel(kind: RelationNodeKind): string {
  if (kind === "artifact") return "Artifact";
  if (kind === "reference") return "Reference";
  return "Prototype";
}

function relationReasonLabel(reason: string): string {
  return (
    (
      {
        prototypeReference: "Reference 流程",
        subject: "主体",
        context: "上下文",
        formalArtifact: "Artifact",
        collectionTemplate: "集合模板",
        collectionPreset: "集合预设",
        mountArtifact: "挂载 Artifact",
        mountPreset: "挂载预设",
      } as Record<string, string>
    )[reason] ?? reason
  );
}

function RelationSection({
  title,
  direction,
  relations,
  onOpen,
}: {
  readonly title: string;
  readonly direction: "outgoing" | "incoming";
  readonly relations: readonly PreviewRelation[];
  readonly onOpen: (relation: PreviewRelation) => void;
}) {
  const Icon = direction === "outgoing" ? ArrowUpFromLine : ArrowDownToLine;
  return (
    <section className={webClasses("relation-section")}>
      <h2>
        <Icon size={12} />
        {title}
        <span>{relations.length}</span>
      </h2>
      {relations.length === 0 ? (
        <p>无直接关系</p>
      ) : (
        <ul className={webClasses("relation-list")}>
          {relations.map((relation) => (
            <li key={`${relation.kind}:${relation.key}:${relation.path}:${relation.reason}`}>
              <button type="button" onClick={() => onOpen(relation)} title={`打开 ${relation.key}`}>
                <RelationIcon kind={relation.kind} />
                <strong>{relation.key}</strong>
                <small>
                  {relationKindLabel(relation.kind)} · {relationReasonLabel(relation.reason)}
                </small>
                <code>{relation.path}</code>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PreviewRelations({
  root,
  artifacts,
  references,
  prototypes,
  onOpenArtifact,
  onOpenReference,
  onOpenPrototype,
}: {
  readonly root: { readonly kind: "reference"; readonly key: string } | { readonly kind: "prototype"; readonly key: string };
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypes: ReadonlyMap<string, PrototypeDocument>;
  readonly onOpenArtifact: (artifactKey: string) => void;
  readonly onOpenReference: (referenceKey: string) => void;
  readonly onOpenPrototype: (prototypeKey: string) => void;
}) {
  const { outgoing, incoming, diagnostics } = useMemo(() => {
    const sourceCatalog = createSourceCatalog([...artifacts.values()].map((entry) => ({ path: entry.path, source: entry.source })));
    const referenceCatalog = createReferenceCatalog(
      [...references.values()].map((entry) => ({ path: entry.path, reference: entry.reference })),
      sourceCatalog,
    );
    const currentPrototype = root.kind === "prototype" ? prototypes.get(root.key)?.prototype : undefined;
    const graph = buildPreviewDependencyGraph({
      sourceCatalog,
      referenceCatalog,
      ...(root.kind === "reference" ? { rootReferenceKeys: [root.key] } : {}),
      ...(currentPrototype ? { prototype: currentPrototype } : {}),
    });
    const rootId = nodeId(root.kind, root.key);
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const outgoing = graph.edges
      .filter((edge) => edge.from === rootId)
      .flatMap((edge) => {
        const target = nodes.get(edge.to);
        return target ? [{ key: target.key, kind: target.kind, reason: edge.reason, path: edge.path }] : [];
      });

    const workspaceEdges = [
      ...buildPreviewDependencyGraph({
        sourceCatalog,
        referenceCatalog,
        rootReferenceKeys: [...references.keys()],
      }).edges,
      ...[...prototypes.values()].flatMap(
        (prototype) => buildPreviewDependencyGraph({ sourceCatalog, referenceCatalog, prototype: prototype.prototype }).edges,
      ),
    ];
    const workspaceNodes = new Map<string, { readonly id: string; readonly key: string; readonly kind: RelationNodeKind }>();
    for (const artifact of artifacts.values())
      workspaceNodes.set(nodeId("artifact", artifact.artifactKey), {
        id: nodeId("artifact", artifact.artifactKey),
        kind: "artifact",
        key: artifact.artifactKey,
      });
    for (const reference of references.values())
      workspaceNodes.set(nodeId("reference", reference.referenceKey), {
        id: nodeId("reference", reference.referenceKey),
        kind: "reference",
        key: reference.referenceKey,
      });
    for (const prototype of prototypes.values())
      workspaceNodes.set(nodeId("prototype", prototype.prototypeKey), {
        id: nodeId("prototype", prototype.prototypeKey),
        kind: "prototype",
        key: prototype.prototypeKey,
      });
    const seen = new Set<string>();
    const incoming = workspaceEdges
      .filter((edge) => edge.to === rootId)
      .flatMap((edge) => {
        const source = workspaceNodes.get(edge.from);
        if (!source) return [];
        const identity = `${source.id}:${edge.reason}:${edge.path}`;
        if (seen.has(identity)) return [];
        seen.add(identity);
        return [{ key: source.key, kind: source.kind, reason: edge.reason, path: edge.path }];
      });
    return { outgoing, incoming, diagnostics: graph.diagnostics };
  }, [artifacts, prototypes, references, root.key, root.kind]);

  const open = (relation: PreviewRelation): void => {
    if (relation.kind === "artifact") onOpenArtifact(relation.key);
    else if (relation.kind === "reference") onOpenReference(relation.key);
    else onOpenPrototype(relation.key);
  };
  return (
    <div className={webClasses("preview-relations")}>
      <header>
        <GitFork size={13} />
        <strong>关系</strong>
        <span>直接预览依赖图</span>
      </header>
      <RelationSection title="使用" direction="outgoing" relations={outgoing} onOpen={open} />
      <RelationSection title="被使用" direction="incoming" relations={incoming} onOpen={open} />
      {diagnostics.length > 0 ? (
        <ul className={webClasses("relation-diagnostics")}>
          {diagnostics.map((entry) => (
            <li key={`${entry.code}:${entry.path}`}>{entry.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
