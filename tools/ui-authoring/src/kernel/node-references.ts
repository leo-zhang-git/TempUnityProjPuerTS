import type { ComponentNodeReferenceOwner } from "../components/component-module.js";
import type { ComponentDefinition, InspectorFieldDefinition } from "../registry/component-contract.js";
import { componentRegistry } from "../registry/component-registry.js";
import type { UiComponentType, UiNode } from "../schema/ui-source-schema.js";

export interface LocalNodeReference {
  readonly ownerNodeId: string;
  readonly targetNodeId: string;
  readonly field: string;
}

export interface LocalNodeReferenceRemoval extends LocalNodeReference {
  readonly requiresRepair: boolean;
}

interface ComponentReferenceDefinition extends ComponentDefinition {
  readonly nodeReferences?: ComponentNodeReferenceOwner;
}

function referenceFields(definition: ComponentDefinition): readonly InspectorFieldDefinition[] {
  return definition.inspector.filter(
    (entry): entry is InspectorFieldDefinition =>
      "property" in entry && (entry.control === "nodeReference" || entry.control === "nodeReferenceList"),
  );
}

function componentDefinition(componentType: UiComponentType): ComponentReferenceDefinition {
  return componentRegistry[componentType] as ComponentReferenceDefinition;
}

export function overrideReferencesRemovedNode(
  componentType: string,
  fieldPath: string,
  value: unknown,
  removedNodeIds: ReadonlySet<string>,
): boolean {
  if (!(componentType in componentRegistry)) return false;
  const field = referenceFields(componentDefinition(componentType as UiComponentType)).find(
    (candidate) => candidate.property === fieldPath,
  );
  if (!field) return false;
  if (field.control === "nodeReference") return typeof value === "string" && removedNodeIds.has(value);
  return Array.isArray(value) && value.some((entry) => typeof entry === "string" && removedNodeIds.has(entry));
}

export function remapOverrideNodeReferenceValue(
  componentType: string,
  fieldPath: string,
  value: unknown,
  remap: (nodeId: string) => string,
): unknown {
  if (!(componentType in componentRegistry)) return value;
  const field = referenceFields(componentDefinition(componentType as UiComponentType)).find(
    (candidate) => candidate.property === fieldPath,
  );
  if (!field) return value;
  if (field.control === "nodeReference") return typeof value === "string" && value.length > 0 ? remap(value) : value;
  return Array.isArray(value) ? value.map((entry) => (typeof entry === "string" && entry.length > 0 ? remap(entry) : entry)) : value;
}

export function remapComponentNodeReferenceTargets(
  componentType: UiComponentType,
  rawValue: Readonly<Record<string, unknown>>,
  remap: (nodeId: string) => string,
): Readonly<Record<string, unknown>> {
  const definition = componentDefinition(componentType);
  let value = rawValue;
  for (const field of referenceFields(definition)) {
    const current = value[field.property];
    if (field.control === "nodeReference") {
      if (typeof current === "string" && current.length > 0) value = { ...value, [field.property]: remap(current) };
    } else if (Array.isArray(current)) {
      value = {
        ...value,
        [field.property]: current.map((entry) => (typeof entry === "string" && entry.length > 0 ? remap(entry) : entry)),
      };
    }
  }
  return definition.nodeReferences ? definition.nodeReferences.remap(value, remap) : value;
}

export function collectLocalNodeReferences(root: UiNode): LocalNodeReference[] {
  const result: LocalNodeReference[] = [];
  const add = (ownerNodeId: string, targetNodeId: string, field: string): void => {
    if (targetNodeId.length > 0) result.push({ ownerNodeId, targetNodeId, field });
  };
  const visit = (node: UiNode): void => {
    for (const [componentType, rawValue] of Object.entries(node.components ?? {}) as [
      UiComponentType,
      Readonly<Record<string, unknown>> | undefined,
    ][]) {
      if (!rawValue) continue;
      const definition = componentDefinition(componentType);
      for (const field of referenceFields(definition)) {
        const value = rawValue[field.property];
        if (field.control === "nodeReference") {
          if (typeof value === "string") add(node.id, value, `${componentType}.${field.property}`);
          continue;
        }
        for (const targetNodeId of Array.isArray(value) ? value : []) {
          if (typeof targetNodeId === "string") add(node.id, targetNodeId, `${componentType}.${field.property}`);
        }
      }
      for (const reference of definition.nodeReferences?.collect(rawValue) ?? []) add(node.id, reference.targetNodeId, reference.field);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return result;
}

export function remapLocalNodeReferenceTargets(root: UiNode, remap: (nodeId: string) => string): UiNode {
  const result = structuredClone(root);
  const visit = (node: UiNode): void => {
    for (const [componentType, rawValue] of Object.entries(node.components ?? {}) as [
      UiComponentType,
      Readonly<Record<string, unknown>> | undefined,
    ][]) {
      if (!rawValue || !node.components) continue;
      node.components[componentType] = remapComponentNodeReferenceTargets(componentType, rawValue, remap) as never;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(result);
  return result;
}

export function removeLocalNodeReferenceTargets(
  root: UiNode,
  removedNodeIds: ReadonlySet<string>,
): { readonly root: UiNode; readonly removals: readonly LocalNodeReferenceRemoval[] } {
  const result = structuredClone(root);
  const removals: LocalNodeReferenceRemoval[] = [];
  const visit = (node: UiNode): void => {
    if (removedNodeIds.has(node.id)) return;
    for (const [componentType, rawValue] of Object.entries(node.components ?? {}) as [
      UiComponentType,
      Readonly<Record<string, unknown>> | undefined,
    ][]) {
      if (!rawValue || !node.components) continue;
      const definition = componentDefinition(componentType);
      let value: Readonly<Record<string, unknown>> = rawValue;
      for (const field of referenceFields(definition)) {
        const current = value[field.property];
        if (field.control === "nodeReference") {
          if (typeof current !== "string" || !removedNodeIds.has(current)) continue;
          removals.push({
            ownerNodeId: node.id,
            targetNodeId: current,
            field: `${componentType}.${field.property}`,
            requiresRepair: field.required === true,
          });
          const next = { ...value };
          if (field.required) next[field.property] = "";
          else if (field.nullable) next[field.property] = null;
          else delete next[field.property];
          value =
            definition.mutateInspectorField?.(next, { property: field.property, value: next[field.property], previous: value }) ?? next;
          continue;
        }
        if (!Array.isArray(current)) continue;
        const retained = current.filter((entry) => typeof entry !== "string" || !removedNodeIds.has(entry));
        if (retained.length === current.length) continue;
        const requiresRepair = field.required === true && retained.length === 0;
        for (const entry of current) {
          if (typeof entry === "string" && removedNodeIds.has(entry))
            removals.push({
              ownerNodeId: node.id,
              targetNodeId: entry,
              field: `${componentType}.${field.property}`,
              requiresRepair,
            });
        }
        const next = { ...value, [field.property]: retained };
        value = definition.mutateInspectorField?.(next, { property: field.property, value: retained, previous: value }) ?? next;
      }
      if (definition.nodeReferences) {
        const custom = definition.nodeReferences.removeTargets(value, removedNodeIds);
        value = custom.value;
        removals.push(...custom.removals.map((removal) => ({ ownerNodeId: node.id, ...removal })));
      }
      node.components[componentType] = value as never;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(result);
  return { root: result, removals };
}
