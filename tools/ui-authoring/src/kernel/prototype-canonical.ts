import { Value } from "@sinclair/typebox/value";
import { type UiPrototype, UiPrototypeSchema, type UiReference, UiReferenceSchema } from "../schema/ui-prototype-schema.js";
import { artifactInitialSize } from "./artifact-size.js";
import { assertValidPrototypeShape, assertValidReferenceShape } from "./prototype.js";
import type { SourceCatalog } from "./source-catalog.js";

const REFERENCE_ORDER = [
  "referenceKey",
  "subjectArtifactKey",
  "values",
  "instanceValues",
  "statePreviewContexts",
  "context",
  "collections",
  "mounts",
  "viewport",
  "description",
  "backdrop",
];
const CONTEXT_ORDER = ["parentArtifactKey", "placement", "values"];
const OWNER_ORDER = ["kind", "root", "mountKey", "instancePath"];
const INSTANCE_VALUES_ORDER = ["owner", "referenceKey", "values"];
const COLLECTION_ORDER = ["key", "owner", "targetBinding", "groups"];
const COLLECTION_GROUP_ORDER = ["templateKey", "referenceKey", "values", "items", "count"];
const COLLECTION_ITEM_ORDER = ["key", "referenceKey", "values"];
const MOUNT_ORDER = ["key", "owner", "targetBinding", "artifactKey", "referenceKey", "values", "offset", "size"];
const BACKDROP_ORDER = ["images"];
const BACKDROP_IMAGE_ORDER = ["path", "viewport"];
const PROTOTYPE_ORDER = ["prototypeKey", "startReferenceKey", "interactions"];
const INTERACTION_ORDER = ["referenceKey", "trigger", "actions"];
const ACTION_ORDER = ["kind", "referenceKey", "owner", "fieldName", "capability", "value"];
const GRAPH_TARGET_ORDER = ["rootArtifactKey", "instancePath", "nodeId", "componentType"];

function clone<T>(value: T): T {
  return structuredClone(value);
}

function objectOrder(input: Record<string, unknown>): readonly string[] {
  if ("referenceKey" in input && "subjectArtifactKey" in input) return REFERENCE_ORDER;
  if ("parentArtifactKey" in input && "placement" in input) return CONTEXT_ORDER;
  if ("owner" in input && ("referenceKey" in input || "values" in input)) return INSTANCE_VALUES_ORDER;
  if ("targetBinding" in input && "groups" in input) return COLLECTION_ORDER;
  if ("templateKey" in input && ("items" in input || "count" in input)) return COLLECTION_GROUP_ORDER;
  if ("targetBinding" in input && "artifactKey" in input) return MOUNT_ORDER;
  if (("referenceKey" in input || "values" in input) && !("kind" in input) && !("subjectArtifactKey" in input))
    return COLLECTION_ITEM_ORDER;
  if ("kind" in input && ("root" in input || "mountKey" in input || Object.keys(input).length === 1)) return OWNER_ORDER;
  if ("path" in input && "viewport" in input) return BACKDROP_IMAGE_ORDER;
  if ("images" in input) return BACKDROP_ORDER;
  if ("prototypeKey" in input && "startReferenceKey" in input) return PROTOTYPE_ORDER;
  if ("trigger" in input && "actions" in input) return INTERACTION_ORDER;
  if ("kind" in input) return ACTION_ORDER;
  if ("rootArtifactKey" in input && "nodeId" in input) return GRAPH_TARGET_ORDER;
  return [];
}

function normalizeValue(value: unknown, parentKey = ""): unknown {
  if (Array.isArray(value)) return value.map((entry) => normalizeValue(entry));
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && parentKey === "path") return value.replaceAll("\\", "/");
    return value;
  }
  const input = value as Record<string, unknown>;
  const order = objectOrder(input);
  const preserveRecordOrder = parentKey === "values";
  const keys = preserveRecordOrder
    ? Object.keys(input)
    : Object.keys(input).sort((left, right) => {
        const leftIndex = order.indexOf(left);
        const rightIndex = order.indexOf(right);
        if (leftIndex >= 0 || rightIndex >= 0) {
          return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
        }
        return left.localeCompare(right);
      });
  return Object.fromEntries(keys.map((key) => [key, normalizeValue(input[key], key)]));
}

function stripDefaults<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripDefaults) as T;
  if (!value || typeof value !== "object") return value;
  const output = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, stripDefaults(entry)]),
  ) as Record<string, unknown>;
  if (Array.isArray(output.instancePath) && output.instancePath.length === 0) delete output.instancePath;
  for (const key of ["instanceValues", "collections", "mounts"] as const) {
    if (Array.isArray(output[key]) && output[key].length === 0) delete output[key];
  }
  return output as T;
}

function canonicalReference(reference: UiReference): UiReference {
  assertValidReferenceShape(reference);
  const resolved = Value.Default(UiReferenceSchema, clone(reference)) as UiReference;
  const normalized = normalizeValue(stripDefaults(resolved)) as UiReference;
  assertValidReferenceShape(normalized);
  return normalized;
}

export function normalizeReference(reference: UiReference, sourceCatalog: SourceCatalog): UiReference {
  const result = clone(reference);
  const subject = sourceCatalog.entries.get(result.subjectArtifactKey)?.resolvedSource;
  const baselineViewport = subject ? artifactInitialSize(subject) : undefined;
  if (
    result.viewport &&
    subject?.artifactType === "Canvas" &&
    baselineViewport &&
    result.viewport[0] === baselineViewport[0] &&
    result.viewport[1] === baselineViewport[1]
  ) {
    delete result.viewport;
  }
  return canonicalReference(result);
}

function canonicalPrototype(prototype: UiPrototype): UiPrototype {
  assertValidPrototypeShape(prototype);
  const resolved = Value.Default(UiPrototypeSchema, clone(prototype)) as UiPrototype;
  const normalized = normalizeValue(stripDefaults(resolved)) as UiPrototype;
  assertValidPrototypeShape(normalized);
  return normalized;
}

export function formatReference(reference: UiReference, sourceCatalog?: SourceCatalog): string {
  const normalized = sourceCatalog ? normalizeReference(reference, sourceCatalog) : canonicalReference(reference);
  return `${JSON.stringify(normalized, null, 2)}\n`;
}

export function formatPrototype(prototype: UiPrototype): string {
  return `${JSON.stringify(canonicalPrototype(prototype), null, 2)}\n`;
}

export function parseReference(text: string): UiReference {
  const value = JSON.parse(text) as unknown;
  assertValidReferenceShape(value);
  return value;
}

export function parsePrototype(text: string): UiPrototype {
  const value = JSON.parse(text) as unknown;
  assertValidPrototypeShape(value);
  return value;
}
