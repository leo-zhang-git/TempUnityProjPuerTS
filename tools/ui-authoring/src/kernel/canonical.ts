import { Value } from "@sinclair/typebox/value";
import {
  componentInspectorFields,
  componentRegistry,
  defaultComponent,
  inspectorFieldDefaultValue,
} from "../registry/component-registry.js";
import {
  type UiComponentAddition,
  UiComponentsSchema,
  type UiComponentType,
  type UiConcreteSource,
  type UiNode,
  type UiSource,
  UiSourceSchema,
  type UiVariantComponentAddition,
  type UiVariantNodeAddition,
  type UiVariantSource,
} from "../schema/ui-source-schema.js";
import { assertValidSource } from "./validation.js";

const ROOT_ORDER = [
  "sourceKind",
  "artifactKey",
  "artifactType",
  "displayName",
  "description",
  "variantOf",
  "widgetType",
  "nodeAdditions",
  "componentAdditions",
  "overrides",
  "initialSize",
  "bindings",
  "root",
];
const NODE_ORDER = ["id", "idMode", "name", "active", "rect", "components", "children"];
const RECT_ORDER = ["anchorMin", "anchorMax", "pivot", "anchoredPosition", "sizeDelta", "rotation", "scale"];
const ORDERED_RECORD_KEYS = new Set(["states", "values"]);

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^Assets\/UI\//, "");
}

function normalizeValue(value: unknown, parentKey = "", sourceRoot = false): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item));
  if (value === null || typeof value !== "object") {
    if (typeof value === "string" && (parentKey === "sprite" || parentKey === "font")) return normalizePath(value);
    if (typeof value === "string" && parentKey === "color") return value.toUpperCase();
    return value;
  }

  const input = value as Record<string, unknown>;
  const order = sourceRoot ? ROOT_ORDER : "anchorMin" in input ? RECT_ORDER : "id" in input && "rect" in input ? NODE_ORDER : [];
  const keys = ORDERED_RECORD_KEYS.has(parentKey)
    ? Object.keys(input)
    : [...Object.keys(input)].sort((left, right) => {
        const leftIndex = order.indexOf(left);
        const rightIndex = order.indexOf(right);
        if (leftIndex >= 0 || rightIndex >= 0)
          return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
        return left.localeCompare(right);
      });

  const output: Record<string, unknown> = {};
  for (const key of keys) output[key] = normalizeValue(input[key], key);
  return output;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) || Array.isArray(right)) return false;
  const leftEntries = Object.entries(left);
  const rightRecord = right as Record<string, unknown>;
  return (
    leftEntries.length === Object.keys(rightRecord).length &&
    leftEntries.every(([key, value]) => key in rightRecord && sameValue(value, rightRecord[key]))
  );
}

function normalizeTarget(target: { instancePath?: string[] }): void {
  if (target.instancePath?.length === 0) delete target.instancePath;
}

function stripComponentDefaults(type: UiComponentType, component: Record<string, unknown>): void {
  const required = new Set(UiComponentsSchema.properties[type].required ?? []);
  const fields = componentInspectorFields(type);
  const resolved = { ...(defaultComponent(type) as Record<string, unknown>), ...structuredClone(component) };
  for (const field of fields) {
    const defaultValue = inspectorFieldDefaultValue(field, resolved, componentRegistry[type].inspector);
    if (!required.has(field.property) && defaultValue !== undefined && sameValue(component[field.property], defaultValue))
      delete component[field.property];
  }
}

function stripAdditionDefaults(addition: UiComponentAddition): void {
  normalizeTarget(addition.target);
  stripComponentDefaults(addition.componentType, addition.value as Record<string, unknown>);
}

function stripNodeDefaults(node: UiNode): UiNode {
  const result = clone(node);
  if (result.active === true) delete result.active;
  if (result.rect.rotation === 0) delete result.rect.rotation;
  if (result.rect.scale?.[0] === 1 && result.rect.scale[1] === 1) delete result.rect.scale;
  if (result.children?.length === 0) delete result.children;

  for (const [type, component] of Object.entries(result.components ?? {}) as [UiComponentType, Record<string, unknown>][]) {
    stripComponentDefaults(type, component);
    if (type !== "PrefabRef") continue;
    const prefabRef = component as NonNullable<UiNode["components"]>["PrefabRef"];
    for (const override of prefabRef?.overrides ?? []) normalizeTarget(override.target);
    if (prefabRef?.overrides?.length === 0) delete prefabRef.overrides;
    for (const addition of prefabRef?.componentAdditions ?? []) stripAdditionDefaults(addition);
    prefabRef?.componentAdditions?.sort((left, right) => {
      const pathOrder = (left.target.instancePath ?? []).join("/").localeCompare((right.target.instancePath ?? []).join("/"));
      if (pathOrder !== 0) return pathOrder;
      const nodeOrder = left.target.nodeId.localeCompare(right.target.nodeId);
      return nodeOrder !== 0 ? nodeOrder : left.componentType.localeCompare(right.componentType);
    });
    if (prefabRef?.componentAdditions?.length === 0) delete prefabRef.componentAdditions;
  }
  if (result.children) result.children = result.children.map(stripNodeDefaults);
  return result;
}

function stripDefaults(value: UiSource): UiSource {
  const result = clone(value);
  if (result.sourceKind === "variant") {
    const nodeAdditions = result.nodeAdditions
      ?.map((addition: UiVariantNodeAddition) => ({ ...addition, node: stripNodeDefaults(addition.node) }))
      .sort(
        (left, right) =>
          left.parentId.localeCompare(right.parentId) ||
          left.siblingIndex - right.siblingIndex ||
          left.node.id.localeCompare(right.node.id),
      );
    if (nodeAdditions && nodeAdditions.length > 0) result.nodeAdditions = nodeAdditions;
    else delete result.nodeAdditions;
    for (const addition of result.componentAdditions ?? []) stripAdditionDefaults(addition as UiVariantComponentAddition);
    result.componentAdditions?.sort((left, right) => {
      const nodeOrder = left.target.nodeId.localeCompare(right.target.nodeId);
      return nodeOrder !== 0 ? nodeOrder : left.componentType.localeCompare(right.componentType);
    });
    if (result.componentAdditions?.length === 0) delete result.componentAdditions;
    for (const override of result.overrides) normalizeTarget(override.target);
    if (result.bindings?.length === 0) delete result.bindings;
    for (const declaration of result.bindings ?? []) normalizeTarget(declaration.target);
    return result;
  }
  if (result.bindings?.length === 0) delete result.bindings;
  for (const declaration of result.bindings ?? []) normalizeTarget(declaration.target);
  result.root = stripNodeDefaults(result.root);
  return result;
}

function resolveComponentDefaults(type: UiComponentType, component: Record<string, unknown>): void {
  for (const field of componentInspectorFields(type)) {
    if (component[field.property] === undefined && field.defaultValue !== undefined) component[field.property] = clone(field.defaultValue);
  }
}

function resolveNodeDefaults(node: UiNode): void {
  for (const [type, component] of Object.entries(node.components ?? {}) as [UiComponentType, Record<string, unknown>][]) {
    resolveComponentDefaults(type, component);
    if (type !== "PrefabRef") continue;
    const additions = (component as NonNullable<UiNode["components"]>["PrefabRef"])?.componentAdditions ?? [];
    for (const addition of additions) resolveComponentDefaults(addition.componentType, addition.value as Record<string, unknown>);
  }
  for (const child of node.children ?? []) resolveNodeDefaults(child);
}

export function resolveDefaults(source: UiConcreteSource): UiConcreteSource;
export function resolveDefaults(source: UiVariantSource): UiVariantSource;
export function resolveDefaults(source: UiSource): UiSource;
export function resolveDefaults(source: UiSource): UiSource {
  assertValidSource(source);
  const result = Value.Default(UiSourceSchema, clone(source)) as UiSource;
  if (result.sourceKind === "artifact") resolveNodeDefaults(result.root);
  else {
    for (const addition of result.nodeAdditions ?? []) resolveNodeDefaults(addition.node);
    for (const addition of result.componentAdditions ?? [])
      resolveComponentDefaults(addition.componentType, addition.value as Record<string, unknown>);
  }
  return result;
}

export function canonicalSource(source: UiConcreteSource): UiConcreteSource;
export function canonicalSource(source: UiVariantSource): UiVariantSource;
export function canonicalSource(source: UiSource): UiSource;
export function canonicalSource(source: UiSource): UiSource {
  assertValidSource(source);
  const normalized = normalizeValue(stripDefaults(source), "", true) as UiSource;
  assertValidSource(normalized);
  return normalized;
}

export function formatSource(source: UiSource): string {
  return `${JSON.stringify(canonicalSource(source), null, 2)}\n`;
}

export function parseSource(text: string): UiSource {
  const value = JSON.parse(text) as unknown;
  assertValidSource(value);
  return value;
}
