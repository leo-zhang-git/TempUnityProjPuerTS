import { spawn } from "node:child_process";

export interface RunProcessOptions {
  readonly windowsVerbatimArguments?: boolean;
  readonly timeoutMs?: number;
  readonly killTree?: boolean;
  readonly timeoutMessage?: string;
  readonly signal?: AbortSignal;
}

export function runProcess(
  command: string,
  args: readonly string[],
  cwd: string,
  options: RunProcessOptions = {},
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  if (options.signal?.aborted) return Promise.reject(new Error(`${command} was aborted`));
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      windowsVerbatimArguments: options.windowsVerbatimArguments,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let forceRejectHandle: NodeJS.Timeout | undefined;
    const abortError = new Error(`${command} was aborted`);
    const timeoutError = new Error(
      options.timeoutMessage ?? `${command} timed out after ${Math.round((options.timeoutMs ?? 0) / 1000)} seconds`,
    );
    const terminateChild = (): void => {
      if (process.platform === "win32" && options.killTree && child.pid) {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.once("error", () => child.kill());
      } else {
        child.kill("SIGKILL");
      }
    };
    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimers();
      reject(error);
    };
    const abortHandler = (): void => {
      if (settled || aborted) return;
      aborted = true;
      terminateChild();
      forceRejectHandle = setTimeout(() => rejectOnce(abortError), 5_000);
    };
    const clearTimers = (): void => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (forceRejectHandle) clearTimeout(forceRejectHandle);
      options.signal?.removeEventListener("abort", abortHandler);
    };
    const resolveOnce = (result: { readonly stdout: string; readonly stderr: string }): void => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve(result);
    };
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => rejectOnce(timedOut ? timeoutError : aborted ? abortError : error));
    child.once("exit", (code) => {
      if (timedOut) {
        rejectOnce(timeoutError);
        return;
      }
      if (aborted) {
        rejectOnce(abortError);
        return;
      }
      if (code === 0) {
        resolveOnce({ stdout, stderr });
        return;
      }
      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
      rejectOnce(new Error(`${command} exited with code ${code}${output ? `: ${output}` : ""}`));
    });
    if (options.timeoutMs !== undefined) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        terminateChild();
        forceRejectHandle = setTimeout(() => rejectOnce(timeoutError), 5_000);
      }, options.timeoutMs);
    }
    options.signal?.addEventListener("abort", abortHandler, { once: true });
    if (options.signal?.aborted) abortHandler();
  });
}
