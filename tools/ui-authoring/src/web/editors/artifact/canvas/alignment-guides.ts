import type { AuthoringRect } from "./node-authoring.js";

export interface AlignmentGuide {
  readonly axis: "x" | "y";
  readonly position: number;
  readonly start: number;
  readonly end: number;
}

export interface AlignmentSnapResult {
  readonly delta: readonly [number, number];
  readonly guides: readonly AlignmentGuide[];
}

interface AxisCandidate {
  readonly value: number;
  readonly start: number;
  readonly end: number;
}

interface AxisSnap {
  readonly correction: number;
  readonly moving: AxisCandidate;
  readonly target: AxisCandidate;
  readonly kind: "alignment" | "grid";
}

const SNAP_DISTANCE_EPSILON = 0.001;

function horizontalCandidates(rect: AuthoringRect): readonly AxisCandidate[] {
  return [
    { value: rect.x, start: rect.y, end: rect.y + rect.height },
    { value: rect.x + rect.width / 2, start: rect.y, end: rect.y + rect.height },
    { value: rect.x + rect.width, start: rect.y, end: rect.y + rect.height },
  ];
}

function verticalCandidates(rect: AuthoringRect): readonly AxisCandidate[] {
  return [
    { value: rect.y, start: rect.x, end: rect.x + rect.width },
    { value: rect.y + rect.height / 2, start: rect.x, end: rect.x + rect.width },
    { value: rect.y + rect.height, start: rect.x, end: rect.x + rect.width },
  ];
}

function closestAxisSnap(
  moving: readonly AxisCandidate[],
  targets: readonly AxisCandidate[],
  delta: number,
  threshold: number,
): AxisSnap | undefined {
  let closest: AxisSnap | undefined;
  for (const movingCandidate of moving) {
    for (const target of targets) {
      const correction = target.value - (movingCandidate.value + delta);
      if (Math.abs(correction) > threshold || (closest && Math.abs(correction) >= Math.abs(closest.correction))) continue;
      closest = { correction, moving: movingCandidate, target, kind: "alignment" };
    }
  }
  return closest;
}

function closestAxisGridSnap(moving: readonly AxisCandidate[], delta: number, gridSize: number): AxisSnap | undefined {
  if (!Number.isFinite(gridSize) || gridSize <= 0) return undefined;
  let closest: AxisSnap | undefined;
  for (const movingCandidate of moving) {
    const movedValue = movingCandidate.value + delta;
    const targetValue = Math.round(movedValue / gridSize) * gridSize;
    const correction = targetValue - movedValue;
    if (closest && Math.abs(correction) >= Math.abs(closest.correction)) continue;
    closest = {
      correction,
      moving: movingCandidate,
      target: { value: targetValue, start: 0, end: 0 },
      kind: "grid",
    };
  }
  return closest;
}

function closestSnap(alignment: AxisSnap | undefined, grid: AxisSnap | undefined): AxisSnap | undefined {
  if (!alignment) return grid;
  if (!grid || Math.abs(alignment.correction) <= Math.abs(grid.correction) + SNAP_DISTANCE_EPSILON) return alignment;
  return grid;
}

export function unionAuthoringRects(rects: readonly AuthoringRect[]): AuthoringRect | undefined {
  if (rects.length === 0) return undefined;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function snapRectToAlignmentGuides(
  movingBounds: AuthoringRect,
  requestedDelta: readonly [number, number],
  targets: readonly AuthoringRect[],
  threshold: number,
  gridSize?: number,
): AlignmentSnapResult {
  const movingX = horizontalCandidates(movingBounds);
  const movingY = verticalCandidates(movingBounds);
  const xSnap = closestSnap(
    closestAxisSnap(movingX, targets.flatMap(horizontalCandidates), requestedDelta[0], threshold),
    gridSize === undefined ? undefined : closestAxisGridSnap(movingX, requestedDelta[0], gridSize),
  );
  const ySnap = closestSnap(
    closestAxisSnap(movingY, targets.flatMap(verticalCandidates), requestedDelta[1], threshold),
    gridSize === undefined ? undefined : closestAxisGridSnap(movingY, requestedDelta[1], gridSize),
  );
  const delta: readonly [number, number] = [requestedDelta[0] + (xSnap?.correction ?? 0), requestedDelta[1] + (ySnap?.correction ?? 0)];
  const guides: AlignmentGuide[] = [];
  if (xSnap?.kind === "alignment") {
    guides.push({
      axis: "x",
      position: xSnap.target.value,
      start: Math.min(xSnap.moving.start + delta[1], xSnap.target.start),
      end: Math.max(xSnap.moving.end + delta[1], xSnap.target.end),
    });
  }
  if (ySnap?.kind === "alignment") {
    guides.push({
      axis: "y",
      position: ySnap.target.value,
      start: Math.min(ySnap.moving.start + delta[0], ySnap.target.start),
      end: Math.max(ySnap.moving.end + delta[0], ySnap.target.end),
    });
  }
  return { delta, guides };
}
