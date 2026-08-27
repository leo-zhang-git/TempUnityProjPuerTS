import { join } from "node:path";
import type { WorkspacePaths } from "../workspace.js";
import type { ProgramGateRunner } from "./contracts.js";
import { runProcess } from "./process.js";

/** Timeout for one program generation step. */
export const PROGRAM_PREPARATION_STEP_TIMEOUT_MS = 120_000;
/** Timeout for the client typecheck process. */
export const CLIENT_TYPECHECK_TIMEOUT_MS = 240_000;

export interface ProgramCommandInvocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly options?: { readonly windowsVerbatimArguments?: boolean };
}

export class WorkspaceProgramGateRunner implements ProgramGateRunner {
  constructor(readonly paths: WorkspacePaths) {}

  async prepareClientTypecheck(signal?: AbortSignal): Promise<void> {
    for (const invocation of programPreparationInvocations()) {
      await this.runProgramCommand(invocation, PROGRAM_PREPARATION_STEP_TIMEOUT_MS, signal);
    }
  }

  async runClientTypecheck(signal?: AbortSignal): Promise<void> {
    await this.runProgramCommand(programTypecheckInvocation(), CLIENT_TYPECHECK_TIMEOUT_MS, signal);
  }

  private async runProgramCommand(invocation: ProgramCommandInvocation, timeoutMs: number, signal?: AbortSignal): Promise<void> {
    await runProcess(invocation.command, invocation.args, join(this.paths.repoRoot, "TsProj"), {
      ...invocation.options,
      ...(signal ? { signal } : {}),
      timeoutMs,
      timeoutMessage: `${programCommandDescription(invocation)} timed out after ${Math.round(timeoutMs / 1000)} seconds`,
      killTree: true,
    });
  }
}

export function programPreparationInvocations(platform = process.platform): readonly ProgramCommandInvocation[] {
  void platform;
  return [];
}

export function programTypecheckInvocation(platform = process.platform): ProgramCommandInvocation {
  return platform === "win32"
    ? {
        command: "cmd.exe",
        args: ["/d", "/s", "/c", "npm.cmd run check"],
        options: { windowsVerbatimArguments: true },
      }
    : { command: "npm", args: ["run", "check"] };
}

function programCommandDescription(invocation: ProgramCommandInvocation): string {
  return invocation.command === "cmd.exe" ? invocation.args.at(-1)! : `${invocation.command} ${invocation.args.join(" ")}`;
}
