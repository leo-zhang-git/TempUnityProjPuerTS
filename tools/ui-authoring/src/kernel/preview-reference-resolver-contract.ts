import type { AuthoringAssetCatalog } from "../schema/asset-catalog.js";
import type { UiPrototype } from "../schema/ui-prototype-schema.js";
import type { UiConcreteSource } from "../schema/ui-source-schema.js";
import type { PreviewDependencyDiagnostic, PreviewDependencyGraph, PreviewDependencyGraphBudget } from "./preview-dependency-graph.js";
import type { PreviewReferenceCatalog, PreviewReferencePlacement } from "./preview-reference.js";
import type { PreviewValues, PreviewValuesDiagnostic, ResolvedPreviewValuePatch, ResolvedPreviewValues } from "./preview-values.js";
import type { SourceCatalog, SourceCatalogEntry } from "./source-catalog.js";

export type PreviewResolverDiagnosticCategory =
  | PreviewDependencyDiagnostic["category"]
  | PreviewValuesDiagnostic["category"]
  | "invalidReference"
  | "budget";

export interface PreviewResolverDiagnostic {
  readonly category: PreviewResolverDiagnosticCategory;
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly chain?: readonly string[];
}

export type ResolvedPreviewInstanceRole = "subject" | "context" | "dependency";

export interface ResolvedPreviewLayoutRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type ResolvedPreviewInstancePlacement =
  | { readonly kind: "root" }
  | { readonly kind: "prefabRef"; readonly nodeId: string }
  | { readonly kind: "contextBinding"; readonly nodeId: string; readonly bindingField: string }
  | {
      readonly kind: "collection";
      readonly nodeId: string;
      readonly contentNodeId: string;
      readonly bindingField: string;
      readonly collectionKey: string;
      readonly groupIndex: number;
      readonly itemIndex: number;
      readonly itemKey: string;
      readonly rect: ResolvedPreviewLayoutRect;
    }
  | {
      readonly kind: "mount";
      readonly nodeId: string;
      readonly bindingField: string;
      readonly mountKey: string;
      readonly rect: ResolvedPreviewLayoutRect;
    };

export interface ResolvedPreviewInstance {
  readonly instanceKey: string;
  readonly artifactKey: string;
  readonly instancePath: readonly string[];
  readonly role: ResolvedPreviewInstanceRole;
  readonly source: UiConcreteSource;
  readonly effectiveLayoutSource: UiConcreteSource;
  readonly placement: ResolvedPreviewInstancePlacement;
  readonly children: readonly ResolvedPreviewInstance[];
}

interface PreviewGeneratedSessionEntryBase {
  readonly instanceKey: string;
  readonly artifactKey: string;
  readonly parentInstanceKey: string;
  readonly targetNodeId: string;
  readonly bindingField: string;
  readonly referenceKey: string;
}

export type PreviewGeneratedSessionEntry = PreviewGeneratedSessionEntryBase &
  (
    | { readonly kind: "contextSubject" }
    | {
        readonly kind: "collectionItem";
        readonly collectionKey: string;
        readonly groupIndex: number;
        readonly itemIndex: number;
        readonly itemKey: string;
        readonly presetReferenceKey?: string;
      }
    | { readonly kind: "mount"; readonly mountKey: string; readonly presetReferenceKey?: string }
  );

export type PreviewProvenanceLayer =
  | "reference.subject"
  | "reference.context"
  | "reference.instance"
  | "reference.preset"
  | "reference.collectionGroup"
  | "reference.collectionItem"
  | "reference.mount"
  | "prototype.subject"
  | "prototype.context"
  | "prototype.instance"
  | "statePreview.subject";

export interface PreviewValueProvenance {
  readonly kind: "value";
  readonly layer: PreviewProvenanceLayer;
  readonly instanceKey: string;
  readonly artifactKey: string;
  readonly nodeId: string;
  readonly bindingField: string;
  readonly capability: string;
  readonly value: unknown;
  readonly baselineValue?: unknown;
  readonly referenceKey?: string;
}

export interface PreviewGeneratedProvenance {
  readonly kind: "generated";
  readonly layer: "reference.context" | "reference.collection" | "reference.mount";
  readonly instanceKey: string;
  readonly artifactKey: string;
  readonly parentInstanceKey: string;
  readonly targetNodeId: string;
  readonly bindingField: string;
  readonly referenceKey: string;
  readonly collectionKey?: string;
  readonly itemKey?: string;
  readonly mountKey?: string;
}

export type PreviewProvenanceEntry = PreviewValueProvenance | PreviewGeneratedProvenance;

export interface PreviewResolverBudget extends PreviewDependencyGraphBudget {
  readonly maxArtifactDepth: number;
  readonly maxResolvedInstances: number;
  readonly maxResolvedNodes: number;
  readonly maxGeneratedInstances: number;
  readonly maxProvenanceEntries: number;
}

export interface ResolvePreviewReferenceInput {
  readonly sourceCatalog: SourceCatalog;
  readonly referenceCatalog: PreviewReferenceCatalog;
  readonly referenceKey: string;
  readonly prototype?: UiPrototype;
  readonly subjectSessionValues?: PreviewValues;
  readonly subjectSessionPatches?: readonly ResolvedPreviewValuePatch[];
  readonly contextSessionValues?: PreviewValues;
  readonly instanceSessionValues?: Readonly<Record<string, PreviewValues>>;
  readonly assetCatalog?: AuthoringAssetCatalog;
  readonly budget?: Partial<PreviewResolverBudget>;
}

export interface ResolvedPreviewReference {
  readonly valid: boolean;
  readonly referenceKey: string;
  readonly graph: PreviewDependencyGraph;
  readonly tree?: ResolvedPreviewInstance;
  readonly subjectInstanceKey?: string;
  readonly viewport?: readonly [number, number];
  readonly generatedSessionData: readonly PreviewGeneratedSessionEntry[];
  readonly diagnostics: readonly PreviewResolverDiagnostic[];
  readonly provenance: readonly PreviewProvenanceEntry[];
}

export interface MutableResolvedPreviewInstance {
  instanceKey: string;
  artifactKey: string;
  instancePath: readonly string[];
  role: ResolvedPreviewInstanceRole;
  source: UiConcreteSource;
  effectiveLayoutSource: UiConcreteSource;
  placement: ResolvedPreviewInstancePlacement;
  children: MutableResolvedPreviewInstance[];
}

export interface ValueLayer {
  readonly layer: PreviewProvenanceLayer;
  readonly resolved: ResolvedPreviewValues;
  readonly referenceKey?: string;
}

export interface ActiveValueOwner {
  readonly layers: readonly ValueLayer[];
  readonly relativePath: readonly string[];
}

export interface PreflightMetrics {
  instances: number;
  nodes: number;
  generatedInstances: number;
  maxArtifactDepth: number;
}

export function resolverDiagnostic(
  category: PreviewResolverDiagnosticCategory,
  code: string,
  path: string,
  message: string,
  chain?: readonly string[],
): PreviewResolverDiagnostic {
  return { category, code, path, message, ...(chain ? { chain } : {}) };
}

export function dependencyDiagnostic(entry: PreviewDependencyDiagnostic): PreviewResolverDiagnostic {
  return resolverDiagnostic(entry.category, entry.code, entry.path, entry.message, entry.chain);
}

export function valuesDiagnostic(entry: PreviewValuesDiagnostic): PreviewResolverDiagnostic {
  return resolverDiagnostic(entry.category, entry.code, entry.path, entry.message);
}

export function instancePathsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function previewInstanceKey(rootArtifactKey: string, instancePath: readonly string[]): string {
  return instancePath.length > 0 ? `${rootArtifactKey}/${instancePath.join("/")}` : rootArtifactKey;
}

export function isBindingPlacement(
  placement: PreviewReferencePlacement,
): placement is PreviewReferencePlacement & { readonly targetBinding: string } {
  return "targetBinding" in placement;
}

export function requireArtifact(sourceCatalog: SourceCatalog, artifactKey: string): SourceCatalogEntry | undefined {
  return sourceCatalog.entries.get(artifactKey);
}
