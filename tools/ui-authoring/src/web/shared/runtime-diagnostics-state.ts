import type { UiRuntimeDiagnostic } from "../../schema/ui-api.js";

export const RECENT_RUNTIME_ERROR_MS = 5 * 60 * 1000;
export const AGING_RUNTIME_ERROR_MS = 10 * 60 * 1000;

export type DiagnosticsTone = "danger" | "warning" | "muted";

export function runtimeTimestampMs(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isRuntimeTimestampAfter(timestamp: string, boundary: string): boolean {
  return runtimeTimestampMs(timestamp) > runtimeTimestampMs(boundary);
}

export function newestRuntimeTimestamp(entries: readonly UiRuntimeDiagnostic[]): string | undefined {
  let latest: string | undefined;
  for (const entry of entries) if (!latest || isRuntimeTimestampAfter(entry.timestamp, latest)) latest = entry.timestamp;
  return latest;
}

export function runtimeNotificationTone(
  entries: readonly UiRuntimeDiagnostic[],
  acknowledgedThrough: string | undefined,
  now: number,
): DiagnosticsTone {
  const latest = newestRuntimeTimestamp(
    acknowledgedThrough ? entries.filter((entry) => isRuntimeTimestampAfter(entry.timestamp, acknowledgedThrough)) : entries,
  );
  if (!latest) return "muted";
  const age = Math.max(0, now - runtimeTimestampMs(latest));
  if (age < RECENT_RUNTIME_ERROR_MS) return "danger";
  return age < AGING_RUNTIME_ERROR_MS ? "warning" : "muted";
}
