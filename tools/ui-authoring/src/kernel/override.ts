import { componentRegistry } from "../registry/component-registry.js";
import type { UiConcreteSource, UiNode, UiPropertyOverride } from "../schema/ui-source-schema.js";
import { findNode, updateNode } from "./tree.js";
import { assertValidSource } from "./validation.js";

const NODE_OVERRIDE_FIELDS = new Set(["active"]);
const RECT_TRANSFORM_OVERRIDE_FIELDS = new Set(["anchorMin", "anchorMax", "pivot", "anchoredPosition", "sizeDelta", "rotation", "scale"]);

export function overrideTargetKey(override: UiPropertyOverride): string {
  const { target } = override;
  return `${(target.instancePath ?? []).join("/")}\0${target.nodeId}\0${target.componentType}\0${target.fieldPath}`;
}

export function applyPropertyOverride(source: UiConcreteSource, override: UiPropertyOverride): UiConcreteSource {
  validateOverrideTarget(source, override);
  const next = writePropertyOverride(source, override);
  assertValidSource(next);
  return next;
}

export function applyPropertyOverrides(source: UiConcreteSource, overrides: readonly UiPropertyOverride[]): UiConcreteSource {
  if (overrides.length === 0) return source;
  let result = structuredClone(source);
  for (const override of overrides) {
    validateOverrideTarget(result, override);
    result = writePropertyOverride(result, override);
  }
  assertValidSource(result);
  return result;
}

export function applyUseSiteOverridesAtCurrentArtifact(
  source: UiConcreteSource,
  overrides: readonly UiPropertyOverride[],
): UiConcreteSource {
  const local = overrides
    .filter((override) => (override.target.instancePath?.length ?? 0) === 0)
    .map((override) => ({
      ...override,
      target: { ...override.target, instancePath: [] },
    }));
  return applyPropertyOverrides(source, local);
}

export function useSiteOverridesForChild(overrides: readonly UiPropertyOverride[], prefabRefNodeId: string): UiPropertyOverride[] {
  return overrides.flatMap((override) => {
    const path = override.target.instancePath ?? [];
    if (path[0] !== prefabRefNodeId) return [];
    return [
      {
        ...override,
        target: { ...override.target, instancePath: path.slice(1) },
      },
    ];
  });
}

export function validateOverrideTarget(source: UiConcreteSource, override: UiPropertyOverride): void {
  if ((override.target.instancePath?.length ?? 0) > 0) throw new Error("Local property override cannot traverse PrefabRef instances");
  const node = findNode(source, override.target.nodeId);
  if (!node) throw new Error(`Override target node '${override.target.nodeId}' does not exist`);
  if (override.value === undefined) throw new Error("Override value cannot be undefined");
  overrideOwner(node, override);
}

function overrideOwner(node: UiNode, override: UiPropertyOverride): Record<string, unknown> {
  const { componentType, fieldPath } = override.target;
  if (componentType === "Node") {
    if (!NODE_OVERRIDE_FIELDS.has(fieldPath)) throw unsupportedField(componentType, fieldPath);
    return node as unknown as Record<string, unknown>;
  }
  if (componentType === "RectTransform") {
    if (!RECT_TRANSFORM_OVERRIDE_FIELDS.has(fieldPath)) throw unsupportedField(componentType, fieldPath);
    return node.rect as unknown as Record<string, unknown>;
  }
  const definition = componentRegistry[componentType];
  if (!(definition.overrideFields as readonly string[]).includes(fieldPath)) throw unsupportedField(componentType, fieldPath);
  const component = node.components?.[componentType];
  if (!component) throw new Error(`Override target '${node.id}' has no ${componentType} component`);
  return component as unknown as Record<string, unknown>;
}

function unsupportedField(componentType: string, fieldPath: string): Error {
  return new Error(`Override field '${componentType}.${fieldPath}' is not supported`);
}

function writePropertyOverride(source: UiConcreteSource, override: UiPropertyOverride): UiConcreteSource {
  return updateNode(source, override.target.nodeId, (node) => {
    const result = structuredClone(node);
    const owner = overrideOwner(result, override);
    writeField(owner, override.target.fieldPath, structuredClone(override.value));
    return result;
  });
}

function writeField(owner: Record<string, unknown>, fieldPath: string, value: unknown): void {
  const segments = fieldPath.split(".");
  let current = owner;
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment];
    if (!next || typeof next !== "object" || Array.isArray(next))
      throw new Error(`Override field '${fieldPath}' has no object parent '${segment}'`);
    current = next as Record<string, unknown>;
  }
  current[segments.at(-1)!] = value;
}
