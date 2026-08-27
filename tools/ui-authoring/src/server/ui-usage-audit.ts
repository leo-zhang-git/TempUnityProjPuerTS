import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { deliveryStatePath, parseDeliveryState } from "../kernel/delivery-state.js";
import type { SourceCatalog } from "../kernel/source-catalog.js";
import { inspectProgramUiWidgetUsage } from "./program-ui-contract.js";

export interface UnusedDeliveredWidgetCandidate {
  readonly artifactKey: string;
  readonly sourcePath: string;
  readonly abstractOwnerPaths: readonly string[];
}

export async function auditUnusedDeliveredWidgets(
  repoRoot: string,
  catalog: SourceCatalog,
): Promise<readonly UnusedDeliveredWidgetCandidate[]> {
  const inboundArtifacts = new Map<string, Set<string>>();
  for (const entry of catalog.entries.values()) {
    for (const dependency of entry.dependencies) {
      const inbound = inboundArtifacts.get(dependency) ?? new Set<string>();
      inbound.add(entry.source.artifactKey);
      inboundArtifacts.set(dependency, inbound);
    }
  }

  const usageByArtifact = new Map(
    (await inspectProgramUiWidgetUsage(repoRoot, catalog)).map((usage) => [usage.artifactKey, usage] as const),
  );
  const candidates: UnusedDeliveredWidgetCandidate[] = [];
  for (const entry of catalog.entries.values()) {
    if (entry.source.artifactType !== "Widget") continue;
    if ((inboundArtifacts.get(entry.source.artifactKey)?.size ?? 0) > 0) continue;
    const usage = usageByArtifact.get(entry.source.artifactKey);
    if ((usage?.concreteRuntimeOwners.length ?? 0) > 0) continue;
    if (!(await hasDeliveryState(repoRoot, entry.source.artifactKey))) continue;
    candidates.push({
      artifactKey: entry.source.artifactKey,
      sourcePath: entry.path,
      abstractOwnerPaths: usage?.abstractOwnerPaths ?? [],
    });
  }
  return candidates.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
}

async function hasDeliveryState(repoRoot: string, artifactKey: string): Promise<boolean> {
  try {
    parseDeliveryState(JSON.parse(await readFile(join(repoRoot, ...deliveryStatePath(artifactKey).split("/")), "utf8")));
    return true;
  } catch {
    return false;
  }
}
