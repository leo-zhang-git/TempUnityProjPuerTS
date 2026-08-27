import { Ajv, type ErrorObject } from "ajv";
import { componentRegistry } from "../registry/component-registry.js";
import {
  type UiBindingComponentType,
  UiComponentsSchema,
  type UiComponentType,
  type UiConcreteSource,
  UiConcreteSourceSchema,
  type UiNestedTarget,
  type UiNode,
} from "../schema/ui-source-schema.js";
import { duplicateNodeSubtree } from "./node-clipboard.js";
import {
  addNodeComponent,
  createSemanticDiff,
  insertNode,
  moveNode,
  removeNode,
  removeNodeComponent,
  type SemanticDiff,
  setNodeField,
} from "./semantic.js";
import { findNode, walkNodes } from "./tree.js";

const ajv = new Ajv({ allErrors: true, strict: false });
const validateNodeShape = ajv.compile(UiConcreteSourceSchema.properties.root);
const validateComponentsShape = ajv.compile(UiComponentsSchema);

type EditTransactionPrecondition =
  | { readonly kind: "nodeExists"; readonly nodeId: string }
  | { readonly kind: "nodeAbsent"; readonly nodeId: string }
  | { readonly kind: "fieldEquals"; readonly nodeId: string; readonly field: string; readonly value: unknown }
  | { readonly kind: "fieldAbsent"; readonly nodeId: string; readonly field: string }
  | { readonly kind: "childrenEqual"; readonly nodeId: string; readonly children: readonly string[] };

type EditTransactionOperation =
  | { readonly kind: "insert"; readonly parentId: string; readonly node: UiNode; readonly index?: number }
  | { readonly kind: "duplicate"; readonly nodeId: string }
  | { readonly kind: "remove"; readonly nodeId: string }
  | { readonly kind: "move"; readonly nodeId: string; readonly parentId: string; readonly index?: number }
  | { readonly kind: "set"; readonly nodeId: string; readonly field: string; readonly value: unknown }
  | { readonly kind: "unset"; readonly nodeId: string; readonly field: string }
  | { readonly kind: "componentAdd"; readonly nodeId: string; readonly componentType: UiComponentType; readonly value?: unknown }
  | { readonly kind: "componentRemove"; readonly nodeId: string; readonly componentType: UiComponentType }
  | { readonly kind: "bindingSet"; readonly name: string; readonly target: UiNestedTarget }
  | { readonly kind: "bindingRemove"; readonly name: string };

export interface UiEditTransaction {
  readonly preconditions: readonly EditTransactionPrecondition[];
  readonly operations: readonly EditTransactionOperation[];
}

export interface EditTransactionResult {
  readonly source: UiConcreteSource;
  readonly diff: SemanticDiff;
}

/** Strictly parses the JSON-shaped transaction boundary without changing its input. */
export function parseEditTransaction(value: unknown): UiEditTransaction {
  const input = record(value, "Edit transaction");
  exactKeys(input, ["preconditions", "operations"], "Edit transaction");
  if (!Array.isArray(input.preconditions)) throw new Error("Edit transaction 'preconditions' must be an array");
  if (!Array.isArray(input.operations)) throw new Error("Edit transaction 'operations' must be an array");
  return {
    preconditions: input.preconditions.map((entry, index) => parsePrecondition(entry, index)),
    operations: input.operations.map((entry, index) => parseOperation(entry, index)),
  };
}

/** Applies a transaction atomically in memory and returns one initial-to-final semantic diff. */
export function applyEditTransaction(source: UiConcreteSource, value: unknown): EditTransactionResult {
  const transaction = parseEditTransaction(value);
  transaction.preconditions.forEach((precondition, index) => void checkPrecondition(source, precondition, index));

  let next = source;
  const origins = new Map(walkNodes(source).map(({ node }) => [node.id, node.id] as const));
  const usedNodeIds = new Set(origins.keys());
  for (let index = 0; index < transaction.operations.length; index += 1) {
    const operation = transaction.operations[index]!;
    const beforeIds = new Set(walkNodes(next).map(({ node }) => node.id));
    try {
      const applied = applyOperation(next, operation);
      const introducedIds = walkNodes(applied)
        .map(({ node }) => node.id)
        .filter((nodeId) => !beforeIds.has(nodeId));
      const reusedId = introducedIds.find((nodeId) => usedNodeIds.has(nodeId));
      if (reusedId) throw new Error(`Node id '${reusedId}' cannot be reused within one edit transaction`);
      introducedIds.forEach((nodeId) => void usedNodeIds.add(nodeId));
      next = applied;
      updateOrigins(origins, beforeIds, next);
    } catch (error) {
      throw indexedError("operation", index, error);
    }
  }

  const finalIds = new Set(walkNodes(next).map(({ node }) => node.id));
  const renames = [...origins]
    .filter(([nodeId, originalId]) => originalId !== undefined && nodeId !== originalId && finalIds.has(nodeId))
    .map(([afterNodeId, beforeNodeId]) => ({ beforeNodeId: beforeNodeId!, afterNodeId }));
  return { source: next, diff: createSemanticDiff(source, next, renames) };
}

function parsePrecondition(value: unknown, index: number): EditTransactionPrecondition {
  const label = `Edit transaction precondition[${index}]`;
  const input = record(value, label);
  const kind = string(input.kind, `${label}.kind`);
  if (kind === "nodeExists" || kind === "nodeAbsent") {
    exactKeys(input, ["kind", "nodeId"], label);
    return { kind, nodeId: nodeId(input.nodeId, `${label}.nodeId`) };
  }
  if (kind === "fieldEquals") {
    exactKeys(input, ["kind", "nodeId", "field", "value"], label);
    requireOwn(input, "value", label);
    return { kind, nodeId: nodeId(input.nodeId, `${label}.nodeId`), field: field(input.field, label), value: structuredClone(input.value) };
  }
  if (kind === "fieldAbsent") {
    exactKeys(input, ["kind", "nodeId", "field"], label);
    return { kind, nodeId: nodeId(input.nodeId, `${label}.nodeId`), field: field(input.field, label) };
  }
  if (kind === "childrenEqual") {
    exactKeys(input, ["kind", "nodeId", "children"], label);
    if (!Array.isArray(input.children)) throw new Error(`${label}.children must be an array`);
    return {
      kind,
      nodeId: nodeId(input.nodeId, `${label}.nodeId`),
      children: input.children.map((entry, childIndex) => nodeId(entry, `${label}.children[${childIndex}]`)),
    };
  }
  throw new Error(`${label}.kind is unsupported: '${kind}'`);
}

function parseOperation(value: unknown, index: number): EditTransactionOperation {
  const label = `Edit transaction operation[${index}]`;
  const input = record(value, label);
  const kind = string(input.kind, `${label}.kind`);
  if (kind === "insert") {
    exactKeys(input, ["kind", "parentId", "node", "index"], label, ["index"]);
    return {
      kind,
      parentId: nodeId(input.parentId, `${label}.parentId`),
      node: parseNode(input.node, `${label}.node`),
      ...optionalIndex(input, label),
    };
  }
  if (kind === "duplicate") {
    exactKeys(input, ["kind", "nodeId"], label);
    return { kind, nodeId: nodeId(input.nodeId, `${label}.nodeId`) };
  }
  if (kind === "remove") {
    exactKeys(input, ["kind", "nodeId"], label);
    return { kind, nodeId: nodeId(input.nodeId, `${label}.nodeId`) };
  }
  if (kind === "move") {
    exactKeys(input, ["kind", "nodeId", "parentId", "index"], label, ["index"]);
    return {
      kind,
      nodeId: nodeId(input.nodeId, `${label}.nodeId`),
      parentId: nodeId(input.parentId, `${label}.parentId`),
      ...optionalIndex(input, label),
    };
  }
  if (kind === "rename" || kind === "setNodeName") {
    throw new Error(`${label}.kind '${kind}' is not supported; use the top-level 'rename' command for Node names and identity`);
  }
  if (kind === "set") {
    exactKeys(input, ["kind", "nodeId", "field", "value"], label);
    requireOwn(input, "value", label);
    return {
      kind,
      nodeId: nodeId(input.nodeId, `${label}.nodeId`),
      field: mutableField(input.field, label),
      value: structuredClone(input.value),
    };
  }
  if (kind === "unset") {
    exactKeys(input, ["kind", "nodeId", "field"], label);
    return { kind, nodeId: nodeId(input.nodeId, `${label}.nodeId`), field: mutableField(input.field, label) };
  }
  if (kind === "componentAdd") {
    exactKeys(input, ["kind", "nodeId", "componentType", "value"], label, ["value"]);
    return {
      kind,
      nodeId: nodeId(input.nodeId, `${label}.nodeId`),
      componentType: componentType(input.componentType, label),
      ...(Object.hasOwn(input, "value") ? { value: parseComponentValue(input.componentType, input.value, label) } : {}),
    };
  }
  if (kind === "componentRemove") {
    exactKeys(input, ["kind", "nodeId", "componentType"], label);
    return { kind, nodeId: nodeId(input.nodeId, `${label}.nodeId`), componentType: componentType(input.componentType, label) };
  }
  if (kind === "bindingSet") {
    exactKeys(input, ["kind", "name", "target"], label);
    return { kind, name: identifier(input.name, `${label}.name`, "Binding field name"), target: bindingTarget(input.target, label) };
  }
  if (kind === "bindingRemove") {
    exactKeys(input, ["kind", "name"], label);
    return { kind, name: identifier(input.name, `${label}.name`, "Binding field name") };
  }
  throw new Error(`${label}.kind is unsupported: '${kind}'`);
}

function applyOperation(source: UiConcreteSource, operation: EditTransactionOperation): UiConcreteSource {
  switch (operation.kind) {
    case "insert":
      return insertNode(source, operation.parentId, operation.node, operation.index);
    case "duplicate":
      return duplicateNodeSubtree(source, operation.nodeId).source;
    case "remove":
      return removeNode(source, operation.nodeId);
    case "move":
      return moveNode(source, operation.nodeId, operation.parentId, operation.index);
    case "set":
      return setNodeField(source, operation.nodeId, operation.field, operation.value);
    case "unset":
      return setNodeField(source, operation.nodeId, operation.field, undefined, true);
    case "componentAdd":
      return addNodeComponent(source, operation.nodeId, operation.componentType, operation.value);
    case "componentRemove":
      return removeNodeComponent(source, operation.nodeId, operation.componentType);
    case "bindingSet":
      return setBinding(source, operation.name, operation.target);
    case "bindingRemove":
      return removeBinding(source, operation.name);
  }
}

function setBinding(source: UiConcreteSource, name: string, target: UiNestedTarget): UiConcreteSource {
  const bindings = source.bindings ?? [];
  const index = bindings.findIndex((binding) => binding.name === name);
  if (index < 0) return { ...source, bindings: [...bindings, { name, target: structuredClone(target) }] };
  return {
    ...source,
    bindings: bindings.map((binding, currentIndex) =>
      currentIndex === index ? { name, target: structuredClone(target) } : structuredClone(binding),
    ),
  };
}

function removeBinding(source: UiConcreteSource, name: string): UiConcreteSource {
  const bindings = source.bindings ?? [];
  if (!bindings.some((binding) => binding.name === name)) throw new Error(`Binding '${name}' does not exist`);
  const remaining = bindings.filter((binding) => binding.name !== name).map((binding) => structuredClone(binding));
  if (remaining.length > 0) return { ...source, bindings: remaining };
  const next = { ...source };
  delete next.bindings;
  return next;
}

function checkPrecondition(source: UiConcreteSource, precondition: EditTransactionPrecondition, index: number): void {
  const node = findNode(source, precondition.nodeId);
  let satisfied: boolean;
  if (precondition.kind === "nodeExists") satisfied = node !== undefined;
  else if (precondition.kind === "nodeAbsent") satisfied = node === undefined;
  else if (!node) satisfied = false;
  else if (precondition.kind === "childrenEqual") {
    satisfied = equal(
      (node.children ?? []).map((child) => child.id),
      precondition.children,
    );
  } else {
    const result = nestedValue(node as unknown as Record<string, unknown>, precondition.field);
    satisfied = precondition.kind === "fieldAbsent" ? !result.exists : result.exists && equal(result.value, precondition.value);
  }
  if (!satisfied) throw new Error(`Edit transaction precondition[${index}] failed (${precondition.kind})`);
}

function updateOrigins(origins: Map<string, string | undefined>, beforeIds: ReadonlySet<string>, after: UiConcreteSource): void {
  const afterIds = new Set(walkNodes(after).map(({ node }) => node.id));
  for (const nodeId of origins.keys()) if (!afterIds.has(nodeId)) origins.delete(nodeId);
  for (const nodeId of afterIds) if (!beforeIds.has(nodeId)) origins.set(nodeId, undefined);
}

function nestedValue(root: Record<string, unknown>, path: string): { readonly exists: boolean; readonly value?: unknown } {
  let current: unknown = root;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !Object.hasOwn(current, segment)) return { exists: false };
    current = (current as Record<string, unknown>)[segment];
  }
  return { exists: true, value: current };
}

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => equal(entry, right[index]))
    );
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return equal(leftKeys, rightKeys) && leftKeys.every((key) => equal(leftRecord[key], rightRecord[key]));
}

function parseNode(value: unknown, label: string): UiNode {
  if (!validateNodeShape(value)) throw schemaError(label, validateNodeShape.errors);
  return structuredClone(value) as UiNode;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(input: Record<string, unknown>, allowed: readonly string[], label: string, optional: readonly string[] = []): void {
  const allowedSet = new Set(allowed);
  const optionalSet = new Set(optional);
  for (const key of Object.keys(input)) if (!allowedSet.has(key)) throw new Error(`${label} has unknown property '${key}'`);
  for (const key of allowed) if (!optionalSet.has(key) && !Object.hasOwn(input, key)) throw new Error(`${label} is missing '${key}'`);
}

function requireOwn(input: Record<string, unknown>, property: string, label: string): void {
  if (!Object.hasOwn(input, property)) throw new Error(`${label} is missing '${property}'`);
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function nodeId(value: unknown, label: string): string {
  return identifier(value, label, "node id");
}

function identifier(value: unknown, label: string, description = "identifier"): string {
  const result = string(value, label);
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(result)) throw new Error(`${label} must be a valid ${description}`);
  return result;
}

function field(value: unknown, label: string): string {
  const result = string(value, `${label}.field`);
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(result))
    throw new Error(`${label}.field must be a dotted Source field path`);
  return result;
}

function mutableField(value: unknown, label: string): string {
  const result = field(value, label);
  if (result === "name" || result === "id" || result === "idMode") {
    throw new Error(`${label}.field '${result}' is managed by the top-level 'rename' command`);
  }
  return result;
}

function optionalIndex(input: Record<string, unknown>, label: string): { readonly index?: number } {
  if (input.index === undefined) return {};
  if (!Number.isInteger(input.index) || (input.index as number) < 0) throw new Error(`${label}.index must be a non-negative integer`);
  return { index: input.index as number };
}

function componentType(value: unknown, label: string): UiComponentType {
  const result = string(value, `${label}.componentType`);
  if (!(result in componentRegistry)) throw new Error(`${label}.componentType is unsupported: '${result}'`);
  return result as UiComponentType;
}

function bindingTarget(value: unknown, label: string): UiNestedTarget {
  const input = record(value, `${label}.target`);
  exactKeys(input, ["instancePath", "nodeId", "componentType"], `${label}.target`, ["instancePath"]);
  return {
    ...(input.instancePath === undefined ? {} : { instancePath: identifierArray(input.instancePath, `${label}.target.instancePath`) }),
    nodeId: nodeId(input.nodeId, `${label}.target.nodeId`),
    componentType: bindingComponentType(input.componentType, `${label}.target.componentType`),
  };
}

function bindingComponentType(value: unknown, label: string): UiBindingComponentType {
  const result = string(value, label);
  if (result === "GameObject" || result === "RectTransform" || result in componentRegistry) return result as UiBindingComponentType;
  throw new Error(`${label} is unsupported: '${result}'`);
}

function identifierArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((entry, index) => identifier(entry, `${label}[${index}]`));
}

function parseComponentValue(typeValue: unknown, value: unknown, label: string): unknown {
  const type = componentType(typeValue, label);
  if (!validateComponentsShape({ [type]: value })) throw schemaError(`${label}.value`, validateComponentsShape.errors);
  return structuredClone(value);
}

function schemaError(label: string, errors: readonly ErrorObject[] | null | undefined): Error {
  const detail = (errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`).join("; ");
  return new Error(`${label} is invalid${detail ? `: ${detail}` : ""}`);
}

function indexedError(kind: "operation", index: number, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Edit transaction ${kind}[${index}] failed: ${message}`, { cause: error });
}
