export const DELIVERY_STATE_ROOT = "My project/UIAuthoring/DeliveryState";

export interface DeliveryState {
  readonly prefabGuid: string;
  readonly nodes: Readonly<Record<string, string>>;
}

export function deliveryStatePath(artifactKey: string): string {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(artifactKey)) throw new Error(`Invalid DeliveryState Artifact key '${artifactKey}'`);
  return `${DELIVERY_STATE_ROOT}/${artifactKey}.ui-delivery-state.json`;
}

export function parseDeliveryState(value: unknown): DeliveryState {
  const input = record(value, "DeliveryState");
  exactKeys(input, ["prefabGuid", "nodes"]);
  const prefabGuid = nonEmptyString(input.prefabGuid, "DeliveryState.prefabGuid");
  if (!/^[0-9a-fA-F]{32}$/.test(prefabGuid)) throw new Error("DeliveryState.prefabGuid must be a Unity GUID");
  const nodeInput = record(input.nodes, "DeliveryState.nodes");
  const nodes = Object.fromEntries(
    Object.entries(nodeInput)
      .map(
        ([nodeId, localFileId]) =>
          [nonEmptyString(nodeId, "DeliveryState node id"), nonEmptyString(localFileId, `DeliveryState.nodes.${nodeId}`)] as const,
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  ensureUnique(Object.keys(nodes).map(nodeIdKey), "case-insensitive node ids");
  ensureUnique(Object.values(nodes), "local fileIDs");
  return {
    prefabGuid: prefabGuid.toLowerCase(),
    nodes,
  };
}

export function formatDeliveryState(state: DeliveryState): string {
  return `${JSON.stringify(parseDeliveryState(state), null, 2)}\n`;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(input: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(input)) if (!allowedSet.has(key)) throw new Error(`DeliveryState has unknown property '${key}'`);
  for (const key of allowed) if (!Object.hasOwn(input, key)) throw new Error(`DeliveryState is missing '${key}'`);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function ensureUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`DeliveryState contains duplicate ${label}`);
}

import { nodeIdKey } from "./naming.js";
