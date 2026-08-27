import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

import type { UiArtifactSvnRevertRequest, UiArtifactSvnStatus } from "../schema/ui-api.js";
import { acquireWorkspaceLock } from "./artifact-transaction.js";
import { documentRevisionFromText } from "./document-revision.js";
import { parseSvnStatus } from "./svn-local-changes.js";
import { safeChildPath, type WorkspacePaths } from "./workspace.js";

const execFileAsync = promisify(execFile);

export class SourceSvnBaselineConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceSvnBaselineConflictError";
  }
}

export class SourceSvnStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceSvnStateError";
  }
}

export interface SourceSvnApiService {
  status(path: string): Promise<UiArtifactSvnStatus>;
  revert(request: UiArtifactSvnRevertRequest): Promise<{ readonly reverted: true; readonly path: string }>;
}

export interface SourceSvnServiceOptions {
  readonly run?: (args: readonly string[]) => Promise<{ readonly stdout: string }>;
}

export class SourceSvnService implements SourceSvnApiService {
  readonly #run: NonNullable<SourceSvnServiceOptions["run"]>;

  constructor(
    private readonly paths: WorkspacePaths,
    options: SourceSvnServiceOptions = {},
  ) {
    this.#run = options.run ?? runSvn;
  }

  async status(path: string): Promise<UiArtifactSvnStatus> {
    const target = sourceTarget(this.paths, path);
    let stdout: string;
    try {
      ({ stdout } = await this.#run(["status", "--depth", "empty", "--", target]));
    } catch (error) {
      throw new SourceSvnStateError(`无法读取 Source 的 SVN 状态：${errorMessage(error)}`);
    }
    const entries = parseSvnStatus(stdout);
    const entry = entries.find((candidate) => pathsEqual(candidate.path, target)) ?? entries[0];
    return presentStatus(path, entry?.columns);
  }

  async revert(request: UiArtifactSvnRevertRequest): Promise<{ readonly reverted: true; readonly path: string }> {
    const target = sourceTarget(this.paths, request.path);
    const release = await acquireWorkspaceLock(this.paths);
    try {
      let content: string;
      try {
        content = await readFile(target, "utf8");
      } catch (error) {
        throw new SourceSvnBaselineConflictError(`Source '${request.path}' 在还原前已不可读取：${errorMessage(error)}`);
      }
      if (documentRevisionFromText("artifact", content) !== request.expectedRevision) {
        throw new SourceSvnBaselineConflictError(`Source '${request.path}' 在还原前已发生变化`);
      }
      const status = await this.status(request.path);
      if (status.state === "clean") return { reverted: true, path: request.path };
      if (!status.canRevert) throw new SourceSvnStateError(status.message);
      try {
        await this.#run(["revert", "--depth", "empty", "--", target]);
      } catch (error) {
        throw new SourceSvnStateError(`无法还原 Source 的 SVN 修改：${errorMessage(error)}`);
      }
      return { reverted: true, path: request.path };
    } finally {
      await release();
    }
  }
}

function sourceTarget(paths: WorkspacePaths, path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (!normalized.endsWith(".ui.json")) throw new SourceSvnStateError("SVN 还原只支持 Artifact .ui.json Source");
  try {
    return safeChildPath(paths.sourceRoot, normalized);
  } catch (error) {
    throw new SourceSvnStateError(`Source 路径无效：${errorMessage(error)}`);
  }
}

function presentStatus(path: string, columns: string | undefined): UiArtifactSvnStatus {
  if (!columns) return { path, state: "clean", canRevert: false, message: "当前 Source 没有 SVN 本地修改" };
  const item = columns[0] ?? " ";
  const property = columns[1] ?? " ";
  const tree = columns[6] ?? " ";
  if (item === "C" || property === "C" || tree === "C") {
    return { path, state: "unsupported", canRevert: false, message: "当前 Source 存在 SVN 冲突，请在版本控制工具中处理" };
  }
  if ((item === "M" && (property === " " || property === "M")) || (item === " " && property === "M")) {
    return { path, state: "modified", canRevert: true, message: "还原当前 Source 到 SVN BASE" };
  }
  const reason = (
    {
      "?": "当前 Source 未纳入 SVN，不能还原到 BASE",
      A: "当前 Source 是 SVN 新增文件，不能按普通修改还原",
      D: "当前 Source 已标记删除，请在版本控制工具中处理",
      R: "当前 Source 已被替换，请在版本控制工具中处理",
      "!": "当前 Source 在 SVN 工作副本中缺失",
      "~": "当前 Source 的工作副本类型异常",
    } as Record<string, string>
  )[item];
  return { path, state: "unsupported", canRevert: false, message: reason ?? "当前 Source 的 SVN 状态不支持一键还原" };
}

function pathsEqual(left: string, right: string): boolean {
  return left.replaceAll("\\", "/").toLocaleLowerCase("en-US") === right.replaceAll("\\", "/").toLocaleLowerCase("en-US");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runSvn(args: readonly string[]): Promise<{ readonly stdout: string }> {
  const result = await execFileAsync("svn", [...args], { windowsHide: true, maxBuffer: 1024 * 1024, encoding: "utf8" });
  return { stdout: result.stdout };
}
