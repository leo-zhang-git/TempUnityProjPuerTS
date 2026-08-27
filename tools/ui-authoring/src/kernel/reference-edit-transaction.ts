import type { PreviewReferenceOwnerScope, ReferenceCollection, ReferenceMount, UiReference } from "../schema/ui-prototype-schema.js";
import { assertValidReferenceShape } from "./prototype.js";

type PreviewValues = NonNullable<UiReference["values"]>;
type ReferenceContext = NonNullable<UiReference["context"]>;
type InstanceValues = NonNullable<UiReference["instanceValues"]>[number];

type ReferenceEditOperation =
  | {
      readonly kind: "valueSet";
      readonly target: "subject" | "context";
      readonly fieldName: string;
      readonly capability: string;
      readonly value: unknown;
    }
  | {
      readonly kind: "valueRemove";
      readonly target: "subject" | "context";
      readonly fieldName: string;
      readonly capability?: string;
    }
  | {
      readonly kind: "statePreviewContextSet";
      readonly targetStateRoot: string;
      readonly upstreamStateRoot: string;
      readonly stateName: string;
    }
  | {
      readonly kind: "statePreviewContextRemove";
      readonly targetStateRoot: string;
      readonly upstreamStateRoot?: string;
    }
  | { readonly kind: "collectionSet"; readonly collection: ReferenceCollection }
  | { readonly kind: "collectionRemove"; readonly key: string }
  | { readonly kind: "instanceValuesSet"; readonly entry: InstanceValues }
  | { readonly kind: "instanceValuesRemove"; readonly owner: PreviewReferenceOwnerScope }
  | { readonly kind: "mountSet"; readonly mount: ReferenceMount }
  | { readonly kind: "mountRemove"; readonly key: string }
  | { readonly kind: "contextSet"; readonly context: ReferenceContext }
  | { readonly kind: "contextRemove" };

interface ReferenceEditTransaction {
  readonly operations: readonly ReferenceEditOperation[];
}

interface ReferenceSemanticChange {
  readonly kind: "added" | "removed" | "updated";
  readonly path: string;
  readonly before?: unknown;
  readonly after?: unknown;
}

export interface ReferenceSemanticDiff {
  readonly referenceKey: string;
  readonly created: boolean;
  readonly changes: readonly ReferenceSemanticChange[];
}

export interface ReferenceEditTransactionResult {
  readonly reference: UiReference;
  readonly diff: ReferenceSemanticDiff;
}

function parseReferenceEditTransaction(value: unknown): ReferenceEditTransaction {
  const input = record(value, "Reference edit transaction");
  exactKeys(input, ["operations"], "Reference edit transaction");
  if (!Array.isArray(input.operations)) throw new Error("Reference edit transaction 'operations' must be an array");
  return { operations: input.operations.map((entry, index) => parseOperation(entry, index)) };
}

export function applyReferenceEditTransaction(reference: UiReference, value: unknown): ReferenceEditTransactionResult {
  assertValidReferenceShape(reference);
  const transaction = parseReferenceEditTransaction(value);
  let next = structuredClone(reference);
  for (const [index, operation] of transaction.operations.entries()) {
    try {
      next = applyOperation(next, operation);
      assertValidReferenceShape(next);
    } catch (error) {
      throw indexedError(index, error);
    }
  }
  return { reference: next, diff: createReferenceSemanticDiff(reference, next) };
}

export function createReferenceSemanticDiff(before: UiReference | undefined, after: UiReference): ReferenceSemanticDiff {
  const changes: ReferenceSemanticChange[] = [];
  if (before) compareValue(before, after, "", changes);
  return {
    referenceKey: after.referenceKey,
    created: before === undefined,
    changes,
  };
}

function parseOperation(value: unknown, index: number): ReferenceEditOperation {
  const label = `Reference edit transaction operation[${index}]`;
  const input = record(value, label);
  const kind = string(input.kind, `${label}.kind`);
  if (kind === "valueSet") {
    exactKeys(input, ["kind", "target", "fieldName", "capability", "value"], label, ["target"]);
    requireOwn(input, "value", label);
    return {
      kind,
      target: valueTarget(input.target, label),
      fieldName: identifier(input.fieldName, `${label}.fieldName`),
      capability: identifier(input.capability, `${label}.capability`),
      value: structuredClone(input.value),
    };
  }
  if (kind === "valueRemove") {
    exactKeys(input, ["kind", "target", "fieldName", "capability"], label, ["target", "capability"]);
    return {
      kind,
      target: valueTarget(input.target, label),
      fieldName: identifier(input.fieldName, `${label}.fieldName`),
      ...(input.capability === undefined ? {} : { capability: identifier(input.capability, `${label}.capability`) }),
    };
  }
  if (kind === "statePreviewContextSet") {
    exactKeys(input, ["kind", "targetStateRoot", "upstreamStateRoot", "stateName"], label);
    return {
      kind,
      targetStateRoot: identifier(input.targetStateRoot, `${label}.targetStateRoot`),
      upstreamStateRoot: identifier(input.upstreamStateRoot, `${label}.upstreamStateRoot`),
      stateName: identifier(input.stateName, `${label}.stateName`),
    };
  }
  if (kind === "statePreviewContextRemove") {
    exactKeys(input, ["kind", "targetStateRoot", "upstreamStateRoot"], label, ["upstreamStateRoot"]);
    return {
      kind,
      targetStateRoot: identifier(input.targetStateRoot, `${label}.targetStateRoot`),
      ...(input.upstreamStateRoot === undefined
        ? {}
        : { upstreamStateRoot: identifier(input.upstreamStateRoot, `${label}.upstreamStateRoot`) }),
    };
  }
  if (kind === "collectionSet") {
    exactKeys(input, ["kind", "collection"], label);
    return { kind, collection: structuredClone(record(input.collection, `${label}.collection`)) as ReferenceCollection };
  }
  if (kind === "collectionRemove" || kind === "mountRemove") {
    exactKeys(input, ["kind", "key"], label);
    return { kind, key: identifier(input.key, `${label}.key`) };
  }
  if (kind === "instanceValuesSet") {
    exactKeys(input, ["kind", "owner", "referenceKey", "values"], label, ["referenceKey", "values"]);
    if (input.referenceKey === undefined && input.values === undefined) {
      throw new Error(`${label} requires at least one of 'referenceKey' or 'values'`);
    }
    const owner = parseOwner(input.owner, `${label}.owner`);
    const values = input.values === undefined ? undefined : parseValues(input.values, `${label}.values`);
    if (input.referenceKey === undefined) return { kind, entry: { owner, values: values! } };
    if (owner.kind === "subject" || owner.kind === "context") {
      throw new Error(`${label}.referenceKey requires an artifact or mount owner`);
    }
    return {
      kind,
      entry: {
        owner,
        referenceKey: artifactKey(input.referenceKey, `${label}.referenceKey`),
        ...(values === undefined ? {} : { values }),
      },
    };
  }
  if (kind === "instanceValuesRemove") {
    exactKeys(input, ["kind", "owner"], label);
    return { kind, owner: parseOwner(input.owner, `${label}.owner`) };
  }
  if (kind === "mountSet") {
    exactKeys(input, ["kind", "mount"], label);
    return { kind, mount: structuredClone(record(input.mount, `${label}.mount`)) as ReferenceMount };
  }
  if (kind === "contextSet") {
    exactKeys(input, ["kind", "context"], label);
    return { kind, context: structuredClone(record(input.context, `${label}.context`)) as ReferenceContext };
  }
  if (kind === "contextRemove") {
    exactKeys(input, ["kind"], label);
    return { kind };
  }
  throw new Error(`${label}.kind is unsupported: '${kind}'`);
}

function applyOperation(reference: UiReference, operation: ReferenceEditOperation): UiReference {
  const result = structuredClone(reference);
  switch (operation.kind) {
    case "valueSet": {
      const values = valuesForTarget(result, operation.target, true)!;
      values[operation.fieldName] = {
        ...(values[operation.fieldName] ?? {}),
        [operation.capability]: structuredClone(operation.value),
      };
      return result;
    }
    case "valueRemove": {
      const values = valuesForTarget(result, operation.target, false);
      if (!values) return result;
      if (operation.capability === undefined) delete values[operation.fieldName];
      else {
        const capabilities = values[operation.fieldName];
        if (capabilities) {
          delete capabilities[operation.capability];
          if (Object.keys(capabilities).length === 0) delete values[operation.fieldName];
        }
      }
      cleanValuesTarget(result, operation.target, values);
      return result;
    }
    case "statePreviewContextSet": {
      result.statePreviewContexts ??= {};
      result.statePreviewContexts[operation.targetStateRoot] = {
        ...(result.statePreviewContexts[operation.targetStateRoot] ?? {}),
        [operation.upstreamStateRoot]: operation.stateName,
      };
      return result;
    }
    case "statePreviewContextRemove": {
      const contexts = result.statePreviewContexts;
      if (!contexts) return result;
      if (operation.upstreamStateRoot === undefined) delete contexts[operation.targetStateRoot];
      else {
        const context = contexts[operation.targetStateRoot];
        if (context) {
          delete context[operation.upstreamStateRoot];
          if (Object.keys(context).length === 0) delete contexts[operation.targetStateRoot];
        }
      }
      if (Object.keys(contexts).length === 0) delete result.statePreviewContexts;
      return result;
    }
    case "collectionSet":
      result.collections = upsertByKey(result.collections, operation.collection);
      return result;
    case "collectionRemove":
      result.collections = removeByKey(result.collections, operation.key);
      if (result.collections.length === 0) delete result.collections;
      return result;
    case "instanceValuesSet": {
      const entries = result.instanceValues ?? [];
      const index = entries.findIndex((entry) => sameOwner(entry.owner, operation.entry.owner));
      result.instanceValues =
        index < 0
          ? [...entries, structuredClone(operation.entry)]
          : entries.map((entry, current) => (current === index ? structuredClone(operation.entry) : entry));
      return result;
    }
    case "instanceValuesRemove":
      result.instanceValues = (result.instanceValues ?? []).filter((entry) => !sameOwner(entry.owner, operation.owner));
      if (result.instanceValues.length === 0) delete result.instanceValues;
      return result;
    case "mountSet":
      result.mounts = upsertByKey(result.mounts, operation.mount);
      return result;
    case "mountRemove":
      result.mounts = removeByKey(result.mounts, operation.key);
      if (result.mounts.length === 0) delete result.mounts;
      return result;
    case "contextSet":
      result.context = structuredClone(operation.context);
      return result;
    case "contextRemove":
      delete result.context;
      return result;
  }
}

function valuesForTarget(reference: UiReference, target: "subject" | "context", create: boolean): PreviewValues | undefined {
  if (target === "subject") {
    if (create) reference.values ??= {};
    return reference.values;
  }
  if (!reference.context) throw new Error("Context values require an existing Reference context");
  if (create) reference.context.values ??= {};
  return reference.context.values;
}

function cleanValuesTarget(reference: UiReference, target: "subject" | "context", values: PreviewValues): void {
  if (Object.keys(values).length > 0) return;
  if (target === "subject") delete reference.values;
  else if (reference.context) delete reference.context.values;
}

function upsertByKey<T extends { readonly key: string }>(entries: readonly T[] | undefined, value: T): T[] {
  const current = entries ?? [];
  const index = current.findIndex((entry) => entry.key === value.key);
  return index < 0
    ? [...current, structuredClone(value)]
    : current.map((entry, currentIndex) => (currentIndex === index ? structuredClone(value) : structuredClone(entry)));
}

function removeByKey<T extends { readonly key: string }>(entries: readonly T[] | undefined, key: string): T[] {
  return (entries ?? []).filter((entry) => entry.key !== key).map((entry) => structuredClone(entry));
}

function sameOwner(left: PreviewReferenceOwnerScope, right: PreviewReferenceOwnerScope): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseOwner(value: unknown, label: string): PreviewReferenceOwnerScope {
  const input = record(value, label);
  const kind = string(input.kind, `${label}.kind`);
  if (kind === "subject" || kind === "context") {
    exactKeys(input, ["kind"], label);
    return { kind };
  }
  if (kind === "artifact") {
    exactKeys(input, ["kind", "root", "instancePath"], label);
    if (input.root !== "subject" && input.root !== "context") throw new Error(`${label}.root must be 'subject' or 'context'`);
    return { kind, root: input.root, instancePath: identifierArray(input.instancePath, `${label}.instancePath`, true) };
  }
  if (kind === "mount") {
    exactKeys(input, ["kind", "mountKey", "instancePath"], label, ["instancePath"]);
    return {
      kind,
      mountKey: identifier(input.mountKey, `${label}.mountKey`),
      ...(input.instancePath === undefined ? {} : { instancePath: identifierArray(input.instancePath, `${label}.instancePath`, true) }),
    };
  }
  throw new Error(`${label}.kind is unsupported: '${kind}'`);
}

function parseValues(value: unknown, label: string): PreviewValues {
  const input = record(value, label);
  if (Object.keys(input).length === 0) throw new Error(`${label} must contain at least one Binder field`);
  return Object.fromEntries(
    Object.entries(input).map(([fieldName, capabilities]) => {
      identifier(fieldName, `${label}.${fieldName}`);
      const capabilityRecord = record(capabilities, `${label}.${fieldName}`);
      if (Object.keys(capabilityRecord).length === 0) throw new Error(`${label}.${fieldName} must contain at least one capability`);
      for (const capability of Object.keys(capabilityRecord)) identifier(capability, `${label}.${fieldName}.${capability}`);
      return [fieldName, structuredClone(capabilityRecord)];
    }),
  );
}

function compareValue(before: unknown, after: unknown, path: string, changes: ReferenceSemanticChange[]): void {
  if (sameValue(before, after)) return;
  if (plainObject(before) && plainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort((left, right) => left.localeCompare(right));
    for (const key of keys) compareValue(before[key], after[key], `${path}/${pointerToken(key)}`, changes);
    return;
  }
  const kind = before === undefined ? "added" : after === undefined ? "removed" : "updated";
  changes.push({
    kind,
    path: path || "/",
    ...(before === undefined ? {} : { before: structuredClone(before) }),
    ...(after === undefined ? {} : { after: structuredClone(after) }),
  });
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => sameValue(entry, right[index]))
    );
  }
  if (!plainObject(left) || !plainObject(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pointerToken(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function valueTarget(value: unknown, label: string): "subject" | "context" {
  if (value === undefined || value === "subject") return "subject";
  if (value === "context") return "context";
  throw new Error(`${label}.target must be 'subject' or 'context'`);
}

function identifierArray(value: unknown, label: string, nonEmpty: boolean): string[] {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) throw new Error(`${label} must be a non-empty array`);
  return value.map((entry, index) => identifier(entry, `${label}[${index}]`));
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!plainObject(value)) throw new Error(`${label} must be an object`);
  return value;
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

function identifier(value: unknown, label: string): string {
  const result = string(value, label);
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(result)) throw new Error(`${label} must be a valid identifier`);
  return result;
}

function artifactKey(value: unknown, label: string): string {
  const result = string(value, label);
  if (!/^[A-Z][A-Za-z0-9]*$/.test(result)) throw new Error(`${label} must be a valid Artifact or Reference key`);
  return result;
}

function indexedError(index: number, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Reference edit transaction operation[${index}] failed: ${message}`, { cause: error });
}
