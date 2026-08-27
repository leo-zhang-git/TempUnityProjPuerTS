import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { UiUnityJobProgressStep } from "../../schema/ui-unity-job.js";
import type { WorkspacePaths } from "../workspace.js";
import type { UnityBridgeResponse, UnityJobExecutor } from "./contracts.js";
import { runProcess } from "./process.js";

// The Editor bridge refreshes the AssetDatabase before claiming. That refresh can
// trigger compilation and a domain reload, so the claim window must cover both.
export const EDITOR_CLAIM_TIMEOUT_MS = 60_000;
export const BATCH_TIMEOUT_MS = 180_000;
const BATCH_ARTIFACT_BUDGET_MS = 4_000;
export const MAX_BATCH_TIMEOUT_MS = 900_000;

export interface WorkspaceUnityJobExecutorOptions {
  readonly editorClaimTimeoutMs?: number;
  readonly batchTimeoutMs?: number;
}

interface UnityProcessStatus {
  readonly unityProcesses?: {
    readonly editor?: { readonly running?: boolean; readonly currentProject?: boolean };
    readonly batchMode?: { readonly running?: boolean; readonly currentProject?: boolean };
  };
}

interface BridgeProgressMonitorState {
  previous: string;
}

export class WorkspaceUnityJobExecutor implements UnityJobExecutor {
  constructor(
    readonly paths: WorkspacePaths,
    readonly options: WorkspaceUnityJobExecutorOptions = {},
  ) {}

  async execute(
    requestPath: string,
    resultPath: string,
    logPath: string,
    signal?: AbortSignal,
    onProgress?: (progress: UiUnityJobProgressStep) => void,
  ): Promise<UnityBridgeResponse> {
    const progressPath = join(dirname(repositoryPath(this.paths.repoRoot, requestPath)), "progress.json");
    const progressState: BridgeProgressMonitorState = { previous: "" };
    const progressController = new AbortController();
    const progress = onProgress ? monitorBridgeProgress(progressPath, onProgress, progressController.signal, progressState) : undefined;
    try {
      return await this.#execute(requestPath, resultPath, logPath, signal);
    } finally {
      progressController.abort();
      await progress;
      if (onProgress) await reportBridgeProgress(progressPath, onProgress, progressState);
    }
  }

  async #execute(requestPath: string, resultPath: string, logPath: string, signal?: AbortSignal): Promise<UnityBridgeResponse> {
    let status: UnityProcessStatus;
    try {
      status = await unityProcessStatus(this.paths.repoRoot, signal);
    } catch (error) {
      const requestState = await cancelUnclaimedRequest(this.paths.repoRoot, requestPath, resultPath);
      if (requestState === "claimed" || requestState === "completed") {
        return await waitForBridgeResponse(repositoryPath(this.paths.repoRoot, resultPath));
      }
      throw error;
    }

    const editor = status.unityProcesses?.editor;
    if (editor?.running === true && editor.currentProject === true) {
      await waitForEditorClaim(
        this.paths.repoRoot,
        requestPath,
        resultPath,
        this.options.editorClaimTimeoutMs ?? EDITOR_CLAIM_TIMEOUT_MS,
        signal,
      );
      return await waitForBridgeResponse(repositoryPath(this.paths.repoRoot, resultPath));
    }

    const batchMode = status.unityProcesses?.batchMode;
    if (batchMode?.running === true && batchMode.currentProject === true) {
      await cancelUnclaimedRequest(this.paths.repoRoot, requestPath, resultPath);
      throw new Error("当前 Unity 工程已有 batchMode 任务，等待其结束后重试");
    }

    try {
      const timeoutMs = this.options.batchTimeoutMs ?? (await batchModeTimeoutMs(this.paths.repoRoot, requestPath));
      await runBatchMode(this.paths.repoRoot, requestPath, logPath, timeoutMs, signal);
      return await readBridgeResponse(repositoryPath(this.paths.repoRoot, resultPath));
    } catch (error) {
      await cancelUnclaimedRequest(this.paths.repoRoot, requestPath, resultPath);
      throw await withUnityLogSummary(error, logPath);
    }
  }
}

async function monitorBridgeProgress(
  path: string,
  onProgress: (progress: UiUnityJobProgressStep) => void,
  signal: AbortSignal,
  state: BridgeProgressMonitorState,
): Promise<void> {
  while (!signal.aborted) {
    await reportBridgeProgress(path, onProgress, state);
    await abortableDelay(100, signal);
  }
}

async function reportBridgeProgress(
  path: string,
  onProgress: (progress: UiUnityJobProgressStep) => void,
  state: BridgeProgressMonitorState,
): Promise<void> {
  try {
    const content = await readFile(path, "utf8");
    if (content !== state.previous) {
      state.previous = content;
      onProgress(parseBridgeProgress(JSON.parse(content)));
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
}

function parseBridgeProgress(value: unknown): UiUnityJobProgressStep {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Unity progress must be an object");
  const entry = value as Record<string, unknown>;
  if (typeof entry.id !== "string" || !entry.id) throw new Error("Unity progress id is missing");
  if (typeof entry.label !== "string" || !entry.label) throw new Error("Unity progress label is missing");
  if (!Number.isInteger(entry.completed) || (entry.completed as number) < 0) throw new Error("Unity progress completed is invalid");
  if (!Number.isInteger(entry.total) || (entry.total as number) <= 0) throw new Error("Unity progress total is invalid");
  const total = entry.total as number;
  const completed = Math.min(entry.completed as number, total);
  return {
    id: entry.id,
    label: entry.label,
    status: completed >= total ? "succeeded" : "running",
    completed,
    total,
    ...(typeof entry.currentItem === "string" && entry.currentItem ? { currentItem: entry.currentItem } : {}),
  };
}

async function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(finish, delayMs);
    function finish(): void {
      signal.removeEventListener("abort", finish);
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

export function unityBatchTimeoutMs(request: unknown): number {
  if (!request || typeof request !== "object" || Array.isArray(request)) return BATCH_TIMEOUT_MS;
  const artifacts = (request as Record<string, unknown>).artifacts;
  if (!Array.isArray(artifacts) || artifacts.length <= 1) return BATCH_TIMEOUT_MS;
  return Math.min(MAX_BATCH_TIMEOUT_MS, BATCH_TIMEOUT_MS + (artifacts.length - 1) * BATCH_ARTIFACT_BUDGET_MS);
}

async function batchModeTimeoutMs(repoRoot: string, requestPath: string): Promise<number> {
  const request = JSON.parse(await readFile(repositoryPath(repoRoot, requestPath), "utf8")) as unknown;
  return unityBatchTimeoutMs(request);
}

async function unityProcessStatus(repoRoot: string, signal?: AbortSignal): Promise<UnityProcessStatus> {
  const { stdout } = await runProcess(
    "python",
    ["tools/unity_workspace_status.py", "--repo-root", repoRoot, "--format", "json", "--processes-only"],
    repoRoot,
    signal ? { signal } : {},
  );
  return JSON.parse(stdout) as UnityProcessStatus;
}

async function runBatchMode(
  repoRoot: string,
  requestPath: string,
  logPath: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (process.platform !== "win32") throw new Error("Legma Unity batch fallback currently requires Windows");
  const command = [
    "call",
    quoteCmd(join(repoRoot, "start_unity6000.bat")),
    "batchmode",
    "-quit",
    "-executeMethod",
    "PuerTsTemplate.UI.Editor.Authoring.UiAuthoringJobBridge.RunFromCommandLine",
    "-uiJob",
    quoteCmd(requestPath),
    "-logFile",
    quoteCmd(logPath),
  ].join(" ");
  await runProcess("cmd.exe", ["/d", "/s", "/c", command], repoRoot, {
    windowsVerbatimArguments: true,
    timeoutMs,
    killTree: true,
    timeoutMessage: `Unity batchMode timed out after ${Math.round(timeoutMs / 1000)} seconds`,
    ...(signal ? { signal } : {}),
  });
}

async function waitForEditorClaim(
  repoRoot: string,
  requestPath: string,
  resultPath: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const requestState = await currentRequestState(repoRoot, requestPath, resultPath);
    if (requestState === "claimed" || requestState === "completed") return;
    if (signal?.aborted) {
      const cancelledState = await cancelUnclaimedRequest(repoRoot, requestPath, resultPath);
      if (cancelledState !== "cancelled") return;
      throw new Error("Unity job execution was aborted");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const cancelledState = await cancelUnclaimedRequest(repoRoot, requestPath, resultPath);
  if (cancelledState !== "cancelled") return;
  throw new Error(`Unity Editor 未在 ${Math.round(timeoutMs / 1000)} 秒内接取任务；请退出 Play Mode，并等待脚本编译和资源刷新完成后重试`);
}

type RequestState = "pending" | "cancelled" | "claimed" | "completed";

async function currentRequestState(repoRoot: string, requestPath: string, resultPath: string): Promise<RequestState> {
  const request = repositoryPath(repoRoot, requestPath);
  const result = repositoryPath(repoRoot, resultPath);
  const directory = dirname(request);
  if (await pathExists(result)) return "completed";
  if (await pathExists(join(directory, "claim"))) return "claimed";
  if (await pathExists(join(directory, "cancelled"))) return "cancelled";
  return "pending";
}

async function cancelUnclaimedRequest(repoRoot: string, requestPath: string, resultPath: string): Promise<RequestState> {
  const request = repositoryPath(repoRoot, requestPath);
  const directory = dirname(request);
  const initialState = await currentRequestState(repoRoot, requestPath, resultPath);
  if (initialState !== "pending") return initialState;
  await atomicWrite(join(directory, "cancelled"), "cancelled\n");
  const finalState = await currentRequestState(repoRoot, requestPath, resultPath);
  return finalState === "pending" ? "cancelled" : finalState;
}

async function waitForBridgeResponse(path: string): Promise<UnityBridgeResponse> {
  while (true) {
    try {
      return JSON.parse(await readFile(path, "utf8")) as UnityBridgeResponse;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function readBridgeResponse(path: string): Promise<UnityBridgeResponse> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as UnityBridgeResponse;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("Unity batchMode exited without writing a bridge result", { cause: error });
    }
    throw error;
  }
}

async function withUnityLogSummary(error: unknown, path: string): Promise<Error> {
  const summary = await unityLogErrorSummary(path);
  const message = error instanceof Error ? error.message : String(error);
  return new Error(summary ? `${message}\nUnity batch log:\n${summary}` : message, { cause: error });
}

async function unityLogErrorSummary(path: string): Promise<string | undefined> {
  try {
    const lines = (await readFile(path, "utf8")).split(/\r?\n/);
    const errors = lines.filter((line) => /\berror\b/i.test(line));
    const selected = errors.length > 0 ? errors.slice(-12) : lines.slice(-40);
    return selected.filter(Boolean).join("\n") || undefined;
  } catch {
    return undefined;
  }
}

export function repositoryPath(repoRoot: string, relativePath: string): string {
  if (!relativePath || /^[A-Za-z]:|^[\\/]/.test(relativePath)) throw new Error(`Repository path must be relative: ${relativePath}`);
  const path = join(repoRoot, ...relativePath.replaceAll("\\", "/").split("/"));
  const child = relative(repoRoot, path);
  if (!child || child.startsWith("..") || child.includes(":")) throw new Error(`Repository path escapes the workspace: ${relativePath}`);
  return path;
}

export async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function quoteCmd(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
