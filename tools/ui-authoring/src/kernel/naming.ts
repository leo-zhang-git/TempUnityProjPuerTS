import type { UiNode, UiNodeIdMode } from "../schema/ui-source-schema.js";

const nodeIdCharactersPattern = /^[A-Za-z0-9_$]+$/;

export function nodeIdKey(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

export function explainChildNodeIdIssue(value: string): string | undefined {
  if (value.length === 0) return "Node id 不能为空";
  if (!nodeIdCharactersPattern.test(value)) return "Node id 只能包含英文字母、数字、_ 或 $";
  if (!/^[a-z_$]/.test(value)) return "Node id 首字符必须是小写英文字母、_ 或 $";
  return undefined;
}

export function isChildNodeId(value: string): boolean {
  return explainChildNodeIdIssue(value) === undefined;
}

export function displayNameToNodeIdBase(displayName: string): string {
  const parts = displayName.match(/[A-Za-z0-9_$]+/g) ?? [];
  const joined = parts
    .map((part, index) => {
      if (part.length === 0) return part;
      const first = part[0]!;
      if (index === 0 && /[A-Z]/.test(first)) return `${first.toLowerCase()}${part.slice(1)}`;
      if (index > 0 && /[a-z]/.test(first)) return `${first.toUpperCase()}${part.slice(1)}`;
      return part;
    })
    .join("");
  const base = joined.length === 0 ? "node" : joined;
  return /^[0-9]/.test(base) ? `_${base}` : base;
}

export function allocateNodeId(base: string, reservedIds: Iterable<string>, excludedCurrentId?: string): string {
  const candidateBase = isChildNodeId(base) ? base : displayNameToNodeIdBase(base);
  const excludedKey = excludedCurrentId === undefined ? undefined : nodeIdKey(excludedCurrentId);
  const reserved = new Set([...reservedIds].map(nodeIdKey).filter((key) => key !== excludedKey));
  if (!reserved.has(nodeIdKey(candidateBase))) return candidateBase;
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const candidate = `${candidateBase}_${suffix}`;
    if (!reserved.has(nodeIdKey(candidate))) return candidate;
  }
  throw new Error(`Unable to allocate a unique node id for '${base}'`);
}

export function allocateDuplicateNodeId(nodeId: string, reservedIds: Iterable<string>): string {
  const reserved = new Set([...reservedIds].map(nodeIdKey));
  const numbered = /^(.*)_([0-9]+)$/.exec(nodeId);
  const stem = numbered?.[1] || nodeId;
  const firstSuffix = numbered ? Number(numbered[2]) + 1 : 1;
  for (let suffix = firstSuffix; suffix < 10_000; suffix += 1) {
    const candidate = `${stem}_${suffix}`;
    if (!reserved.has(nodeIdKey(candidate))) return candidate;
  }
  throw new Error(`Unable to allocate a duplicate node id for '${nodeId}'`);
}

export function effectiveNodeIdMode(node: Pick<UiNode, "idMode">): UiNodeIdMode {
  return node.idMode === "manual" ? "manual" : "auto";
}

export function isDisplayNameAlignedNodeId(nodeId: string, displayName: string): boolean {
  const base = displayNameToNodeIdBase(displayName);
  if (nodeId === base) return true;
  return nodeId.startsWith(`${base}_`) && /^[1-9][0-9]*$/.test(nodeId.slice(base.length + 1));
}

export function unityNodeName(node: Pick<UiNode, "id" | "name">): string {
  if (node.name) return node.name;
  return node.id.length > 0 ? `${node.id[0]!.toUpperCase()}${node.id.slice(1)}` : node.id;
}
