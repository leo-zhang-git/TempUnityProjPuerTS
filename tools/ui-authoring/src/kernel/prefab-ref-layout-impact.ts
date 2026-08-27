import type { UiNode, UiPropertyOverride } from "../schema/ui-source-schema.js";
import type { SourceCatalog, SourceCatalogEntry } from "./source-catalog.js";
import { findNode, walkNodes } from "./tree.js";

const ANCHOR_FIELDS = ["anchorMin", "anchorMax"] as const;
const COORDINATE_FIELDS = ["anchoredPosition", "sizeDelta"] as const;

type AnchorField = (typeof ANCHOR_FIELDS)[number];
type CoordinateField = (typeof COORDINATE_FIELDS)[number];
type RelevantRectField = AnchorField | CoordinateField;

export interface PrefabRefLayoutImpact {
  readonly changedArtifactKey: string;
  readonly changedNodeId: string;
  readonly changedAnchorFields: readonly AnchorField[];
  readonly ownerArtifactKey: string;
  readonly ownerPath: string;
  readonly useSiteNodeId: string;
  readonly targetInstancePath: readonly string[];
  readonly coordinateOverrideFields: readonly CoordinateField[];
  readonly inheritedAnchorFields: readonly AnchorField[];
}

interface OverrideGroup {
  readonly instancePath: readonly string[];
  readonly nodeId: string;
  readonly fields: Set<RelevantRectField>;
}

export class PrefabRefLayoutImpactError extends Error {
  constructor(readonly impacts: readonly PrefabRefLayoutImpact[]) {
    super(formatPrefabRefLayoutImpacts(impacts));
    this.name = "PrefabRefLayoutImpactError";
  }
}

export function findPrefabRefLayoutImpacts(before: SourceCatalog, after: SourceCatalog): PrefabRefLayoutImpact[] {
  const changedAnchors = collectChangedAnchors(before, after);
  if (changedAnchors.size === 0) return [];

  const impacts: PrefabRefLayoutImpact[] = [];
  for (const owner of after.entries.values()) {
    for (const useSite of declaredPrefabRefNodes(owner)) {
      const prefabRef = useSite.components?.PrefabRef;
      if (!prefabRef) continue;
      for (const group of groupRectOverrides(prefabRef.overrides ?? [])) {
        const coordinateOverrideFields = COORDINATE_FIELDS.filter((field) => group.fields.has(field));
        if (coordinateOverrideFields.length === 0) continue;
        const target = resolveOverrideTargetArtifact(after, prefabRef.artifactKey, group.instancePath, owner, useSite.id);
        const changedAnchorFields = changedAnchors.get(layoutTargetKey(target.source.artifactKey, group.nodeId));
        if (!changedAnchorFields) continue;
        const inheritedAnchorFields = changedAnchorFields.filter((field) => !group.fields.has(field));
        if (inheritedAnchorFields.length === 0) continue;
        impacts.push({
          changedArtifactKey: target.source.artifactKey,
          changedNodeId: group.nodeId,
          changedAnchorFields,
          ownerArtifactKey: owner.source.artifactKey,
          ownerPath: owner.path,
          useSiteNodeId: useSite.id,
          targetInstancePath: [...group.instancePath],
          coordinateOverrideFields,
          inheritedAnchorFields,
        });
      }
    }
  }
  return impacts.sort(compareImpacts);
}

export function assertNoPrefabRefLayoutImpacts(before: SourceCatalog, after: SourceCatalog): void {
  const impacts = findPrefabRefLayoutImpacts(before, after);
  if (impacts.length > 0) throw new PrefabRefLayoutImpactError(impacts);
}

function collectChangedAnchors(before: SourceCatalog, after: SourceCatalog): Map<string, readonly AnchorField[]> {
  const changed = new Map<string, readonly AnchorField[]>();
  for (const [artifactKey, afterEntry] of after.entries) {
    const beforeEntry = before.entries.get(artifactKey);
    if (!beforeEntry) continue;
    const beforeNodes = new Map(walkNodes(beforeEntry.resolvedSource).map(({ node }) => [node.id, node]));
    for (const { node: afterNode } of walkNodes(afterEntry.resolvedSource)) {
      const beforeNode = beforeNodes.get(afterNode.id);
      if (!beforeNode) continue;
      const fields = ANCHOR_FIELDS.filter((field) => !vectorEquals(beforeNode.rect[field], afterNode.rect[field]));
      if (fields.length > 0) changed.set(layoutTargetKey(artifactKey, afterNode.id), fields);
    }
  }
  return changed;
}

function declaredPrefabRefNodes(entry: SourceCatalogEntry): UiNode[] {
  if (entry.source.sourceKind === "artifact") {
    return walkNodes(entry.source)
      .map(({ node }) => node)
      .filter(hasPrefabRef);
  }
  return (entry.source.nodeAdditions ?? []).flatMap(({ node }) => walkNodeTree(node).filter(hasPrefabRef));
}

function walkNodeTree(root: UiNode): UiNode[] {
  return [root, ...(root.children ?? []).flatMap(walkNodeTree)];
}

function hasPrefabRef(node: UiNode): boolean {
  return node.components?.PrefabRef !== undefined;
}

function groupRectOverrides(overrides: readonly UiPropertyOverride[]): OverrideGroup[] {
  const groups = new Map<string, OverrideGroup>();
  for (const override of overrides) {
    if (override.target.componentType !== "RectTransform" || !isRelevantRectField(override.target.fieldPath)) continue;
    const instancePath = override.target.instancePath ?? [];
    const key = `${instancePath.join("/")}\0${override.target.nodeId}`;
    let group = groups.get(key);
    if (!group) {
      group = { instancePath: [...instancePath], nodeId: override.target.nodeId, fields: new Set() };
      groups.set(key, group);
    }
    group.fields.add(override.target.fieldPath);
  }
  return [...groups.values()];
}

function resolveOverrideTargetArtifact(
  catalog: SourceCatalog,
  artifactKey: string,
  instancePath: readonly string[],
  owner: SourceCatalogEntry,
  useSiteNodeId: string,
): SourceCatalogEntry {
  let current = requireArtifact(catalog, artifactKey, owner, useSiteNodeId);
  for (const instanceId of instancePath) {
    const instance = findNode(current.resolvedSource, instanceId);
    const nextKey = instance?.components?.PrefabRef?.artifactKey;
    if (!nextKey) {
      throw new Error(
        `PrefabRef '${owner.source.artifactKey}/${useSiteNodeId}' target instance '${instanceId}' is not a PrefabRef in '${current.source.artifactKey}'`,
      );
    }
    current = requireArtifact(catalog, nextKey, owner, useSiteNodeId);
  }
  return current;
}

function requireArtifact(
  catalog: SourceCatalog,
  artifactKey: string,
  owner: SourceCatalogEntry,
  useSiteNodeId: string,
): SourceCatalogEntry {
  const entry = catalog.entries.get(artifactKey);
  if (!entry) throw new Error(`PrefabRef '${owner.source.artifactKey}/${useSiteNodeId}' targets missing Artifact '${artifactKey}'`);
  return entry;
}

function isRelevantRectField(fieldPath: string): fieldPath is RelevantRectField {
  return (ANCHOR_FIELDS as readonly string[]).includes(fieldPath) || (COORDINATE_FIELDS as readonly string[]).includes(fieldPath);
}

function vectorEquals(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function layoutTargetKey(artifactKey: string, nodeId: string): string {
  return `${artifactKey}\0${nodeId}`;
}

function compareImpacts(left: PrefabRefLayoutImpact, right: PrefabRefLayoutImpact): number {
  return (
    left.changedArtifactKey.localeCompare(right.changedArtifactKey) ||
    left.changedNodeId.localeCompare(right.changedNodeId) ||
    left.ownerPath.localeCompare(right.ownerPath) ||
    left.useSiteNodeId.localeCompare(right.useSiteNodeId) ||
    left.targetInstancePath.join("/").localeCompare(right.targetInstancePath.join("/"))
  );
}

function formatPrefabRefLayoutImpacts(impacts: readonly PrefabRefLayoutImpact[]): string {
  const details = impacts.map((impact) => {
    const target = [...impact.targetInstancePath, impact.changedNodeId].join("/");
    const coordinateFields = impact.coordinateOverrideFields.map((field) => `RectTransform.${field}`).join(", ");
    const inheritedFields = impact.inheritedAnchorFields.map((field) => `RectTransform.${field}`).join(", ");
    return `- '${impact.changedArtifactKey}/${impact.changedNodeId}' changed ${impact.changedAnchorFields.join(", ")}; PrefabRef '${impact.ownerArtifactKey}/${impact.useSiteNodeId}' in '${impact.ownerPath}' overrides ${coordinateFields} for '${target}' while inheriting changed ${inheritedFields}.`;
  });
  return `PrefabRef layout impact blocks the anchor change:\n${details.join("\n")}\nUpdate each listed PrefabRef override in the same transaction or remove its coordinate overrides.`;
}
