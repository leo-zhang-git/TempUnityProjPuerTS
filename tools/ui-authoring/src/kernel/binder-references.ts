import { isPreviewCollectionOwner } from "../registry/component-registry.js";
import type { UiPrototype, UiReference } from "../schema/ui-prototype-schema.js";
import { resolveArtifactUseSite } from "./artifact-use-site.js";
import { resolveBinderBindings } from "./binder.js";
import { resolvePreviewCollectionTemplate } from "./preview-collection.js";
import { type PreviewReferenceOwnerScope, previewReferenceOwnerRootArtifactKey } from "./preview-reference.js";
import type { PrototypeCatalogInput, ReferenceCatalogInput } from "./prototype.js";
import type { SourceCatalog } from "./source-catalog.js";
import { findNode } from "./tree.js";

export interface BinderReferenceImpact {
  readonly documentKind: "reference" | "prototype";
  readonly documentKey: string;
  readonly path: string;
  readonly fieldPath: string;
}

export interface BinderReferenceRenameResult {
  readonly references: readonly ReferenceCatalogInput[];
  readonly prototypes: readonly PrototypeCatalogInput[];
  readonly impacts: readonly BinderReferenceImpact[];
}

interface MutableUse {
  readonly impact: BinderReferenceImpact;
  readonly rename: (nextFieldName: string) => void;
}

function ownerArtifactKey(
  sourceCatalog: SourceCatalog,
  reference: UiReference,
  owner: PreviewReferenceOwnerScope | undefined,
): string | undefined {
  const root = previewReferenceOwnerRootArtifactKey(reference, owner);
  if (!root) return undefined;
  try {
    return resolveArtifactUseSite(sourceCatalog, {
      rootArtifactKey: root.artifactKey,
      ...(root.instancePath.length > 0 ? { instancePath: [...root.instancePath] } : {}),
    }).source.artifactKey;
  } catch {
    return undefined;
  }
}

function collectionTemplateArtifactKey(
  sourceCatalog: SourceCatalog,
  reference: UiReference,
  collection: NonNullable<UiReference["collections"]>[number],
  templateKey: string,
): string | undefined {
  const ownerKey = ownerArtifactKey(sourceCatalog, reference, collection.owner);
  if (!ownerKey) return undefined;
  const binding = resolveBinderBindings(sourceCatalog, ownerKey).find((entry) => entry.fieldName === collection.targetBinding);
  if (!binding) return undefined;
  const targetEntry = sourceCatalog.entries.get(binding.targetOwnerArtifactKey);
  const targetNode = targetEntry ? findNode(targetEntry.resolvedSource, binding.target.nodeId) : undefined;
  if (!targetEntry || !targetNode) return undefined;
  const componentTypes =
    binding.componentType === "GameObject"
      ? Object.keys(targetNode.components ?? {}).filter(isPreviewCollectionOwner)
      : isPreviewCollectionOwner(binding.componentType)
        ? [binding.componentType]
        : [];
  if (componentTypes.length !== 1) return undefined;
  const template = resolvePreviewCollectionTemplate(targetEntry.resolvedSource, targetNode, componentTypes[0]!, templateKey);
  return template?.kind === "artifact" ? template.artifactKey : undefined;
}

function renameValueField(values: Record<string, unknown>, fieldName: string, nextFieldName: string): void {
  if (Object.hasOwn(values, nextFieldName)) throw new Error(`Preview Values already contain Binder field '${nextFieldName}'`);
  values[nextFieldName] = values[fieldName];
  delete values[fieldName];
}

function visitValues(
  uses: MutableUse[],
  impact: Omit<BinderReferenceImpact, "fieldPath">,
  values: Record<string, unknown> | undefined,
  ownerKey: string | undefined,
  artifactKey: string,
  fieldName: string,
  path: string,
): void {
  if (ownerKey !== artifactKey || !values || !Object.hasOwn(values, fieldName)) return;
  uses.push({
    impact: { ...impact, fieldPath: `${path}/${fieldName}` },
    rename: (nextFieldName) => renameValueField(values, fieldName, nextFieldName),
  });
}

function visitTargetBinding(
  uses: MutableUse[],
  impact: Omit<BinderReferenceImpact, "fieldPath">,
  value: { targetBinding: string },
  ownerKey: string | undefined,
  artifactKey: string,
  fieldName: string,
  path: string,
): void {
  if (ownerKey !== artifactKey || value.targetBinding !== fieldName) return;
  uses.push({
    impact: { ...impact, fieldPath: path },
    rename: (nextFieldName) => {
      value.targetBinding = nextFieldName;
    },
  });
}

function referenceUses(
  sourceCatalog: SourceCatalog,
  entry: { path: string; reference: UiReference },
  artifactKey: string,
  fieldName: string,
): MutableUse[] {
  const uses: MutableUse[] = [];
  const reference = entry.reference;
  const impact = { documentKind: "reference" as const, documentKey: reference.referenceKey, path: entry.path };
  visitValues(uses, impact, reference.values, reference.subjectArtifactKey, artifactKey, fieldName, "/values");
  for (const [index, instance] of (reference.instanceValues ?? []).entries()) {
    visitValues(
      uses,
      impact,
      instance.values,
      ownerArtifactKey(sourceCatalog, reference, instance.owner),
      artifactKey,
      fieldName,
      `/instanceValues/${index}/values`,
    );
  }
  if (reference.context) {
    visitValues(uses, impact, reference.context.values, reference.context.parentArtifactKey, artifactKey, fieldName, "/context/values");
    if ("targetBinding" in reference.context.placement) {
      visitTargetBinding(
        uses,
        impact,
        reference.context.placement,
        reference.context.parentArtifactKey,
        artifactKey,
        fieldName,
        "/context/placement/targetBinding",
      );
    }
  }
  for (const [collectionIndex, collection] of (reference.collections ?? []).entries()) {
    const collectionOwnerKey = ownerArtifactKey(sourceCatalog, reference, collection.owner);
    visitTargetBinding(
      uses,
      impact,
      collection,
      collectionOwnerKey,
      artifactKey,
      fieldName,
      `/collections/${collectionIndex}/targetBinding`,
    );
    for (const [groupIndex, group] of collection.groups.entries()) {
      const templateArtifactKey = collectionTemplateArtifactKey(sourceCatalog, reference, collection, group.templateKey);
      visitValues(
        uses,
        impact,
        group.values,
        templateArtifactKey,
        artifactKey,
        fieldName,
        `/collections/${collectionIndex}/groups/${groupIndex}/values`,
      );
      if ("items" in group) {
        for (const [itemIndex, item] of group.items.entries()) {
          visitValues(
            uses,
            impact,
            item.values,
            templateArtifactKey,
            artifactKey,
            fieldName,
            `/collections/${collectionIndex}/groups/${groupIndex}/items/${itemIndex}/values`,
          );
        }
      }
    }
  }
  for (const [mountIndex, mount] of (reference.mounts ?? []).entries()) {
    visitTargetBinding(
      uses,
      impact,
      mount,
      ownerArtifactKey(sourceCatalog, reference, mount.owner),
      artifactKey,
      fieldName,
      `/mounts/${mountIndex}/targetBinding`,
    );
    visitValues(uses, impact, mount.values, mount.artifactKey, artifactKey, fieldName, `/mounts/${mountIndex}/values`);
  }
  return uses;
}

function prototypeUses(
  sourceCatalog: SourceCatalog,
  references: ReadonlyMap<string, UiReference>,
  entry: { path: string; prototype: UiPrototype },
  artifactKey: string,
  fieldName: string,
): MutableUse[] {
  const uses: MutableUse[] = [];
  const impact = { documentKind: "prototype" as const, documentKey: entry.prototype.prototypeKey, path: entry.path };
  for (const [interactionIndex, interaction] of entry.prototype.interactions.entries()) {
    const reference = references.get(interaction.referenceKey);
    if (!reference) continue;
    for (const [actionIndex, action] of interaction.actions.entries()) {
      if (action.kind !== "SetValue" || action.fieldName !== fieldName) continue;
      if (ownerArtifactKey(sourceCatalog, reference, action.owner) !== artifactKey) continue;
      uses.push({
        impact: { ...impact, fieldPath: `/interactions/${interactionIndex}/actions/${actionIndex}/fieldName` },
        rename: (nextFieldName) => {
          action.fieldName = nextFieldName;
        },
      });
    }
  }
  return uses;
}

function collectMutableUses(
  sourceCatalog: SourceCatalog,
  references: readonly { path: string; reference: UiReference }[],
  prototypes: readonly { path: string; prototype: UiPrototype }[],
  artifactKey: string,
  fieldName: string,
): MutableUse[] {
  const referencesByKey = new Map(references.map((entry) => [entry.reference.referenceKey, entry.reference]));
  return [
    ...references.flatMap((entry) => referenceUses(sourceCatalog, entry, artifactKey, fieldName)),
    ...prototypes.flatMap((entry) => prototypeUses(sourceCatalog, referencesByKey, entry, artifactKey, fieldName)),
  ];
}

export function findBinderReferenceImpacts(
  sourceCatalog: SourceCatalog,
  references: readonly ReferenceCatalogInput[],
  prototypes: readonly PrototypeCatalogInput[],
  artifactKey: string,
  fieldName: string,
): BinderReferenceImpact[] {
  return collectMutableUses(sourceCatalog, references, prototypes, artifactKey, fieldName)
    .map((use) => use.impact)
    .sort((left, right) => `${left.path}${left.fieldPath}`.localeCompare(`${right.path}${right.fieldPath}`));
}

export function renameBinderReferenceUses(
  sourceCatalog: SourceCatalog,
  references: readonly ReferenceCatalogInput[],
  prototypes: readonly PrototypeCatalogInput[],
  artifactKey: string,
  fieldName: string,
  nextFieldName: string,
): BinderReferenceRenameResult {
  const nextReferences = references.map((entry) => ({ path: entry.path, reference: structuredClone(entry.reference) }));
  const nextPrototypes = prototypes.map((entry) => ({ path: entry.path, prototype: structuredClone(entry.prototype) }));
  const uses = collectMutableUses(sourceCatalog, nextReferences, nextPrototypes, artifactKey, fieldName);
  for (const use of uses) use.rename(nextFieldName);
  return {
    references: nextReferences,
    prototypes: nextPrototypes,
    impacts: uses
      .map((use) => use.impact)
      .sort((left, right) => `${left.path}${left.fieldPath}`.localeCompare(`${right.path}${right.fieldPath}`)),
  };
}
