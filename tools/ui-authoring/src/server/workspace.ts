import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface WorkspacePaths {
  readonly repoRoot: string;
  readonly sourceRoot: string;
  readonly assetRoot: string;
  readonly unityAssetsRoot?: string;
  readonly runtimeRoot: string;
  readonly defaultArtifact: string;
  readonly defaultPrototype: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(join(path, "AGENTS.md"));
    return true;
  } catch {
    return false;
  }
}

async function findRepoRoot(start = dirname(fileURLToPath(import.meta.url))): Promise<string> {
  let current = resolve(start);
  while (true) {
    if ((await pathExists(current)) && (await pathExists(join(current, "My project"))))
      return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(`Unable to find repository root from ${start}`);
    current = parent;
  }
}

export async function workspacePaths(workspaceRoot?: string): Promise<WorkspacePaths> {
  const configuredRoot = workspaceRoot ?? process.env.UI_AUTHORING_WORKSPACE_ROOT;
  const repoRoot = configuredRoot ? resolve(configuredRoot) : await findRepoRoot();
  return {
    repoRoot,
    sourceRoot: join(repoRoot, "My project", "UIAuthoring", "Sources"),
    assetRoot: join(repoRoot, "My project", "Assets", "Resources", "UI"),
    unityAssetsRoot: join(repoRoot, "My project", "Assets"),
    runtimeRoot: join(repoRoot, "tools", "ui-authoring", ".runtime"),
    defaultArtifact: "LaneDodgeCanvas.ui.json",
    defaultPrototype: "LaneDodgeFlow.ui-prototype.json",
  };
}

export function referenceAssetRoot(paths: WorkspacePaths): string {
  return join(dirname(paths.sourceRoot), "ReferenceAssets");
}

export function safeChildPath(root: string, requested: string): string {
  const normalized = requested.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").includes("..")) throw new Error("Invalid relative path");
  const target = resolve(root, normalized);
  const rel = relative(root, target);
  if (rel.startsWith("..") || rel === ".." || rel.includes(`..${sep}`)) throw new Error("Path escapes workspace root");
  return target;
}

export async function listFiles(root: string, suffix: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(suffix)) result.push(relative(root, path).replaceAll("\\", "/"));
    }
  };
  try {
    await visit(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return result.sort((left, right) => left.localeCompare(right));
}
