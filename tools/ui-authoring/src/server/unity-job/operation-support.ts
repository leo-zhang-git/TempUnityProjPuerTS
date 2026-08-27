import { access } from "node:fs/promises";
import { join, relative } from "node:path";
import { runProcess } from "./process.js";

const WORKSPACE_STATUS_SCOPE_LIMIT = 96;

export function repoRelative(repoRoot: string, path: string): string {
  const value = relative(repoRoot, path).replaceAll("\\", "/");
  if (!value || value.startsWith("../")) throw new Error(`Runtime path is outside repository: ${path}`);
  return value;
}

export async function prefabExists(repoRoot: string, prefabPath: string): Promise<boolean> {
  try {
    await access(join(repoRoot, "My project", ...prefabPath.split("/")));
    return true;
  } catch {
    return false;
  }
}

export async function workspaceChangePaths(repoRoot: string, scopePaths?: readonly string[]): Promise<string[]> {
  const result = new Set<string>();
  const normalizedScope = scopePaths
    ? [...new Set(scopePaths.map((path) => path.replaceAll("\\", "/")).filter(Boolean))].sort()
    : undefined;
  if (normalizedScope?.length === 0) return [];
  const scoped = normalizedScope && normalizedScope.length <= WORKSPACE_STATUS_SCOPE_LIMIT ? normalizedScope : undefined;
  const svnScope = scoped?.filter((path) => path === "My project" || path.startsWith("My project/"));
  const [git, svn] = await Promise.all([
    runProcess("git", ["status", "--porcelain=v1", "--untracked-files=all", ...(scoped ? ["--", ...scoped] : [])], repoRoot).catch(
      () => undefined,
    ),
    svnScope?.length === 0
      ? Promise.resolve(undefined)
      : runProcess("svn", ["status", ...(svnScope ?? ["My project"])], repoRoot).catch(() => undefined),
  ]);
  if (git) {
    for (const line of git.stdout.split(/\r?\n/)) {
      if (line.length < 4) continue;
      const raw = line.slice(3).replace(/^"|"$/g, "");
      result.add((raw.includes(" -> ") ? raw.split(" -> ").at(-1)! : raw).replaceAll("\\", "/"));
    }
  }
  if (svn) {
    for (const line of svn.stdout.split(/\r?\n/)) {
      if (line.length < 9) continue;
      result.add(line.slice(8).trim().replaceAll("\\", "/"));
    }
  }
  return [...result].sort();
}
