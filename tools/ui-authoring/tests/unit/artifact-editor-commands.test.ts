import assert from "node:assert/strict";
import test from "node:test";
import { artifactPrefabPath } from "../../src/kernel/prefab-path.js";
import type { UiConcreteSource, UiVariantSource } from "../../src/schema/ui-source-schema.js";
import {
  updateVariantInitialSize,
  updateVariantNode,
  updateWorkspaceNode,
  updateWorkspaceNodes,
} from "../../src/web/editors/artifact/artifact-editor-commands.js";
import type { ArtifactWorkspaceState, WorkspaceArtifactMap } from "../../src/web/editors/artifact/artifact-workspace-state.js";
import type { ArtifactDocument } from "../../src/web/shared/types.js";

const base: UiConcreteSource = {
  sourceKind: "artifact",
  artifactKey: "BaseWidget",
  artifactType: "Widget",
  widgetType: "BaseWidget",
  initialSize: [100, 100],
  root: {
    id: "BaseWidget",
    rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
    components: { Image: { color: "#FFFFFFFF" } },
  },
};

const variant: UiVariantSource = {
  sourceKind: "variant",
  artifactKey: "RedWidget",
  artifactType: "Widget",
  variantOf: "BaseWidget",
  overrides: [],
};

function document(source: UiConcreteSource): ArtifactDocument {
  return {
    artifactKey: source.artifactKey,
    artifactType: source.artifactType,
    path: `${source.artifactKey}.ui.json`,
    prefabPath: artifactPrefabPath({ path: `${source.artifactKey}.ui.json`, artifactKey: source.artifactKey }),
    dependencies: [],
    source,
    resolvedSource: source,
  };
}

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "CommandWidget",
    artifactType: "Widget",
    widgetType: "CommandWidget",
    initialSize: [320, 180],
    root: {
      id: "CommandWidget",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        { id: "first", rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [10, -10], sizeDelta: [40, 20] } },
        { id: "second", rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [60, -10], sizeDelta: [40, 20] } },
      ],
    },
  };
}

test("Variant editor commands write and reset the same Registry field override", () => {
  const baseDocument = document(base);
  const resolvedVariant: UiConcreteSource = { ...base, artifactKey: variant.artifactKey, root: { ...base.root, id: variant.artifactKey } };
  const variantDocument: ArtifactDocument = { ...document(resolvedVariant), source: variant };
  const artifacts = new Map([
    [baseDocument.artifactKey, baseDocument],
    [variantDocument.artifactKey, variantDocument],
  ]);

  const changed = updateVariantNode(variant, variantDocument, artifacts, "RedWidget", (node) => ({
    ...node,
    components: { ...node.components, Image: { ...node.components?.Image, color: "#FF0000FF" } },
  }));
  assert.deepEqual(changed.overrides, [
    { target: { nodeId: "BaseWidget", componentType: "Image", fieldPath: "color" }, value: "#FF0000FF" },
  ]);

  const changedResolved: UiConcreteSource = {
    ...resolvedVariant,
    root: { ...resolvedVariant.root, components: { ...resolvedVariant.root.components, Image: { color: "#FF0000FF" } } },
  };
  const changedDocument: ArtifactDocument = { ...variantDocument, source: changed, resolvedSource: changedResolved };
  const changedArtifacts = new Map([
    [baseDocument.artifactKey, baseDocument],
    [changedDocument.artifactKey, changedDocument],
  ]);
  const reset = updateVariantNode(changed, changedDocument, changedArtifacts, "RedWidget", (node) => ({
    ...node,
    components: { ...node.components, Image: { ...node.components?.Image, color: "#FFFFFFFF" } },
  }));
  assert.deepEqual(reset.overrides, []);
});

test("Variant initialSize writes a local value and normalizes the immediate base value away", () => {
  const changed = updateVariantInitialSize(variant, base, [160, 120]);
  assert.deepEqual(changed.initialSize, [160, 120]);
  assert.equal(variant.initialSize, undefined);

  const reset = updateVariantInitialSize(changed, base, base.initialSize);
  assert.equal(reset.initialSize, undefined);
  assert.equal(Object.hasOwn(reset, "initialSize"), false);
});

test("Variant root canvas resize changes only initialSize", () => {
  const resolvedVariant: UiConcreteSource = { ...base, artifactKey: variant.artifactKey, root: { ...base.root, id: variant.artifactKey } };
  let documents: WorkspaceArtifactMap = new Map([
    [base.artifactKey, { path: "BaseWidget.ui.json", source: base }],
    [variant.artifactKey, { path: "RedWidget.ui.json", source: variant }],
  ]);
  const workspace = {
    get documents() {
      return documents;
    },
    commit: (updater: Parameters<ArtifactWorkspaceState["commit"]>[0]) => {
      const draft = new Map(documents);
      updater(draft);
      documents = draft;
    },
  } as unknown as ArtifactWorkspaceState;

  updateWorkspaceNode(workspace, variant.artifactKey, resolvedVariant.root.id, (node) => node, false, [160, 120]);
  const changed = documents.get(variant.artifactKey)?.source;
  assert.equal(changed?.sourceKind, "variant");
  if (changed?.sourceKind !== "variant") assert.fail("expected Variant source");
  assert.deepEqual(changed.initialSize, [160, 120]);
  assert.deepEqual(changed.overrides, []);

  updateWorkspaceNode(workspace, variant.artifactKey, resolvedVariant.root.id, (node) => node, false, base.initialSize);
  const reset = documents.get(variant.artifactKey)?.source;
  assert.equal(reset?.sourceKind, "variant");
  if (reset?.sourceKind !== "variant") assert.fail("expected Variant source");
  assert.equal(Object.hasOwn(reset, "initialSize"), false);
  assert.deepEqual(reset.overrides, []);
  assert.deepEqual(base.root.rect.sizeDelta, [0, 0]);
});

test("transient node transforms use the local workspace mutation path", () => {
  let documents: WorkspaceArtifactMap = new Map([
    ["CommandWidget", { path: "CommandWidget.ui.json", source: source() }],
    [
      "UnrelatedVariant",
      {
        path: "UnrelatedVariant.ui.json",
        source: {
          sourceKind: "variant",
          artifactKey: "UnrelatedVariant",
          artifactType: "Widget",
          variantOf: "UnavailableBase",
          overrides: [],
        },
      },
    ],
  ]);
  let localUpdates = 0;
  const apply = (updater: Parameters<ArtifactWorkspaceState["updateTransientLocal"]>[0]): void => {
    const draft = new Map(documents);
    updater(draft);
    documents = draft;
  };
  const workspace = {
    get documents() {
      return documents;
    },
    updateTransientLocal: (updater: Parameters<ArtifactWorkspaceState["updateTransientLocal"]>[0]) => {
      localUpdates += 1;
      apply(updater);
    },
    updateTransient: () => assert.fail("transient transforms must not rebuild the full Artifact Catalog"),
    commit: () => assert.fail("transient transforms must not create a committed mutation"),
  } as unknown as ArtifactWorkspaceState;

  updateWorkspaceNode(
    workspace,
    "CommandWidget",
    "first",
    (node) => ({
      ...node,
      rect: { ...node.rect, anchoredPosition: [25, -30] },
    }),
    true,
  );
  updateWorkspaceNodes(
    workspace,
    "CommandWidget",
    ["first", "second"],
    (node) => ({
      ...node,
      rect: { ...node.rect, anchoredPosition: [node.rect.anchoredPosition[0] + 5, node.rect.anchoredPosition[1]] },
    }),
    true,
  );

  assert.equal(localUpdates, 2);
  const updated = documents.get("CommandWidget")?.source;
  assert.equal(updated?.sourceKind, "artifact");
  assert.deepEqual(
    updated?.root.children?.map((node) => node.rect.anchoredPosition),
    [
      [30, -30],
      [65, -10],
    ],
  );
});
