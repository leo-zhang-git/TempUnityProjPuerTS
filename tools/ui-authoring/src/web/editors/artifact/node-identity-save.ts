import type { NodeIdentityRefactorPlan } from "../../../kernel/node-identity-refactor.js";
import type { WorkspaceSaveGroupCommit } from "./artifact-workspace-state.js";

export function nodeIdentityCommitForPlans(plans: readonly NodeIdentityRefactorPlan[]): WorkspaceSaveGroupCommit | undefined {
  const mappings = plans.flatMap((plan) =>
    plan.preview.changes.flatMap((change) =>
      change.beforeNodeId === change.afterNodeId
        ? []
        : [
            {
              ownerArtifactKey: change.ownerArtifactKey,
              beforeNodeId: change.beforeNodeId,
              afterNodeId: change.afterNodeId,
            },
          ],
    ),
  );
  if (mappings.length === 0) return undefined;
  const documentIds = new Set<string>();
  for (const plan of plans) {
    for (const impact of plan.preview.affectedDocuments) {
      if (impact.kind === "source") documentIds.add(`artifact:${impact.key}`);
      else if (impact.kind === "reference" || impact.kind === "prototype") documentIds.add(`${impact.kind}:${impact.key}`);
    }
  }
  return { nodeIdentityMappings: mappings, documentIds: [...documentIds].sort() };
}
