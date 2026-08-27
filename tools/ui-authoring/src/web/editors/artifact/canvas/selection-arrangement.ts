import { unionAuthoringRects } from "./alignment-guides.js";
import type { AuthoringRect } from "./node-authoring.js";

export type SelectionArrangement =
  | "alignLeft"
  | "alignHorizontalCenter"
  | "alignRight"
  | "alignTop"
  | "alignVerticalCenter"
  | "alignBottom"
  | "distributeHorizontal"
  | "distributeVertical";

export interface ArrangementEntry {
  readonly id: string;
  readonly rect: AuthoringRect;
}

export function arrangementTranslations(
  entries: readonly ArrangementEntry[],
  arrangement: SelectionArrangement,
): ReadonlyMap<string, readonly [number, number]> {
  const bounds = unionAuthoringRects(entries.map((entry) => entry.rect));
  if (!bounds || entries.length < 2) return new Map();
  if (arrangement === "distributeHorizontal") return distributionTranslations(entries, 0);
  if (arrangement === "distributeVertical") return distributionTranslations(entries, 1);
  const result = new Map<string, readonly [number, number]>();
  for (const entry of entries) {
    const rect = entry.rect;
    const dx =
      arrangement === "alignLeft"
        ? bounds.x - rect.x
        : arrangement === "alignHorizontalCenter"
          ? bounds.x + bounds.width / 2 - (rect.x + rect.width / 2)
          : arrangement === "alignRight"
            ? bounds.x + bounds.width - (rect.x + rect.width)
            : 0;
    const dy =
      arrangement === "alignTop"
        ? bounds.y - rect.y
        : arrangement === "alignVerticalCenter"
          ? bounds.y + bounds.height / 2 - (rect.y + rect.height / 2)
          : arrangement === "alignBottom"
            ? bounds.y + bounds.height - (rect.y + rect.height)
            : 0;
    result.set(entry.id, [dx, dy]);
  }
  return result;
}

function distributionTranslations(entries: readonly ArrangementEntry[], axis: 0 | 1): ReadonlyMap<string, readonly [number, number]> {
  if (entries.length < 3) return new Map();
  const sorted = [...entries].sort((left, right) => (axis === 0 ? left.rect.x - right.rect.x : left.rect.y - right.rect.y));
  const first = sorted[0]!.rect;
  const last = sorted[sorted.length - 1]!.rect;
  const start = axis === 0 ? first.x : first.y;
  const end = axis === 0 ? last.x + last.width : last.y + last.height;
  const occupied = sorted.reduce((sum, entry) => sum + (axis === 0 ? entry.rect.width : entry.rect.height), 0);
  const gap = (end - start - occupied) / (sorted.length - 1);
  let cursor = start;
  const result = new Map<string, readonly [number, number]>();
  for (const entry of sorted) {
    const current = axis === 0 ? entry.rect.x : entry.rect.y;
    result.set(entry.id, axis === 0 ? [cursor - current, 0] : [0, cursor - current]);
    cursor += (axis === 0 ? entry.rect.width : entry.rect.height) + gap;
  }
  return result;
}
