import assert from "node:assert/strict";
import test from "node:test";
import type { UiConcreteSource, UiVariantSource } from "../../src/schema/ui-source-schema.js";
import type { ArtifactDocument, PrototypeDocument, ReferenceDocument } from "../../src/web/shared/types.js";
import {
  buildWorkspaceRelationGraph,
  workspaceRelationContext,
  workspaceRelationEdgesForReach,
  workspaceUsageRelationContext,
  workspaceVariantRelationContext,
} from "../../src/web/workspace/relations/workspace-relation-model.js";

const rect: UiConcreteSource["root"]["rect"] = {
  anchorMin: [0, 0],
  anchorMax: [1, 1],
  pivot: [0.5, 0.5],
  anchoredPosition: [0, 0],
  sizeDelta: [0, 0],
};

function artifact(artifactKey: string, dependencies: readonly string[] = []): ArtifactDocument {
  const root: UiConcreteSource["root"] = {
    id: artifactKey,
    rect,
    ...(dependencies.length > 0
      ? {
          children: dependencies.map((dependency, index) => ({
            id: `${dependency[0]!.toLowerCase()}${dependency.slice(1)}Use${index}`,
            name: `${dependency} Use`,
            rect,
            components: { PrefabRef: { artifactKey: dependency } },
          })),
        }
      : {}),
  };
  const source: UiConcreteSource = artifactKey.endsWith("Canvas")
    ? { sourceKind: "artifact", artifactKey, artifactType: "Canvas", root }
    : {
        sourceKind: "artifact",
        artifactKey,
        artifactType: "Widget",
        widgetType: artifactKey,
        initialSize: [320, 180],
        root,
      };
  return {
    artifactKey,
    artifactType: source.artifactType,
    path: `Relations/${artifactKey}.ui.json`,
    prefabPath: `Assets/Resources/UI/${artifactKey}.prefab`,
    dependencies,
    source,
    resolvedSource: source,
  };
}

function reference(referenceKey: string, subjectArtifactKey: string): ReferenceDocument {
  return {
    referenceKey,
    subjectArtifactKey,
    path: `Relations/${referenceKey}.ui-reference.json`,
    reference: { referenceKey, subjectArtifactKey },
  };
}

function variant(artifactKey: string, variantOf: string, resolvedSource: UiConcreteSource): ArtifactDocument {
  const source: UiVariantSource = {
    sourceKind: "variant",
    artifactKey,
    artifactType: resolvedSource.artifactType,
    variantOf,
    overrides: [],
  };
  return {
    artifactKey,
    artifactType: source.artifactType,
    path: `Relations/${artifactKey}.ui.json`,
    prefabPath: `Assets/Resources/UI/${artifactKey}.prefab`,
    dependencies: [variantOf],
    source,
    resolvedSource,
  };
}

test("builds direct and indirect Artifact, Reference, and Prototype relations", () => {
  const artifacts = new Map(
    [artifact("MainCanvas", ["PanelWidget"]), artifact("PanelWidget", ["SlotWidget"]), artifact("SlotWidget")].map((entry) => [
      entry.artifactKey,
      entry,
    ]),
  );
  const references = new Map(
    [reference("PanelReview", "PanelWidget"), reference("MainReview", "MainCanvas")].map((entry) => [entry.referenceKey, entry]),
  );
  const flow: PrototypeDocument = {
    prototypeKey: "MainFlow",
    startReferenceKey: "PanelReview",
    path: "Relations/MainFlow.ui-prototype.json",
    interactionCount: 0,
    prototype: { prototypeKey: "MainFlow", startReferenceKey: "PanelReview", interactions: [] },
  };
  const graph = buildWorkspaceRelationGraph(artifacts, references, new Map([[flow.prototypeKey, flow]]));
  const context = workspaceRelationContext(graph, "artifact", "PanelWidget");

  assert.ok(context);
  assert.deepEqual(
    context.outgoing.map((entry) => [entry.node.id, entry.distance]),
    [["artifact:SlotWidget", 1]],
  );
  assert.deepEqual(
    context.incoming.map((entry) => [entry.node.id, entry.distance]),
    [
      ["artifact:MainCanvas", 1],
      ["reference:PanelReview", 1],
      ["prototype:MainFlow", 2],
      ["reference:MainReview", 2],
    ],
  );

  const slot = context.outgoing.find((entry) => entry.node.key === "SlotWidget")!;
  assert.deepEqual(
    workspaceRelationEdgesForReach(graph, context.root.id, "outgoing", slot).map((edge) => [edge.reason, edge.useSite]),
    [["prefabRef", "SlotWidget Use"]],
  );
  const review = context.incoming.find((entry) => entry.node.key === "PanelReview")!;
  assert.deepEqual(
    workspaceRelationEdgesForReach(graph, context.root.id, "incoming", review).map((edge) => edge.reason),
    ["subject"],
  );
});

test("separates Variant lineage from Artifact usage", () => {
  const base = artifact("BaseWidget");
  const parentResolved = {
    ...base.resolvedSource,
    artifactKey: "ParentVariant",
    root: { ...base.resolvedSource.root, id: "ParentVariant" },
  };
  const parent = variant("ParentVariant", "BaseWidget", parentResolved);
  const childResolved = { ...parentResolved, artifactKey: "ChildVariant", root: { ...parentResolved.root, id: "ChildVariant" } };
  const child = variant("ChildVariant", "ParentVariant", childResolved);
  const consumer = artifact("ConsumerCanvas", ["ParentVariant"]);
  const artifacts = new Map([base, parent, child, consumer].map((entry) => [entry.artifactKey, entry]));
  const graph = buildWorkspaceRelationGraph(artifacts, new Map(), new Map());

  const lineage = workspaceVariantRelationContext(graph, "ParentVariant");
  assert.ok(lineage);
  assert.deepEqual(
    lineage.outgoing.map((entry) => [entry.node.key, entry.distance]),
    [["BaseWidget", 1]],
  );
  assert.deepEqual(
    lineage.incoming.map((entry) => [entry.node.key, entry.distance]),
    [["ChildVariant", 1]],
  );

  const baseLineage = workspaceVariantRelationContext(graph, "BaseWidget");
  assert.ok(baseLineage);
  assert.deepEqual(
    baseLineage.incoming.map((entry) => [entry.node.key, entry.distance]),
    [
      ["ParentVariant", 1],
      ["ChildVariant", 2],
    ],
  );

  const usage = workspaceUsageRelationContext(graph, "artifact", "ParentVariant");
  assert.ok(usage);
  assert.deepEqual(
    usage.incoming.map((entry) => [entry.node.key, entry.distance]),
    [["ConsumerCanvas", 1]],
  );
  assert.deepEqual(usage.outgoing, []);
});
