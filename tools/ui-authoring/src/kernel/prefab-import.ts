import type { UiSource, UiVariantSource } from "../schema/ui-source-schema.js";
import { createArtifactSource } from "./authoring.js";
import type { PrefabObservation, PrefabReconcileResult } from "./prefab-observation.js";
import { applyPrefabReconcilePatches, reconcilePrefabObservation } from "./prefab-observation.js";
import { type ArtifactSourceIdentity, artifactPrefabPath, artifactSourceIdentity, assertArtifactPrefabPath } from "./prefab-path.js";
import { createUnityProjection } from "./projection.js";
import { createSourceCatalog, type SourceCatalog } from "./source-catalog.js";
import {
  applyVariantPrefabReconcile,
  reconcileVariantPrefabObservation,
  type VariantPrefabReconcileResult,
} from "./variant-prefab-observation.js";

export interface PrefabImportOptions {
  readonly sourceIdentity: ArtifactSourceIdentity;
  readonly initialSize?: readonly [number, number];
  readonly catalog?: SourceCatalog;
  readonly artifactKeyByPrefabPath?: ReadonlyMap<string, string>;
}

export interface PrefabImportResult {
  readonly prefabPath: string;
  readonly artifactKey: string;
  readonly artifactType: UiSource["artifactType"];
  readonly source: UiSource;
  readonly reconcile: PrefabReconcileResult | VariantPrefabReconcileResult;
  readonly blockers: readonly string[];
  readonly diagnostics: NonNullable<PrefabObservation["diagnostics"]>;
  readonly unityOnlyComponents: readonly { readonly nodeId: string; readonly componentTypes: readonly string[] }[];
  readonly observationHash?: string;
}

export function importPrefabObservation(observation: PrefabObservation, options: PrefabImportOptions): PrefabImportResult {
  const identity = options.sourceIdentity;
  assertArtifactPrefabPath(observation.prefabPath, identity);
  if (identity.artifactKey !== observation.artifactKey)
    throw new Error(`Prefab Import identity mismatch source=${identity.artifactKey} observation=${observation.artifactKey}`);
  if (!observation.artifactType) throw new Error(`Prefab Import observation '${observation.artifactKey}' is missing artifactType`);
  const sourceIdentity = { artifactKey: identity.artifactKey, artifactType: observation.artifactType } as const;
  const diagnostics = [...(observation.diagnostics ?? [])];
  const extractionObservation: PrefabObservation = { ...observation, diagnostics: [] };
  const artifactKeyByPrefabPath = options.artifactKeyByPrefabPath ?? catalogPrefabMap(options.catalog);

  if (observation.basePrefabPath) {
    return importVariant(
      extractionObservation,
      observation,
      diagnostics,
      sourceIdentity,
      identity.path,
      artifactKeyByPrefabPath,
      options.catalog,
    );
  }

  const initialSize = resolveInitialSize(observation, sourceIdentity.artifactType, options.initialSize);
  const source = createArtifactSource({ ...sourceIdentity, initialSize: initialSize.value });
  const importedCatalog = catalogWithImported(options.catalog, source, identity.path);
  const projection = createUnityProjection(importedCatalog.entries.get(identity.artifactKey)!, importedCatalog);
  const reconcile = reconcilePrefabObservation(source, projection, extractionObservation, { artifactKeyByPrefabPath });
  const imported = reconcile.issues.length === 0 ? applyPrefabReconcilePatches(source, reconcile) : source;
  const convergence =
    reconcile.issues.length === 0
      ? reconcileImportedConcrete(imported, extractionObservation, identity.path, artifactKeyByPrefabPath, options.catalog)
      : { issues: [] as string[], patchCount: 0 };
  const blockers = unique([
    ...initialSize.issues,
    ...diagnostics.map((entry) => entry.message),
    ...reconcile.issues,
    ...convergence.issues,
    ...(convergence.patchCount > 0 ? [`Prefab Import Projection did not converge (${convergence.patchCount} remaining patches)`] : []),
  ]);
  return {
    prefabPath: observation.prefabPath,
    artifactKey: identity.artifactKey,
    artifactType: sourceIdentity.artifactType,
    source: imported,
    reconcile,
    blockers,
    diagnostics,
    unityOnlyComponents: reconcile.unityOnlyComponents,
    ...(observation.rawPrefabHash ? { observationHash: observation.rawPrefabHash } : {}),
  };
}

function importVariant(
  extractionObservation: PrefabObservation,
  originalObservation: PrefabObservation,
  diagnostics: NonNullable<PrefabObservation["diagnostics"]>,
  identity: { readonly artifactKey: string; readonly artifactType: UiSource["artifactType"] },
  sourcePath: string,
  artifactKeyByPrefabPath: ReadonlyMap<string, string>,
  catalog: SourceCatalog | undefined,
): PrefabImportResult {
  const basePrefabPath = originalObservation.basePrefabPath!;
  const baseArtifactKey = artifactKeyByPrefabPath.get(basePrefabPath);
  if (!baseArtifactKey || !catalog) {
    const source = emptyVariant(identity, baseArtifactKey ?? "MissingVariantBase");
    const message = `Prefab Variant '${identity.artifactKey}' requires an imported base Source for '${basePrefabPath}'`;
    const reconcile = emptyVariantReconcile(identity.artifactKey, originalObservation.prefabPath, message);
    return {
      prefabPath: originalObservation.prefabPath,
      artifactKey: identity.artifactKey,
      artifactType: identity.artifactType,
      source,
      reconcile,
      blockers: unique([...diagnostics.map((entry) => entry.message), message]),
      diagnostics,
      unityOnlyComponents: [],
      ...(originalObservation.rawPrefabHash ? { observationHash: originalObservation.rawPrefabHash } : {}),
    };
  }

  const baseEntry = catalog.entries.get(baseArtifactKey);
  if (!baseEntry) throw new Error(`Prefab Variant base '${baseArtifactKey}' is missing from Source Catalog`);
  const source = emptyVariant(identity, baseArtifactKey);
  const importedCatalog = createSourceCatalog([
    ...[...catalog.entries.values()].map((entry) => ({ path: entry.path, source: entry.source })),
    { path: sourcePath, source },
  ]);
  const variantEntry = importedCatalog.entries.get(identity.artifactKey)!;
  const baseProjection = createUnityProjection(baseEntry, catalog);
  const variantProjection = createUnityProjection(variantEntry, importedCatalog);
  const reconcile = reconcileVariantPrefabObservation(source, baseProjection, variantProjection, extractionObservation, {
    artifactKeyByPrefabPath,
  });
  const imported = reconcile.issues.length === 0 ? applyVariantPrefabReconcile(source, reconcile) : source;
  const convergence =
    reconcile.issues.length === 0
      ? reconcileImportedVariant(imported, extractionObservation, catalog, sourcePath)
      : { issues: [] as string[], patchCount: 0 };
  const blockers = unique([
    ...diagnostics.map((entry) => entry.message),
    ...reconcile.issues,
    ...convergence.issues,
    ...(convergence.patchCount > 0 ? [`Prefab Import Projection did not converge (${convergence.patchCount} remaining patches)`] : []),
  ]);
  return {
    prefabPath: originalObservation.prefabPath,
    artifactKey: identity.artifactKey,
    artifactType: identity.artifactType,
    source: imported,
    reconcile,
    blockers,
    diagnostics,
    unityOnlyComponents: reconcile.unityOnlyComponents,
    ...(originalObservation.rawPrefabHash ? { observationHash: originalObservation.rawPrefabHash } : {}),
  };
}

function reconcileImportedConcrete(
  source: Extract<UiSource, { readonly sourceKind: "artifact" }>,
  observation: PrefabObservation,
  sourcePath: string,
  artifactKeyByPrefabPath: ReadonlyMap<string, string>,
  catalog: SourceCatalog | undefined,
): { readonly issues: readonly string[]; readonly patchCount: number } {
  const importedCatalog = catalogWithImported(catalog, source, sourcePath);
  const entry = importedCatalog.entries.get(source.artifactKey)!;
  const projection = createUnityProjection(entry, importedCatalog);
  const reconcile = reconcilePrefabObservation(source, projection, observation, { artifactKeyByPrefabPath });
  return { issues: reconcile.issues, patchCount: reconcile.patches.length };
}

function reconcileImportedVariant(
  source: UiVariantSource,
  observation: PrefabObservation,
  catalog: SourceCatalog,
  sourcePath: string,
): { readonly issues: readonly string[]; readonly patchCount: number } {
  const importedCatalog = catalogWithImported(catalog, source, sourcePath);
  const entry = importedCatalog.entries.get(source.artifactKey)!;
  const base = importedCatalog.entries.get(source.variantOf)!;
  const reconcile = reconcileVariantPrefabObservation(
    source,
    createUnityProjection(base, importedCatalog),
    createUnityProjection(entry, importedCatalog),
    observation,
    { artifactKeyByPrefabPath: catalogPrefabMap(importedCatalog) },
  );
  return { issues: reconcile.issues, patchCount: reconcile.patches.length };
}

function catalogWithImported(catalog: SourceCatalog | undefined, source: UiSource, path: string): SourceCatalog {
  return createSourceCatalog([
    ...[...(catalog?.entries.values() ?? [])]
      .filter((entry) => entry.source.artifactKey !== source.artifactKey)
      .map((entry) => ({ path: entry.path, source: entry.source })),
    { path, source },
  ]);
}

function emptyVariant(
  identity: { readonly artifactKey: string; readonly artifactType: UiSource["artifactType"] },
  baseArtifactKey: string,
): UiVariantSource {
  return {
    sourceKind: "variant",
    artifactKey: identity.artifactKey,
    artifactType: identity.artifactType,
    variantOf: baseArtifactKey,
    overrides: [],
  };
}

function emptyVariantReconcile(artifactKey: string, prefabPath: string, issue: string): VariantPrefabReconcileResult {
  return {
    artifactKey,
    prefabPath,
    patches: [],
    issues: [issue],
    diagnostics: [],
    unityOnlyComponents: [],
    nodeAdditions: [],
    componentAdditions: [],
    overrides: [],
    initialSize: undefined,
    widgetType: "",
    bindings: [],
  };
}

function resolveInitialSize(
  observation: PrefabObservation,
  artifactType: UiSource["artifactType"],
  explicit: readonly [number, number] | undefined,
): { readonly value: readonly [number, number]; readonly issues: readonly string[] } {
  if (artifactType === "Canvas") return { value: [1280, 720], issues: [] };
  if (isPositiveSize(explicit)) return { value: explicit, issues: [] };
  if (isPositiveSize(observation.suggestedDesignSize)) return { value: observation.suggestedDesignSize, issues: [] };
  const root = observation.nodes.find((node) => node.id === observation.artifactKey);
  const sizeDelta = root?.rect.sizeDelta;
  if (isPositiveSize(sizeDelta)) return { value: sizeDelta, issues: [] };
  return {
    value: [100, 100],
    issues: [`Prefab Import cannot infer initialSize for ${artifactType} '${observation.artifactKey}'; provide an explicit initialSize`],
  };
}

function isPositiveSize(value: unknown): value is readonly [number, number] {
  return (
    Array.isArray(value) && value.length === 2 && value.every((entry) => typeof entry === "number" && Number.isFinite(entry) && entry > 0)
  );
}

function catalogPrefabMap(catalog: SourceCatalog | undefined): ReadonlyMap<string, string> {
  return new Map(
    [...(catalog?.entries.values() ?? [])].map((entry) => [artifactPrefabPath(artifactSourceIdentity(entry)), entry.source.artifactKey]),
  );
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
