import type { UiPrototype, UiReference } from "../schema/ui-prototype-schema.js";
import type { UiConcreteSource, UiNode, UiRect } from "../schema/ui-source-schema.js";
import { duplicateNodeSubtree } from "./node-clipboard.js";
import { assertValidPrototype, assertValidReference, type ReferenceCatalog } from "./prototype.js";
import { createSemanticDiff, insertNode, moveNode, removeNode, type SemanticDiff } from "./semantic.js";
import type { SourceCatalog } from "./source-catalog.js";
import { assertValidSource } from "./validation.js";

export interface ArtifactAuthoringIdentity {
  readonly artifactKey: string;
  readonly artifactType: UiConcreteSource["artifactType"];
  readonly initialSize: readonly [number, number];
}

export interface ReferenceAuthoringIdentity {
  readonly referenceKey: string;
  readonly subjectArtifactKey: string;
}

export type AuthoringStructureOperation =
  | { readonly kind: "insert"; readonly parentId: string; readonly node: UiNode; readonly index?: number }
  | { readonly kind: "duplicate"; readonly nodeId: string }
  | { readonly kind: "remove"; readonly nodeId: string }
  | { readonly kind: "move"; readonly nodeId: string; readonly parentId: string; readonly index?: number };

export interface AuthoringStructureResult {
  readonly source: UiConcreteSource;
  readonly diff: SemanticDiff;
  readonly selectedNodeId: string;
}

export function createArtifactSource(identity: ArtifactAuthoringIdentity): UiConcreteSource {
  const rootRect: UiRect =
    identity.artifactType === "Canvas"
      ? {
          anchorMin: [0, 0],
          anchorMax: [0, 0],
          pivot: [0, 0],
          anchoredPosition: [0, 0],
          sizeDelta: [0, 0],
        }
      : {
          anchorMin: [0, 1],
          anchorMax: [0, 1],
          pivot: [0, 1],
          anchoredPosition: [0, 0],
          sizeDelta: [...identity.initialSize],
        };
  const source: UiConcreteSource =
    identity.artifactType === "Canvas"
      ? {
          sourceKind: "artifact",
          artifactKey: identity.artifactKey,
          artifactType: "Canvas",
          root: { id: identity.artifactKey, rect: rootRect },
        }
      : {
          sourceKind: "artifact",
          artifactKey: identity.artifactKey,
          artifactType: identity.artifactType,
          ...(identity.artifactType === "Widget" ? { widgetType: identity.artifactKey } : {}),
          initialSize: [...identity.initialSize],
          root: { id: identity.artifactKey, rect: rootRect },
        };
  assertValidSource(source);
  return source;
}

export function createEmptyNode(id: string, size: readonly [number, number] = [100, 100]): UiNode {
  return {
    id,
    rect: {
      anchorMin: [0.5, 0.5],
      anchorMax: [0.5, 0.5],
      pivot: [0.5, 0.5],
      anchoredPosition: [0, 0],
      sizeDelta: [...size],
    },
  };
}

export function createPrefabRefNode(id: string, artifactKey: string, size: readonly [number, number] = [100, 100]): UiNode {
  return { ...createEmptyNode(id, size), components: { PrefabRef: { artifactKey } } };
}

export function createImageNode(id: string, size: readonly [number, number] = [100, 100]): UiNode {
  return { ...createEmptyNode(id, size), components: { Image: {} } };
}

export function createTextNode(id: string, size: readonly [number, number] = [200, 40]): UiNode {
  return { ...createEmptyNode(id, size), components: { Text: { text: "Text", fontSize: 24 } } };
}

export function applyAuthoringStructureOperation(
  source: UiConcreteSource,
  operation: AuthoringStructureOperation,
): AuthoringStructureResult {
  let next: UiConcreteSource;
  let selectedNodeId: string;
  if (operation.kind === "insert") {
    next = insertNode(source, operation.parentId, operation.node, operation.index);
    selectedNodeId = operation.node.id;
  } else if (operation.kind === "duplicate") {
    const result = duplicateNodeSubtree(source, operation.nodeId);
    next = result.source;
    selectedNodeId = result.rootId;
  } else if (operation.kind === "remove") {
    const entry = source.root.id === operation.nodeId ? undefined : findParentId(source.root, operation.nodeId);
    next = removeNode(source, operation.nodeId);
    selectedNodeId = entry ?? next.root.id;
  } else {
    next = moveNode(source, operation.nodeId, operation.parentId, operation.index);
    selectedNodeId = operation.nodeId;
  }
  return { source: next, diff: createSemanticDiff(source, next), selectedNodeId };
}

function findParentId(root: UiNode, nodeId: string): string | undefined {
  for (const child of root.children ?? []) {
    if (child.id === nodeId) return root.id;
    const nested = findParentId(child, nodeId);
    if (nested) return nested;
  }
  return undefined;
}

export function createReference(identity: ReferenceAuthoringIdentity, catalog: SourceCatalog): UiReference {
  const reference: UiReference = {
    referenceKey: identity.referenceKey,
    subjectArtifactKey: identity.subjectArtifactKey,
  };
  assertValidReference(reference, catalog);
  return reference;
}

export function createPrototype(
  prototypeKey: string,
  startReferenceKey: string,
  references: ReferenceCatalog,
  sources: SourceCatalog,
): UiPrototype {
  const prototype: UiPrototype = {
    prototypeKey,
    startReferenceKey,
    interactions: [],
  };
  assertValidPrototype(prototype, references, sources);
  return prototype;
}
