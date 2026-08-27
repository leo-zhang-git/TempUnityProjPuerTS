export interface SelectionAddress {
  readonly rootArtifactKey: string;
  readonly instancePath: readonly string[];
  readonly ownerArtifactKey: string;
  readonly nodeId: string;
}

export interface SelectionCycleState {
  readonly x: number;
  readonly y: number;
  readonly keys: readonly string[];
  readonly index: number;
}

export type SelectionUpdateMode = "replace" | "toggle";

export interface SelectionSet {
  readonly primary: SelectionAddress;
  readonly addresses: readonly SelectionAddress[];
}

export function selectionAddressKey(address: SelectionAddress): string {
  return JSON.stringify([address.rootArtifactKey, address.instancePath, address.ownerArtifactKey, address.nodeId]);
}

export function isSelectionAddressRendered(address: SelectionAddress): boolean {
  const key = selectionAddressKey(address);
  return [...document.querySelectorAll<HTMLElement>("[data-selection-address]")].some(
    (element) => element.dataset.selectionAddress === key,
  );
}

export function sameSelectionAddress(left: SelectionAddress | undefined, right: SelectionAddress | undefined): boolean {
  return Boolean(left && right && selectionAddressKey(left) === selectionAddressKey(right));
}

export function selectionIncludes(addresses: readonly SelectionAddress[], address: SelectionAddress): boolean {
  const key = selectionAddressKey(address);
  return addresses.some((candidate) => selectionAddressKey(candidate) === key);
}

export function sameSelectionScope(left: SelectionAddress, right: SelectionAddress): boolean {
  return (
    left.rootArtifactKey === right.rootArtifactKey &&
    left.ownerArtifactKey === right.ownerArtifactKey &&
    left.instancePath.length === right.instancePath.length &&
    left.instancePath.every((entry, index) => entry === right.instancePath[index])
  );
}

export function selectionAddressesShareScope(addresses: readonly SelectionAddress[]): boolean {
  const first = addresses[0];
  return !first || addresses.every((address) => sameSelectionScope(first, address));
}

export function updateSelectionSet(
  current: SelectionSet,
  address: SelectionAddress,
  mode: SelectionUpdateMode,
  fallback: SelectionAddress,
): SelectionSet {
  if (mode === "replace") return { primary: address, addresses: [address] };
  const key = selectionAddressKey(address);
  const retained = current.addresses.filter((candidate) => selectionAddressKey(candidate) !== key);
  if (retained.length === current.addresses.length) return { primary: address, addresses: [...current.addresses, address] };
  if (retained.length === 0) return { primary: fallback, addresses: [fallback] };
  return {
    primary: sameSelectionAddress(current.primary, address) ? retained[retained.length - 1]! : current.primary,
    addresses: retained,
  };
}

export function normalizeExclusiveSelectionSet(current: SelectionSet, exclusive: SelectionAddress): SelectionSet {
  const exclusiveKey = selectionAddressKey(exclusive);
  const exclusiveSelection = current.addresses.find((address) => selectionAddressKey(address) === exclusiveKey);
  if (!exclusiveSelection) return current;

  if (sameSelectionAddress(current.primary, exclusiveSelection)) {
    if (current.addresses.length === 1 && sameSelectionAddress(current.addresses[0], exclusiveSelection)) return current;
    return { primary: exclusiveSelection, addresses: [exclusiveSelection] };
  }

  const addresses = current.addresses.filter((address) => selectionAddressKey(address) !== exclusiveKey);
  if (addresses.length === 0) return { primary: exclusiveSelection, addresses: [exclusiveSelection] };
  const primary = addresses.some((address) => sameSelectionAddress(address, current.primary))
    ? current.primary
    : addresses[addresses.length - 1]!;
  return { primary, addresses };
}

export function parseSelectionAddress(value: string | undefined): SelectionAddress | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 4) return undefined;
    const [rootArtifactKey, instancePath, ownerArtifactKey, nodeId] = parsed;
    if (
      typeof rootArtifactKey !== "string" ||
      !Array.isArray(instancePath) ||
      instancePath.some((entry) => typeof entry !== "string") ||
      typeof ownerArtifactKey !== "string" ||
      typeof nodeId !== "string"
    )
      return undefined;
    return { rootArtifactKey, instancePath, ownerArtifactKey, nodeId };
  } catch {
    return undefined;
  }
}

export function selectionAddressesAtPoint(document: Document, x: number, y: number): SelectionAddress[] {
  const result: SelectionAddress[] = [];
  const seen = new Set<string>();
  for (const element of document.elementsFromPoint(x, y)) {
    if (!(element instanceof HTMLElement)) continue;
    const address = parseSelectionAddress(element.dataset.selectionAddress);
    if (!address) continue;
    const key = selectionAddressKey(address);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(address);
  }
  return result;
}

export function nextSelectionInCycle(
  previous: SelectionCycleState | undefined,
  point: readonly [number, number],
  addresses: readonly SelectionAddress[],
): { readonly address: SelectionAddress | undefined; readonly state: SelectionCycleState | undefined } {
  if (addresses.length === 0) return { address: undefined, state: undefined };
  const keys = addresses.map(selectionAddressKey);
  const samePoint = previous && Math.hypot(previous.x - point[0], previous.y - point[1]) <= 3;
  const sameStack = samePoint && previous.keys.length === keys.length && previous.keys.every((key, index) => key === keys[index]);
  const index = sameStack ? (previous.index + 1) % addresses.length : 0;
  return { address: addresses[index], state: { x: point[0], y: point[1], keys, index } };
}
