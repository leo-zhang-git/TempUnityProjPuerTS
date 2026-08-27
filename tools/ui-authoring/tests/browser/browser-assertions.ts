export interface EventuallyOptions {
  readonly timeoutMs?: number | undefined;
  readonly intervalMs?: number | undefined;
  readonly message?: string | undefined;
}

export async function assertEventually(predicate: () => Promise<boolean>, options: EventuallyOptions = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const intervalMs = options.intervalMs ?? 25;
  const deadline = performance.now() + timeoutMs;
  let lastError: unknown;
  while (performance.now() < deadline) {
    try {
      if (await predicate()) return;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  if (lastError !== undefined) throw lastError;
  throw new Error(options.message ?? `Condition did not become true within ${timeoutMs}ms`);
}
