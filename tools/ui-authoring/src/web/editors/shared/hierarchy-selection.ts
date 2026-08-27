import { type SelectionAddress, sameSelectionAddress } from "../../rendering/selection.js";

export function hierarchySelectionRange(
  ordered: readonly SelectionAddress[],
  anchor: SelectionAddress,
  target: SelectionAddress,
): readonly SelectionAddress[] {
  const anchorIndex = ordered.findIndex((address) => sameSelectionAddress(address, anchor));
  const targetIndex = ordered.findIndex((address) => sameSelectionAddress(address, target));
  if (anchorIndex < 0 || targetIndex < 0) return [target];
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  const range = ordered.slice(start, end + 1);
  return targetIndex < anchorIndex ? range.reverse() : range;
}
