import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { UiAuthoringEnvironment, UiWorkspaceIdentity, UiWorkspaceVcsAction } from "../schema/ui-api.js";
import type { WorkspacePaths } from "./workspace.js";

const UI_AUTHORING_PORTS = [
  ...Array.from({ length: 79 }, (_, index) => 4321 + index),
  ...Array.from({ length: 79 }, (_, index) => 14321 + index),
];
const ENVIRONMENT_DISCOVERY_TIMEOUT_MS = 180;

export interface WorkspaceApiService {
  identity(): Promise<UiWorkspaceIdentity>;
  environments(currentPort?: number): Promise<readonly UiAuthoringEnvironment[]>;
  openVersionControl(action: UiWorkspaceVcsAction): Promise<{ readonly action: UiWorkspaceVcsAction; readonly paths: readonly string[] }>;
}

export interface WorkspaceServiceOptions {
  readonly launch?: (executable: string, args: readonly string[], cwd: string) => Promise<void>;
  readonly fetchConfig?: (origin: string) => Promise<UiAuthoringEnvironment | undefined>;
}

export class WorkspaceService implements WorkspaceApiService {
  readonly #paths: WorkspacePaths;
  readonly #launch: NonNullable<WorkspaceServiceOptions["launch"]>;
  readonly #fetchConfig: NonNullable<WorkspaceServiceOptions["fetchConfig"]>;

  constructor(paths: WorkspacePaths, options: WorkspaceServiceOptions = {}) {
    this.#paths = paths;
    this.#launch = options.launch ?? launchDetached;
    this.#fetchConfig = options.fetchConfig ?? fetchEnvironment;
  }

  async identity(): Promise<UiWorkspaceIdentity> {
    return {
      name: basename(this.#paths.repoRoot),
      path: this.#paths.repoRoot,
      clusterId: await readClusterId(this.#paths.repoRoot),
    };
  }

  async environments(currentPort?: number): Promise<readonly UiAuthoringEnvironment[]> {
    const currentIdentity = await this.identity();
    const currentOrigin = currentPort ? `http://127.0.0.1:${currentPort}` : undefined;
    const discovered = await Promise.all(
      UI_AUTHORING_PORTS.map(async (port) => {
        const origin = `http://127.0.0.1:${port}`;
        if (origin === currentOrigin) return { ...currentIdentity, origin, current: true };
        return this.#fetchConfig(origin);
      }),
    );
    const byWorkspace = new Map<string, UiAuthoringEnvironment>();
    for (const environment of discovered) {
      if (!environment) continue;
      const key = environment.path.toLowerCase();
      const previous = byWorkspace.get(key);
      if (!previous || environment.current || (!previous.current && environment.origin.localeCompare(previous.origin) < 0)) {
        byWorkspace.set(key, environment);
      }
    }
    if (currentOrigin && !byWorkspace.has(currentIdentity.path.toLowerCase())) {
      byWorkspace.set(currentIdentity.path.toLowerCase(), { ...currentIdentity, origin: currentOrigin, current: true });
    }
    return [...byWorkspace.values()].sort(
      (left, right) =>
        Number(right.current) - Number(left.current) ||
        (left.clusterId ?? Number.MAX_SAFE_INTEGER) - (right.clusterId ?? Number.MAX_SAFE_INTEGER) ||
        left.path.localeCompare(right.path),
    );
  }

  async openVersionControl(
    action: UiWorkspaceVcsAction,
  ): Promise<{ readonly action: UiWorkspaceVcsAction; readonly paths: readonly string[] }> {
    const paths = [this.#paths.sourceRoot, this.#paths.assetRoot];
    const executable = resolveTortoiseProc();
    await this.#launch(executable, [`/command:${action}`, `/path:${paths.join("*")}`, "/closeonend:0"], this.#paths.repoRoot);
    return { action, paths };
  }
}

async function readClusterId(repoRoot: string): Promise<number | null> {
  try {
    const value: unknown = JSON.parse(await readFile(join(repoRoot, "program", "server", "etc", "config.json"), "utf8"));
    const clusterId = value && typeof value === "object" ? (value as { readonly clusterID?: unknown }).clusterID : undefined;
    if (typeof clusterId === "number" && Number.isInteger(clusterId) && clusterId >= 0) return clusterId;
    if (typeof clusterId === "string" && /^\d+$/.test(clusterId.trim())) return Number(clusterId);
  } catch {
    // Workspace identity remains useful when a fixture or partial checkout has no server config.
  }
  return null;
}

async function fetchEnvironment(origin: string): Promise<UiAuthoringEnvironment | undefined> {
  try {
    const response = await fetch(`${origin}/api/config`, { signal: AbortSignal.timeout(ENVIRONMENT_DISCOVERY_TIMEOUT_MS) });
    if (!response.ok) return undefined;
    const value: unknown = await response.json();
    if (!value || typeof value !== "object") return undefined;
    const candidate = value as { readonly product?: unknown; readonly workspace?: Partial<UiWorkspaceIdentity> };
    if (candidate.product !== "legma-ui-authoring" || !candidate.workspace) return undefined;
    const { name, path, clusterId } = candidate.workspace;
    if (typeof name !== "string" || typeof path !== "string" || (clusterId !== null && typeof clusterId !== "number")) return undefined;
    return { name, path, clusterId, origin, current: false };
  } catch {
    return undefined;
  }
}

function resolveTortoiseProc(): string {
  const candidates = [
    process.env.ProgramFiles ? join(process.env.ProgramFiles, "TortoiseSVN", "bin", "TortoiseProc.exe") : undefined,
    process.env["ProgramFiles(x86)"] ? join(process.env["ProgramFiles(x86)"], "TortoiseSVN", "bin", "TortoiseProc.exe") : undefined,
  ];
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate))) ?? "TortoiseProc.exe";
}

async function launchDetached(executable: string, args: readonly string[], cwd: string): Promise<void> {
  if (process.platform !== "win32") throw new Error("TortoiseSVN workspace actions are only available on Windows");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [...args], { cwd, detached: true, stdio: "ignore", windowsHide: false });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
