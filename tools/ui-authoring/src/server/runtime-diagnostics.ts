import type { Dirent } from "node:fs";
import { mkdir, open, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import type { UiRuntimeDiagnostic } from "../schema/ui-api.js";
import type { WorkspacePaths } from "./workspace.js";

const MAX_ENTRIES = 200;
const MAX_LOG_FILES = 8;
const MAX_LOG_TAIL_BYTES = 64 * 1024;

export interface RuntimeDiagnosticsApiService {
  record(entry: Omit<UiRuntimeDiagnostic, "id">): void;
  entries(): readonly UiRuntimeDiagnostic[];
  clearErrors(through: string): { readonly cleared: number; readonly entries: readonly UiRuntimeDiagnostic[] };
  createDownload(): Promise<{ readonly path: string; readonly name: string }>;
}

export class RuntimeDiagnostics implements RuntimeDiagnosticsApiService {
  readonly #paths: WorkspacePaths;
  readonly #entries: UiRuntimeDiagnostic[] = [];
  #sequence = 0;

  constructor(paths: WorkspacePaths) {
    this.#paths = paths;
  }

  record(entry: Omit<UiRuntimeDiagnostic, "id">): void {
    this.#sequence += 1;
    this.#entries.push({ ...entry, id: `${Date.now()}-${this.#sequence}` });
    if (this.#entries.length > MAX_ENTRIES) this.#entries.splice(0, this.#entries.length - MAX_ENTRIES);
  }

  entries(): readonly UiRuntimeDiagnostic[] {
    return [...this.#entries];
  }

  clearErrors(through: string): { readonly cleared: number; readonly entries: readonly UiRuntimeDiagnostic[] } {
    const cutoff = Date.parse(through);
    const retained = this.#entries.filter((entry) => entry.level !== "error" || Date.parse(entry.timestamp) > cutoff);
    const cleared = this.#entries.length - retained.length;
    this.#entries.splice(0, this.#entries.length, ...retained);
    return { cleared, entries: [...retained] };
  }

  async createDownload(): Promise<{ readonly path: string; readonly name: string }> {
    const createdAt = new Date();
    const stamp = createdAt.toISOString().replaceAll(":", "-");
    const name = `legma-${basename(this.#paths.repoRoot)}-${stamp}.log`;
    const output = join(this.#paths.runtimeRoot, "diagnostics", name);
    const sections = [
      "Legma diagnostics",
      `generated: ${createdAt.toISOString()}`,
      `workspace: ${this.#paths.repoRoot}`,
      "",
      "[runtime entries]",
      ...this.#entries.flatMap(formatEntry),
    ];
    for (const log of await recentLogFiles(this.#paths)) {
      sections.push("", `[log: ${log.label}]`, await readTail(log.path).catch((error: unknown) => `[unavailable: ${errorMessage(error)}]`));
    }
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${sections.join("\n")}\n`, "utf8");
    return { path: output, name };
  }
}

function formatEntry(entry: UiRuntimeDiagnostic): string[] {
  return [`${entry.timestamp} [${entry.level}] [${entry.source}] ${entry.message}`, ...(entry.stack ? [entry.stack] : [])];
}

async function recentLogFiles(
  paths: WorkspacePaths,
): Promise<readonly { readonly path: string; readonly label: string; readonly modifiedAt: number }[]> {
  const candidates: { path: string; label: string; modifiedAt: number }[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "diagnostics") await visit(path);
        continue;
      }
      if (!entry.isFile() || ![".log", ".txt"].includes(extname(entry.name).toLowerCase())) continue;
      try {
        candidates.push({ path, label: relative(paths.runtimeRoot, path).replaceAll("\\", "/"), modifiedAt: (await stat(path)).mtimeMs });
      } catch {
        // A runtime task may remove its log while diagnostics are being collected.
      }
    }
  };
  await visit(paths.runtimeRoot);
  return candidates.sort((left, right) => right.modifiedAt - left.modifiedAt).slice(0, MAX_LOG_FILES);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readTail(path: string): Promise<string> {
  const handle = await open(path, "r");
  try {
    const info = await handle.stat();
    const length = Math.min(info.size, MAX_LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, Math.max(0, info.size - length));
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}
