import { createSemanticDiff, type SemanticChange } from "../../kernel/semantic.js";
import type { UiConcreteSource } from "../../schema/ui-source-schema.js";
import type { WorkspaceArtifactMap } from "../editors/artifact/artifact-workspace-state.js";
import { gameObjectDiagnosticLabelById, gameObjectNameById } from "../shared/game-object-label.js";
import type { PrototypeDocument, ReferenceDocument } from "../shared/types.js";
import { workspaceDocumentId } from "../workspace/workspace-editing-context.js";

type WorkspaceDocumentChangeKind = "added" | "modified" | "deleted";

interface WorkspaceChangeLine {
  readonly kind: string;
  readonly label: string;
  readonly nodeId?: string | undefined;
  readonly before?: unknown;
  readonly after?: unknown;
}

export interface WorkspaceDocumentChange {
  readonly id: string;
  readonly kind: "artifact" | "reference" | "prototype";
  readonly key: string;
  readonly path: string;
  readonly changeKind: WorkspaceDocumentChangeKind;
  readonly changes: readonly WorkspaceChangeLine[];
}

export function createWorkspaceChanges(
  savedArtifacts: WorkspaceArtifactMap,
  artifacts: WorkspaceArtifactMap,
  savedReferences: ReadonlyMap<string, ReferenceDocument>,
  references: ReadonlyMap<string, ReferenceDocument>,
  savedPrototypes: ReadonlyMap<string, PrototypeDocument>,
  prototypes: ReadonlyMap<string, PrototypeDocument>,
): readonly WorkspaceDocumentChange[] {
  return [
    ...artifactChanges(savedArtifacts, artifacts),
    ...documentChanges("reference", savedReferences, references, (document) => document.reference),
    ...documentChanges("prototype", savedPrototypes, prototypes, (document) => document.prototype),
  ].sort((left, right) => left.path.localeCompare(right.path) || left.key.localeCompare(right.key));
}

function artifactChanges(saved: WorkspaceArtifactMap, current: WorkspaceArtifactMap): WorkspaceDocumentChange[] {
  const result: WorkspaceDocumentChange[] = [];
  for (const artifactKey of new Set([...saved.keys(), ...current.keys()])) {
    const previous = saved.get(artifactKey);
    const next = current.get(artifactKey);
    if (!previous && next) {
      result.push(documentChange("artifact", artifactKey, next.path, "added", [{ kind: "documentAdded", label: "新增 Artifact" }]));
      continue;
    }
    if (previous && !next) {
      result.push(documentChange("artifact", artifactKey, previous.path, "deleted", [{ kind: "documentDeleted", label: "删除 Artifact" }]));
      continue;
    }
    if (!previous || !next) continue;
    let changes: WorkspaceChangeLine[];
    if (previous.source.sourceKind === "artifact" && next.source.sourceKind === "artifact") {
      const previousSource = previous.source;
      const nextSource = next.source;
      changes = createSemanticDiff(previousSource, nextSource).changes.map((change) =>
        semanticChangeLine(change, previousSource, nextSource),
      );
    } else {
      changes = valueChanges(previous.source, next.source);
    }
    if (previous.path !== next.path)
      changes.unshift({ kind: "pathUpdated", label: "Source 路径", before: previous.path, after: next.path });
    if (changes.length > 0) result.push(documentChange("artifact", artifactKey, next.path, "modified", changes));
  }
  return result;
}

function documentChanges<T extends { readonly path: string }, S>(
  kind: "reference" | "prototype",
  saved: ReadonlyMap<string, T>,
  current: ReadonlyMap<string, T>,
  source: (document: T) => S,
): WorkspaceDocumentChange[] {
  const result: WorkspaceDocumentChange[] = [];
  for (const key of new Set([...saved.keys(), ...current.keys()])) {
    const previous = saved.get(key);
    const next = current.get(key);
    if (!previous && next) {
      result.push(
        documentChange(kind, key, next.path, "added", [
          { kind: "documentAdded", label: `新增 ${kind === "reference" ? "Reference" : "Prototype"}` },
        ]),
      );
      continue;
    }
    if (previous && !next) {
      result.push(
        documentChange(kind, key, previous.path, "deleted", [
          { kind: "documentDeleted", label: `删除 ${kind === "reference" ? "Reference" : "Prototype"}` },
        ]),
      );
      continue;
    }
    if (!previous || !next) continue;
    const changes = valueChanges(source(previous), source(next));
    if (previous.path !== next.path)
      changes.unshift({ kind: "pathUpdated", label: "Source 路径", before: previous.path, after: next.path });
    if (changes.length > 0) result.push(documentChange(kind, key, next.path, "modified", changes));
  }
  return result;
}

function documentChange(
  kind: WorkspaceDocumentChange["kind"],
  key: string,
  path: string,
  changeKind: WorkspaceDocumentChangeKind,
  changes: WorkspaceChangeLine[],
): WorkspaceDocumentChange {
  return { id: workspaceDocumentId(kind, key), kind, key, path, changeKind, changes };
}

function semanticChangeLine(change: SemanticChange, previous: UiConcreteSource, next: UiConcreteSource): WorkspaceChangeLine {
  if (change.kind === "nodeAdded")
    return { kind: change.kind, nodeId: change.nodeId, label: `新增节点 ${gameObjectDiagnosticLabelById(next, change.nodeId)}` };
  if (change.kind === "nodeRemoved")
    return { kind: change.kind, nodeId: change.nodeId, label: `删除节点 ${gameObjectDiagnosticLabelById(previous, change.nodeId)}` };
  if (change.kind === "nodeMoved")
    return {
      kind: change.kind,
      nodeId: change.nodeId,
      label: `移动节点 ${gameObjectDiagnosticLabelById(next, change.nodeId)}`,
      before: change.beforeParentId ? gameObjectDiagnosticLabelById(previous, change.beforeParentId) : "Artifact 根节点",
      after: change.afterParentId ? gameObjectDiagnosticLabelById(next, change.afterParentId) : "Artifact 根节点",
    };
  if (change.kind === "nodeRenamed")
    return { kind: change.kind, nodeId: change.afterNodeId, label: "重构 Node ID", before: change.beforeNodeId, after: change.afterNodeId };
  if (change.kind === "componentAdded")
    return {
      kind: change.kind,
      nodeId: change.nodeId,
      label: `${gameObjectDiagnosticLabelById(next, change.nodeId)} 添加 ${change.componentType}`,
    };
  if (change.kind === "componentRemoved")
    return {
      kind: change.kind,
      nodeId: change.nodeId,
      label: `${gameObjectDiagnosticLabelById(previous, change.nodeId)} 删除 ${change.componentType}`,
    };
  if (change.kind === "fieldUpdated") {
    const nameChanged = change.field === "name";
    return {
      kind: change.kind,
      nodeId: change.nodeId,
      label: `${gameObjectDiagnosticLabelById(next, change.nodeId)} · ${nameChanged ? "GameObject 名称" : change.field}`,
      before: nameChanged ? gameObjectNameById(previous, change.nodeId) : change.before,
      after: nameChanged ? gameObjectNameById(next, change.nodeId) : change.after,
    };
  }
  if (change.kind === "sourceFieldUpdated") return { kind: change.kind, label: change.field, before: change.before, after: change.after };
  throw new Error("不支持的语义改动");
}

function valueChanges(before: unknown, after: unknown, path = ""): WorkspaceChangeLine[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (isRecord(before) && isRecord(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .sort()
      .flatMap((key) => valueChanges(before[key], after[key], path ? `${path}.${key}` : key));
  }
  return [{ kind: "fieldUpdated", label: path || "文档", before, after }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
