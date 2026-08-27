import { componentRegistry } from "../registry/component-registry.js";
import type { UiComponentType, UiSource } from "../schema/ui-source-schema.js";
import type { PrefabObservation } from "./prefab-observation.js";
import { walkNodes } from "./tree.js";

export interface PublishCapabilityDiagnostic {
  readonly artifactKey: string;
  readonly code: string;
  readonly message: string;
  readonly severity: "error";
  readonly path?: string;
  readonly nodeId?: string;
  readonly componentType?: string;
}

export interface PublishCapabilityOptions {
  readonly variantRoundtripSupported?: boolean;
}

export function publishCapabilityDiagnostics(
  source: UiSource,
  observation?: PrefabObservation,
  options: PublishCapabilityOptions = {},
): PublishCapabilityDiagnostic[] {
  const diagnostics: PublishCapabilityDiagnostic[] = [];
  if (source.sourceKind === "variant" && options.variantRoundtripSupported === false) {
    diagnostics.push({
      artifactKey: source.artifactKey,
      code: "publish.variantRoundtripUnsupported",
      severity: "error",
      path: "/sourceKind",
      message: `Variant '${source.artifactKey}' cannot publish until Variant observation and reconcile are available`,
    });
  }

  if (source.sourceKind === "artifact") {
    for (const { node, path } of walkNodes(source)) {
      for (const componentType of Object.keys(node.components ?? {}) as UiComponentType[]) {
        const roundtrip: string = componentRegistry[componentType].roundtrip;
        if (roundtrip !== "source-only") continue;
        diagnostics.push({
          artifactKey: source.artifactKey,
          nodeId: node.id,
          componentType,
          code: "publish.componentUnsupported",
          severity: "error",
          path: `/root/${path.slice(1).join("/children/")}/components/${componentType}`,
          message: `${node.id}.${componentType} has no bidirectional Prefab roundtrip implementation`,
        });
      }
    }
  }

  if (!observation) return diagnostics;
  const reportedUnityOnly = new Set<string>();
  for (const diagnostic of observation.diagnostics ?? []) {
    if (diagnostic.code === "component.unityOnly.unregistered" && diagnostic.nodeId && diagnostic.componentType) {
      reportedUnityOnly.add(`${diagnostic.nodeId}\0${diagnostic.componentType}`);
    }
    diagnostics.push({
      artifactKey: source.artifactKey,
      code: diagnostic.code,
      severity: "error",
      message: diagnostic.message,
      ...(diagnostic.path ? { path: diagnostic.path } : {}),
      ...(diagnostic.nodeId ? { nodeId: diagnostic.nodeId } : {}),
      ...(diagnostic.componentType ? { componentType: diagnostic.componentType } : {}),
    });
  }
  for (const node of observation.nodes) {
    for (const componentType of node.unityOnlyComponents) {
      if (reportedUnityOnly.has(`${node.id}\0${componentType}`)) continue;
      diagnostics.push({
        artifactKey: source.artifactKey,
        nodeId: node.id,
        componentType,
        code: "publish.componentUnsupported",
        severity: "error",
        path: `/prefab/${node.id}/${componentType}`,
        message: `${node.id} contains Unity component '${componentType}' without an explicit Source or Unity-only owner`,
      });
    }
  }
  return deduplicateDiagnostics(diagnostics);
}

function deduplicateDiagnostics(diagnostics: readonly PublishCapabilityDiagnostic[]): PublishCapabilityDiagnostic[] {
  const result = new Map<string, PublishCapabilityDiagnostic>();
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}\0${diagnostic.path ?? ""}\0${diagnostic.nodeId ?? ""}\0${diagnostic.componentType ?? ""}`;
    if (!result.has(key)) result.set(key, diagnostic);
  }
  return [...result.values()];
}
