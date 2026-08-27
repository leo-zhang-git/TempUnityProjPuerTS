export type NumericScrubKind = "float" | "integer";
export type NumericScrubAxis = "x" | "y";

export const NUMERIC_SCRUB_DEAD_ZONE = 4;
const UNITY_DRAG_SENSITIVITY = Math.fround(0.03);

export interface NumericScrubDelta {
  readonly axis: NumericScrubAxis;
  readonly value: number;
}

export function numericScrubAcceleration(shiftPressed: boolean, altPressed: boolean): number {
  return (shiftPressed ? 4 : 1) * (altPressed ? 0.25 : 1);
}

export function numericScrubNiceDelta(
  deviceX: number,
  deviceY: number,
  acceleration: number,
  previousAxis: NumericScrubAxis,
): NumericScrubDelta {
  const x = deviceX;
  const y = -deviceY;
  const maximum = Math.max(Math.abs(x), Math.abs(y));
  let axis = previousAxis;
  if (maximum > 0 && Math.abs(Math.abs(x) - Math.abs(y)) / maximum > 0.1) {
    axis = Math.abs(x) > Math.abs(y) ? "x" : "y";
  }
  const sign = Math.sign(axis === "x" ? x : y);
  return { axis, value: sign * Math.hypot(x, y) * acceleration };
}

export function numericScrubSensitivity(startValue: number, kind: NumericScrubKind): number {
  if (!Number.isFinite(startValue)) return 0;
  const scaled = Math.sqrt(Math.abs(startValue)) * UNITY_DRAG_SENSITIVITY;
  return kind === "integer" ? Math.max(1, Math.trunc(scaled)) : Math.max(1, Math.sqrt(Math.abs(startValue))) * UNITY_DRAG_SENSITIVITY;
}

function roundHalfToEven(value: number): number {
  const sign = Math.sign(value) || 1;
  const absolute = Math.abs(value);
  const lower = Math.floor(absolute);
  const fraction = absolute - lower;
  if (fraction < 0.5) return sign * lower;
  if (fraction > 0.5) return sign * (lower + 1);
  return sign * (lower % 2 === 0 ? lower : lower + 1);
}

function roundAwayFromZero(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  return (scaled < 0 ? -Math.round(-scaled) : Math.round(scaled)) / factor;
}

export function roundNumericScrubValue(value: number, sensitivity: number, kind: NumericScrubKind): number {
  if (kind === "integer") return roundHalfToEven(value);
  if (!Number.isFinite(value) || !Number.isFinite(sensitivity) || sensitivity === 0) return value;
  const decimals = Math.min(15, Math.max(0, -Math.floor(Math.log10(Math.abs(sensitivity)))));
  return roundAwayFromZero(value, decimals);
}

export function clampNumericScrubValue(value: number, minimum?: number, maximum?: number): number {
  const aboveMinimum = minimum === undefined ? value : Math.max(minimum, value);
  return maximum === undefined ? aboveMinimum : Math.min(maximum, aboveMinimum);
}

export function applyNumericScrubDelta(
  currentValue: number,
  niceDelta: number,
  sensitivity: number,
  kind: NumericScrubKind,
  minimum?: number,
  maximum?: number,
): number {
  const delta = kind === "integer" ? roundHalfToEven(niceDelta * sensitivity) : niceDelta * sensitivity;
  return clampNumericScrubValue(roundNumericScrubValue(currentValue + delta, sensitivity, kind), minimum, maximum);
}
