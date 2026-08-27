import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import {
  createPrototypeCatalog,
  createReferenceCatalog,
  type PrototypeCatalog,
  type ReferenceCatalog,
  validatePrototype,
  validatePrototypeShapeOnly,
  validateReference,
  validateReferenceShapeOnly,
} from "../kernel/prototype.js";
import { createSourceCatalog, type SourceCatalog, type SourceCatalogInput } from "../kernel/source-catalog.js";
import { walkNodes } from "../kernel/tree.js";
import { type ValidationResult, validateSource } from "../kernel/validation.js";
import type { CatalogUnavailableDocument } from "../schema/ui-api.js";
import type { UiDiagnostic, UiDiagnosticCategory, UiDocumentKind } from "../schema/ui-diagnostics.js";
import type { UiPrototype, UiReference } from "../schema/ui-prototype-schema.js";
import type { UiSource } from "../schema/ui-source-schema.js";
import { documentRevision } from "./document-revision.js";
import { listFiles, safeChildPath } from "./workspace.js";

interface ParsedDocument<T> {
  readonly kind: UiDocumentKind;
  readonly path: string;
  readonly value: T;
  readonly key: string;
  readonly revision: string;
  readonly artifactType?: "Canvas" | "Widget" | "Fragment";
  readonly modifiedAt?: number;
}

export interface PartialWorkspaceCatalog {
  readonly sourceCatalog: SourceCatalog;
  readonly referenceCatalog: ReferenceCatalog;
  readonly prototypeCatalog: PrototypeCatalog;
  readonly documents: PartialWorkspaceDocuments;
  readonly unavailable: readonly CatalogUnavailableDocument[];
  readonly repairRelations: ReadonlyMap<string, RepairDocumentRelations>;
  readonly problems: readonly UiDiagnostic[];
}

interface RepairDocumentRelations {
  readonly kind: UiDocumentKind;
  readonly path: string;
  readonly key: string;
  /** null means the document could not be parsed, so independence cannot be proven. */
  readonly artifactKeys: readonly string[] | null;
  /** null means an unreadable Prototype may reference any Reference. */
  readonly referenceKeys: readonly string[] | null;
}

interface PartialWorkspaceDocuments {
  readonly artifacts: readonly {
    readonly path: string;
    readonly source: UiSource;
    readonly revision: string;
    readonly modifiedAt?: number;
  }[];
  readonly references: readonly {
    readonly path: string;
    readonly reference: UiReference;
    readonly revision: string;
    readonly modifiedAt?: number;
  }[];
  readonly prototypes: readonly {
    readonly path: string;
    readonly prototype: UiPrototype;
    readonly revision: string;
    readonly modifiedAt?: number;
  }[];
}

const NEXT_ACTION = "Fix this blocking document problem and reload the workspace.";

function documentKey(kind: UiDocumentKind, value: unknown, path: string): string {
  if (value && typeof value === "object") {
    const key = (value as Record<string, unknown>)[
      kind === "artifact" ? "artifactKey" : kind === "reference" ? "referenceKey" : "prototypeKey"
    ];
    if (typeof key === "string" && key.length > 0) return key;
  }
  return basename(path).replace(/\.ui(?:-reference|-prototype)?\.json$/, "");
}

function artifactType(value: unknown): "Canvas" | "Widget" | "Fragment" | undefined {
  if (!value || typeof value !== "object") return undefined;
  const type = (value as Record<string, unknown>).artifactType;
  return type === "Canvas" || type === "Widget" || type === "Fragment" ? type : undefined;
}

function diagnostic(
  kind: UiDocumentKind,
  path: string,
  key: string,
  category: UiDiagnosticCategory,
  code: string,
  message: string,
  fieldPath?: string,
): UiDiagnostic {
  return {
    path,
    severity: "error",
    category,
    code,
    message,
    owner: kind,
    safeFixable: false,
    nextAction: NEXT_ACTION,
    identity: { documentKind: kind, documentKey: key, ...(fieldPath ? { fieldPath } : {}) },
  };
}

function validationDiagnostics(kind: UiDocumentKind, path: string, key: string, result: ValidationResult): UiDiagnostic[] {
  const fallbackCategory: UiDiagnosticCategory = kind === "artifact" ? "source" : kind;
  return result.issues.map((issue) =>
    diagnostic(kind, path, key, issue.code.startsWith("schema.") ? "schema" : fallbackCategory, issue.code, issue.message, issue.path),
  );
}

async function readDocument<T>(
  sourceRoot: string,
  kind: UiDocumentKind,
  path: string,
  validate: (value: unknown) => ValidationResult,
  unavailable: CatalogUnavailableDocument[],
  problems: UiDiagnostic[],
  repairRelations: Map<string, RepairDocumentRelations>,
): Promise<ParsedDocument<T> | undefined> {
  let modifiedAt: number | undefined;
  try {
    modifiedAt = (await stat(safeChildPath(sourceRoot, path))).mtimeMs;
  } catch {
    // The read below owns the blocking diagnostic.
  }

  let text: string;
  try {
    text = await readFile(safeChildPath(sourceRoot, path), "utf8");
  } catch {
    const key = documentKey(kind, undefined, path);
    repairRelations.set(path, unknownRepairRelations(kind, path, key));
    unavailable.push({ kind, path, key, ...(modifiedAt === undefined ? {} : { modifiedAt }) });
    problems.push(diagnostic(kind, path, key, "syntax", "document.read.failed", "Document could not be read."));
    return undefined;
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    const key = documentKey(kind, undefined, path);
    repairRelations.set(path, unknownRepairRelations(kind, path, key));
    unavailable.push({ kind, path, key, ...(modifiedAt === undefined ? {} : { modifiedAt }) });
    problems.push(diagnostic(kind, path, key, "syntax", "document.json.invalid", "Document is not valid JSON."));
    return undefined;
  }

  const key = documentKey(kind, value, path);
  repairRelations.set(path, knownRepairRelations(kind, path, key, value));
  const result = validate(value);
  if (!result.valid) {
    const type = kind === "artifact" ? artifactType(value) : undefined;
    unavailable.push({ kind, path, key, ...(type ? { artifactType: type } : {}), ...(modifiedAt === undefined ? {} : { modifiedAt }) });
    problems.push(...validationDiagnostics(kind, path, key, result));
    return undefined;
  }

  const type = kind === "artifact" ? artifactType(value) : undefined;
  return {
    kind,
    path,
    value: value as T,
    key,
    revision: documentRevision(kind, value as UiSource | UiReference | UiPrototype),
    ...(type ? { artifactType: type } : {}),
    ...(modifiedAt === undefined ? {} : { modifiedAt }),
  };
}

function unknownRepairRelations(kind: UiDocumentKind, path: string, key: string): RepairDocumentRelations {
  return {
    kind,
    path,
    key,
    artifactKeys: null,
    referenceKeys: kind === "prototype" ? null : [],
  };
}

function knownRepairRelations(kind: UiDocumentKind, path: string, key: string, value: unknown): RepairDocumentRelations {
  return {
    kind,
    path,
    key,
    artifactKeys: referencedKeys(
      value,
      new Set(["artifactKey", "rootArtifactKey", "subjectArtifactKey", "parentArtifactKey", "variantOf"]),
      kind === "artifact" ? "artifactKey" : undefined,
    ),
    referenceKeys: kind === "prototype" ? referencedKeys(value, new Set(["referenceKey", "startReferenceKey"]), "prototypeKey") : [],
  };
}

function referencedKeys(value: unknown, propertyNames: ReadonlySet<string>, rootIdentityProperty?: string): readonly string[] {
  const result = new Set<string>();
  const visit = (current: unknown, root: boolean): void => {
    if (Array.isArray(current)) {
      for (const item of current) visit(item, false);
      return;
    }
    if (!current || typeof current !== "object") return;
    for (const [property, child] of Object.entries(current as Record<string, unknown>)) {
      if (!(root && property === rootIdentityProperty) && propertyNames.has(property) && typeof child === "string" && child.length > 0) {
        result.add(child);
      }
      visit(child, false);
    }
  };
  visit(value, true);
  return [...result].sort();
}

function sourceDeclaresDependency(source: UiSource, artifactKey: string): boolean {
  if (source.sourceKind === "variant") return source.variantOf === artifactKey;
  return walkNodes(source).some(({ node }) => node.components?.PrefabRef?.artifactKey === artifactKey);
}

function catalogErrorOwners(error: unknown, documents: readonly ParsedDocument<UiSource>[]): ParsedDocument<UiSource>[] {
  const raw = error instanceof Error ? error.message : String(error);
  const byKey = new Map(documents.map((document) => [document.value.artifactKey, document]));
  const byPath = new Map(documents.map((document) => [document.path, document]));
  const keys = new Set<string>();
  const paths = new Set<string>();

  const duplicate = /^Duplicate artifactKey '[^']+' in '([^']+)' and '([^']+)'/.exec(raw);
  if (duplicate) {
    paths.add(duplicate[1]!);
    paths.add(duplicate[2]!);
  }
  const caseInsensitive = /^Duplicate case-insensitive artifactKey '([^']+)' and '([^']+)'/.exec(raw);
  if (caseInsensitive) {
    keys.add(caseInsensitive[1]!);
    keys.add(caseInsensitive[2]!);
  }
  const missing = /^Artifact '([^']+)' is missing from Source Catalog/.exec(raw);
  if (missing) {
    for (const document of documents) {
      if (sourceDeclaresDependency(document.value, missing[1]!)) keys.add(document.value.artifactKey);
    }
  }
  const cycle = /^Circular Variant base: (.+)$/.exec(raw);
  if (cycle) for (const key of cycle[1]!.split(" -> ")) keys.add(key);

  for (const pattern of [
    /^Artifact '([^']+)' references missing artifact/,
    /^Artifact '([^']+)'/,
    /^Artifact Variant '([^']+)'/,
    /^Variant '([^']+)'/,
    /^PrefabRef '([^'/]+)\//,
    /^Preview collection '([^'/]+)\//,
    /^Binding '([^'.]+)\./,
  ]) {
    const match = pattern.exec(raw);
    if (match) keys.add(match[1]!);
  }

  const owners = new Set<ParsedDocument<UiSource>>();
  for (const key of keys) {
    const owner = byKey.get(key);
    if (owner) owners.add(owner);
  }
  for (const path of paths) {
    const owner = byPath.get(path);
    if (owner) owners.add(owner);
  }
  return [...owners];
}

function blockDocuments<T>(
  documents: readonly ParsedDocument<T>[],
  category: UiDiagnosticCategory,
  code: string,
  message: string,
  unavailable: CatalogUnavailableDocument[],
  problems: UiDiagnostic[],
): void {
  for (const document of documents) {
    unavailable.push({
      kind: document.kind,
      path: document.path,
      key: document.key,
      ...(document.artifactType ? { artifactType: document.artifactType } : {}),
      ...(document.modifiedAt === undefined ? {} : { modifiedAt: document.modifiedAt }),
    });
    problems.push(diagnostic(document.kind, document.path, document.key, category, code, message));
  }
}

function createPartialSourceCatalog(
  documents: readonly ParsedDocument<UiSource>[],
  unavailable: CatalogUnavailableDocument[],
  problems: UiDiagnostic[],
): { readonly catalog: SourceCatalog; readonly documents: readonly ParsedDocument<UiSource>[] } {
  let retained = [...documents];
  while (true) {
    try {
      return {
        catalog: createSourceCatalog(
          retained.map((document) => ({ path: document.path, source: document.value }) satisfies SourceCatalogInput),
        ),
        documents: retained,
      };
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const owners = catalogErrorOwners(error, retained);
      const blocked = owners.length > 0 ? owners : retained.slice(0, 1);
      if (blocked.length === 0) return { catalog: createSourceCatalog([]), documents: [] };
      blockDocuments(blocked, "catalog", "catalog.blocked", raw, unavailable, problems);
      const blockedPaths = new Set(blocked.map((document) => document.path));
      retained = retained.filter((document) => !blockedPaths.has(document.path));
    }
  }
}

function removeDuplicateKeys<T>(
  documents: readonly ParsedDocument<T>[],
  category: "reference" | "prototype",
  unavailable: CatalogUnavailableDocument[],
  problems: UiDiagnostic[],
): ParsedDocument<T>[] {
  const groups = new Map<string, ParsedDocument<T>[]>();
  for (const document of documents) {
    const group = groups.get(document.key) ?? [];
    group.push(document);
    groups.set(document.key, group);
  }
  const duplicates = [...groups.values()].filter((group) => group.length > 1).flat();
  if (duplicates.length > 0)
    blockDocuments(duplicates, category, `${category}.duplicateKey`, `Duplicate ${category} key.`, unavailable, problems);
  const duplicatePaths = new Set(duplicates.map((document) => document.path));
  return documents.filter((document) => !duplicatePaths.has(document.path));
}

function compareProblems(left: UiDiagnostic, right: UiDiagnostic): number {
  return (
    left.path.localeCompare(right.path) ||
    left.category.localeCompare(right.category) ||
    left.code.localeCompare(right.code) ||
    (left.identity?.fieldPath ?? "").localeCompare(right.identity?.fieldPath ?? "")
  );
}

export async function loadPartialWorkspaceCatalog(sourceRoot: string): Promise<PartialWorkspaceCatalog> {
  const [artifactPaths, referencePaths, prototypePaths] = await Promise.all([
    listFiles(sourceRoot, ".ui.json"),
    listFiles(sourceRoot, ".ui-reference.json"),
    listFiles(sourceRoot, ".ui-prototype.json"),
  ]);
  const unavailable: CatalogUnavailableDocument[] = [];
  const problems: UiDiagnostic[] = [];
  const repairRelations = new Map<string, RepairDocumentRelations>();
  const loaded = await Promise.all([
    ...artifactPaths.map((path) =>
      readDocument<UiSource>(sourceRoot, "artifact", path, validateSource, unavailable, problems, repairRelations),
    ),
    ...referencePaths.map((path) =>
      readDocument<UiReference>(sourceRoot, "reference", path, validateReferenceShapeOnly, unavailable, problems, repairRelations),
    ),
    ...prototypePaths.map((path) =>
      readDocument<UiPrototype>(sourceRoot, "prototype", path, validatePrototypeShapeOnly, unavailable, problems, repairRelations),
    ),
  ]);
  const artifacts = loaded.filter((document): document is ParsedDocument<UiSource> => document?.kind === "artifact");
  const references = loaded.filter((document): document is ParsedDocument<UiReference> => document?.kind === "reference");
  const prototypes = loaded.filter((document): document is ParsedDocument<UiPrototype> => document?.kind === "prototype");

  const partialSources = createPartialSourceCatalog(artifacts, unavailable, problems);
  const uniqueReferences = removeDuplicateKeys(references, "reference", unavailable, problems);
  const candidateReferenceCatalog = createReferenceCatalog(
    uniqueReferences.map((document) => ({ path: document.path, reference: document.value })),
  );
  const validReferences: ParsedDocument<UiReference>[] = [];
  for (const document of uniqueReferences) {
    const result = validateReference(document.value, partialSources.catalog, candidateReferenceCatalog);
    if (result.valid) validReferences.push(document);
    else {
      blockDocuments([document], "reference", "reference.blocked", "Reference dependencies cannot be resolved.", unavailable, problems);
      problems.push(...validationDiagnostics("reference", document.path, document.key, result));
    }
  }
  const referenceCatalog = createReferenceCatalog(validReferences.map((document) => ({ path: document.path, reference: document.value })));

  const uniquePrototypes = removeDuplicateKeys(prototypes, "prototype", unavailable, problems);
  const validPrototypes: ParsedDocument<UiPrototype>[] = [];
  for (const document of uniquePrototypes) {
    const result = validatePrototype(document.value, referenceCatalog, partialSources.catalog);
    if (result.valid) validPrototypes.push(document);
    else {
      blockDocuments([document], "prototype", "prototype.blocked", "Prototype dependencies cannot be resolved.", unavailable, problems);
      problems.push(...validationDiagnostics("prototype", document.path, document.key, result));
    }
  }
  const prototypeCatalog = createPrototypeCatalog(validPrototypes.map((document) => ({ path: document.path, prototype: document.value })));

  return {
    sourceCatalog: partialSources.catalog,
    referenceCatalog,
    prototypeCatalog,
    documents: {
      artifacts: partialSources.documents.map((document) => ({
        path: document.path,
        source: document.value,
        revision: document.revision,
        ...(document.modifiedAt === undefined ? {} : { modifiedAt: document.modifiedAt }),
      })),
      references: validReferences.map((document) => ({
        path: document.path,
        reference: document.value,
        revision: document.revision,
        ...(document.modifiedAt === undefined ? {} : { modifiedAt: document.modifiedAt }),
      })),
      prototypes: validPrototypes.map((document) => ({
        path: document.path,
        prototype: document.value,
        revision: document.revision,
        ...(document.modifiedAt === undefined ? {} : { modifiedAt: document.modifiedAt }),
      })),
    },
    unavailable: unavailable.sort((left, right) => left.path.localeCompare(right.path)),
    repairRelations: new Map(
      unavailable.map((document) => [
        document.path,
        repairRelations.get(document.path) ?? unknownRepairRelations(document.kind, document.path, document.key),
      ]),
    ),
    problems: problems.sort(compareProblems),
  };
}
