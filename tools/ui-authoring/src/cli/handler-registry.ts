import type { CliCommandHandler } from "./command-context.js";
import type { CliCommandName } from "./command-registry.js";
import { deliveryCommandHandlers } from "./handlers/delivery.js";
import { evidenceCommandHandlers } from "./handlers/evidence.js";
import { inspectionCommandHandlers } from "./handlers/inspection.js";
import { referenceMutationCommandHandlers } from "./handlers/reference-mutation.js";
import { sourceMutationCommandHandlers } from "./handlers/source-mutation.js";
import { workspaceCommandHandlers } from "./handlers/workspace.js";

export const cliCommandHandlers = {
  ...workspaceCommandHandlers,
  ...deliveryCommandHandlers,
  ...sourceMutationCommandHandlers,
  ...referenceMutationCommandHandlers,
  ...inspectionCommandHandlers,
  ...evidenceCommandHandlers,
} satisfies Record<CliCommandName, CliCommandHandler>;
