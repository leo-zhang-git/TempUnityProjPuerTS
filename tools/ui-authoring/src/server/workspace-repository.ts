import { type FSWatcher, watch } from "node:fs";
import { stat } from "node:fs/promises";
import {
  assertValidPrototype,
  assertValidReference,
  createPrototypeCatalog,
  createReferenceCatalog,
  type PrototypeCatalog,
  type ReferenceCatalog,
} from "../kernel/prototype.js";
import { createSourceCatalog, type SourceCatalog } from "../kernel/source-catalog.js";
import type { CatalogUnavailableDocument } from "../schema/ui-api.js";
import type { UiDiagnostic } from "../schema/ui-diagnostics.js";
import type { UiPrototype, UiReference } from "../schema/ui-prototype-schema.js";
import type { UiSource } from "../schema/ui-source-schema.js";
import { listFiles, safeChildPath } from "./workspace.js";
import { loadPartialWorkspaceCatalog, type PartialWorkspaceCatalog } from "./workspace-catalog.js";

export interface WorkspaceSnapshot {
  readonly revision: number;
  readonly fingerprint: string;
  readonly partial: PartialWorkspaceCatalog;
}

export interface WorkspaceRepositoryOptions {
  readonly freshnessIntervalMs?: number;
}

export interface WorkspaceRepairChanges {
  readonly artifacts: {
    readonly upserts: readonly { readonly path: string; readonly key: string }[];
    readonly deletePaths: ReadonlySet<string>;
  };
  readonly references: readonly { readonly path: string; readonly key: string }[];
  readonly prototypes: readonly { readonly path: string; readonly key: string }[];
}

export class WorkspaceDocumentUnavailableError extends Error {
  constructor(
    readonly document: CatalogUnavailableDocument,
    readonly problem: UiDiagnostic | undefined,
  ) {
    const field = problem?.identity?.fieldPath ? `，字段 ${problem.identity.fieldPath}` : "";
    const reason = problem?.message ?? "文档当前不可用";
    super(`文档“${document.path}”无法参与完整工作区校验${field}：${reason}`);
    this.name = "WorkspaceDocumentUnavailableError";
  }
}

export class WorkspaceRepository {
  readonly #freshnessIntervalMs: number;
  #revision = 0;
  #generation = 0;
  #snapshot: WorkspaceSnapshot | undefined;
  #pending: { readonly generation: number; readonly promise: Promise<WorkspaceSnapshot> } | undefined;
  #lastCheckedAt = 0;
  #watcher: FSWatcher | undefined;
  #watchInvalidateTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    readonly sourceRoot: string,
    options: WorkspaceRepositoryOptions = {},
  ) {
    this.#freshnessIntervalMs = options.freshnessIntervalMs ?? 1_000;
  }

  invalidate(): void {
    this.#generation += 1;
    this.#snapshot = undefined;
    this.#lastCheckedAt = 0;
  }

  startWatching(): void {
    if (this.#watcher) return;
    try {
      this.#watcher = watch(this.sourceRoot, { recursive: true }, (_eventType, filename) => {
        const path = typeof filename === "string" ? filename.replaceAll("\\", "/") : "";
        if (path && !path.endsWith(".json")) return;
        this.#scheduleInvalidate();
      });
    } catch {
      // Fingerprint checks remain the portable fallback when recursive watch is unavailable.
    }
  }

  close(): void {
    this.#watcher?.close();
    this.#watcher = undefined;
    if (this.#watchInvalidateTimer !== undefined) clearTimeout(this.#watchInvalidateTimer);
    this.#watchInvalidateTimer = undefined;
  }

  async snapshot(): Promise<WorkspaceSnapshot> {
    const now = Date.now();
    if (this.#snapshot && now - this.#lastCheckedAt < this.#freshnessIntervalMs) return this.#snapshot;
    const generation = this.#generation;
    if (this.#pending?.generation === generation) return this.#pending.promise;
    const pending = { generation, promise: this.#refresh(now, generation) };
    this.#pending = pending;
    try {
      return await pending.promise;
    } finally {
      if (this.#pending === pending) this.#pending = undefined;
    }
  }

  async partial(): Promise<PartialWorkspaceCatalog> {
    return (await this.snapshot()).partial;
  }

  assertRepairWorkspaceAvailable(partial: PartialWorkspaceCatalog, changes: WorkspaceRepairChanges): void {
    const replacedPaths = new Set([
      ...changes.artifacts.deletePaths,
      ...changes.artifacts.upserts.map((entry) => entry.path),
      ...changes.references.map((entry) => entry.path),
      ...changes.prototypes.map((entry) => entry.path),
    ]);
    this.#assertRepairIdentityAvailable(partial, "artifact", changes.artifacts.upserts, replacedPaths);
    this.#assertRepairIdentityAvailable(partial, "reference", changes.references, replacedPaths);
    this.#assertRepairIdentityAvailable(partial, "prototype", changes.prototypes, replacedPaths);

    const changedArtifactKeys = new Set(changes.artifacts.upserts.map((entry) => entry.key));
    for (const document of partial.documents.artifacts) {
      if (changes.artifacts.deletePaths.has(document.path)) changedArtifactKeys.add(document.source.artifactKey);
    }
    for (const document of partial.unavailable) {
      if (document.kind === "artifact" && changes.artifacts.deletePaths.has(document.path)) changedArtifactKeys.add(document.key);
    }

    const changedReferenceKeys = new Set(changes.references.map((entry) => entry.key));
    const changedReferencePaths = new Set(changes.references.map((entry) => entry.path));
    for (const document of partial.documents.references) {
      if (changedReferencePaths.has(document.path)) changedReferenceKeys.add(document.reference.referenceKey);
    }
    for (const document of partial.unavailable) {
      if (document.kind === "reference" && changedReferencePaths.has(document.path)) changedReferenceKeys.add(document.key);
    }

    this.#assertRepairDependenciesAvailable(partial, "artifactKeys", changedArtifactKeys, replacedPaths);
    this.#assertRepairDependenciesAvailable(partial, "referenceKeys", changedReferenceKeys, replacedPaths);
  }

  async strictSourceCatalog(override?: { readonly path?: string; readonly source: UiSource }): Promise<SourceCatalog> {
    const partial = await this.partial();
    this.#assertAvailable(partial, new Set(["artifact"]));
    const inputs = partial.documents.artifacts.map(({ path, source }) => ({ path, source }));
    if (!override) return createSourceCatalog(inputs);
    const existing = inputs.find((entry) => entry.source.artifactKey === override.source.artifactKey);
    const retained = inputs.filter((entry) => entry.source.artifactKey !== override.source.artifactKey);
    return createSourceCatalog([
      ...retained,
      { path: override.path ?? existing?.path ?? `<memory:${override.source.artifactKey}>`, source: override.source },
    ]);
  }

  async scopedSourceCatalog(
    artifactKeys: readonly string[],
    override?: { readonly path?: string; readonly source: UiSource },
  ): Promise<SourceCatalog> {
    const partial = await this.partial();
    const changedKeys = new Set(artifactKeys);
    let catalog = partial.sourceCatalog;
    let replacedPaths: ReadonlySet<string> = new Set();

    if (override) {
      const existing = partial.documents.artifacts.find((entry) => entry.source.artifactKey === override.source.artifactKey);
      const unavailable = partial.unavailable.find((entry) => entry.kind === "artifact" && entry.key === override.source.artifactKey);
      const path = override.path ?? existing?.path ?? unavailable?.path ?? `<memory:${override.source.artifactKey}>`;
      replacedPaths = new Set([path]);
      catalog = await this.repairSourceCatalog([{ path, source: override.source }]);
    } else {
      this.#assertRepairDependenciesAvailable(partial, "artifactKeys", changedKeys, replacedPaths);
    }

    for (const artifactKey of artifactKeys) {
      if (catalog.entries.has(artifactKey)) continue;
      const unavailable = partial.unavailable.find(
        (entry) => entry.kind === "artifact" && entry.key.toLocaleLowerCase("en-US") === artifactKey.toLocaleLowerCase("en-US"),
      );
      if (unavailable) {
        const problem = partial.problems.find((entry) => entry.path === unavailable.path);
        throw new WorkspaceDocumentUnavailableError(unavailable, problem);
      }
      throw new Error(`Artifact '${artifactKey}' is missing from Source Catalog`);
    }
    return catalog;
  }

  async repairSourceCatalog(
    upserts: readonly { readonly path: string; readonly source: UiSource }[] = [],
    deletePaths: ReadonlySet<string> = new Set(),
  ): Promise<SourceCatalog> {
    const partial = await this.partial();
    const replacedPaths = new Set([...deletePaths, ...upserts.map((entry) => entry.path)]);
    const replacedKeys = new Set(upserts.map((entry) => entry.source.artifactKey));
    this.#assertRepairIdentityAvailable(
      partial,
      "artifact",
      upserts.map((entry) => ({ path: entry.path, key: entry.source.artifactKey })),
      replacedPaths,
    );
    const changedKeys = new Set(replacedKeys);
    for (const document of partial.documents.artifacts) if (deletePaths.has(document.path)) changedKeys.add(document.source.artifactKey);
    for (const document of partial.unavailable)
      if (document.kind === "artifact" && deletePaths.has(document.path)) changedKeys.add(document.key);
    this.#assertRepairDependenciesAvailable(partial, "artifactKeys", changedKeys, replacedPaths);
    const retained = partial.documents.artifacts.filter(
      (entry) => !replacedPaths.has(entry.path) && !replacedKeys.has(entry.source.artifactKey),
    );
    return createSourceCatalog([...retained.map(({ path, source }) => ({ path, source })), ...upserts]);
  }

  async strictReferenceCatalog(
    sourceCatalog?: SourceCatalog,
    override?: { readonly path: string; readonly reference: UiReference },
  ): Promise<ReferenceCatalog> {
    const sources = sourceCatalog ?? (await this.strictSourceCatalog());
    const partial = await this.partial();
    this.#assertAvailable(partial, new Set(["artifact", "reference"]));
    const inputs = partial.documents.references.map(({ path, reference }) => ({ path, reference }));
    const retained = override ? inputs.filter((entry) => entry.path !== override.path) : inputs;
    const catalog = createReferenceCatalog(override ? [...retained, override] : retained, sources);
    for (const entry of catalog.entries.values()) assertValidReference(entry.reference, sources, catalog);
    return catalog;
  }

  async repairReferenceCatalog(
    sourceCatalog: SourceCatalog,
    override?: { readonly path: string; readonly reference: UiReference },
  ): Promise<ReferenceCatalog> {
    const partial = await this.partial();
    if (override) {
      this.#assertRepairIdentityAvailable(
        partial,
        "reference",
        [{ path: override.path, key: override.reference.referenceKey }],
        new Set([override.path]),
      );
      const changedKeys = new Set([override.reference.referenceKey]);
      for (const document of partial.documents.references)
        if (document.path === override.path) changedKeys.add(document.reference.referenceKey);
      for (const document of partial.unavailable)
        if (document.kind === "reference" && document.path === override.path) changedKeys.add(document.key);
      this.#assertRepairDependenciesAvailable(partial, "referenceKeys", changedKeys, new Set([override.path]));
    }
    const inputs = partial.documents.references.map(({ path, reference }) => ({ path, reference }));
    const retained = override
      ? inputs.filter((entry) => entry.path !== override.path && entry.reference.referenceKey !== override.reference.referenceKey)
      : inputs;
    const catalog = createReferenceCatalog(override ? [...retained, override] : retained, sourceCatalog);
    for (const entry of catalog.entries.values()) assertValidReference(entry.reference, sourceCatalog, catalog);
    return catalog;
  }

  async strictPrototypeCatalog(
    sourceCatalog?: SourceCatalog,
    referenceCatalog?: ReferenceCatalog,
    override?: { readonly path: string; readonly prototype: UiPrototype },
  ): Promise<PrototypeCatalog> {
    const sources = sourceCatalog ?? (await this.strictSourceCatalog());
    const references = referenceCatalog ?? (await this.strictReferenceCatalog(sources));
    const partial = await this.partial();
    this.#assertAvailable(partial, new Set(["artifact", "reference", "prototype"]));
    const inputs = partial.documents.prototypes.map(({ path, prototype }) => ({ path, prototype }));
    const retained = override ? inputs.filter((entry) => entry.path !== override.path) : inputs;
    const catalog = createPrototypeCatalog(override ? [...retained, override] : retained);
    for (const entry of catalog.entries.values()) assertValidPrototype(entry.prototype, references, sources);
    return catalog;
  }

  async repairPrototypeCatalog(
    sourceCatalog: SourceCatalog,
    referenceCatalog: ReferenceCatalog,
    override?: { readonly path: string; readonly prototype: UiPrototype },
  ): Promise<PrototypeCatalog> {
    const partial = await this.partial();
    if (override) {
      this.#assertRepairIdentityAvailable(
        partial,
        "prototype",
        [{ path: override.path, key: override.prototype.prototypeKey }],
        new Set([override.path]),
      );
    }
    const inputs = partial.documents.prototypes.map(({ path, prototype }) => ({ path, prototype }));
    const retained = override
      ? inputs.filter((entry) => entry.path !== override.path && entry.prototype.prototypeKey !== override.prototype.prototypeKey)
      : inputs;
    const catalog = createPrototypeCatalog(override ? [...retained, override] : retained);
    for (const entry of catalog.entries.values()) assertValidPrototype(entry.prototype, referenceCatalog, sourceCatalog);
    return catalog;
  }

  async #refresh(now: number, generation: number): Promise<WorkspaceSnapshot> {
    const before = await workspaceFingerprint(this.sourceRoot);
    this.#lastCheckedAt = now;
    if (generation !== this.#generation) return this.snapshot();
    if (this.#snapshot?.fingerprint === before) return this.#snapshot;
    const partial = await loadPartialWorkspaceCatalog(this.sourceRoot);
    const after = await workspaceFingerprint(this.sourceRoot);
    if (before !== after) {
      const stablePartial = await loadPartialWorkspaceCatalog(this.sourceRoot);
      const stableFingerprint = await workspaceFingerprint(this.sourceRoot);
      const snapshot = { revision: ++this.#revision, fingerprint: stableFingerprint, partial: stablePartial } satisfies WorkspaceSnapshot;
      if (generation !== this.#generation) return this.snapshot();
      this.#snapshot = snapshot;
      return snapshot;
    }
    const snapshot = { revision: ++this.#revision, fingerprint: after, partial } satisfies WorkspaceSnapshot;
    if (generation !== this.#generation) return this.snapshot();
    this.#snapshot = snapshot;
    return snapshot;
  }

  #assertAvailable(partial: PartialWorkspaceCatalog, kinds: ReadonlySet<"artifact" | "reference" | "prototype">): void {
    const unavailable = partial.unavailable.find((document) => kinds.has(document.kind));
    if (!unavailable) return;
    const problem = partial.problems.find((entry) => entry.path === unavailable.path);
    throw new WorkspaceDocumentUnavailableError(unavailable, problem);
  }

  #assertRepairIdentityAvailable(
    partial: PartialWorkspaceCatalog,
    kind: "artifact" | "reference" | "prototype",
    candidates: readonly { readonly path: string; readonly key: string }[],
    replacedPaths: ReadonlySet<string>,
  ): void {
    for (const candidate of candidates) {
      const unavailable = partial.unavailable.find(
        (document) =>
          document.kind === kind &&
          !replacedPaths.has(document.path) &&
          (document.path === candidate.path ||
            document.key === candidate.key ||
            (kind === "artifact" && document.key.toLocaleLowerCase("en-US") === candidate.key.toLocaleLowerCase("en-US"))),
      );
      if (!unavailable) continue;
      const problem = partial.problems.find((entry) => entry.path === unavailable.path);
      throw new WorkspaceDocumentUnavailableError(unavailable, problem);
    }
  }

  #assertRepairDependenciesAvailable(
    partial: PartialWorkspaceCatalog,
    relation: "artifactKeys" | "referenceKeys",
    changedKeys: ReadonlySet<string>,
    replacedPaths: ReadonlySet<string>,
  ): void {
    if (changedKeys.size === 0) return;
    for (const document of partial.unavailable) {
      if (replacedPaths.has(document.path)) continue;
      const dependencies = partial.repairRelations.get(document.path)?.[relation] ?? null;
      if (dependencies !== null && !dependencies.some((key) => changedKeys.has(key))) continue;
      const problem = partial.problems.find((entry) => entry.path === document.path);
      throw new WorkspaceDocumentUnavailableError(document, problem);
    }
  }

  #scheduleInvalidate(): void {
    if (this.#watchInvalidateTimer !== undefined) clearTimeout(this.#watchInvalidateTimer);
    this.#watchInvalidateTimer = setTimeout(() => {
      this.#watchInvalidateTimer = undefined;
      this.invalidate();
    }, 100);
  }
}

async function workspaceFingerprint(sourceRoot: string): Promise<string> {
  const paths = await listFiles(sourceRoot, ".json");
  const entries = await Promise.all(
    paths.map(async (path) => {
      const info = await stat(safeChildPath(sourceRoot, path));
      return `${path}:${info.size}:${info.mtimeMs}`;
    }),
  );
  return entries.join("|");
}
