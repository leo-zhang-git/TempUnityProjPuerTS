import assert from "node:assert/strict";
import test from "node:test";
import type { UiRuntimeDiagnostic } from "../../src/schema/ui-api.js";
import {
  AGING_RUNTIME_ERROR_MS,
  isRuntimeTimestampAfter,
  newestRuntimeTimestamp,
  RECENT_RUNTIME_ERROR_MS,
  runtimeNotificationTone,
} from "../../src/web/shared/runtime-diagnostics-state.js";

const now = Date.parse("2026-07-31T08:00:00.000Z");

function errorAt(timestamp: number, id: string): UiRuntimeDiagnostic {
  return { id, timestamp: new Date(timestamp).toISOString(), level: "error", source: "client", message: id };
}

test("runtime notification tone follows the five and ten minute boundaries", () => {
  assert.equal(runtimeNotificationTone([errorAt(now - RECENT_RUNTIME_ERROR_MS + 1, "recent")], undefined, now), "danger");
  assert.equal(runtimeNotificationTone([errorAt(now - RECENT_RUNTIME_ERROR_MS, "aging")], undefined, now), "warning");
  assert.equal(runtimeNotificationTone([errorAt(now - AGING_RUNTIME_ERROR_MS + 1, "warning")], undefined, now), "warning");
  assert.equal(runtimeNotificationTone([errorAt(now - AGING_RUNTIME_ERROR_MS, "stale")], undefined, now), "muted");
});

test("acknowledgement mutes current errors while later errors alert again", () => {
  const acknowledged = errorAt(now - 60_000, "acknowledged");
  assert.equal(runtimeNotificationTone([acknowledged], acknowledged.timestamp, now), "muted");

  const next = errorAt(now - 30_000, "next");
  assert.equal(runtimeNotificationTone([acknowledged, next], acknowledged.timestamp, now), "danger");
  assert.equal(newestRuntimeTimestamp([next, acknowledged]), next.timestamp);
  assert.equal(isRuntimeTimestampAfter(next.timestamp, acknowledged.timestamp), true);
});
