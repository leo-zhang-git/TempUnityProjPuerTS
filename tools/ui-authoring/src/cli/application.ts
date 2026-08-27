import { startUiAuthoringServer } from "../server/server.js";
import { UnityJobService } from "../server/unity-job-service.js";
import { awaitUnityJob } from "../server/unity-job-wait.js";
import { workspacePaths } from "../server/workspace.js";
import { parseCliInvocation } from "./arguments.js";
import { CliCommandContext, type CliOutput, type CliServices } from "./command-context.js";
import { cliUsage } from "./command-registry.js";
import { cliCommandHandlers } from "./handler-registry.js";

export type { CliOutput, CliServices } from "./command-context.js";
export { parsePublishSelectionFile } from "./handlers/delivery.js";

const defaultServices: CliServices = {
  workspacePaths,
  createUnityJobService: (paths) => new UnityJobService(paths),
  waitForUnityJob: awaitUnityJob,
  startCaptureServer: () => startUiAuthoringServer({ host: "127.0.0.1", port: 0, development: true }),
};

export async function runCli(raw: readonly string[], output: CliOutput, serviceOverrides: Partial<CliServices> = {}): Promise<number> {
  try {
    const invocation = parseCliInvocation(raw);
    const context = new CliCommandContext(invocation, output, { ...defaultServices, ...serviceOverrides });
    if (invocation.helpRequested) {
      context.stdout(`${cliUsage(invocation.command)}\n`);
      return context.exitCode;
    }
    if (!invocation.command) throw new Error(cliUsage());
    await cliCommandHandlers[invocation.command](context);
    return context.exitCode;
  } catch (error) {
    output.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
