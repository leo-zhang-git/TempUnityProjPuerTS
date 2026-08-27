import type { UiWorkspaceDocumentOperation as WorkspaceDocumentOperation } from "../schema/ui-api.js";
import type { UiPrototype, UiReference } from "../schema/ui-prototype-schema.js";
import type { UiConcreteSource, UiSource } from "../schema/ui-source-schema.js";
import { createReference } from "./authoring.js";
import { remapLocalNodeReferenceTargets } from "./node-references.js";
import { defaultReferencePathForArtifact } from "./preview-reference.js";
import {
  assertValidPrototype,
  assertValidReference,
  createPrototypeCatalog,
  createReferenceCatalog,
  type PrototypeCatalogInput,
  type ReferenceCatalogInput,
} from "./prototype.js";
import { createSourceCatalog, type SourceCatalogInput } from "./source-catalog.js";
import { createArtifactVariant } from "./variant.js";

type WorkspaceDocumentKind = "artifact" | "reference" | "prototype";

export interface WorkspaceDocuments {
  readonly artifacts: readonly SourceCatalogInput[];
  readonly references: readonly ReferenceCatalogInput[];
  readonly prototypes: readonly PrototypeCatalogInput[];
}

export interface WorkspaceDocumentOperationResult extends WorkspaceDocuments {
  readonly location?: { readonly kind: WorkspaceDocumentKind; readonly key: string };
}

export function applyWorkspaceDocumentOperation(
  documents: WorkspaceDocuments,
  operation: WorkspaceDocumentOperation,
): WorkspaceDocumentOperationResult {
  if (operation.action === "create-directory" || operation.action === "move-directory" || operation.action === "delete-directory")
    throw new Error(`Directory operation '${operation.action}' is owned by the workspace service`);
  const artifacts = documents.artifacts.map(cloneSourceInput);
  const references = documents.references.map(cloneReferenceInput);
  const prototypes = documents.prototypes.map(clonePrototypeInput);

  if (operation.action === "move-document") {
    if (operation.kind === "artifact")
      moveArtifact(artifacts, references, prototypes, operation.key, operation.nextKey, operation.nextPath);
    if (operation.kind === "reference") moveReference(references, prototypes, operation.key, operation.nextKey, operation.nextPath);
    if (operation.kind === "prototype") movePrototype(prototypes, operation.key, operation.nextKey, operation.nextPath);
    return validated({ artifacts, references, prototypes, location: { kind: operation.kind, key: operation.nextKey } });
  }

  if (operation.action === "duplicate-document") {
    if (operation.kind === "artifact") duplicateArtifact(artifacts, references, operation.key, operation.nextKey, operation.nextPath);
    if (operation.kind === "reference") duplicateReference(references, operation.key, operation.nextKey, operation.nextPath);
    if (operation.kind === "prototype") duplicatePrototype(prototypes, operation.key, operation.nextKey, operation.nextPath);
    return validated({ artifacts, references, prototypes, location: { kind: operation.kind, key: operation.nextKey } });
  }

  if (operation.action === "create-variant") {
    const base = requireArtifact(artifacts, operation.artifactKey).source;
    artifacts.push({ path: operation.nextPath, source: createArtifactVariant(base, { artifactKey: operation.nextKey }) });
    return validated({ artifacts, references, prototypes, location: { kind: "artifact", key: operation.nextKey } });
  }

  if (operation.action === "create-reference") {
    requireArtifact(artifacts, operation.artifactKey);
    const catalog = createSourceCatalog(artifacts);
    references.push({
      path: operation.nextPath,
      reference: createReference({ referenceKey: operation.nextKey, subjectArtifactKey: operation.artifactKey }, catalog),
    });
    return validated({ artifacts, references, prototypes, location: { kind: "reference", key: operation.nextKey } });
  }

  if (operation.kind === "artifact") {
    const entry = requireArtifact(artifacts, operation.key);
    const paired = pairedDefaultReference(references, entry);
    if (paired) assertReferenceUnused(references, prototypes, paired.reference.referenceKey);
    removeByKey(artifacts, operation.key, (candidate) => candidate.source.artifactKey, "Artifact");
    if (paired) removeByKey(references, paired.reference.referenceKey, (candidate) => candidate.reference.referenceKey, "Reference");
  }
  if (operation.kind === "reference") {
    assertReferenceUnused(references, prototypes, operation.key);
    removeByKey(references, operation.key, (entry) => entry.reference.referenceKey, "Reference");
  }
  if (operation.kind === "prototype") removeByKey(prototypes, operation.key, (entry) => entry.prototype.prototypeKey, "Prototype");
  return validated({ artifacts, references, prototypes });
}

function moveArtifact(
  artifacts: MutableSourceInput[],
  references: MutableReferenceInput[],
  prototypes: MutablePrototypeInput[],
  key: string,
  nextKey: string,
  nextPath: string,
): void {
  const entry = requireArtifact(artifacts, key);
  const paired = pairedDefaultReference(references, entry);
  entry.path = nextPath;
  if (paired) paired.path = defaultReferencePathForArtifact(nextPath);
  if (key === nextKey) return;
  for (const candidate of artifacts) candidate.source = replaceArtifactDependency(candidate.source, key, nextKey);
  entry.source = renameArtifactIdentity(entry.source, key, nextKey);
  for (const candidate of references)
    candidate.reference = replaceNamedProperty(candidate.reference, ARTIFACT_REFERENCE_FIELDS, key, nextKey);
  if (paired) {
    paired.reference = { ...paired.reference, referenceKey: nextKey, subjectArtifactKey: nextKey };
    for (const candidate of references) candidate.reference = replaceNamedProperty(candidate.reference, REFERENCE_FIELDS, key, nextKey);
    for (const candidate of prototypes) candidate.prototype = replaceNamedProperty(candidate.prototype, REFERENCE_FIELDS, key, nextKey);
  }
  for (const candidate of prototypes)
    candidate.prototype = replaceNamedProperty(candidate.prototype, ARTIFACT_REFERENCE_FIELDS, key, nextKey);
}

function moveReference(
  references: MutableReferenceInput[],
  prototypes: MutablePrototypeInput[],
  key: string,
  nextKey: string,
  nextPath: string,
): void {
  const entry = requireReference(references, key);
  entry.path = nextPath;
  if (key === nextKey) return;
  entry.reference = { ...entry.reference, referenceKey: nextKey };
  for (const candidate of references) candidate.reference = replaceNamedProperty(candidate.reference, REFERENCE_FIELDS, key, nextKey);
  for (const candidate of prototypes) candidate.prototype = replaceNamedProperty(candidate.prototype, REFERENCE_FIELDS, key, nextKey);
}

function movePrototype(prototypes: MutablePrototypeInput[], key: string, nextKey: string, nextPath: string): void {
  const entry = requirePrototype(prototypes, key);
  entry.path = nextPath;
  if (key !== nextKey) entry.prototype = { ...entry.prototype, prototypeKey: nextKey };
}

function duplicateArtifact(
  artifacts: MutableSourceInput[],
  references: MutableReferenceInput[],
  key: string,
  nextKey: string,
  nextPath: string,
): void {
  const original = requireArtifact(artifacts, key);
  const source = renameArtifactIdentity(original.source, key, nextKey);
  artifacts.push({ path: nextPath, source });
  const paired = pairedDefaultReference(references, original);
  if (paired) {
    const reference = replaceNamedProperty(structuredClone(paired.reference), ARTIFACT_REFERENCE_FIELDS, key, nextKey);
    references.push({
      path: defaultReferencePathForArtifact(nextPath),
      reference: { ...reference, referenceKey: nextKey, subjectArtifactKey: nextKey },
    });
  }
}

function duplicateReference(references: MutableReferenceInput[], key: string, nextKey: string, nextPath: string): void {
  const source = requireReference(references, key).reference;
  references.push({ path: nextPath, reference: { ...structuredClone(source), referenceKey: nextKey } });
}

function duplicatePrototype(prototypes: MutablePrototypeInput[], key: string, nextKey: string, nextPath: string): void {
  const source = requirePrototype(prototypes, key).prototype;
  prototypes.push({ path: nextPath, prototype: { ...structuredClone(source), prototypeKey: nextKey } });
}

function renameArtifactIdentity(source: UiSource, key: string, nextKey: string): UiSource {
  let result = structuredClone(source);
  if (result.sourceKind === "artifact" && result.root.id === key) {
    result = renameConcreteArtifactIdentity(result, nextKey);
  }
  if (result.sourceKind === "variant") result = replaceNamedProperty(result, VARIANT_ROOT_FIELDS, key, nextKey);
  return {
    ...result,
    artifactKey: nextKey,
  };
}

function renameConcreteArtifactIdentity(source: UiConcreteSource, nextArtifactKey: string): UiConcreteSource {
  // `moveArtifact` first rewrites dependency fields across the catalog, which also
  // touches the concrete source's top-level artifactKey. The root id remains the
  // authoritative pre-rename identity for remapping the widget type and local
  // node references.
  const previousArtifactKey = source.root.id;
  const result = structuredClone(source);
  result.artifactKey = nextArtifactKey;
  if (result.artifactType === "Widget" && result.widgetType === previousArtifactKey) result.widgetType = nextArtifactKey;
  if (result.root.name === previousArtifactKey) result.root.name = nextArtifactKey;
  result.root = remapLocalNodeReferenceTargets(result.root, (nodeId) => (nodeId === previousArtifactKey ? nextArtifactKey : nodeId));
  result.root.id = nextArtifactKey;
  for (const { target } of result.bindings ?? []) {
    if ((target.instancePath?.length ?? 0) > 0) {
      target.instancePath = target.instancePath!.map((nodeId) => (nodeId === previousArtifactKey ? nextArtifactKey : nodeId));
    } else if (target.nodeId === previousArtifactKey) {
      target.nodeId = nextArtifactKey;
    }
  }
  return result;
}

function replaceArtifactDependency(source: UiSource, key: string, nextKey: string): UiSource {
  return replaceNamedProperty(source, ARTIFACT_REFERENCE_FIELDS, key, nextKey);
}

const ARTIFACT_REFERENCE_FIELDS = new Set(["artifactKey", "rootArtifactKey", "subjectArtifactKey", "parentArtifactKey", "variantOf"]);
const REFERENCE_FIELDS = new Set(["referenceKey", "startReferenceKey"]);
const VARIANT_ROOT_FIELDS = new Set(["nodeId", "parentId", "prefabRefNodeId", "instancePath"]);

function replaceNamedProperty<T>(value: T, fields: ReadonlySet<string>, previous: string, next: string, parentKey = ""): T {
  if (typeof value === "string") {
    const replace = fields.has(parentKey) && value === previous;
    return (replace ? next : value) as T;
  }
  if (Array.isArray(value)) return value.map((item) => replaceNamedProperty(item, fields, previous, next, parentKey)) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, replaceNamedProperty(item, fields, previous, next, key)]),
  ) as T;
}

function validated(result: WorkspaceDocumentOperationResult): WorkspaceDocumentOperationResult {
  for (const [kind, identities] of [
    ["Artifact", result.artifacts.map((entry) => entry.source.artifactKey)],
    ["Reference", result.references.map((entry) => entry.reference.referenceKey)],
    ["Prototype", result.prototypes.map((entry) => entry.prototype.prototypeKey)],
  ] as const) {
    if (new Set(identities).size !== identities.length) throw new Error(`${kind} keys must be unique`);
  }
  const paths = [...result.artifacts, ...result.references, ...result.prototypes].map((entry) => entry.path);
  if (new Set(paths).size !== paths.length)
    throw new Error("Document paths must be unique across Artifact, Reference, and Prototype documents");
  const sources = createSourceCatalog(result.artifacts);
  const references = createReferenceCatalog(result.references, sources);
  for (const entry of references.entries.values()) assertValidReference(entry.reference, sources, references);
  const prototypes = createPrototypeCatalog(result.prototypes);
  for (const entry of prototypes.entries.values()) assertValidPrototype(entry.prototype, references, sources);
  return result;
}

function requireArtifact(entries: MutableSourceInput[], key: string): MutableSourceInput {
  const entry = entries.find((candidate) => candidate.source.artifactKey === key);
  if (!entry) throw new Error(`Artifact '${key}' does not exist`);
  return entry;
}

function requireReference(entries: MutableReferenceInput[], key: string): MutableReferenceInput {
  const entry = entries.find((candidate) => candidate.reference.referenceKey === key);
  if (!entry) throw new Error(`Reference '${key}' does not exist`);
  return entry;
}

function requirePrototype(entries: MutablePrototypeInput[], key: string): MutablePrototypeInput {
  const entry = entries.find((candidate) => candidate.prototype.prototypeKey === key);
  if (!entry) throw new Error(`Prototype '${key}' does not exist`);
  return entry;
}

function normalizedPath(path: string): string {
  return path.replaceAll("\\", "/").toLocaleLowerCase("en-US");
}

function pairedDefaultReference(references: MutableReferenceInput[], artifact: MutableSourceInput): MutableReferenceInput | undefined {
  const path = normalizedPath(defaultReferencePathForArtifact(artifact.path));
  return references.find(
    (entry) =>
      normalizedPath(entry.path) === path &&
      entry.reference.referenceKey === artifact.source.artifactKey &&
      entry.reference.subjectArtifactKey === artifact.source.artifactKey,
  );
}

export interface ReferenceUseSite {
  readonly documentKind: "reference" | "prototype";
  readonly documentKey: string;
  readonly path: string;
  readonly fieldPath: string;
}

export function findReferenceUseSites(
  references: readonly ReferenceCatalogInput[],
  prototypes: readonly PrototypeCatalogInput[],
  referenceKey: string,
): ReferenceUseSite[] {
  const result: ReferenceUseSite[] = [];
  for (const entry of references) {
    if (entry.reference.referenceKey === referenceKey) continue;
    for (const [instanceIndex, instance] of (entry.reference.instanceValues ?? []).entries()) {
      if ("referenceKey" in instance && instance.referenceKey === referenceKey) {
        result.push(referenceUseSite(entry, `/instanceValues/${instanceIndex}/referenceKey`));
      }
    }
    for (const [collectionIndex, collection] of (entry.reference.collections ?? []).entries()) {
      for (const [groupIndex, group] of collection.groups.entries()) {
        if (group.referenceKey === referenceKey)
          result.push(referenceUseSite(entry, `/collections/${collectionIndex}/groups/${groupIndex}/referenceKey`));
        if ("items" in group) {
          for (const [itemIndex, item] of group.items.entries()) {
            if (item.referenceKey === referenceKey)
              result.push(referenceUseSite(entry, `/collections/${collectionIndex}/groups/${groupIndex}/items/${itemIndex}/referenceKey`));
          }
        }
      }
    }
    for (const [mountIndex, mount] of (entry.reference.mounts ?? []).entries()) {
      if (mount.referenceKey === referenceKey) result.push(referenceUseSite(entry, `/mounts/${mountIndex}/referenceKey`));
    }
  }
  for (const entry of prototypes) {
    if (entry.prototype.startReferenceKey === referenceKey) result.push(prototypeUseSite(entry, "/startReferenceKey"));
    for (const [interactionIndex, interaction] of entry.prototype.interactions.entries()) {
      if (interaction.referenceKey === referenceKey) result.push(prototypeUseSite(entry, `/interactions/${interactionIndex}/referenceKey`));
      for (const [actionIndex, action] of interaction.actions.entries()) {
        if (action.kind === "Navigate" && action.referenceKey === referenceKey) {
          result.push(prototypeUseSite(entry, `/interactions/${interactionIndex}/actions/${actionIndex}/referenceKey`));
        }
      }
    }
  }
  return result.sort((left, right) => `${left.path}${left.fieldPath}`.localeCompare(`${right.path}${right.fieldPath}`));
}

function referenceUseSite(entry: ReferenceCatalogInput, fieldPath: string): ReferenceUseSite {
  return { documentKind: "reference", documentKey: entry.reference.referenceKey, path: entry.path, fieldPath };
}

function prototypeUseSite(entry: PrototypeCatalogInput, fieldPath: string): ReferenceUseSite {
  return { documentKind: "prototype", documentKey: entry.prototype.prototypeKey, path: entry.path, fieldPath };
}

function assertReferenceUnused(
  references: readonly ReferenceCatalogInput[],
  prototypes: readonly PrototypeCatalogInput[],
  referenceKey: string,
): void {
  const uses = findReferenceUseSites(references, prototypes, referenceKey);
  if (uses.length === 0) return;
  throw new Error(`Reference '${referenceKey}' is still used by:\n${uses.map((use) => `- ${use.path}${use.fieldPath}`).join("\n")}`);
}

function removeByKey<T>(entries: T[], key: string, readKey: (entry: T) => string, label: string): void {
  const index = entries.findIndex((entry) => readKey(entry) === key);
  if (index < 0) throw new Error(`${label} '${key}' does not exist`);
  entries.splice(index, 1);
}

type MutableSourceInput = { path: string; source: UiSource };
type MutableReferenceInput = { path: string; reference: UiReference };
type MutablePrototypeInput = { path: string; prototype: UiPrototype };

function cloneSourceInput(entry: SourceCatalogInput): MutableSourceInput {
  return { path: entry.path, source: structuredClone(entry.source) };
}

function cloneReferenceInput(entry: ReferenceCatalogInput): MutableReferenceInput {
  return { path: entry.path, reference: structuredClone(entry.reference) };
}

function clonePrototypeInput(entry: PrototypeCatalogInput): MutablePrototypeInput {
  return { path: entry.path, prototype: structuredClone(entry.prototype) };
}
