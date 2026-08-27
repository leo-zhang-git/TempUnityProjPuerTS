import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceSaveCoordinator, WorkspaceSaveAttemptError } from "../../src/web/application/workspace-save-coordinator.js";

class TestClock {
  #nextId = 1;
  #timers = new Map<number, { readonly callback: () => void; readonly delay: number }>();

  readonly setTimeout = (callback: () => void, delay: number): ReturnType<typeof setTimeout> => {
    const id = this.#nextId++;
    this.#timers.set(id, { callback, delay });
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  readonly clearTimeout = (handle: ReturnType<typeof setTimeout>): void => {
    this.#timers.delete(handle as unknown as number);
  };

  runNext(): void {
    const next = [...this.#timers].sort((left, right) => left[1].delay - right[1].delay || left[0] - right[0])[0];
    assert.ok(next, "expected a scheduled timer");
    this.#timers.delete(next[0]);
    next[1].callback();
  }

  get size(): number {
    return this.#timers.size;
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function turn(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test("coordinator debounces and unions scheduled document ids", async () => {
  const clock = new TestClock();
  const attempts: string[][] = [];
  const coordinator = createWorkspaceSaveCoordinator(
    async (ids) => {
      attempts.push([...ids].sort());
    },
    400,
    clock,
  );
  coordinator.schedule(["artifact:A"]);
  coordinator.schedule(["reference:R"]);
  assert.equal(clock.size, 1);
  assert.equal(coordinator.status.phase, "scheduled");
  clock.runNext();
  await turn();
  assert.deepEqual(attempts, [["artifact:A", "reference:R"]]);
  assert.equal(coordinator.status.phase, "idle");
});

test("coordinator serializes attempts and follows up edits made in flight", async () => {
  const clock = new TestClock();
  const first = deferred<void>();
  const attempts: string[][] = [];
  const coordinator = createWorkspaceSaveCoordinator(
    async (ids) => {
      attempts.push([...ids]);
      if (attempts.length === 1) await first.promise;
    },
    400,
    clock,
  );
  coordinator.schedule(["artifact:A"]);
  clock.runNext();
  coordinator.schedule(["artifact:A", "prototype:P"]);
  assert.equal(attempts.length, 1);
  first.resolve();
  await turn();
  assert.equal(clock.size, 1);
  clock.runNext();
  await turn();
  assert.deepEqual(attempts, [["artifact:A"], ["artifact:A", "prototype:P"]]);
});

test("flush during an in-flight attempt waits for a later snapshot", async () => {
  const clock = new TestClock();
  const first = deferred<void>();
  let attemptCount = 0;
  const coordinator = createWorkspaceSaveCoordinator(
    async () => {
      attemptCount += 1;
      if (attemptCount === 1) await first.promise;
    },
    400,
    clock,
  );
  coordinator.schedule(["artifact:A"]);
  clock.runNext();
  let settled = false;
  const flushed = coordinator.flush(["artifact:A"]).then((value) => {
    settled = true;
    return value;
  });
  first.resolve();
  await turn();
  assert.equal(settled, false);
  clock.runNext();
  await turn();
  assert.equal(await flushed, true);
  assert.equal(attemptCount, 2);
});

test("failure stops automatic retry until a new schedule", async () => {
  const clock = new TestClock();
  let attemptCount = 0;
  const coordinator = createWorkspaceSaveCoordinator(
    async () => {
      attemptCount += 1;
      if (attemptCount === 1) throw new Error("disk conflict");
    },
    400,
    clock,
  );
  coordinator.schedule(["reference:R"]);
  clock.runNext();
  await turn();
  assert.equal(coordinator.status.phase, "failed");
  assert.equal(coordinator.status.message, "disk conflict");
  assert.equal(clock.size, 0);
  coordinator.schedule(["reference:R"]);
  clock.runNext();
  await turn();
  assert.equal(attemptCount, 2);
  assert.equal(coordinator.status.phase, "idle");
});

test("dispose settles a pending flush", async () => {
  const clock = new TestClock();
  let attempts = 0;
  const coordinator = createWorkspaceSaveCoordinator(
    async () => {
      attempts += 1;
    },
    400,
    clock,
  );
  const flushed = coordinator.flush(["artifact:A"]);
  assert.equal(clock.size, 1);
  coordinator.dispose();
  assert.equal(await flushed, false);
  assert.equal(attempts, 0);
});

test("cancelScheduled preserves a newer pending version required by flush", async () => {
  const clock = new TestClock();
  let attempts = 0;
  const coordinator = createWorkspaceSaveCoordinator(
    async () => {
      attempts += 1;
    },
    400,
    clock,
  );
  const flushed = coordinator.flush(["artifact:A"]);
  coordinator.schedule(["artifact:A"]);
  coordinator.cancelScheduled();
  assert.equal(clock.size, 1);
  clock.runNext();
  await turn();
  assert.equal(await flushed, true);
  assert.equal(attempts, 1);
});

test("manual repair flush replaces a pending strict auto-save for the same document", async () => {
  const clock = new TestClock();
  const attempts: { readonly ids: readonly string[]; readonly mode: string }[] = [];
  const coordinator = createWorkspaceSaveCoordinator(
    async (ids, mode) => {
      attempts.push({ ids: [...ids], mode });
    },
    400,
    clock,
  );
  coordinator.schedule(["artifact:A"]);
  const flushed = coordinator.flush(["artifact:A"], "repair");
  clock.runNext();
  await turn();
  assert.equal(await flushed, true);
  assert.deepEqual(attempts, [{ ids: ["artifact:A"], mode: "repair" }]);
});

test("coordinator isolates repair and strict groups in one pending batch", async () => {
  const clock = new TestClock();
  const attempts: { readonly ids: readonly string[]; readonly mode: string }[] = [];
  const coordinator = createWorkspaceSaveCoordinator(
    async (ids, mode) => {
      attempts.push({ ids: [...ids], mode });
      if (mode === "strict") throw new Error("strict blocked");
    },
    400,
    clock,
  );
  const repaired = coordinator.flush(["reference:R"], "repair");
  coordinator.schedule(["artifact:A"]);
  clock.runNext();
  await turn();
  assert.equal(await repaired, true);
  assert.deepEqual(attempts, [
    { ids: ["reference:R"], mode: "repair" },
    { ids: ["artifact:A"], mode: "strict" },
  ]);
  assert.equal(coordinator.status.phase, "failed");
  assert.deepEqual([...coordinator.status.documentIds], ["artifact:A"]);
});

test("coordinator advances successful documents from a partial attempt", async () => {
  const clock = new TestClock();
  const attempts: string[][] = [];
  const coordinator = createWorkspaceSaveCoordinator(
    async (ids) => {
      attempts.push([...ids].sort());
      if (attempts.length === 1) throw new WorkspaceSaveAttemptError(new Set(["artifact:B"]), "B failed");
    },
    400,
    clock,
  );
  const first = coordinator.flush(["artifact:A", "artifact:B"]);
  clock.runNext();
  await turn();
  assert.equal(await first, false);
  assert.deepEqual([...coordinator.status.documentIds], ["artifact:B"]);

  const retry = coordinator.flush(["artifact:B"]);
  clock.runNext();
  await turn();
  assert.equal(await retry, true);
  assert.deepEqual(attempts, [["artifact:A", "artifact:B"], ["artifact:B"]]);
});
