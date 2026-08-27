import type {
  ReferenceCollection,
  ReferenceCollectionItem,
  ReferenceMount,
  PreviewReferenceOwnerScope as SchemaPreviewReferenceOwnerScope,
  UiReference,
} from "../schema/ui-prototype-schema.js";
import type { SourceCatalog } from "./source-catalog.js";
import { stateRootPreviewContextIssues } from "./state-root-control.js";

export type PreviewReference = UiReference;
type PreviewReferenceContext = NonNullable<UiReference["context"]>;
export type PreviewReferencePlacement = PreviewReferenceContext["placement"];
export type PreviewReferenceOwnerScope = SchemaPreviewReferenceOwnerScope;
export type PreviewReferenceCollection = ReferenceCollection;
export type PreviewReferenceCollectionItem = ReferenceCollectionItem;
export type PreviewReferenceMount = ReferenceMount;

export interface PreviewReferenceCatalogInput {
  readonly path: string;
  readonly reference: PreviewReference;
}

export interface PreviewReferenceCatalogEntry extends PreviewReferenceCatalogInput {
  readonly defaultForArtifactKey?: string;
}

export interface PreviewReferenceCatalog {
  readonly entries: ReadonlyMap<string, PreviewReferenceCatalogEntry>;
  readonly defaults: ReadonlyMap<string, PreviewReferenceCatalogEntry>;
}

const REFERENCE_KEY_PATTERN = /^[A-Z][A-Za-z0-9]*$/;

function normalizedDocumentPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function documentPathKey(path: string): string {
  return normalizedDocumentPath(path).toLocaleLowerCase("en-US");
}

export function defaultReferencePathForArtifact(artifactPath: string): string {
  const normalized = normalizedDocumentPath(artifactPath);
  if (!normalized.endsWith(".ui.json")) throw new Error(`Artifact path '${artifactPath}' must end with .ui.json`);
  return `${normalized.slice(0, -".ui.json".length)}.ui-reference.json`;
}

export function pairedArtifactPathForDefaultReference(referencePath: string): string {
  const normalized = normalizedDocumentPath(referencePath);
  if (!normalized.endsWith(".ui-reference.json")) throw new Error(`Reference path '${referencePath}' must end with .ui-reference.json`);
  return `${normalized.slice(0, -".ui-reference.json".length)}.ui.json`;
}

export function createPreviewReferenceCatalog(
  inputs: readonly PreviewReferenceCatalogInput[],
  sourceCatalog: SourceCatalog,
): PreviewReferenceCatalog {
  const entries = new Map<string, PreviewReferenceCatalogEntry>();
  const defaults = new Map<string, PreviewReferenceCatalogEntry>();
  const artifactsByPath = new Map([...sourceCatalog.entries.values()].map((entry) => [documentPathKey(entry.path), entry]));
  for (const input of inputs) {
    const { reference } = input;
    if (!REFERENCE_KEY_PATTERN.test(reference.referenceKey)) throw new Error(`Reference key '${reference.referenceKey}' is invalid`);
    if (!REFERENCE_KEY_PATTERN.test(reference.subjectArtifactKey))
      throw new Error(`Reference subject '${reference.subjectArtifactKey}' is invalid`);
    const subject = sourceCatalog.entries.get(reference.subjectArtifactKey)?.resolvedSource;
    if (subject) {
      const contextIssues = stateRootPreviewContextIssues(subject, reference.statePreviewContexts);
      if (contextIssues.length > 0) {
        throw new Error(`Reference '${reference.referenceKey}' has invalid statePreviewContexts: ${contextIssues.join("; ")}`);
      }
    }
    const existing = entries.get(reference.referenceKey);
    if (existing) throw new Error(`Duplicate referenceKey '${reference.referenceKey}' in '${existing.path}' and '${input.path}'`);
    const pairedArtifactPath = pairedArtifactPathForDefaultReference(input.path);
    const pairedArtifact = artifactsByPath.get(documentPathKey(pairedArtifactPath));
    if (pairedArtifact && pairedArtifact.source.artifactKey !== reference.subjectArtifactKey) {
      throw new Error(`Default Reference '${input.path}' must use paired subject '${pairedArtifact.source.artifactKey}'`);
    }
    if (pairedArtifact && reference.referenceKey !== reference.subjectArtifactKey) {
      throw new Error(`Default Reference '${input.path}' must use subject key '${reference.subjectArtifactKey}' as referenceKey`);
    }
    const entry: PreviewReferenceCatalogEntry = {
      ...input,
      ...(pairedArtifact ? { defaultForArtifactKey: pairedArtifact.source.artifactKey } : {}),
    };
    entries.set(reference.referenceKey, entry);
    if (pairedArtifact) {
      const existingDefault = defaults.get(pairedArtifact.source.artifactKey);
      if (existingDefault)
        throw new Error(
          `Duplicate default Reference for '${pairedArtifact.source.artifactKey}' in '${existingDefault.path}' and '${input.path}'`,
        );
      defaults.set(pairedArtifact.source.artifactKey, entry);
    }
  }
  return { entries, defaults };
}

export function defaultPreviewReferenceEntry(
  catalog: PreviewReferenceCatalog,
  artifactKey: string,
): PreviewReferenceCatalogEntry | undefined {
  return catalog.defaults.get(artifactKey);
}

export function previewReferenceOwnerRootArtifactKey(
  reference: PreviewReference,
  scope: PreviewReferenceOwnerScope | undefined,
  mounts: ReadonlyMap<string, PreviewReferenceMount> = new Map((reference.mounts ?? []).map((mount) => [mount.key, mount])),
): { readonly artifactKey: string; readonly instancePath: readonly string[] } | undefined {
  if (!scope || scope.kind === "subject") return { artifactKey: reference.subjectArtifactKey, instancePath: [] };
  if (scope.kind === "context")
    return reference.context ? { artifactKey: reference.context.parentArtifactKey, instancePath: [] } : undefined;
  if (scope.kind === "artifact") {
    const artifactKey = scope.root === "subject" ? reference.subjectArtifactKey : reference.context?.parentArtifactKey;
    return artifactKey ? { artifactKey, instancePath: scope.instancePath } : undefined;
  }
  const mount = mounts.get(scope.mountKey);
  return mount ? { artifactKey: mount.artifactKey, instancePath: scope.instancePath ?? [] } : undefined;
}
