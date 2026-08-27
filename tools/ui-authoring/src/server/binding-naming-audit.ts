import type { BinderReferenceImpact } from "../kernel/binder-references.js";
import { findBinderReferenceImpacts } from "../kernel/binder-references.js";
import { auditBindingName, type BindingNamingRule } from "../kernel/binding-naming.js";
import { createSourceCatalog, type SourceCatalogInput } from "../kernel/source-catalog.js";
import type { UiBindingComponentType, UiSource } from "../schema/ui-source-schema.js";
import { loadPrototypeCatalogInputs, loadReferenceCatalogInputs } from "./prototype-catalog.js";
import { loadSourceCatalogInputs } from "./source-catalog.js";
import type { WorkspacePaths } from "./workspace.js";

interface BindingNamingConsumer {
  readonly kind: "reference" | "prototype";
  readonly key: string;
  readonly path: string;
  readonly location: string;
  readonly ownerArtifactKey: string;
}

interface BindingNamingFinding {
  readonly path: string;
  readonly artifactKey: string;
  readonly artifactType: UiSource["artifactType"];
  readonly sourceKind: UiSource["sourceKind"];
  readonly declarationIndex: number;
  readonly bindingName: string;
  readonly componentType: UiBindingComponentType;
  readonly rules: readonly BindingNamingRule[];
  readonly consumers: readonly BindingNamingConsumer[];
}

export interface BindingNamingAuditReport {
  readonly root: ".";
  readonly files: {
    readonly artifact: number;
    readonly reference: number;
    readonly prototype: number;
  };
  readonly summary: {
    readonly bindings: number;
    readonly violatingBindings: number;
    readonly violations: number;
    readonly ruleCounts: Readonly<Record<BindingNamingRule, number>>;
    readonly consumerOccurrences: number;
    readonly consumerDocuments: number;
  };
  readonly findings: readonly BindingNamingFinding[];
}

interface MutableFinding {
  readonly path: string;
  readonly artifactKey: string;
  readonly artifactType: UiSource["artifactType"];
  readonly sourceKind: UiSource["sourceKind"];
  readonly declarationIndex: number;
  readonly bindingName: string;
  readonly componentType: UiBindingComponentType;
  readonly rules: readonly BindingNamingRule[];
  readonly consumers: BindingNamingConsumer[];
}

function sortText(left: string, right: string): number {
  return left.localeCompare(right, "en-US");
}

function createFindings(sourceInputs: readonly SourceCatalogInput[]): Map<string, MutableFinding> {
  const findings = new Map<string, MutableFinding>();
  for (const input of sourceInputs) {
    for (const [declarationIndex, binding] of (input.source.bindings ?? []).entries()) {
      const violations = auditBindingName(binding.name, binding.target.componentType);
      if (violations.length === 0) continue;
      findings.set(`${input.source.artifactKey}\0${binding.name}`, {
        path: input.path.replaceAll("\\", "/"),
        artifactKey: input.source.artifactKey,
        artifactType: input.source.artifactType,
        sourceKind: input.source.sourceKind,
        declarationIndex,
        bindingName: binding.name,
        componentType: binding.target.componentType,
        rules: violations.map((violation) => violation.rule),
        consumers: [],
      });
    }
  }
  return findings;
}

function consumerFromImpact(finding: MutableFinding, impact: BinderReferenceImpact): BindingNamingConsumer {
  return {
    kind: impact.documentKind,
    key: impact.documentKey,
    path: impact.path.replaceAll("\\", "/"),
    location: impact.fieldPath,
    ownerArtifactKey: finding.artifactKey,
  };
}

function collectConsumers(
  findings: ReadonlyMap<string, MutableFinding>,
  sourceInputs: readonly SourceCatalogInput[],
  references: Awaited<ReturnType<typeof loadReferenceCatalogInputs>>,
  prototypes: Awaited<ReturnType<typeof loadPrototypeCatalogInputs>>,
): void {
  const sourceCatalog = createSourceCatalog(sourceInputs);
  for (const finding of findings.values()) {
    const impacts = findBinderReferenceImpacts(sourceCatalog, references, prototypes, finding.artifactKey, finding.bindingName);
    const seen = new Set<string>();
    for (const impact of impacts) {
      const consumer = consumerFromImpact(finding, impact);
      const key = `${consumer.kind}\0${consumer.key}\0${consumer.path}\0${consumer.location}`;
      if (seen.has(key)) continue;
      seen.add(key);
      finding.consumers.push(consumer);
    }
    finding.consumers.sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        sortText(left.key, right.key) ||
        sortText(left.path, right.path) ||
        sortText(left.location, right.location),
    );
  }
}

function sortedFinding(finding: MutableFinding): BindingNamingFinding {
  return {
    path: finding.path,
    artifactKey: finding.artifactKey,
    artifactType: finding.artifactType,
    sourceKind: finding.sourceKind,
    declarationIndex: finding.declarationIndex,
    bindingName: finding.bindingName,
    componentType: finding.componentType,
    rules: [...finding.rules],
    consumers: [...finding.consumers],
  };
}

export async function auditBindingNamingWorkspace(paths: WorkspacePaths): Promise<BindingNamingAuditReport> {
  const [sourceInputs, referenceInputs, prototypeInputs] = await Promise.all([
    loadSourceCatalogInputs(paths.sourceRoot),
    loadReferenceCatalogInputs(paths.sourceRoot),
    loadPrototypeCatalogInputs(paths.sourceRoot),
  ]);
  const findings = createFindings(sourceInputs);
  collectConsumers(findings, sourceInputs, referenceInputs, prototypeInputs);
  const sorted = [...findings.values()]
    .sort(
      (left, right) =>
        sortText(left.path, right.path) || left.declarationIndex - right.declarationIndex || sortText(left.bindingName, right.bindingName),
    )
    .map(sortedFinding);
  const ruleCounts: Record<BindingNamingRule, number> = {
    format: 0,
    prefix: 0,
    node_name: 0,
    primary_reference: 0,
    unconfirmed_type: 0,
  };
  for (const finding of sorted) for (const rule of finding.rules) ruleCounts[rule] += 1;
  const consumerDocuments = new Set(sorted.flatMap((finding) => finding.consumers.map((consumer) => `${consumer.kind}\0${consumer.key}`)));
  return {
    root: ".",
    files: { artifact: sourceInputs.length, reference: referenceInputs.length, prototype: prototypeInputs.length },
    summary: {
      bindings: sourceInputs.reduce((total, input) => total + (input.source.bindings?.length ?? 0), 0),
      violatingBindings: sorted.length,
      violations: sorted.reduce((total, finding) => total + finding.rules.length, 0),
      ruleCounts,
      consumerOccurrences: sorted.reduce((total, finding) => total + finding.consumers.length, 0),
      consumerDocuments: consumerDocuments.size,
    },
    findings: sorted,
  };
}
