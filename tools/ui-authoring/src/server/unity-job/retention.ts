import type { Dirent } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { UiUnityJobSnapshot } from "../../schema/ui-unity-job.js";
import type { UnityJobServiceOptions } from "./contracts.js";

const DEFAULT_MAX_RETAINED_JOBS = 200;
const DEFAULT_MAX_RETAINED_JOB_DIRECTORIES = 100;
const DEFAULT_MAX_RETAINED_JOB_DIRECTORY_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const JOB_DIRECTORY_CLEANUP_GRACE_MS = 60 * 60 * 1_000;

interface RetainedJob {
  readonly snapshot: UiUnityJobSnapshot;
}

export class UnityJobRetention {
  readonly #options: Required<UnityJobServiceOptions>;

  constructor(
    readonly jobs: Map<string, RetainedJob>,
    readonly runtimeRoot: string,
    options: UnityJobServiceOptions = {},
  ) {
    this.#options = {
      maxRetainedJobs: positiveRetentionLimit(options.maxRetainedJobs, DEFAULT_MAX_RETAINED_JOBS, "maxRetainedJobs"),
      maxRetainedJobDirectories: positiveRetentionLimit(
        options.maxRetainedJobDirectories,
        DEFAULT_MAX_RETAINED_JOB_DIRECTORIES,
        "maxRetainedJobDirectories",
      ),
      maxRetainedJobDirectoryAgeMs: positiveRetentionLimit(
        options.maxRetainedJobDirectoryAgeMs,
        DEFAULT_MAX_RETAINED_JOB_DIRECTORY_AGE_MS,
        "maxRetainedJobDirectoryAgeMs",
      ),
    };
  }

  pruneSnapshots(): void {
    const overflow = this.jobs.size - this.#options.maxRetainedJobs;
    if (overflow <= 0) return;
    const terminal = [...this.jobs.entries()]
      .filter(([, job]) => isTerminalJob(job.snapshot))
      .sort(([, left], [, right]) => left.snapshot.updatedAt - right.snapshot.updatedAt);
    for (const [id] of terminal.slice(0, overflow)) this.jobs.delete(id);
  }

  async pruneDirectories(): Promise<void> {
    const root = join(this.runtimeRoot, "unity-jobs");
    let entries: Dirent[];
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const activeJobIds = new Set([...this.jobs.entries()].filter(([, job]) => !isTerminalJob(job.snapshot)).map(([id]) => id));
    const candidates = (
      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory() && !activeJobIds.has(entry.name))
          .map(async (entry) => {
            const path = join(root, entry.name);
            try {
              return { path, name: entry.name, modifiedAt: (await stat(path)).mtimeMs };
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
              throw error;
            }
          }),
      )
    )
      .filter((entry): entry is { path: string; name: string; modifiedAt: number } => entry !== undefined)
      .sort((left, right) => left.modifiedAt - right.modifiedAt || left.name.localeCompare(right.name));
    const now = Date.now();
    const expired = new Set(
      candidates
        .filter((entry) => now - entry.modifiedAt >= Math.max(JOB_DIRECTORY_CLEANUP_GRACE_MS, this.#options.maxRetainedJobDirectoryAgeMs))
        .map((entry) => entry.path),
    );
    let overflow = Math.max(0, candidates.length - this.#options.maxRetainedJobDirectories);
    for (const entry of candidates) {
      const pastGracePeriod = now - entry.modifiedAt >= JOB_DIRECTORY_CLEANUP_GRACE_MS;
      if (!expired.has(entry.path) && (!pastGracePeriod || overflow <= 0)) continue;
      await rm(entry.path, { recursive: true, force: true });
      if (overflow > 0) overflow -= 1;
    }
  }
}

export function isTerminalJob(snapshot: UiUnityJobSnapshot): boolean {
  return snapshot.status === "succeeded" || snapshot.status === "failed";
}

function positiveRetentionLimit(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) throw new Error(`${label} must be a positive integer`);
  return resolved;
}
