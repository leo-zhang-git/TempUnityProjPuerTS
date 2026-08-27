import { overrideTargetKey } from "../../../kernel/override.js";
import { stateRootActiveControlIndex } from "../../../kernel/state-root-control.js";
import { findNode, walkNodes } from "../../../kernel/tree.js";
import { componentAdditionTargetKey } from "../../../kernel/use-site-components.js";
import type { UiConcreteSource, UiNode } from "../../../schema/ui-source-schema.js";
import type { ArtifactDocument } from "../../shared/types.js";

export interface HierarchyNodeStatusIndex {
  readonly nodesById: ReadonlyMap<string, UiNode>;
  readonly prefabDescendantNodeIds: ReadonlySet<string>;
  readonly stateRootActiveControllersByNodeId: ReadonlyMap<string, readonly string[]>;
}

export interface HierarchyNodeStatusInput {
  readonly node: UiNode;
  readonly ownerArtifactKey: string;
  readonly instancePath: readonly string[];
  readonly localArtifactKey: string;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly index?: HierarchyNodeStatusIndex | undefined;
}

export function createHierarchyNodeStatusIndex(source: UiConcreteSource): HierarchyNodeStatusIndex {
  const nodesById = new Map<string, UiNode>();
  const prefabDescendantNodeIds = new Set<string>();
  const visit = (node: UiNode, belowPrefabRef: boolean): void => {
    nodesById.set(node.id, node);
    if (belowPrefabRef) prefabDescendantNodeIds.add(node.id);
    const childBelowPrefabRef = belowPrefabRef || Boolean(node.components?.PrefabRef);
    for (const child of node.children ?? []) visit(child, childBelowPrefabRef);
  };
  visit(source.root, false);
  const stateRootActiveControllersByNodeId = new Map(
    [...stateRootActiveControlIndex(source)].map(([nodeId, controls]) => [nodeId, controls.map((control) => control.stateRootNodeId)]),
  );
  return { nodesById, prefabDescendantNodeIds, stateRootActiveControllersByNodeId };
}

export function hierarchyNodeStatus(input: HierarchyNodeStatusInput): readonly string[] {
  const owner = input.artifacts.get(input.ownerArtifactKey);
  const isBindingRoot = owner?.resolvedSource.root.id === input.node.id && owner.source.artifactType !== "Fragment";
  const labels: string[] = [];
  if (isBindingRoot) {
    const localBindings = input.artifacts.get(input.localArtifactKey)?.resolvedSource.bindings ?? [];
    const referencedByParentBinder =
      owner.source.artifactType === "Widget" &&
      localBindings.some(
        ({ target }) =>
          target.componentType === "PrefabRef" &&
          [...(target.instancePath ?? []), target.nodeId].join("\0") === input.instancePath.join("\0"),
      );
    labels.push(referencedByParentBinder ? "BR" : "B");
  }
  if (input.node.components?.StateRoot) labels.push("SR");
  const stateRootActiveControllers =
    input.ownerArtifactKey === input.localArtifactKey
      ? input.index?.stateRootActiveControllersByNodeId.get(input.node.id)
      : owner
        ? stateRootActiveControlIndex(owner.resolvedSource)
            .get(input.node.id)
            ?.map((control) => control.stateRootNodeId)
        : undefined;
  if ((stateRootActiveControllers?.length ?? 0) > 0) labels.push("SR:A");
  const topOwner = input.artifacts.get(input.localArtifactKey)?.resolvedSource;
  const localDocument = input.artifacts.get(input.localArtifactKey);
  if (localDocument?.source.sourceKind === "variant") {
    const base = input.artifacts.get(localDocument.source.variantOf)?.resolvedSource;
    const targetNodeId =
      input.instancePath.length === 0 && input.node.id === localDocument.resolvedSource.root.id
        ? (base?.root.id ?? input.node.id)
        : input.node.id;
    const targetPath = input.instancePath.join("\0");
    if (
      localDocument.source.overrides.some(
        (override) => (override.target.instancePath ?? []).join("\0") === targetPath && override.target.nodeId === targetNodeId,
      )
    )
      labels.push("OVR");
    const baseNames = new Set(base?.bindings?.map((declaration) => declaration.name) ?? []);
    if (
      (localDocument.source.bindings ?? []).some(
        (declaration) =>
          !baseNames.has(declaration.name) &&
          (declaration.target.instancePath ?? []).join("\0") === targetPath &&
          declaration.target.nodeId === input.node.id,
      )
    )
      labels.push("ADD");
  }
  if (input.instancePath.length === 0 && topOwner) {
    const belowPrefabRef = input.index
      ? input.index.prefabDescendantNodeIds.has(input.node.id)
      : walkNodes(topOwner)
          .find((candidate) => candidate.node.id === input.node.id)
          ?.path.slice(0, -1)
          .some((ancestorId) => findNode(topOwner, ancestorId)?.components?.PrefabRef);
    if (belowPrefabRef) labels.push("ADD");
  }
  const topNode =
    input.instancePath.length > 0 && topOwner
      ? (input.index?.nodesById.get(input.instancePath[0]!) ?? findNode(topOwner, input.instancePath[0]!))
      : undefined;
  const topPrefabRef = topNode?.components?.PrefabRef;
  if (topPrefabRef) {
    const target = { ...(input.instancePath.length > 1 ? { instancePath: input.instancePath.slice(1) } : {}), nodeId: input.node.id };
    const overridden = (topPrefabRef.overrides ?? []).some((override) =>
      overrideTargetKey(override).startsWith(`${(target.instancePath ?? []).join("/")}\0${target.nodeId}\0`),
    );
    const added = (topPrefabRef.componentAdditions ?? []).some((addition) =>
      componentAdditionTargetKey(addition).startsWith(`${(target.instancePath ?? []).join("/")}\0${target.nodeId}\0`),
    );
    const firstReferenced = input.artifacts.get(topPrefabRef.artifactKey)?.resolvedSource;
    const isFirstRoot = input.instancePath.length === 1 && firstReferenced?.root.id === input.node.id;
    const rootAdded = isFirstRoot && Object.keys(topNode?.components ?? {}).some((type) => type !== "PrefabRef");
    const rootLayoutOverride =
      isFirstRoot &&
      firstReferenced &&
      (JSON.stringify(topNode?.rect) !== JSON.stringify(firstReferenced.root.rect) ||
        (topNode?.active ?? true) !== (firstReferenced.root.active ?? true));
    if ((overridden || rootLayoutOverride) && !labels.includes("OVR")) labels.push("OVR");
    if ((added || rootAdded) && !labels.includes("ADD")) labels.push("ADD");
  } else if (input.node.components?.PrefabRef) {
    const prefabRef = input.node.components.PrefabRef;
    if ((prefabRef.overrides?.length ?? 0) > 0) labels.push("OVR");
    if (
      (prefabRef.componentAdditions?.length ?? 0) > 0 ||
      (input.node.children?.length ?? 0) > 0 ||
      Object.keys(input.node.components ?? {}).some((type) => type !== "PrefabRef")
    )
      labels.push("ADD");
  }
  return labels;
}
