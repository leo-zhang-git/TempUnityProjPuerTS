import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { listFiles } from "./workspace.js";

const execFileAsync = promisify(execFile);
const PUBLISHABLE_ITEM_STATUSES = new Set(["M", "A", "R", "?"]);
const BLOCKING_STATUSES = new Set(["C", "!", "~"]);

export interface SvnStatusEntry {
  readonly columns: string;
  readonly path: string;
}

export function parseSvnStatus(output: string): SvnStatusEntry[] {
  return output.split(/\r?\n/u).flatMap((line) => {
    if (line.length < 9 || line[7] !== " ") return [];
    const path = line.slice(8).trimEnd();
    return path ? [{ columns: line.slice(0, 7), path }] : [];
  });
}

export async function svnModifiedSourcePaths(sourceRoot: string): Promise<string[]> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("svn", ["status", "--depth", "infinity", sourceRoot], {
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
    }));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`无法读取 UI Source 的 SVN 本地修改：${detail}`, { cause: error });
  }

  return await modifiedSourcePathsFromStatus(sourceRoot, parseSvnStatus(stdout));
}

export async function modifiedSourcePathsFromStatus(sourceRoot: string, entries: readonly SvnStatusEntry[]): Promise<string[]> {
  const changed = new Set<string>();
  for (const entry of entries) {
    const itemStatus = entry.columns[0] ?? " ";
    const propertyStatus = entry.columns[1] ?? " ";
    const treeConflict = entry.columns[6] ?? " ";
    const blocked = BLOCKING_STATUSES.has(itemStatus) || BLOCKING_STATUSES.has(propertyStatus) || BLOCKING_STATUSES.has(treeConflict);
    const publishable = PUBLISHABLE_ITEM_STATUSES.has(itemStatus) || (itemStatus === " " && propertyStatus === "M");
    if (!blocked && !publishable) continue;
    const target = isAbsolute(entry.path) ? resolve(entry.path) : resolve(sourceRoot, entry.path);
    if (relative(resolve(sourceRoot), target) === "") {
      if (blocked) throw new Error("无法发布存在 SVN 冲突或工作副本异常的 Source 根目录");
      if (itemStatus === "?") {
        for (const nested of await listFiles(target, ".ui.json")) changed.add(nested);
      }
      continue;
    }
    const sourcePath = relativeSourcePath(sourceRoot, target);
    const isSource = sourcePath.endsWith(".ui.json");
    if (blocked && isSource) {
      throw new Error(`无法发布存在 SVN 冲突或工作副本异常的 Source：${sourcePath}`);
    }
    if (!publishable) continue;
    if (isSource) {
      changed.add(sourcePath);
      continue;
    }
    if (itemStatus !== "?") continue;
    const info = await stat(target).catch(() => undefined);
    if (!info?.isDirectory()) continue;
    for (const nested of await listFiles(target, ".ui.json")) {
      changed.add(relativeSourcePath(sourceRoot, resolve(target, nested)));
    }
  }
  return [...changed].sort();
}

function relativeSourcePath(sourceRoot: string, target: string): string {
  const path = relative(resolve(sourceRoot), target);
  if (!path || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error(`SVN 状态包含 Source 根目录之外的路径：${target}`);
  }
  return path.replaceAll("\\", "/");
}
