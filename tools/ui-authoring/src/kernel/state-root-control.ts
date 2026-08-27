import type { UiConcreteSource } from "../schema/ui-source-schema.js";
import { walkNodes } from "./tree.js";

export interface StateRootActiveControl {
  readonly stateRootNodeId: string;
  readonly currentState: string;
  readonly currentValue: boolean | undefined;
  readonly values: Readonly<Record<string, boolean | undefined>>;
}

export interface StateRootPreviewContextResolution {
  readonly states: Readonly<Record<string, string>>;
  readonly automaticStates: Readonly<Record<string, string>>;
  readonly issues: readonly string[];
}

export type StateRootPreviewContexts = Readonly<Record<string, Readonly<Record<string, string>>>>;

const activeControlIndexCache = new WeakMap<UiConcreteSource, ReadonlyMap<string, readonly StateRootActiveControl[]>>();

export function stateRootActiveControlIndex(source: UiConcreteSource): ReadonlyMap<string, readonly StateRootActiveControl[]> {
  const cached = activeControlIndexCache.get(source);
  if (cached) return cached;
  const result = new Map<string, StateRootActiveControl[]>();
  for (const { node } of walkNodes(source)) {
    const stateRoot = node.components?.StateRoot;
    if (!stateRoot) continue;
    const stateNames = Object.keys(stateRoot.states);
    const targetNodeIds = new Set(stateNames.flatMap((stateName) => Object.keys(stateRoot.states[stateName] ?? {})));
    for (const targetNodeId of targetNodeIds) {
      const values = Object.fromEntries(stateNames.map((stateName) => [stateName, stateRoot.states[stateName]?.[targetNodeId]]));
      const controls = result.get(targetNodeId) ?? [];
      controls.push({
        stateRootNodeId: node.id,
        currentState: stateRoot.currentState,
        currentValue: stateRoot.states[stateRoot.currentState]?.[targetNodeId],
        values,
      });
      result.set(targetNodeId, controls);
    }
  }
  activeControlIndexCache.set(source, result);
  return result;
}

export function stateRootActiveControllers(source: UiConcreteSource, nodeId: string): readonly StateRootActiveControl[] {
  return stateRootActiveControlIndex(source).get(nodeId) ?? [];
}

export function resolveStateRootPreviewContext(
  source: UiConcreteSource,
  targetStateRootNodeId: string,
  contexts: StateRootPreviewContexts | undefined,
): StateRootPreviewContextResolution {
  const entries = walkNodes(source);
  const stateRoots = new Map(
    entries.flatMap(({ node }) => (node.components?.StateRoot ? [[node.id, node.components.StateRoot] as const] : [])),
  );
  const targetEntry = entries.find(({ node }) => node.id === targetStateRootNodeId);
  const issues: string[] = [];
  if (!targetEntry?.node.components?.StateRoot) {
    return {
      states: {},
      automaticStates: {},
      issues: [`State preview target '${targetStateRootNodeId}' has no StateRoot component`],
    };
  }

  const requirements = new Map<string, Set<string>>();
  const controlIndex = stateRootActiveControlIndex(source);
  for (const pathNodeId of targetEntry.path) {
    for (const control of controlIndex.get(pathNodeId) ?? []) {
      if (control.stateRootNodeId === targetStateRootNodeId) continue;
      const controlledTargets = requirements.get(control.stateRootNodeId) ?? new Set<string>();
      controlledTargets.add(pathNodeId);
      requirements.set(control.stateRootNodeId, controlledTargets);
    }
  }

  const automatic = new Map<string, string>();
  for (const { node } of entries) {
    const requiredTargets = requirements.get(node.id);
    const stateRoot = node.components?.StateRoot;
    if (!requiredTargets || !stateRoot) continue;
    const stateNames = Object.keys(stateRoot.states);
    const candidates = stateNames.filter((stateName) =>
      [...requiredTargets].every((targetNodeId) => stateRoot.states[stateName]?.[targetNodeId] === true),
    );
    const selected = candidates.includes(stateRoot.currentState) ? stateRoot.currentState : candidates[0];
    if (selected) automatic.set(node.id, selected);
    else {
      issues.push(
        `StateRoot '${node.id}' has no state that makes '${[...requiredTargets].join("', '")}' active for '${targetStateRootNodeId}'`,
      );
    }
  }

  const explicit = contexts?.[targetStateRootNodeId] ?? {};
  for (const [stateRootNodeId, stateName] of Object.entries(explicit)) {
    if (stateRootNodeId === targetStateRootNodeId) {
      issues.push(`State preview context '${targetStateRootNodeId}' cannot override its own state`);
      continue;
    }
    const stateRoot = stateRoots.get(stateRootNodeId);
    if (!stateRoot) {
      issues.push(`State preview context '${targetStateRootNodeId}' references missing StateRoot '${stateRootNodeId}'`);
      continue;
    }
    if (!stateRoot.states[stateName]) {
      issues.push(`State preview context '${targetStateRootNodeId}' references missing state '${stateRootNodeId}.${stateName}'`);
    }
  }

  const states = new Map(automatic);
  for (const { node } of entries) {
    const stateName = explicit[node.id];
    if (node.id !== targetStateRootNodeId && stateName && stateRoots.get(node.id)?.states[stateName]) states.set(node.id, stateName);
  }
  return {
    states: Object.fromEntries(states),
    automaticStates: Object.fromEntries(automatic),
    issues,
  };
}

export function stateRootPreviewContextIssues(source: UiConcreteSource, contexts: StateRootPreviewContexts | undefined): readonly string[] {
  if (!contexts) return [];
  const stateRootIds = new Set(walkNodes(source).flatMap(({ node }) => (node.components?.StateRoot ? [node.id] : [])));
  const issues: string[] = [];
  for (const targetStateRootNodeId of Object.keys(contexts)) {
    if (!stateRootIds.has(targetStateRootNodeId)) {
      issues.push(`State preview context target '${targetStateRootNodeId}' has no StateRoot component`);
      continue;
    }
    issues.push(
      ...resolveStateRootPreviewContext(source, targetStateRootNodeId, contexts).issues.filter(
        (issue) => issue.includes("references missing") || issue.includes("cannot override its own state"),
      ),
    );
  }
  return issues;
}
