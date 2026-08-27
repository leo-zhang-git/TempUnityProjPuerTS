import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  collectPrototypeSessionAssetReferences,
  collectReferenceAssetReferences,
  collectSourceAssetReferences,
} from "../kernel/asset-references.js";
import { auditBindingName } from "../kernel/binding-naming.js";
import { formatSource } from "../kernel/canonical.js";
import { type EvaluatedNode, evaluateLayout } from "../kernel/layout.js";
import {
  createPrototypeCatalog,
  createReferenceCatalog,
  type ReferenceCatalog,
  validatePrototype,
  validatePrototypeShapeOnly,
  validateReference,
  validateReferenceShapeOnly,
} from "../kernel/prototype.js";
import { formatPrototype, formatReference } from "../kernel/prototype-canonical.js";
import { createSourceCatalog, type SourceCatalog } from "../kernel/source-catalog.js";
import { measureTmpText, tmpTextFirstLineHeight } from "../kernel/tmp-text.js";
import { walkNodes } from "../kernel/tree.js";
import { validateSourceReadiness } from "../kernel/validation.js";
import type { ValidationIssue } from "../kernel/validation-contract.js";
import { findReferenceUseSites } from "../kernel/workspace-documents.js";
import { DEFAULT_UI_FONT_ASSET } from "../registry/component-registry.js";
import type {
  UiDiagnostic,
  UiDiagnosticCategory,
  UiDiagnosticIdentity,
  UiDiagnosticOwner,
  UiDoctorReport,
  UiDocumentKind,
} from "../schema/ui-diagnostics.js";
import type { UiPrototype, UiReference } from "../schema/ui-prototype-schema.js";
import type { UiSource } from "../schema/ui-source-schema.js";
import { AssetIndex, AssetValidationError } from "./asset-index.js";
import { auditUnusedDeliveredWidgets, type UnusedDeliveredWidgetCandidate } from "./ui-usage-audit.js";
import { listFiles, referenceAssetRoot, safeChildPath, type WorkspacePaths } from "./workspace.js";

interface DocumentBase {
  readonly path: string;
  readonly text: string;
}

interface ArtifactDocument extends DocumentBase {
  readonly kind: "artifact";
  readonly value: UiSource;
}

interface ReferenceDocument extends DocumentBase {
  readonly kind: "reference";
  readonly value: UiReference;
}

interface PrototypeDocument extends DocumentBase {
  readonly kind: "prototype";
  readonly value: UiPrototype;
}

type ValidDocument = ArtifactDocument | ReferenceDocument | PrototypeDocument;

const NEXT_ACTION = {
  json: "Fix the JSON syntax and run check --full again.",
  schema: "Fix the document schema issue and run check --full again.",
  source: "Fix the Source validation issue and run check --full again.",
  canonical: "Rewrite this Source with canonical formatting.",
  catalog: "Fix the Source Catalog relationship and run check --full again.",
  reference: "Fix the Reference relationship and run check --full again.",
  prototype: "Fix the Prototype relationship and run check --full again.",
  resource: "Restore or correct the referenced UI resource and run check --full again.",
  bindingNaming: "Apply the fixed Binder prefix, lower snake_case, and node-name contract, then run check --full again.",
} as const;

function documentKey(kind: UiDocumentKind, value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const key = kind === "artifact" ? record.artifactKey : kind === "reference" ? record.referenceKey : record.prototypeKey;
  return typeof key === "string" ? key : undefined;
}

function identity(kind: UiDocumentKind, value: unknown, fieldPath?: string): UiDiagnosticIdentity | undefined {
  const key = documentKey(kind, value);
  if (!key) return undefined;
  return {
    documentKind: kind,
    documentKey: key,
    ...(fieldPath ? { fieldPath } : {}),
  };
}

function diagnostic(input: {
  readonly path: string;
  readonly category: UiDiagnosticCategory;
  readonly code: string;
  readonly message: string;
  readonly owner: UiDiagnosticOwner;
  readonly safeFixable?: boolean;
  readonly nextAction: string;
  readonly identity?: UiDiagnosticIdentity;
  readonly severity?: "error" | "warning";
}): UiDiagnostic {
  return {
    path: input.path.replaceAll("\\", "/"),
    severity: input.severity ?? "error",
    category: input.category,
    code: input.code,
    message: input.message,
    owner: input.owner,
    safeFixable: input.safeFixable ?? false,
    nextAction: input.nextAction,
    ...(input.identity ? { identity: input.identity } : {}),
  };
}

function validationDiagnostics(
  document: ValidDocument,
  issues: readonly ValidationIssue[],
  category: "reference" | "prototype",
): UiDiagnostic[] {
  return issues.map((issue) => {
    const documentIdentity = identity(document.kind, document.value, issue.path);
    return diagnostic({
      path: document.path,
      category: issue.code.startsWith("schema.") ? "schema" : category,
      code: issue.code,
      message: issue.message,
      owner: document.kind,
      nextAction: issue.code.startsWith("schema.") ? NEXT_ACTION.schema : NEXT_ACTION[category],
      ...(documentIdentity ? { identity: documentIdentity } : {}),
    });
  });
}

async function readDocument(
  sourceRoot: string,
  kind: UiDocumentKind,
  path: string,
  diagnostics: UiDiagnostic[],
): Promise<ValidDocument | undefined> {
  let text: string;
  try {
    text = await readFile(safeChildPath(sourceRoot, path), "utf8");
  } catch {
    diagnostics.push(
      diagnostic({
        path,
        category: "syntax",
        code: "document.read.failed",
        message: "Document could not be read.",
        owner: kind,
        nextAction: "Restore read access to this document and run check --full again.",
      }),
    );
    return undefined;
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    diagnostics.push(
      diagnostic({
        path,
        category: "syntax",
        code: "document.json.invalid",
        message: "Document is not valid JSON.",
        owner: kind,
        nextAction: NEXT_ACTION.json,
      }),
    );
    return undefined;
  }

  if (kind === "artifact") {
    const result = validateSourceReadiness(value);
    if (!result.valid) {
      diagnostics.push(
        ...result.issues.map((issue) => {
          const documentIdentity = identity(kind, value, issue.path);
          return diagnostic({
            path,
            category: issue.code.startsWith("schema.") ? "schema" : "source",
            code: issue.code,
            message: issue.message,
            owner: kind,
            nextAction: issue.code.startsWith("schema.") ? NEXT_ACTION.schema : NEXT_ACTION.source,
            ...(documentIdentity ? { identity: documentIdentity } : {}),
          });
        }),
      );
      return undefined;
    }
    const source = value as UiSource;
    if (text !== formatSource(source)) {
      const documentIdentity = identity(kind, source);
      diagnostics.push(
        diagnostic({
          path,
          severity: "warning",
          category: "canonical",
          code: "source.nonCanonical",
          message: "Source is valid but is not in canonical form.",
          owner: kind,
          safeFixable: true,
          nextAction: NEXT_ACTION.canonical,
          ...(documentIdentity ? { identity: documentIdentity } : {}),
        }),
      );
    }
    return { kind, path, text, value: source };
  }

  if (kind === "reference") {
    const result = validateReferenceShapeOnly(value);
    if (!result.valid) {
      const shell = { kind, path, text, value: value as UiReference } satisfies ReferenceDocument;
      diagnostics.push(...validationDiagnostics(shell, result.issues, "reference"));
      return undefined;
    }
    const reference = value as UiReference;
    if (text !== formatReference(reference)) {
      const documentIdentity = identity(kind, reference);
      diagnostics.push(
        diagnostic({
          path,
          severity: "warning",
          category: "canonical",
          code: "reference.nonCanonical",
          message: "Reference is valid but is not in canonical form.",
          owner: kind,
          safeFixable: true,
          nextAction: NEXT_ACTION.canonical,
          ...(documentIdentity ? { identity: documentIdentity } : {}),
        }),
      );
    }
    return { kind, path, text, value: reference };
  }

  const result = validatePrototypeShapeOnly(value);
  if (!result.valid) {
    const shell = { kind, path, text, value: value as UiPrototype } satisfies PrototypeDocument;
    diagnostics.push(...validationDiagnostics(shell, result.issues, "prototype"));
    return undefined;
  }
  const prototype = value as UiPrototype;
  if (text !== formatPrototype(prototype)) {
    const documentIdentity = identity(kind, prototype);
    diagnostics.push(
      diagnostic({
        path,
        severity: "warning",
        category: "canonical",
        code: "prototype.nonCanonical",
        message: "Prototype is valid but is not in canonical form.",
        owner: kind,
        safeFixable: true,
        nextAction: NEXT_ACTION.canonical,
        ...(documentIdentity ? { identity: documentIdentity } : {}),
      }),
    );
  }
  return { kind, path, text, value: prototype };
}

function capture(pattern: RegExp, message: string, index: number): string | undefined {
  return pattern.exec(message)?.[index];
}

function catalogErrorDiagnostic(error: unknown, documents: readonly ArtifactDocument[]): UiDiagnostic {
  const raw = error instanceof Error ? error.message : "";
  let code = "catalog.invalid";
  let message = "Source Catalog validation failed.";
  let artifactKey: string | undefined;

  const duplicateKey = /^Duplicate artifactKey '([^']+)'/.exec(raw);
  const duplicatePrefab = /^Duplicate prefabPath '([^']+)' for '([^']+)' and '([^']+)'/.exec(raw);
  const missingReference = /^Artifact '([^']+)' references missing artifact '([^']+)'/.exec(raw);
  const missingCatalog = /^Artifact '([^']+)' is missing from Source Catalog/.exec(raw);
  const circularVariant = /^Circular Variant base: (.+)$/.exec(raw);
  const circularDependency = /^Circular Artifact dependency: (.+)$/.exec(raw);
  const variantMismatch = /^Variant '([^']+)' type '([^']+)' does not match base '([^']+)' type '([^']+)'/.exec(raw);

  if (duplicateKey) {
    code = "catalog.duplicateArtifactKey";
    artifactKey = duplicateKey[1];
    message = `Artifact key '${artifactKey}' is declared by more than one Source.`;
  } else if (duplicatePrefab) {
    code = "catalog.duplicatePrefabPath";
    artifactKey = duplicatePrefab[3];
    message = `Prefab path '${duplicatePrefab[1]}' is owned by both '${duplicatePrefab[2]}' and '${duplicatePrefab[3]}'.`;
  } else if (missingReference) {
    code = "catalog.missingArtifact";
    artifactKey = missingReference[1];
    message = `Artifact '${missingReference[1]}' references missing artifact '${missingReference[2]}'.`;
  } else if (missingCatalog) {
    code = "catalog.missingArtifact";
    const missingKey = missingCatalog[1]!;
    const owner = documents.find((item) => item.value.sourceKind === "variant" && item.value.variantOf === missingKey);
    artifactKey = owner?.value.artifactKey;
    message = `Artifact '${missingKey}' is missing from the Source Catalog.`;
  } else if (circularVariant) {
    code = "catalog.circularVariant";
    artifactKey = circularVariant[1]!.split(" -> ")[0];
    message = `Variant base cycle detected: ${circularVariant[1]}.`;
  } else if (circularDependency) {
    code = "catalog.circularDependency";
    artifactKey = circularDependency[1]!.split(" -> ")[0];
    message = `Artifact dependency cycle detected: ${circularDependency[1]}.`;
  } else if (variantMismatch) {
    code = "catalog.variantTypeMismatch";
    artifactKey = variantMismatch[1];
    message = `Variant '${variantMismatch[1]}' type '${variantMismatch[2]}' does not match base '${variantMismatch[3]}' type '${variantMismatch[4]}'.`;
  } else if (raw.includes("Binding ") || raw.includes("binding ")) {
    code = "catalog.invalidBinding";
    artifactKey = capture(/Artifact '([^']+)'/, raw, 1) ?? capture(/Binding '([^'.]+)\./, raw, 1);
    message = "A binding cannot be resolved through the Source Catalog.";
  } else if (raw.includes("PrefabRef")) {
    code = "catalog.invalidPrefabRef";
    artifactKey = capture(/PrefabRef '([^'/]+)/, raw, 1);
    message = "A PrefabRef relationship is invalid in the Source Catalog.";
  } else if (raw.includes("Override") || raw.includes("override")) {
    code = "catalog.invalidOverride";
    artifactKey = capture(/Variant '([^']+)'/, raw, 1);
    message = "A Variant override cannot be resolved through the Source Catalog.";
  } else if (raw.includes("dependency")) {
    code = "catalog.invalidDependency";
    artifactKey = capture(/Artifact dependency '([^']+)'/, raw, 1);
    message = "An Artifact dependency is not allowed by the Source Catalog.";
  }

  const owner = artifactKey ? documents.find((item) => item.value.artifactKey === artifactKey) : undefined;
  const documentIdentity = owner ? identity("artifact", owner.value) : undefined;
  return diagnostic({
    path: owner?.path ?? ".",
    category: "catalog",
    code,
    message,
    owner: owner ? "artifact" : "workspace",
    nextAction: NEXT_ACTION.catalog,
    ...(documentIdentity ? { identity: documentIdentity } : {}),
  });
}

function duplicateCatalogDiagnostic(
  error: unknown,
  kind: "reference" | "prototype",
  documents: readonly (ReferenceDocument | PrototypeDocument)[],
): UiDiagnostic {
  const raw = error instanceof Error ? error.message : "";
  const keyName = kind === "reference" ? "referenceKey" : "prototypeKey";
  const match = new RegExp(`^Duplicate ${keyName} '([^']+)'`).exec(raw);
  const key = match?.[1];
  const owner = documents.find((item) => documentKey(kind, item.value) === key);
  const documentIdentity = owner ? identity(kind, owner.value) : undefined;
  return diagnostic({
    path: owner?.path ?? ".",
    category: kind,
    code: `${kind}.duplicateKey`,
    message: key
      ? `${kind === "reference" ? "Reference" : "Prototype"} key '${key}' is declared by more than one document.`
      : `${kind === "reference" ? "Reference" : "Prototype"} Catalog validation failed.`,
    owner: owner ? kind : "workspace",
    nextAction: NEXT_ACTION[kind],
    ...(documentIdentity ? { identity: documentIdentity } : {}),
  });
}

function compareDiagnostics(left: UiDiagnostic, right: UiDiagnostic): number {
  const severity = { error: 0, warning: 1 } as const;
  return (
    left.path.localeCompare(right.path) ||
    severity[left.severity] - severity[right.severity] ||
    left.category.localeCompare(right.category) ||
    left.code.localeCompare(right.code) ||
    (left.identity?.fieldPath ?? "").localeCompare(right.identity?.fieldPath ?? "") ||
    left.message.localeCompare(right.message)
  );
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, stableJsonValue((value as Record<string, unknown>)[key])]),
  );
}

function referenceEvidenceSignature(reference: UiReference, sourceCatalog: SourceCatalog): string {
  const comparable = structuredClone(reference) as UiReference & { description?: string; referenceKey: string };
  delete comparable.description;
  comparable.referenceKey = comparable.subjectArtifactKey;
  return JSON.stringify(stableJsonValue(JSON.parse(formatReference(comparable, sourceCatalog))));
}

function referenceIntentDiagnostics(
  references: readonly ReferenceDocument[],
  prototypes: readonly PrototypeDocument[],
  sourceCatalog: SourceCatalog,
  referenceCatalog: ReferenceCatalog,
): UiDiagnostic[] {
  const result: UiDiagnostic[] = [];
  const referenceInputs = references.map((item) => ({ path: item.path, reference: item.value }));
  const prototypeInputs = prototypes.map((item) => ({ path: item.path, prototype: item.value }));
  for (const item of references) {
    const entry = referenceCatalog.entries.get(item.value.referenceKey);
    if (!entry || entry.defaultForArtifactKey) continue;
    const documentIdentity = identity("reference", item.value);
    const defaultEntry = referenceCatalog.defaults.get(item.value.subjectArtifactKey);
    if (
      defaultEntry &&
      referenceEvidenceSignature(item.value, sourceCatalog) === referenceEvidenceSignature(defaultEntry.reference, sourceCatalog)
    ) {
      result.push(
        diagnostic({
          path: item.path,
          severity: "warning",
          category: "reference",
          code: "reference.duplicatesDefaultEvidence",
          message: `Named Reference '${item.value.referenceKey}' has the same preview evidence as default Reference '${defaultEntry.reference.referenceKey}'.`,
          owner: "reference",
          nextAction: `Use default Reference '${defaultEntry.reference.referenceKey}' or add distinct visible evidence.`,
          ...(documentIdentity ? { identity: documentIdentity } : {}),
        }),
      );
    }
    if (findReferenceUseSites(referenceInputs, prototypeInputs, item.value.referenceKey).length === 0 && !item.value.description?.trim()) {
      result.push(
        diagnostic({
          path: item.path,
          severity: "warning",
          category: "reference",
          code: "reference.unclassifiedStandalone",
          message: `Named Reference '${item.value.referenceKey}' has no inbound use and no standalone review description.`,
          owner: "reference",
          nextAction: "Reference it from a Prototype or preset, add a standalone review description, or delete it.",
          ...(documentIdentity ? { identity: documentIdentity } : {}),
        }),
      );
    }
  }
  return result;
}

function unusedDeliveredWidgetDiagnostics(candidates: readonly UnusedDeliveredWidgetCandidate[]): UiDiagnostic[] {
  return candidates.map((candidate) => {
    const ownerEvidence =
      candidate.abstractOwnerPaths.length > 0
        ? ` Only abstract program owner(s) remain: ${candidate.abstractOwnerPaths.join(", ")}.`
        : " No program owner maps to this View Artifact.";
    return diagnostic({
      path: candidate.sourcePath,
      severity: "warning",
      category: "catalog",
      code: "usage.deliveredWidgetWithoutConsumer",
      message: `Delivered Widget '${candidate.artifactKey}' has no inbound Artifact dependency or concrete runtime owner.${ownerEvidence}`,
      owner: "artifact",
      nextAction:
        "Review runtime and design intent manually. Keep intentional work; delete an obsolete Source, Reference, DeliveryState, Prefab, generated binding, and program owner only as one confirmed delivery unit.",
      identity: { documentKind: "artifact", documentKey: candidate.artifactKey },
    });
  });
}

function bindingNamingDiagnostics(documents: readonly ArtifactDocument[]): UiDiagnostic[] {
  return documents.flatMap((document) =>
    (document.value.bindings ?? []).flatMap((binding, declarationIndex) =>
      auditBindingName(binding.name, binding.target.componentType).map((violation) =>
        diagnostic({
          path: document.path,
          category: "source",
          code: violation.code,
          message: violation.message,
          owner: "artifact",
          nextAction: NEXT_ACTION.bindingNaming,
          identity: {
            documentKind: "artifact",
            documentKey: document.value.artifactKey,
            fieldPath: `/bindings/${declarationIndex}/name`,
          },
        }),
      ),
    ),
  );
}

function flattenEvaluatedNodes(root: EvaluatedNode): readonly EvaluatedNode[] {
  return [root, ...root.children.flatMap(flattenEvaluatedNodes)];
}

function formatMetric(value: number): string {
  return Number(value.toFixed(2)).toString();
}

async function finiteTextOverflowDiagnostics(
  artifacts: readonly ArtifactDocument[],
  sourceCatalog: SourceCatalog,
  assets: AssetIndex,
): Promise<UiDiagnostic[]> {
  const result: UiDiagnostic[] = [];
  for (const document of artifacts) {
    const entry = sourceCatalog.entries.get(document.value.artifactKey);
    if (!entry) continue;
    const fontPaths = [
      ...new Set(
        walkNodes(entry.resolvedSource).flatMap(({ node }) =>
          node.components?.Text ? [node.components.Text.font ?? DEFAULT_UI_FONT_ASSET] : [],
        ),
      ),
    ];
    const fontMetrics = new Map<string, Awaited<ReturnType<AssetIndex["tmpFontMetrics"]>>>();
    for (const fontPath of fontPaths) {
      try {
        fontMetrics.set(fontPath, await assets.tmpFontMetrics(fontPath));
      } catch {
        // Missing or incomplete font assets are reported by the resource audit. Do not
        // turn the layout diagnostic into a second error or a false positive.
      }
    }
    const evaluated = evaluateLayout(entry.resolvedSource, undefined, {
      intrinsic: {
        measureText: (node, availableWidth) => {
          const font = node.components?.Text?.font ?? DEFAULT_UI_FONT_ASSET;
          const metrics = fontMetrics.get(font);
          if (!metrics) return undefined;
          try {
            return measureTmpText(metrics, node, availableWidth);
          } catch {
            return undefined;
          }
        },
      },
    });
    for (const evaluatedNode of flattenEvaluatedNodes(evaluated)) {
      const evaluated = evaluatedNode;
      const text = evaluated.node.components?.Text;
      const overflow = text?.overflow ?? "overflow";
      if (!text || (overflow !== "ellipsis" && overflow !== "truncate")) continue;
      const font = text.font ?? DEFAULT_UI_FONT_ASSET;
      let firstLineHeight: number;
      try {
        firstLineHeight = tmpTextFirstLineHeight(await assets.tmpFontMetrics(font), evaluated.node)!;
      } catch {
        continue;
      }
      if (evaluated.rect.height + 0.0001 >= firstLineHeight) continue;
      const mode = overflow === "ellipsis" ? "Ellipsis" : "Truncate";
      result.push(
        diagnostic({
          path: document.path,
          severity: "warning",
          category: "source",
          code: "text.finiteOverflowInsufficientHeight",
          message: `Text node '${evaluated.node.id}' uses ${mode} with height ${formatMetric(evaluated.rect.height)}, below the TMP first-line height ${formatMetric(firstLineHeight)} at font size ${formatMetric(text.fontSize ?? 24)}.`,
          owner: "artifact",
          nextAction: "Increase the Text rect height, reduce its font size, or use Overflow when the content must not be suppressed.",
          identity: {
            documentKind: "artifact",
            documentKey: document.value.artifactKey,
            nodeId: evaluated.node.id,
            fieldPath: "components.Text.overflow",
          },
        }),
      );
    }
  }
  return result;
}

export async function doctorWorkspace(
  sourceRoot: string,
  assetRoot: string,
  unityAssetsRoot?: string,
  referenceAssetsRoot = join(dirname(sourceRoot), "ReferenceAssets"),
  repoRoot?: string,
): Promise<UiDoctorReport> {
  const [artifactPaths, referencePaths, prototypePaths] = await Promise.all([
    listFiles(sourceRoot, ".ui.json"),
    listFiles(sourceRoot, ".ui-reference.json"),
    listFiles(sourceRoot, ".ui-prototype.json"),
  ]);
  const diagnostics: UiDiagnostic[] = [];
  const loaded = await Promise.all([
    ...artifactPaths.map((path) => readDocument(sourceRoot, "artifact", path, diagnostics)),
    ...referencePaths.map((path) => readDocument(sourceRoot, "reference", path, diagnostics)),
    ...prototypePaths.map((path) => readDocument(sourceRoot, "prototype", path, diagnostics)),
  ]);
  const artifacts = loaded.filter((item): item is ArtifactDocument => item?.kind === "artifact");
  const references = loaded.filter((item): item is ReferenceDocument => item?.kind === "reference");
  const prototypes = loaded.filter((item): item is PrototypeDocument => item?.kind === "prototype");
  const assets = new AssetIndex(assetRoot);

  let sourceCatalog: SourceCatalog | undefined;
  try {
    sourceCatalog = createSourceCatalog(artifacts.map((item) => ({ path: item.path, source: item.value })));
  } catch (error) {
    diagnostics.push(catalogErrorDiagnostic(error, artifacts));
  }
  diagnostics.push(...bindingNamingDiagnostics(artifacts));

  let referenceCatalog: ReferenceCatalog | undefined;
  try {
    referenceCatalog = createReferenceCatalog(
      references.map((item) => ({ path: item.path, reference: item.value })),
      sourceCatalog,
    );
  } catch (error) {
    diagnostics.push(duplicateCatalogDiagnostic(error, "reference", references));
  }
  if (sourceCatalog && referenceCatalog) {
    for (const item of references) {
      const result = validateReference(item.value, sourceCatalog, referenceCatalog);
      diagnostics.push(...validationDiagnostics(item, result.issues, "reference"));
      if (
        result.valid &&
        item.text !== formatReference(item.value, sourceCatalog) &&
        !diagnostics.some((entry) => entry.path === item.path && entry.code === "reference.nonCanonical")
      ) {
        const documentIdentity = identity("reference", item.value);
        diagnostics.push(
          diagnostic({
            path: item.path,
            severity: "warning",
            category: "canonical",
            code: "reference.nonCanonical",
            message: "Reference contains redundant preview overrides or is not in canonical form.",
            owner: "reference",
            safeFixable: true,
            nextAction: NEXT_ACTION.canonical,
            ...(documentIdentity ? { identity: documentIdentity } : {}),
          }),
        );
      }
      for (const [index, image] of (item.value.backdrop?.images ?? []).entries()) {
        try {
          const file = await stat(safeChildPath(referenceAssetsRoot, image.path));
          if (!file.isFile()) throw new Error("not a file");
        } catch {
          diagnostics.push(
            diagnostic({
              path: item.path,
              category: "resource",
              code: "reference.backdropMissing",
              message: `Reference backdrop '${image.path}' is missing.`,
              owner: "reference",
              nextAction: NEXT_ACTION.resource,
              identity: {
                documentKind: "reference",
                documentKey: item.value.referenceKey,
                fieldPath: `/backdrop/images/${index}/path`,
              },
            }),
          );
        }
      }
    }
  }

  try {
    createPrototypeCatalog(prototypes.map((item) => ({ path: item.path, prototype: item.value })));
  } catch (error) {
    diagnostics.push(duplicateCatalogDiagnostic(error, "prototype", prototypes));
  }
  if (sourceCatalog && referenceCatalog) {
    for (const item of prototypes) {
      diagnostics.push(...validationDiagnostics(item, validatePrototype(item.value, referenceCatalog, sourceCatalog).issues, "prototype"));
    }
    diagnostics.push(...referenceIntentDiagnostics(references, prototypes, sourceCatalog, referenceCatalog));
  }

  if (sourceCatalog && referenceCatalog) {
    const referencesToCheck = references.filter((item) => validateReference(item.value, sourceCatalog, referenceCatalog).valid);
    const prototypesToCheck = prototypes.filter((item) => validatePrototype(item.value, referenceCatalog, sourceCatalog).valid);
    const assetReferences = [
      ...artifacts.flatMap((item) => collectSourceAssetReferences({ path: item.path, source: item.value }, sourceCatalog)),
      ...referencesToCheck.flatMap((item) => collectReferenceAssetReferences({ path: item.path, reference: item.value }, sourceCatalog)),
      ...prototypesToCheck.flatMap((item) =>
        collectPrototypeSessionAssetReferences({ path: item.path, prototype: item.value }, referenceCatalog, sourceCatalog),
      ),
    ];
    for (const reference of assetReferences) {
      try {
        await assets.asset(reference.kind, reference.path);
      } catch (error) {
        if (!(error instanceof AssetValidationError)) throw error;
        const code =
          error.code === "resource.missing"
            ? reference.kind === "image"
              ? "resource.spriteMissing"
              : reference.kind === "font"
                ? "resource.fontMissing"
                : reference.kind === "animationClip"
                  ? "resource.animationClipMissing"
                  : "resource.animatorControllerMissing"
            : error.code === "resource.metrics"
              ? reference.kind === "image"
                ? "resource.spriteInvalid"
                : reference.kind === "font"
                  ? "resource.fontInvalid"
                  : reference.kind === "animationClip"
                    ? "resource.animationClipInvalid"
                    : "resource.animatorControllerInvalid"
              : error.code;
        diagnostics.push(
          diagnostic({
            path: reference.documentPath,
            category: "resource",
            code,
            message: error.message,
            owner: reference.documentKind,
            nextAction: NEXT_ACTION.resource,
            identity: {
              documentKind: reference.documentKind,
              documentKey: reference.documentKey,
              ...(reference.nodeId ? { nodeId: reference.nodeId } : {}),
              fieldPath: reference.fieldPath,
            },
          }),
        );
      }
    }
  }

  if (sourceCatalog) diagnostics.push(...(await finiteTextOverflowDiagnostics(artifacts, sourceCatalog, assets)));
  if (sourceCatalog && repoRoot) {
    diagnostics.push(...unusedDeliveredWidgetDiagnostics(await auditUnusedDeliveredWidgets(repoRoot, sourceCatalog)));
  }

  if (unityAssetsRoot) {
    const catalog = await new AssetIndex(assetRoot, { unityAssetsRoot }).catalog();
    for (const issue of catalog.issues.filter((entry) => entry.code.startsWith("resource.defaultFont"))) {
      diagnostics.push(
        diagnostic({
          path: `Assets/Resources/UI/${issue.path}`,
          category: "resource",
          code: issue.code,
          message: issue.message,
          owner: "workspace",
          nextAction: NEXT_ACTION.resource,
        }),
      );
    }
  }

  diagnostics.sort(compareDiagnostics);
  return {
    root: ".",
    files: { artifact: artifactPaths.length, reference: referencePaths.length, prototype: prototypePaths.length },
    summary: {
      errors: diagnostics.filter((item) => item.severity === "error").length,
      warnings: diagnostics.filter((item) => item.severity === "warning").length,
      safeFixable: diagnostics.filter((item) => item.safeFixable).length,
    },
    diagnostics,
  };
}

export function doctorWorkspaceForPaths(paths: WorkspacePaths): Promise<UiDoctorReport> {
  return doctorWorkspace(paths.sourceRoot, paths.assetRoot, paths.unityAssetsRoot, referenceAssetRoot(paths), paths.repoRoot);
}
