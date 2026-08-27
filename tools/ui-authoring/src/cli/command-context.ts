import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative } from "node:path";
import type { UiSource } from "../schema/ui-source-schema.js";
import type {
  UiPrefabImportRequest,
  UiPublishArtifactsRequest,
  UiPublishExecutionOptions,
  UiPublishRequest,
  UiReconcileRequest,
  UiUnityJobSnapshot,
} from "../schema/ui-unity-job.js";
import type { CaptureService } from "../server/capture-service.js";
import type { AwaitUnityJobOptions, UnityJobPoll } from "../server/unity-job-wait.js";
import type { WorkspacePaths } from "../server/workspace.js";
import { safeChildPath } from "../server/workspace.js";
import type { CliInvocation } from "./arguments.js";

export interface CliOutput {
  stdout(value: string): void;
  stderr(value: string): void;
}

export interface CliUnityJobService extends UnityJobPoll {
  startImport(request: UiPrefabImportRequest): Promise<UiUnityJobSnapshot>;
  startReconcile(request: UiReconcileRequest): Promise<UiUnityJobSnapshot>;
  startSync(source: UiSource): Promise<UiUnityJobSnapshot>;
  startPublish(request: UiPublishRequest): Promise<UiUnityJobSnapshot>;
  startPublishArtifacts(request: UiPublishArtifactsRequest): Promise<UiUnityJobSnapshot>;
  startPublishAll(request?: UiPublishExecutionOptions): Promise<UiUnityJobSnapshot>;
  close(): Promise<void>;
}

interface CliCaptureServer {
  readonly captureService: Pick<CaptureService, "capture">;
  close(): Promise<void>;
}

export interface CliServices {
  workspacePaths(): Promise<WorkspacePaths>;
  createUnityJobService(paths: WorkspacePaths): CliUnityJobService;
  waitForUnityJob(service: UnityJobPoll, started: UiUnityJobSnapshot, options: AwaitUnityJobOptions): Promise<UiUnityJobSnapshot>;
  startCaptureServer(): Promise<CliCaptureServer>;
}

export class CliCommandContext {
  #workspacePaths?: Promise<WorkspacePaths>;
  exitCode = 0;

  constructor(
    readonly invocation: CliInvocation,
    readonly output: CliOutput,
    readonly services: CliServices,
  ) {}

  get input(): string | undefined {
    return this.invocation.input;
  }

  get raw(): readonly string[] {
    return this.invocation.raw;
  }

  has(name: string): boolean {
    return this.invocation.has(name);
  }

  option(name: string): string | undefined {
    return this.invocation.option(name);
  }

  options(name: string): string[] {
    return this.invocation.options(name);
  }

  requiredOption(name: string): string {
    const value = this.option(name);
    if (value === undefined) throw new Error(`Missing ${name}`);
    return value;
  }

  viewport(value: string): readonly [number, number] {
    const match = /^(\d+)x(\d+)$/.exec(value);
    if (!match) throw new Error(`Invalid viewport '${value}', expected WIDTHxHEIGHT`);
    const viewport = [Number(match[1]), Number(match[2])] as const;
    if (viewport.some((dimension) => !Number.isFinite(dimension) || dimension <= 0)) {
      throw new Error(`Invalid viewport '${value}', width and height must be positive`);
    }
    return viewport;
  }

  integerOption(name: string): number | undefined {
    const value = this.option(name);
    if (value === undefined) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`);
    return parsed;
  }

  coordinateOption(name: string): readonly [number, number] | undefined {
    const value = this.option(name);
    if (value === undefined) return undefined;
    const rawParts = value.split(",");
    if (rawParts.length !== 2 || rawParts.some((part) => part.trim().length === 0)) {
      throw new Error(`${name} must use the form X,Y`);
    }
    const parts = rawParts.map(Number);
    if (parts.some((part) => !Number.isFinite(part))) throw new Error(`${name} must use the form X,Y`);
    return [parts[0]!, parts[1]!];
  }

  jsonValue(value: string, description: string): unknown {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error(`${description} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  fail(): void {
    this.exitCode = 1;
  }

  stdout(value: string): void {
    this.output.stdout(value);
  }

  workspacePaths(): Promise<WorkspacePaths> {
    this.#workspacePaths ??= this.services.workspacePaths();
    return this.#workspacePaths;
  }

  async repoPath(value: string | undefined): Promise<string> {
    if (!value) throw new Error("Missing relative path");
    if (isAbsolute(value)) throw new Error(`Absolute paths are not allowed: '${value}'. Use a repository-relative path.`);
    if (value.replaceAll("\\", "/").split("/").includes("..")) {
      throw new Error(`Repository paths cannot contain '..': '${value}'. Resolve the path from the repository root.`);
    }
    return safeChildPath((await this.workspacePaths()).repoRoot, value);
  }

  async sourcePath(value: string | undefined): Promise<string> {
    if (!value) throw new Error("Missing source path");
    const hint = "Use a Source-root-relative path such as Flow/Main.ui.json, or a repository-relative path starting with My project/.";
    if (isAbsolute(value)) throw new Error(`Absolute paths are not allowed for Source paths: '${value}'. ${hint}`);
    const paths = await this.workspacePaths();
    const normalized = value.replaceAll("\\", "/");
    if (normalized.split("/").includes("..")) throw new Error(`Source paths cannot contain '..': '${value}'. ${hint}`);
    if (normalized.startsWith("My project/") || normalized.startsWith("tools/")) return safeChildPath(paths.repoRoot, normalized);
    return safeChildPath(paths.sourceRoot, normalized);
  }

  async sourceRelativePath(value: string | undefined): Promise<string> {
    const path = await this.sourcePath(value);
    const paths = await this.workspacePaths();
    const normalized = relative(paths.sourceRoot, path).replaceAll("\\", "/");
    if (!normalized || normalized === ".." || normalized.startsWith("../")) throw new Error("Document path is outside the Source Root");
    return normalized;
  }

  async writeText(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const transactionId = `${process.pid}.${randomUUID()}`;
    const tempPath = `${path}.${transactionId}.tmp`;
    const backupPath = `${path}.${transactionId}.backup`;
    await writeFile(tempPath, content, "utf8");
    let backedUp = false;
    try {
      try {
        await rename(path, backupPath);
        backedUp = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await rename(tempPath, path);
    } catch (error) {
      await rm(tempPath, { force: true });
      if (backedUp) await rename(backupPath, path);
      throw error;
    }
    if (backedUp) await rm(backupPath, { force: true }).catch(() => undefined);
  }
}

export function relativePath(root: string, path: string): string {
  const value = relative(root, path).replaceAll("\\", "/");
  if (!value || value === ".") return ".";
  if (value === ".." || value.startsWith("../")) throw new Error("Path is outside the workspace");
  return value;
}

export function keyValues<T>(values: readonly string[], optionName: string, parse: (value: string) => T): Record<string, T> {
  const result: Record<string, T> = {};
  for (const entry of values) {
    const separator = entry.indexOf("=");
    if (separator <= 0 || separator === entry.length - 1) throw new Error(`${optionName} expects KEY=VALUE`);
    result[entry.slice(0, separator)] = parse(entry.slice(separator + 1));
  }
  return result;
}

export type CliCommandHandler = (context: CliCommandContext) => Promise<void>;
