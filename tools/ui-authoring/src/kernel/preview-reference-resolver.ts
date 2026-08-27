import { artifactInitialSize } from "./artifact-size.js";
import { resolveArtifactUseSite } from "./artifact-use-site.js";
import { resolveBinderBindings } from "./binder.js";
import { buildPreviewDependencyGraph } from "./preview-dependency-graph.js";
import type { PreviewReference } from "./preview-reference.js";
import {
  dependencyDiagnostic,
  isBindingPlacement,
  type PreflightMetrics,
  type PreviewGeneratedSessionEntry,
  type PreviewProvenanceEntry,
  type PreviewResolverDiagnostic,
  type ResolvedPreviewReference,
  type ResolvePreviewReferenceInput,
  requireArtifact,
  resolverDiagnostic,
  type ValueLayer,
  valuesDiagnostic,
} from "./preview-reference-resolver-contract.js";
import { PreviewDynamicExpander, pointerToken } from "./preview-reference-resolver-dynamic.js";
import {
  buildInstance,
  findInstance,
  resolvedPreviewInstance,
  resolveLayer,
  walkResolvedPreviewInstances,
} from "./preview-reference-resolver-instance.js";
import {
  addScaledMetrics,
  budgetDiagnostics,
  DEFAULT_PREVIEW_RESOLVER_BUDGET,
  measureDynamicScenarioCost,
  preflightArtifact,
  previewValueCount,
} from "./preview-reference-resolver-preflight.js";
import type { ResolvedPreviewValues } from "./preview-values.js";
import type { SourceCatalogEntry } from "./source-catalog.js";
import { findNode } from "./tree.js";

export type {
  PreviewValueProvenance,
  ResolvedPreviewInstance,
  ResolvedPreviewReference,
  ResolvePreviewReferenceInput,
} from "./preview-reference-resolver-contract.js";
export { resolvedPreviewInstance, walkResolvedPreviewInstances };

export function resolvePreviewReference(input: ResolvePreviewReferenceInput): ResolvedPreviewReference {
  const budget = { ...DEFAULT_PREVIEW_RESOLVER_BUDGET, ...input.budget };
  const graph = buildPreviewDependencyGraph({
    sourceCatalog: input.sourceCatalog,
    referenceCatalog: input.referenceCatalog,
    rootReferenceKeys: [input.referenceKey],
    ...(input.prototype ? { prototype: input.prototype } : {}),
    budget: { maxReferenceDepth: budget.maxReferenceDepth, maxGraphNodes: budget.maxGraphNodes },
  });
  const diagnostics: PreviewResolverDiagnostic[] = graph.diagnostics.map(dependencyDiagnostic);
  const referenceEntry = input.referenceCatalog.entries.get(input.referenceKey);
  if (!referenceEntry) {
    diagnostics.push(
      resolverDiagnostic(
        "missingDependency",
        "previewResolver.reference.missing",
        "/referenceKey",
        `Reference '${input.referenceKey}' is missing from Reference Catalog`,
      ),
    );
    return { valid: false, referenceKey: input.referenceKey, graph, generatedSessionData: [], diagnostics, provenance: [] };
  }
  const reference: PreviewReference = referenceEntry.reference;
  const subject = requireArtifact(input.sourceCatalog, reference.subjectArtifactKey);
  if (!subject) {
    diagnostics.push(
      resolverDiagnostic(
        "missingDependency",
        "previewResolver.subject.missing",
        "/subjectArtifactKey",
        `Subject Artifact '${reference.subjectArtifactKey}' is missing`,
      ),
    );
  } else if (subject.source.artifactType === "Fragment") {
    diagnostics.push(
      resolverDiagnostic(
        "invalidReference",
        "previewResolver.subject.fragment",
        "/subjectArtifactKey",
        `Fragment '${reference.subjectArtifactKey}' cannot be a Reference subject`,
      ),
    );
  }

  let context: SourceCatalogEntry | undefined;
  let subjectUseSitePath: readonly string[] | undefined;
  let contextBinding: ReturnType<typeof resolveBinderBindings>[number] | undefined;
  if (reference.context) {
    if (subject?.source.artifactType === "Canvas") {
      diagnostics.push(
        resolverDiagnostic(
          "invalidReference",
          "previewResolver.context.canvasSubject",
          "/context",
          "Canvas Reference subject cannot use a parent context",
        ),
      );
    }
    context = requireArtifact(input.sourceCatalog, reference.context.parentArtifactKey);
    if (!context) {
      diagnostics.push(
        resolverDiagnostic(
          "missingDependency",
          "previewResolver.context.missing",
          "/context/parentArtifactKey",
          `Context Artifact '${reference.context.parentArtifactKey}' is missing`,
        ),
      );
    } else if (context.source.artifactType === "Fragment") {
      diagnostics.push(
        resolverDiagnostic(
          "invalidReference",
          "previewResolver.context.fragment",
          "/context/parentArtifactKey",
          `Fragment '${reference.context.parentArtifactKey}' cannot be a Reference context`,
        ),
      );
    } else if (isBindingPlacement(reference.context.placement)) {
      const targetBinding = reference.context.placement.targetBinding;
      contextBinding = resolveBinderBindings(input.sourceCatalog, context.source.artifactKey).find(
        (binding) => binding.fieldName === targetBinding,
      );
      if (!contextBinding)
        diagnostics.push(
          resolverDiagnostic(
            "missingBinder",
            "previewResolver.context.binding",
            "/context/placement/targetBinding",
            `Context '${context.source.artifactKey}' has no Binder field '${targetBinding}'`,
          ),
        );
    } else {
      subjectUseSitePath = reference.context.placement.instancePath;
      if (subjectUseSitePath.length === 0) {
        diagnostics.push(
          resolverDiagnostic(
            "invalidReference",
            "previewResolver.context.useSite",
            "/context/placement/instancePath",
            "Context subject use-site path cannot be empty",
          ),
        );
      } else {
        try {
          const useSite = resolveArtifactUseSite(input.sourceCatalog, {
            rootArtifactKey: context.source.artifactKey,
            instancePath: [...subjectUseSitePath],
          });
          if (useSite.source.artifactKey !== reference.subjectArtifactKey) {
            diagnostics.push(
              resolverDiagnostic(
                "invalidReference",
                "previewResolver.context.subject",
                "/context/placement/instancePath",
                `Context use site resolves '${useSite.source.artifactKey}', expected subject '${reference.subjectArtifactKey}'`,
              ),
            );
          }
        } catch (error) {
          diagnostics.push(
            resolverDiagnostic(
              "invalidReference",
              "previewResolver.context.useSite",
              "/context/placement/instancePath",
              error instanceof Error ? error.message : String(error),
            ),
          );
        }
      }
    }
  }

  const subjectReferenceValues = resolveLayer(
    input.sourceCatalog,
    reference.subjectArtifactKey,
    reference.values,
    "reference",
    "/values",
    input.assetCatalog,
  );
  const subjectSessionValues = resolveLayer(
    input.sourceCatalog,
    reference.subjectArtifactKey,
    input.subjectSessionValues,
    "prototypeSession",
    "/prototypeSession/subjectValues",
    input.assetCatalog,
  );
  const subjectSessionPatches = {
    valid: true,
    patches: input.subjectSessionPatches ?? [],
    diagnostics: [],
  } satisfies ResolvedPreviewValues;
  diagnostics.push(...subjectReferenceValues.diagnostics.map(valuesDiagnostic), ...subjectSessionValues.diagnostics.map(valuesDiagnostic));
  const subjectLayers: ValueLayer[] = [
    { layer: "reference.subject", resolved: subjectReferenceValues, referenceKey: reference.referenceKey },
    { layer: "prototype.subject", resolved: subjectSessionValues },
    { layer: "statePreview.subject", resolved: subjectSessionPatches },
  ];
  const contextReferenceValues = reference.context
    ? resolveLayer(
        input.sourceCatalog,
        reference.context.parentArtifactKey,
        reference.context.values,
        "context",
        "/context/values",
        input.assetCatalog,
      )
    : ({ valid: true, patches: [], diagnostics: [] } satisfies ResolvedPreviewValues);
  const contextSessionValues = reference.context
    ? resolveLayer(
        input.sourceCatalog,
        reference.context.parentArtifactKey,
        input.contextSessionValues,
        "prototypeSession",
        "/prototypeSession/contextValues",
        input.assetCatalog,
      )
    : ({ valid: true, patches: [], diagnostics: [] } satisfies ResolvedPreviewValues);
  diagnostics.push(...contextReferenceValues.diagnostics.map(valuesDiagnostic), ...contextSessionValues.diagnostics.map(valuesDiagnostic));
  const contextLayers: ValueLayer[] = [
    { layer: "reference.context", resolved: contextReferenceValues, referenceKey: reference.referenceKey },
    { layer: "prototype.context", resolved: contextSessionValues },
  ];

  if (diagnostics.length > 0 || !subject) {
    return { valid: false, referenceKey: input.referenceKey, graph, generatedSessionData: [], diagnostics, provenance: [] };
  }

  const metrics: PreflightMetrics = { instances: 0, nodes: 0, generatedInstances: contextBinding ? 1 : 0, maxArtifactDepth: 0 };
  if (context) {
    preflightArtifact(input.sourceCatalog, context.source.artifactKey, 1, [], metrics, diagnostics, "/context");
    if (contextBinding) preflightArtifact(input.sourceCatalog, subject.source.artifactKey, 1, [], metrics, diagnostics, "/subject");
  } else {
    preflightArtifact(input.sourceCatalog, subject.source.artifactKey, 1, [], metrics, diagnostics, "/subject");
  }
  const dynamicCost = measureDynamicScenarioCost(
    input.sourceCatalog,
    input.referenceCatalog,
    reference,
    false,
    2,
    diagnostics,
    new Set([reference.referenceKey]),
  );
  addScaledMetrics(metrics, dynamicCost.metrics);
  const instanceSessionProvenance = Object.values(input.instanceSessionValues ?? {}).reduce(
    (total, values) => total + previewValueCount(values),
    0,
  );
  const provenanceCount =
    [subjectReferenceValues, subjectSessionValues, subjectSessionPatches, contextReferenceValues, contextSessionValues].reduce(
      (total, resolved) => total + resolved.patches.length,
      0,
    ) +
    (contextBinding ? 1 : 0) +
    dynamicCost.provenanceEntries +
    instanceSessionProvenance;
  diagnostics.push(...budgetDiagnostics(metrics, budget, provenanceCount));
  if (diagnostics.length > 0) {
    return { valid: false, referenceKey: input.referenceKey, graph, generatedSessionData: [], diagnostics, provenance: [] };
  }

  const provenance: PreviewProvenanceEntry[] = [];
  const generatedSessionData: PreviewGeneratedSessionEntry[] = [];
  const rootEntry = context ?? subject;
  const rootArtifactKey = rootEntry.source.artifactKey;
  const tree = buildInstance({
    sourceCatalog: input.sourceCatalog,
    rootArtifactKey,
    artifactKey: rootArtifactKey,
    instancePath: [],
    placement: { kind: "root" },
    propertyOverrides: [],
    componentAdditions: [],
    activeArtifacts: [],
    ...(input.assetCatalog ? { assetCatalog: input.assetCatalog } : {}),
    reportStateRootDiagnostic: (diagnostic) =>
      diagnostics.push(
        resolverDiagnostic(
          "invalidReference",
          diagnostic.code,
          `/artifacts/${rootArtifactKey}/nodes/${diagnostic.stateRootNodeId}/elements/${diagnostic.targetNodeId}/${diagnostic.elementType}`,
          diagnostic.message,
        ),
      ),
    ...(context
      ? {
          rootRole: "context" as const,
          activeOwner: { layers: contextLayers, relativePath: [] },
          ...(subjectUseSitePath ? { subjectUseSitePath } : {}),
        }
      : {
          rootRole: "subject" as const,
          activeOwner: { layers: subjectLayers, relativePath: [] },
          subjectUseSitePath: [],
        }),
    subjectLayers,
    provenance,
  });

  let subjectInstance = context ? (subjectUseSitePath ? findInstance(tree, subjectUseSitePath) : undefined) : tree;
  if (context && contextBinding) {
    const targetParent = findInstance(tree, contextBinding.target.instancePath ?? []);
    if (
      !targetParent ||
      targetParent.artifactKey !== contextBinding.targetOwnerArtifactKey ||
      !findNode(targetParent.source, contextBinding.target.nodeId)
    ) {
      diagnostics.push(
        resolverDiagnostic(
          "invalidReference",
          "previewResolver.context.bindingTarget",
          "/context/placement/targetBinding",
          `Context Binder '${contextBinding.fieldName}' target cannot be found in the resolved context tree`,
        ),
      );
    } else {
      const generatedPath = [...(contextBinding.target.instancePath ?? []), "__referenceSubject"];
      if (findInstance(tree, generatedPath)) {
        diagnostics.push(
          resolverDiagnostic(
            "invalidReference",
            "previewResolver.context.identity",
            "/context/placement",
            `Generated subject instance '${generatedPath.join("/")}' collides with the context graph`,
          ),
        );
      } else {
        subjectInstance = buildInstance({
          sourceCatalog: input.sourceCatalog,
          rootArtifactKey,
          artifactKey: subject.source.artifactKey,
          instancePath: generatedPath,
          placement: { kind: "contextBinding", nodeId: contextBinding.target.nodeId, bindingField: contextBinding.fieldName },
          propertyOverrides: [],
          componentAdditions: [],
          activeArtifacts: [],
          ...(input.assetCatalog ? { assetCatalog: input.assetCatalog } : {}),
          reportStateRootDiagnostic: (diagnostic) =>
            diagnostics.push(
              resolverDiagnostic(
                "invalidReference",
                diagnostic.code,
                `/artifacts/${subject.source.artifactKey}/nodes/${diagnostic.stateRootNodeId}/elements/${diagnostic.targetNodeId}/${diagnostic.elementType}`,
                diagnostic.message,
              ),
            ),
          activeOwner: { layers: subjectLayers, relativePath: [] },
          subjectUseSitePath: generatedPath,
          subjectLayers,
          provenance,
        });
        targetParent.children.push(subjectInstance);
        const generated: PreviewGeneratedSessionEntry = {
          kind: "contextSubject",
          instanceKey: subjectInstance.instanceKey,
          artifactKey: subject.source.artifactKey,
          parentInstanceKey: targetParent.instanceKey,
          targetNodeId: contextBinding.target.nodeId,
          bindingField: contextBinding.fieldName,
          referenceKey: reference.referenceKey,
        };
        generatedSessionData.push(generated);
        provenance.push({
          kind: "generated",
          layer: "reference.context",
          instanceKey: generated.instanceKey,
          artifactKey: generated.artifactKey,
          parentInstanceKey: generated.parentInstanceKey,
          targetNodeId: generated.targetNodeId,
          bindingField: generated.bindingField,
          referenceKey: reference.referenceKey,
        });
      }
    }
  }
  if (!subjectInstance) {
    diagnostics.push(
      resolverDiagnostic(
        "invalidReference",
        "previewResolver.subject.instance",
        "/context/placement",
        `Subject '${reference.subjectArtifactKey}' is not present in the resolved context tree`,
      ),
    );
  } else {
    const expander = new PreviewDynamicExpander(input, tree, diagnostics, generatedSessionData, provenance);
    expander.expand(
      reference,
      { subject: subjectInstance, ...(context ? { context: tree } : {}) },
      false,
      new Set([reference.referenceKey]),
    );
    expander.resolveLayouts();
    for (const instanceKey of Object.keys(input.instanceSessionValues ?? {})) {
      if (!expander.usedSessionKeys.has(instanceKey)) {
        diagnostics.push(
          resolverDiagnostic(
            "invalidReference",
            "previewResolver.session.instance",
            `/prototypeSession/instances/${pointerToken(instanceKey)}`,
            `Prototype session instance '${instanceKey}' does not exist in the resolved Preview tree`,
          ),
        );
      }
    }
  }

  return {
    valid: diagnostics.length === 0,
    referenceKey: input.referenceKey,
    graph,
    tree,
    ...(subjectInstance ? { subjectInstanceKey: subjectInstance.instanceKey } : {}),
    viewport: reference.viewport ?? artifactInitialSize(tree.source),
    generatedSessionData,
    diagnostics,
    provenance,
  };
}
