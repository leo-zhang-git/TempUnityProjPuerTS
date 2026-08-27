import assert from "node:assert/strict";
import test from "node:test";
import { type EvaluatedNode, evaluateLocalLayout } from "../../src/kernel/layout.js";
import { buildPreviewDependencyGraph } from "../../src/kernel/preview-dependency-graph.js";
import type { PreviewReference } from "../../src/kernel/preview-reference.js";
import {
  createPreviewReferenceCatalog,
  defaultPreviewReferenceEntry,
  defaultReferencePathForArtifact,
  pairedArtifactPathForDefaultReference,
} from "../../src/kernel/preview-reference.js";
import { resolvedPreviewInstance, resolvePreviewReference } from "../../src/kernel/preview-reference-resolver.js";
import {
  applyPrototypeInteraction,
  createPrototypeSession,
  findPrototypeInteraction,
  prototypeOwnerValues,
  validatePrototype,
} from "../../src/kernel/prototype.js";
import { formatPrototype, formatReference, parsePrototype, parseReference } from "../../src/kernel/prototype-canonical.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import { findNode } from "../../src/kernel/tree.js";
import type { GraphTarget, UiPrototype } from "../../src/schema/ui-prototype-schema.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";

function rect(width = 200, height = 80): UiNode["rect"] {
  return {
    anchorMin: [0.5, 0.5],
    anchorMax: [0.5, 0.5],
    pivot: [0.5, 0.5],
    anchoredPosition: [0, 0],
    sizeDelta: [width, height],
  };
}

function source(artifactKey: string, artifactType: "Canvas" | "Widget", children: UiNode[] = []): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey,
    artifactType,
    ...(artifactType === "Widget" ? { widgetType: artifactKey, initialSize: [200, 80] as [number, number] } : {}),
    root: {
      id: artifactKey,
      rect: artifactType === "Canvas" ? { ...rect(), anchorMin: [0, 0], anchorMax: [1, 1], sizeDelta: [0, 0] } : rect(),
      children,
    },
  } as UiConcreteSource;
}

function evaluatedNode(root: EvaluatedNode, nodeId: string): EvaluatedNode | undefined {
  if (root.node.id === nodeId) return root;
  for (const child of root.children) {
    const found = evaluatedNode(child, nodeId);
    if (found) return found;
  }
  return undefined;
}

function sources() {
  const item = source("ItemWidget", "Widget", [
    { id: "itemLabel", rect: rect(80, 20), components: { Text: { text: "Empty", fontSize: 16 } } },
  ]);
  item.initialSize = [80, 20];
  item.root.rect.sizeDelta = [80, 20];
  item.bindings = [{ name: "label", target: { nodeId: "itemLabel", componentType: "Text" } }];

  const inventory = source("InventoryWidget", "Widget", [
    { id: "title", rect: rect(), components: { Text: { text: "Inventory", fontSize: 18 } } },
    {
      id: "itemList",
      rect: rect(),
      components: {
        LayoutSettings: { spacing: [0, 4] },
        ScrollRectEx: {
          content: "content",
          viewport: "viewport",
          emptyDefaultTarget: "emptyTarget",
          emptyDefaultStateRoot: "emptyState",
          templates: { Item: "itemTemplate" },
        },
      },
      children: [
        { id: "viewport", rect: rect() },
        {
          id: "content",
          rect: rect(),
          children: [{ id: "itemTemplate", active: false, rect: rect(80, 20), components: { PrefabRef: { artifactKey: "ItemWidget" } } }],
        },
        { id: "emptyTarget", active: true, rect: rect() },
        {
          id: "emptyState",
          rect: rect(),
          components: {
            StateRoot: {
              currentState: "empty",
              states: { populated: { emptyStateVisual: false }, empty: { emptyStateVisual: true } },
            },
          },
          children: [{ id: "emptyStateVisual", active: true, rect: rect() }],
        },
      ],
    },
    { id: "mountSlot", rect: rect() },
  ]);
  inventory.bindings = [
    { name: "title", target: { nodeId: "title", componentType: "Text" } },
    { name: "items", target: { nodeId: "itemList", componentType: "ScrollRectEx" } },
    { name: "mountSlot", target: { nodeId: "mountSlot", componentType: "GameObject" } },
  ];

  const context = source("WarehouseCanvas", "Canvas", [
    { id: "subjectMount", rect: rect() },
    { id: "inventoryUse", rect: rect(), components: { PrefabRef: { artifactKey: "InventoryWidget" } } },
  ]);
  context.bindings = [{ name: "subjectMount", target: { nodeId: "subjectMount", componentType: "GameObject" } }];

  return createSourceCatalog([
    { path: "Items/ItemWidget.ui.json", source: item },
    { path: "Inventory/InventoryWidget.ui.json", source: inventory },
    { path: "Inventory/WarehouseCanvas.ui.json", source: context },
  ]);
}

test("parses and formats only the current Reference and Prototype contract", () => {
  const reference = parseReference(
    JSON.stringify({
      referenceKey: "InventoryReview",
      subjectArtifactKey: "InventoryWidget",
      values: { title: { text: "Review" } },
      statePreviewContexts: { panelState: { viewState: "details" } },
    }),
  );
  const prototype = parsePrototype(
    JSON.stringify({
      prototypeKey: "InventoryFlow",
      startReferenceKey: "InventoryReview",
      interactions: [],
    }),
  );

  assert.equal(parseReference(formatReference(reference)).subjectArtifactKey, "InventoryWidget");
  assert.deepEqual(parseReference(formatReference(reference)).statePreviewContexts, {
    panelState: { viewState: "details" },
  });
  assert.deepEqual(parsePrototype(formatPrototype(prototype)), prototype);
  const instancePreset = parseReference(
    JSON.stringify({
      referenceKey: "InventoryPresetReview",
      subjectArtifactKey: "InventoryWidget",
      instanceValues: [
        {
          owner: { kind: "artifact", root: "subject", instancePath: ["item"] },
          referenceKey: "ItemWeapon",
        },
      ],
    }),
  );
  assert.equal("referenceKey" in instancePreset.instanceValues![0]!, true);
  assert.throws(() =>
    parseReference(
      JSON.stringify({
        referenceKey: "LegacyReference",
        rootArtifactKey: "InventoryWidget",
      }),
    ),
  );
  assert.throws(() =>
    parseReference(
      JSON.stringify({
        referenceKey: "RootInstancePreset",
        subjectArtifactKey: "InventoryWidget",
        instanceValues: [{ owner: { kind: "subject" }, referenceKey: "ItemWeapon" }],
      }),
    ),
  );
  assert.throws(() => parseReference(JSON.stringify({ ...reference, schemaVersion: 1 })));
  assert.throws(() =>
    parseReference(
      JSON.stringify({
        referenceKey: "EmptyInstanceEvidence",
        subjectArtifactKey: "InventoryWidget",
        instanceValues: [{ owner: { kind: "subject" } }],
      }),
    ),
  );
  assert.throws(() => parsePrototype(JSON.stringify({ ...prototype, version: "v1" })));
});

test("pairs only same-directory same-basename References as Artifact defaults", () => {
  const sourceCatalog = sources();
  const defaultReference: PreviewReference = {
    referenceKey: "InventoryWidget",
    subjectArtifactKey: "InventoryWidget",
  };
  const catalog = createPreviewReferenceCatalog(
    [
      { path: "Inventory/InventoryWidget.ui-reference.json", reference: defaultReference },
      {
        path: "Scenarios/InventoryReview.ui-reference.json",
        reference: { referenceKey: "InventoryReview", subjectArtifactKey: "InventoryWidget" },
      },
    ],
    sourceCatalog,
  );

  assert.equal(defaultReferencePathForArtifact(".\\Inventory\\InventoryWidget.ui.json"), "Inventory/InventoryWidget.ui-reference.json");
  assert.equal(pairedArtifactPathForDefaultReference("Inventory/InventoryWidget.ui-reference.json"), "Inventory/InventoryWidget.ui.json");
  assert.equal(defaultPreviewReferenceEntry(catalog, "InventoryWidget")?.reference.referenceKey, "InventoryWidget");
  assert.equal(catalog.entries.get("InventoryReview")?.defaultForArtifactKey, undefined);
  assert.throws(
    () =>
      createPreviewReferenceCatalog(
        [
          {
            path: "Inventory/InventoryWidget.ui-reference.json",
            reference: { referenceKey: "WrongReference", subjectArtifactKey: "InventoryWidget" },
          },
        ],
        sourceCatalog,
      ),
    /must use subject key/,
  );
});

test("rejects invalid StateRoot preview contexts when building the Reference catalog", () => {
  const sourceCatalog = createSourceCatalog([
    {
      path: "StateWidget.ui.json",
      source: {
        sourceKind: "artifact",
        artifactKey: "StateWidget",
        artifactType: "Widget",
        widgetType: "StateWidget",
        initialSize: [100, 100],
        root: {
          id: "StateWidget",
          rect: rect(),
          children: [
            {
              id: "viewState",
              rect: rect(),
              components: { StateRoot: { currentState: "default", states: { default: { panelState: true } } } },
              children: [
                {
                  id: "panelState",
                  rect: rect(),
                  components: { StateRoot: { currentState: "idle", states: { idle: {} } } },
                },
              ],
            },
          ],
        },
      },
    },
  ]);
  assert.throws(
    () =>
      createPreviewReferenceCatalog(
        [
          {
            path: "Scenarios/StatePreview.ui-reference.json",
            reference: {
              referenceKey: "StatePreview",
              subjectArtifactKey: "StateWidget",
              statePreviewContexts: { panelState: { viewState: "missing" } },
            },
          },
        ],
        sourceCatalog,
      ),
    /invalid statePreviewContexts.*viewState\.missing/,
  );
});

test("resolves context placement and Binder values with session precedence", () => {
  const sourceCatalog = sources();
  const reference: PreviewReference = {
    referenceKey: "InventoryContext",
    subjectArtifactKey: "InventoryWidget",
    values: { title: { text: "Reference title" } },
    context: {
      parentArtifactKey: "WarehouseCanvas",
      placement: { targetBinding: "subjectMount" },
    },
  };
  const referenceCatalog = createPreviewReferenceCatalog(
    [{ path: "Scenarios/InventoryContext.ui-reference.json", reference }],
    sourceCatalog,
  );
  const resolved = resolvePreviewReference({
    sourceCatalog,
    referenceCatalog,
    referenceKey: reference.referenceKey,
    subjectSessionValues: { title: { text: "Session title" } },
  });

  assert.equal(resolved.valid, true, resolved.diagnostics.map((entry) => entry.message).join("\n"));
  assert.equal(resolved.subjectInstanceKey, "WarehouseCanvas/__referenceSubject");
  const subject = resolvedPreviewInstance(resolved.tree!, resolved.subjectInstanceKey!);
  assert.equal(findNode(subject!.source, "title")?.components?.Text?.text, "Session title");
  assert.ok(resolved.provenance.some((entry) => entry.kind === "generated" && entry.layer === "reference.context"));
});

test("applies subject and instance values through nested Widget Binder paths", () => {
  const control = source("NestedControlWidget", "Widget", [
    { id: "nestedLabel", rect: rect(120, 20), components: { Text: { text: "Baseline", fontSize: 16 } } },
  ]);
  const confirm = source("NestedConfirmWidget", "Widget", [
    { id: "subjectControl", rect: rect(), components: { PrefabRef: { artifactKey: "NestedControlWidget" } } },
    { id: "instanceControl", rect: rect(), components: { PrefabRef: { artifactKey: "NestedControlWidget" } } },
  ]);
  confirm.bindings = [
    {
      name: "instanceLabel",
      target: { instancePath: ["instanceControl"], nodeId: "nestedLabel", componentType: "Text" },
    },
  ];
  const canvas = source("NestedCanvas", "Canvas", [
    { id: "confirmPanel", rect: rect(), components: { PrefabRef: { artifactKey: "NestedConfirmWidget" } } },
  ]);
  canvas.bindings = [
    {
      name: "subjectLabel",
      target: {
        instancePath: ["confirmPanel", "subjectControl"],
        nodeId: "nestedLabel",
        componentType: "Text",
      },
    },
  ];
  const sourceCatalog = createSourceCatalog([
    { path: "Nested/NestedControlWidget.ui.json", source: control },
    { path: "Nested/NestedConfirmWidget.ui.json", source: confirm },
    { path: "Nested/NestedCanvas.ui.json", source: canvas },
  ]);
  const reference: PreviewReference = {
    referenceKey: "NestedCanvas",
    subjectArtifactKey: "NestedCanvas",
    values: { subjectLabel: { text: "Subject value" } },
    instanceValues: [
      {
        owner: { kind: "artifact", root: "subject", instancePath: ["confirmPanel"] },
        values: { instanceLabel: { text: "Instance value" } },
      },
    ],
  };
  const referenceCatalog = createPreviewReferenceCatalog([{ path: "Nested/NestedCanvas.ui-reference.json", reference }], sourceCatalog);
  const resolved = resolvePreviewReference({ sourceCatalog, referenceCatalog, referenceKey: reference.referenceKey });
  const confirmInstance = resolved.tree?.children.find((instance) => instance.instancePath.at(-1) === "confirmPanel");
  const subjectControl = confirmInstance?.children.find((instance) => instance.instancePath.at(-1) === "subjectControl");
  const instanceControl = confirmInstance?.children.find((instance) => instance.instancePath.at(-1) === "instanceControl");

  assert.equal(resolved.valid, true, resolved.diagnostics.map((entry) => entry.message).join("\n"));
  assert.equal(findNode(subjectControl!.source, "nestedLabel")?.components?.Text?.text, "Subject value");
  assert.equal(findNode(instanceControl!.source, "nestedLabel")?.components?.Text?.text, "Instance value");
  assert.equal(findNode(control, "nestedLabel")?.components?.Text?.text, "Baseline");
});

test("composes a Reference preset onto an existing nested Widget and keeps local values last", () => {
  const detail = source("ComposableDetailWidget", "Widget", [
    { id: "detailText", rect: rect(120, 20), components: { Text: { text: "Baseline detail", fontSize: 14 } } },
  ]);
  detail.bindings = [{ name: "detail", target: { nodeId: "detailText", componentType: "Text" } }];
  const item = source("ComposableItemWidget", "Widget", [
    { id: "itemText", rect: rect(120, 20), components: { Text: { text: "Baseline item", fontSize: 14 } } },
    { id: "detail", rect: rect(), components: { PrefabRef: { artifactKey: detail.artifactKey } } },
  ]);
  item.bindings = [{ name: "label", target: { nodeId: "itemText", componentType: "Text" } }];
  const host = source("ComposableHostWidget", "Widget", [
    { id: "item", rect: rect(), components: { PrefabRef: { artifactKey: item.artifactKey } } },
  ]);
  const sourceCatalog = createSourceCatalog([
    { path: "Composable/ComposableDetailWidget.ui.json", source: detail },
    { path: "Composable/ComposableItemWidget.ui.json", source: item },
    { path: "Composable/ComposableHostWidget.ui.json", source: host },
  ]);
  const preset: PreviewReference = {
    referenceKey: "ComposableItemPreset",
    subjectArtifactKey: item.artifactKey,
    values: { label: { text: "Preset item" } },
    instanceValues: [
      {
        owner: { kind: "artifact", root: "subject", instancePath: ["detail"] },
        values: { detail: { text: "Preset detail" } },
      },
    ],
  };
  const review: PreviewReference = {
    referenceKey: host.artifactKey,
    subjectArtifactKey: host.artifactKey,
    instanceValues: [
      {
        owner: { kind: "artifact", root: "subject", instancePath: ["item"] },
        referenceKey: preset.referenceKey,
        values: { label: { text: "Local item" } },
      },
    ],
  };
  const referenceCatalog = createPreviewReferenceCatalog(
    [
      { path: "Composable/ComposableHostWidget.ui-reference.json", reference: review },
      { path: "Composable/References/ComposableItemPreset.ui-reference.json", reference: preset },
    ],
    sourceCatalog,
  );
  const resolved = resolvePreviewReference({ sourceCatalog, referenceCatalog, referenceKey: review.referenceKey });
  const itemInstance = resolved.tree?.children.find((instance) => instance.instancePath.at(-1) === "item");
  const detailInstance = itemInstance?.children.find((instance) => instance.instancePath.at(-1) === "detail");

  assert.equal(resolved.valid, true, resolved.diagnostics.map((entry) => entry.message).join("\n"));
  assert.equal(findNode(itemInstance!.source, "itemText")?.components?.Text?.text, "Local item");
  assert.equal(findNode(detailInstance!.source, "detailText")?.components?.Text?.text, "Preset detail");
  assert.ok(resolved.graph.edges.some((edge) => edge.reason === "instancePreset" && edge.to === `reference:${preset.referenceKey}`));
  assert.ok(resolved.provenance.some((entry) => entry.kind === "value" && entry.layer === "reference.preset"));
  assert.ok(resolved.provenance.some((entry) => entry.kind === "value" && entry.layer === "reference.instance"));
});

test("explains how subject instance ownership differs from context ownership", () => {
  const sourceCatalog = sources();
  const reference: PreviewReference = {
    referenceKey: "InventoryWithoutContext",
    subjectArtifactKey: "InventoryWidget",
    instanceValues: [
      {
        owner: { kind: "artifact", root: "context", instancePath: ["inventoryUse"] },
        values: { title: { text: "Context value" } },
      },
    ],
  };
  const referenceCatalog = createPreviewReferenceCatalog(
    [{ path: "Scenarios/InventoryWithoutContext.ui-reference.json", reference }],
    sourceCatalog,
  );
  const resolved = resolvePreviewReference({ sourceCatalog, referenceCatalog, referenceKey: reference.referenceKey });

  assert.equal(resolved.valid, false);
  assert.ok(
    resolved.diagnostics.some((entry) => entry.code === "previewResolver.owner.context" && entry.message.includes('root: "subject"')),
  );
});

test("uses item References as Collection presets and keeps ordinary baseline instances", () => {
  const sourceCatalog = sources();
  const inventory: PreviewReference = {
    referenceKey: "InventoryUseCase",
    subjectArtifactKey: "InventoryWidget",
    collections: [
      {
        key: "inventory",
        targetBinding: "items",
        groups: [
          {
            templateKey: "Item",
            items: [{ key: "weapon", referenceKey: "ItemWeapon" }, { key: "ammo", referenceKey: "ItemAmmo" }, {}, {}],
          },
        ],
      },
    ],
  };
  const referenceCatalog = createPreviewReferenceCatalog(
    [
      { path: "Scenarios/InventoryUseCase.ui-reference.json", reference: inventory },
      {
        path: "Scenarios/ItemWeapon.ui-reference.json",
        reference: { referenceKey: "ItemWeapon", subjectArtifactKey: "ItemWidget", values: { label: { text: "Weapon" } } },
      },
      {
        path: "Scenarios/ItemAmmo.ui-reference.json",
        reference: { referenceKey: "ItemAmmo", subjectArtifactKey: "ItemWidget", values: { label: { text: "Ammo" } } },
      },
    ],
    sourceCatalog,
  );
  const resolved = resolvePreviewReference({ sourceCatalog, referenceCatalog, referenceKey: inventory.referenceKey });

  assert.equal(resolved.valid, true, resolved.diagnostics.map((entry) => entry.message).join("\n"));
  const generated = resolved.generatedSessionData.filter((entry) => entry.kind === "collectionItem");
  assert.deepEqual(
    generated.map((entry) => entry.itemKey),
    ["weapon", "ammo", "0:2", "0:3"],
  );
  const texts = generated.map(
    (entry) => findNode(resolvedPreviewInstance(resolved.tree!, entry.instanceKey)!.source, "itemLabel")?.components?.Text?.text,
  );
  assert.deepEqual(texts, ["Weapon", "Ammo", "Empty", "Empty"]);
  assert.equal(findNode(resolved.tree!.effectiveLayoutSource, "emptyTarget")?.active, false);
  assert.equal(findNode(resolved.tree!.effectiveLayoutSource, "emptyState")?.components?.StateRoot?.currentState, "populated");
  assert.equal(findNode(resolved.tree!.effectiveLayoutSource, "emptyStateVisual")?.active, false);
});

test("lays out sibling Preview Collections in one owner evaluation", () => {
  const item = source("GridItemWidget", "Widget");
  item.initialSize = [20, 20];
  item.root.rect.sizeDelta = [20, 20];
  const inventory = source("SectionedInventoryWidget", "Widget", [
    {
      id: "sections",
      rect: rect(200, 200),
      components: {
        VerticalLayoutGroup: {
          spacing: 4,
          childForceExpandWidth: false,
          childForceExpandHeight: false,
        },
      },
      children: [
        {
          id: "itemGrid",
          rect: rect(44, 0),
          components: {
            GridLayoutGroup: { cellSize: [20, 20], spacing: [4, 4], constraint: "fixedColumnCount", constraintCount: 2 },
            ContentSizeFitter: { verticalFit: "preferredSize" },
            LayoutElement: { preferredWidth: 44 },
          },
        },
        { id: "divider", rect: rect(44, 10), components: { LayoutElement: { preferredWidth: 44, preferredHeight: 10 } } },
        {
          id: "gunGrid",
          rect: rect(44, 0),
          components: {
            GridLayoutGroup: { cellSize: [20, 20], spacing: [4, 4], constraint: "fixedColumnCount", constraintCount: 2 },
            ContentSizeFitter: { verticalFit: "preferredSize" },
            LayoutElement: { preferredWidth: 44 },
          },
        },
      ],
    },
  ]);
  inventory.initialSize = [200, 200];
  inventory.root.rect.sizeDelta = [200, 200];
  inventory.bindings = [
    { name: "items", target: { nodeId: "itemGrid", componentType: "GridLayoutGroup" } },
    { name: "guns", target: { nodeId: "gunGrid", componentType: "GridLayoutGroup" } },
  ];
  const sourceCatalog = createSourceCatalog([
    { path: "Items/GridItemWidget.ui.json", source: item },
    { path: "Inventory/SectionedInventoryWidget.ui.json", source: inventory },
  ]);
  const reference: PreviewReference = {
    referenceKey: "SectionedInventoryWidget",
    subjectArtifactKey: "SectionedInventoryWidget",
    collections: [
      { key: "items", targetBinding: "items", groups: [{ templateKey: "GridItemWidget", count: 3 }] },
      { key: "guns", targetBinding: "guns", groups: [{ templateKey: "GridItemWidget", count: 2 }] },
    ],
  };
  const referenceCatalog = createPreviewReferenceCatalog(
    [{ path: "Inventory/SectionedInventoryWidget.ui-reference.json", reference }],
    sourceCatalog,
  );
  const resolved = resolvePreviewReference({ sourceCatalog, referenceCatalog, referenceKey: reference.referenceKey });
  const firstItem = resolved.tree?.children.find(
    (instance) => instance.placement.kind === "collection" && instance.placement.collectionKey === "items",
  );
  const firstGun = resolved.tree?.children.find(
    (instance) => instance.placement.kind === "collection" && instance.placement.collectionKey === "guns",
  );

  assert.equal(resolved.valid, true, resolved.diagnostics.map((entry) => entry.message).join("\n"));
  assert.equal(firstItem?.placement.kind, "collection");
  assert.equal(firstGun?.placement.kind, "collection");
  if (firstItem?.placement.kind !== "collection" || firstGun?.placement.kind !== "collection")
    throw new Error("Expected Collection placements");
  assert.equal(firstGun.placement.rect.y - firstItem.placement.rect.y, 62);
});

test("includes mounted Widgets in fitted owner layout and moves following siblings", () => {
  const mounted = source("MountedWidget", "Widget");
  mounted.initialSize = [120, 30];
  mounted.root.rect.sizeDelta = [120, 30];

  const owner = source("DynamicOwnerWidget", "Widget", [
    {
      id: "top",
      rect: rect(120, 0),
      components: {
        ContentSizeFitter: { verticalFit: "preferredSize" },
        VerticalLayoutGroup: { spacing: 0, childForceExpandHeight: false, childForceExpandWidth: false },
        LayoutElement: { preferredWidth: 120 },
      },
    },
    { id: "footer", rect: rect(120, 20), components: { LayoutElement: { preferredWidth: 120, preferredHeight: 20 } } },
  ]);
  owner.initialSize = [120, 100];
  owner.root.rect.sizeDelta = [120, 100];
  owner.root.components = {
    ContentSizeFitter: { verticalFit: "preferredSize" },
    VerticalLayoutGroup: { spacing: 5, childForceExpandHeight: false, childForceExpandWidth: false },
  };
  owner.bindings = [{ name: "top", target: { nodeId: "top", componentType: "GameObject" } }];

  const sourceCatalog = createSourceCatalog([
    { path: "Dynamic/MountedWidget.ui.json", source: mounted },
    { path: "Dynamic/DynamicOwnerWidget.ui.json", source: owner },
  ]);
  const reference: PreviewReference = {
    referenceKey: "DynamicOwnerWidget",
    subjectArtifactKey: "DynamicOwnerWidget",
    mounts: [{ key: "mounted", targetBinding: "top", artifactKey: "MountedWidget" }],
  };
  const referenceCatalog = createPreviewReferenceCatalog(
    [{ path: "Dynamic/DynamicOwnerWidget.ui-reference.json", reference }],
    sourceCatalog,
  );
  const resolved = resolvePreviewReference({ sourceCatalog, referenceCatalog, referenceKey: reference.referenceKey });
  const layout = evaluateLocalLayout(resolved.tree!.effectiveLayoutSource, owner.initialSize);
  const top = evaluatedNode(layout, "top");
  const footer = evaluatedNode(layout, "footer");
  const mountedInstance = resolved.tree!.children.find((child) => child.placement.kind === "mount");

  assert.equal(resolved.valid, true, resolved.diagnostics.map((entry) => entry.message).join("\n"));
  assert.equal(layout.rect.height, 55);
  assert.equal(top?.rect.height, 30);
  assert.ok((footer?.rect.y ?? 0) >= (top?.rect.y ?? 0) + (top?.rect.height ?? 0));
  assert.equal(mountedInstance?.placement.kind, "mount");
  if (mountedInstance?.placement.kind !== "mount") throw new Error("Expected Mount placement");
  assert.equal(mountedInstance.placement.rect.width, 120);
  assert.equal(mountedInstance.placement.rect.height, 30);
  assert.ok(mountedInstance.placement.rect.y >= (top?.rect.y ?? 0));
  assert.ok(mountedInstance.placement.rect.y + mountedInstance.placement.rect.height <= (top?.rect.y ?? 0) + (top?.rect.height ?? 0));
});

test("keeps explicit Mount sizes from being compressed by a constrained owner layout", () => {
  const mounted = source("ExplicitSizeWidget", "Widget");
  mounted.initialSize = [120, 20];
  mounted.root.rect.sizeDelta = [120, 20];

  const owner = source("ConstrainedMountOwnerWidget", "Widget", [
    {
      id: "body",
      rect: rect(120, 100),
      components: {
        VerticalLayoutGroup: { spacing: 4, childForceExpandHeight: false, childForceExpandWidth: false },
      },
    },
  ]);
  owner.initialSize = [120, 100];
  owner.root.rect.sizeDelta = [120, 100];
  owner.bindings = [{ name: "body", target: { nodeId: "body", componentType: "GameObject" } }];

  const sourceCatalog = createSourceCatalog([
    { path: "Dynamic/ExplicitSizeWidget.ui.json", source: mounted },
    { path: "Dynamic/ConstrainedMountOwnerWidget.ui.json", source: owner },
  ]);
  const reference: PreviewReference = {
    referenceKey: "ConstrainedMountOwnerWidget",
    subjectArtifactKey: "ConstrainedMountOwnerWidget",
    mounts: [
      { key: "first", targetBinding: "body", artifactKey: "ExplicitSizeWidget", size: [120, 80] },
      { key: "second", targetBinding: "body", artifactKey: "ExplicitSizeWidget", size: [120, 80] },
    ],
  };
  const referenceCatalog = createPreviewReferenceCatalog(
    [{ path: "Dynamic/ConstrainedMountOwnerWidget.ui-reference.json", reference }],
    sourceCatalog,
  );
  const resolved = resolvePreviewReference({ sourceCatalog, referenceCatalog, referenceKey: reference.referenceKey });
  const first = resolved.tree!.children.find((child) => child.placement.kind === "mount" && child.placement.mountKey === "first");
  const second = resolved.tree!.children.find((child) => child.placement.kind === "mount" && child.placement.mountKey === "second");

  assert.equal(resolved.valid, true, resolved.diagnostics.map((entry) => entry.message).join("\n"));
  assert.equal(first?.placement.kind, "mount");
  assert.equal(second?.placement.kind, "mount");
  if (first?.placement.kind !== "mount" || second?.placement.kind !== "mount") throw new Error("Expected Mount placements");
  assert.equal(first.placement.rect.height, 80);
  assert.equal(second.placement.rect.height, 80);
  assert.ok(second.placement.rect.y >= first.placement.rect.y + first.placement.rect.height + 4);
});

test("propagates nested Mount preferred height through fitted owners", () => {
  const leaf = source("NestedLeafWidget", "Widget");
  leaf.initialSize = [120, 24];
  leaf.root.rect.sizeDelta = [120, 24];

  const container = source("NestedContainerWidget", "Widget");
  container.initialSize = [120, 80];
  container.root.rect.sizeDelta = [120, 80];
  container.root.components = {
    ContentSizeFitter: { verticalFit: "preferredSize" },
    VerticalLayoutGroup: { childForceExpandHeight: false, childForceExpandWidth: false },
  };
  container.bindings = [{ name: "content", target: { nodeId: "NestedContainerWidget", componentType: "GameObject" } }];

  const owner = source("NestedOwnerWidget", "Widget", [
    {
      id: "top",
      rect: rect(120, 0),
      components: {
        ContentSizeFitter: { verticalFit: "preferredSize" },
        VerticalLayoutGroup: { childForceExpandHeight: false, childForceExpandWidth: false },
      },
    },
  ]);
  owner.initialSize = [120, 100];
  owner.root.rect.sizeDelta = [120, 100];
  owner.root.components = {
    ContentSizeFitter: { verticalFit: "preferredSize" },
    VerticalLayoutGroup: { childForceExpandHeight: false, childForceExpandWidth: false },
  };
  owner.bindings = [{ name: "top", target: { nodeId: "top", componentType: "GameObject" } }];

  const sourceCatalog = createSourceCatalog([
    { path: "Dynamic/NestedLeafWidget.ui.json", source: leaf },
    { path: "Dynamic/NestedContainerWidget.ui.json", source: container },
    { path: "Dynamic/NestedOwnerWidget.ui.json", source: owner },
  ]);
  const containerReference: PreviewReference = {
    referenceKey: "NestedContainerWithLeaf",
    subjectArtifactKey: "NestedContainerWidget",
    mounts: [{ key: "leaf", targetBinding: "content", artifactKey: "NestedLeafWidget" }],
  };
  const ownerReference: PreviewReference = {
    referenceKey: "NestedOwnerWidget",
    subjectArtifactKey: "NestedOwnerWidget",
    mounts: [
      { key: "container", targetBinding: "top", artifactKey: "NestedContainerWidget", referenceKey: containerReference.referenceKey },
    ],
  };
  const referenceCatalog = createPreviewReferenceCatalog(
    [
      { path: "Dynamic/NestedContainerWithLeaf.ui-reference.json", reference: containerReference },
      { path: "Dynamic/NestedOwnerWidget.ui-reference.json", reference: ownerReference },
    ],
    sourceCatalog,
  );
  const resolved = resolvePreviewReference({ sourceCatalog, referenceCatalog, referenceKey: ownerReference.referenceKey });
  const ownerLayout = evaluateLocalLayout(resolved.tree!.effectiveLayoutSource, owner.initialSize);
  const containerInstance = resolved.tree!.children.find((child) => child.placement.kind === "mount");

  assert.equal(resolved.valid, true, resolved.diagnostics.map((entry) => entry.message).join("\n"));
  assert.equal(ownerLayout.rect.height, 24);
  assert.equal(containerInstance?.placement.kind, "mount");
  if (containerInstance?.placement.kind !== "mount") throw new Error("Expected nested container Mount");
  assert.equal(containerInstance.placement.rect.height, 24);
  assert.equal(evaluateLocalLayout(containerInstance.effectiveLayoutSource, container.initialSize).rect.height, 24);
});

test("keeps a fixed ScrollRect boundary while mounted content grows", () => {
  const content = source("TallContentWidget", "Widget");
  content.initialSize = [120, 500];
  content.root.rect.sizeDelta = [120, 500];

  const owner = source("ScrollBoundaryWidget", "Widget", [
    {
      id: "scroll",
      rect: rect(120, 300),
      components: { LayoutElement: { preferredWidth: 120, preferredHeight: 300 } },
      children: [
        {
          id: "body",
          rect: rect(120, 0),
          components: {
            ContentSizeFitter: { verticalFit: "preferredSize" },
            VerticalLayoutGroup: { childForceExpandHeight: false, childForceExpandWidth: false },
          },
        },
      ],
    },
  ]);
  owner.initialSize = [120, 300];
  owner.root.rect.sizeDelta = [120, 300];
  owner.root.components = {
    ContentSizeFitter: { verticalFit: "preferredSize" },
    VerticalLayoutGroup: { childForceExpandHeight: false, childForceExpandWidth: false },
  };
  owner.bindings = [{ name: "body", target: { nodeId: "body", componentType: "GameObject" } }];

  const sourceCatalog = createSourceCatalog([
    { path: "Dynamic/TallContentWidget.ui.json", source: content },
    { path: "Dynamic/ScrollBoundaryWidget.ui.json", source: owner },
  ]);
  const reference: PreviewReference = {
    referenceKey: "ScrollBoundaryWidget",
    subjectArtifactKey: "ScrollBoundaryWidget",
    mounts: [{ key: "content", targetBinding: "body", artifactKey: "TallContentWidget" }],
  };
  const referenceCatalog = createPreviewReferenceCatalog(
    [{ path: "Dynamic/ScrollBoundaryWidget.ui-reference.json", reference }],
    sourceCatalog,
  );
  const resolved = resolvePreviewReference({ sourceCatalog, referenceCatalog, referenceKey: reference.referenceKey });
  const layout = evaluateLocalLayout(resolved.tree!.effectiveLayoutSource, owner.initialSize);

  assert.equal(resolved.valid, true, resolved.diagnostics.map((entry) => entry.message).join("\n"));
  assert.equal(evaluatedNode(layout, "body")?.rect.height, 500);
  assert.equal(evaluatedNode(layout, "scroll")?.rect.height, 300);
  assert.equal(layout.rect.height, 300);
});

test("expands subject-only Mount presets and rejects dependency cycles and oversized collections", () => {
  const sourceCatalog = sources();
  const mounted: PreviewReference = {
    referenceKey: "MountedInventory",
    subjectArtifactKey: "InventoryWidget",
    mounts: [
      {
        key: "weapon",
        targetBinding: "mountSlot",
        artifactKey: "ItemWidget",
        referenceKey: "ItemWeapon",
        values: { label: { color: "#44AAFFFF" } },
      },
    ],
  };
  const itemWeapon: PreviewReference = {
    referenceKey: "ItemWeapon",
    subjectArtifactKey: "ItemWidget",
    values: { label: { text: "Weapon" } },
  };
  const referenceCatalog = createPreviewReferenceCatalog(
    [
      { path: "Scenarios/MountedInventory.ui-reference.json", reference: mounted },
      { path: "Scenarios/ItemWeapon.ui-reference.json", reference: itemWeapon },
    ],
    sourceCatalog,
  );
  const resolved = resolvePreviewReference({ sourceCatalog, referenceCatalog, referenceKey: mounted.referenceKey });
  const mount = resolved.generatedSessionData.find((entry) => entry.kind === "mount");

  assert.equal(resolved.valid, true, resolved.diagnostics.map((entry) => entry.message).join("\n"));
  assert.equal(
    findNode(resolvedPreviewInstance(resolved.tree!, mount!.instanceKey)!.source, "itemLabel")?.components?.Text?.text,
    "Weapon",
  );

  const cyclicCatalog = createPreviewReferenceCatalog(
    [
      {
        path: "Scenarios/CycleA.ui-reference.json",
        reference: {
          referenceKey: "CycleA",
          subjectArtifactKey: "InventoryWidget",
          mounts: [{ key: "a", targetBinding: "mountSlot", artifactKey: "ItemWidget", referenceKey: "CycleB" }],
        },
      },
      {
        path: "Scenarios/CycleB.ui-reference.json",
        reference: {
          referenceKey: "CycleB",
          subjectArtifactKey: "ItemWidget",
          mounts: [{ key: "b", targetBinding: "label", artifactKey: "InventoryWidget", referenceKey: "CycleA" }],
        },
      },
    ],
    sourceCatalog,
  );
  const graph = buildPreviewDependencyGraph({ sourceCatalog, referenceCatalog: cyclicCatalog, rootReferenceKeys: ["CycleA"] });
  assert.ok(graph.diagnostics.some((entry) => entry.code === "previewGraph.reference.cycle"));

  const missingTemplate: PreviewReference = {
    referenceKey: "MissingTemplate",
    subjectArtifactKey: "InventoryWidget",
    collections: [{ key: "inventory", targetBinding: "items", groups: [{ templateKey: "Missing", count: 1 }] }],
  };
  const missingTemplateCatalog = createPreviewReferenceCatalog(
    [{ path: "Scenarios/MissingTemplate.ui-reference.json", reference: missingTemplate }],
    sourceCatalog,
  );
  const missingTemplateGraph = buildPreviewDependencyGraph({
    sourceCatalog,
    referenceCatalog: missingTemplateCatalog,
    rootReferenceKeys: [missingTemplate.referenceKey],
  });
  assert.ok(
    missingTemplateGraph.diagnostics.some(
      (entry) => entry.code === "previewGraph.collection.template" && entry.message.includes("Available ScrollRectEx template keys: Item"),
    ),
  );

  const large: PreviewReference = {
    referenceKey: "LargeInventory",
    subjectArtifactKey: "InventoryWidget",
    collections: [{ key: "large", targetBinding: "items", groups: [{ templateKey: "Item", count: 1_000 }] }],
  };
  const largeCatalog = createPreviewReferenceCatalog(
    [{ path: "Scenarios/LargeInventory.ui-reference.json", reference: large }],
    sourceCatalog,
  );
  const overBudget = resolvePreviewReference({
    sourceCatalog,
    referenceCatalog: largeCatalog,
    referenceKey: large.referenceKey,
    budget: { maxGeneratedInstances: 10 },
  });
  assert.ok(overBudget.diagnostics.some((entry) => entry.code === "previewResolver.budget.generated"));
});

test("validates and executes owner-scoped SetValue, Navigate, and Back", () => {
  const sourceCatalog = sources();
  const startReference: PreviewReference = {
    referenceKey: "InventoryStart",
    subjectArtifactKey: "InventoryWidget",
  };
  const nextReference: PreviewReference = {
    referenceKey: "InventoryNext",
    subjectArtifactKey: "InventoryWidget",
  };
  const references = createPreviewReferenceCatalog(
    [
      { path: "Scenarios/InventoryStart.ui-reference.json", reference: startReference },
      { path: "Scenarios/InventoryNext.ui-reference.json", reference: nextReference },
    ],
    sourceCatalog,
  );
  const target: GraphTarget = {
    rootArtifactKey: "InventoryWidget",
    nodeId: "title",
    componentType: "Text",
  };
  const prototype: UiPrototype = {
    prototypeKey: "InventoryFlow",
    startReferenceKey: "InventoryStart",
    interactions: [
      {
        referenceKey: "InventoryStart",
        trigger: { kind: "Tap", target },
        actions: [
          { kind: "SetValue", owner: { kind: "subject" }, fieldName: "title", capability: "text", value: "Session title" },
          { kind: "Navigate", referenceKey: "InventoryNext" },
        ],
      },
      {
        referenceKey: "InventoryNext",
        trigger: { kind: "Tap", target },
        actions: [{ kind: "Back" }],
      },
    ],
  };

  assert.equal(validatePrototype(prototype, references, sourceCatalog).valid, true);
  const start = createPrototypeSession(prototype, [1280, 720]);
  const forward = findPrototypeInteraction(prototype, start.currentReferenceKey, target);
  assert.ok(forward);
  const next = applyPrototypeInteraction(start, forward);
  assert.equal(next.currentReferenceKey, "InventoryNext");
  assert.deepEqual(prototypeOwnerValues(next, "InventoryStart", { kind: "subject" }), {
    title: { text: "Session title" },
  });
  const back = findPrototypeInteraction(prototype, next.currentReferenceKey, target);
  assert.ok(back);
  assert.equal(applyPrototypeInteraction(next, back).currentReferenceKey, "InventoryStart");
});

test("validates Tap targets in Reference-generated Collection items", () => {
  const item = source("ActionItemWidget", "Widget");
  item.root.components = { ButtonEx: { targetGraphic: "ActionItemWidget" }, RoundedRect: {} };
  const list = source("ActionListWidget", "Widget", [
    {
      id: "itemList",
      rect: rect(),
      components: {
        LayoutSettings: { spacing: [0, 4] },
        ScrollRectEx: { content: "content", viewport: "viewport", templates: { ActionItemWidget: "itemTemplate" } },
      },
      children: [
        { id: "viewport", rect: rect() },
        {
          id: "content",
          rect: rect(),
          children: [
            {
              id: "itemTemplate",
              active: false,
              rect: rect(),
              components: { PrefabRef: { artifactKey: "ActionItemWidget" } },
            },
          ],
        },
      ],
    },
  ]);
  list.bindings = [{ name: "items", target: { nodeId: "itemList", componentType: "ScrollRectEx" } }];
  const sourceCatalog = createSourceCatalog([
    { path: "Action/ActionItemWidget.ui.json", source: item },
    { path: "Action/ActionListWidget.ui.json", source: list },
  ]);
  const reference: PreviewReference = {
    referenceKey: "ActionListReference",
    subjectArtifactKey: "ActionListWidget",
    collections: [
      {
        key: "actions",
        targetBinding: "items",
        groups: [{ templateKey: "ActionItemWidget", items: [{ key: "first" }] }],
      },
    ],
  };
  const references = createPreviewReferenceCatalog([{ path: "Action/ActionListReference.ui-reference.json", reference }], sourceCatalog);
  const resolved = resolvePreviewReference({
    sourceCatalog,
    referenceCatalog: references,
    referenceKey: reference.referenceKey,
  });
  const generated = resolved.generatedSessionData.find(
    (entry) => entry.kind === "collectionItem" && entry.collectionKey === "actions" && entry.itemKey === "first",
  );
  assert.ok(generated);
  const instance = resolvedPreviewInstance(resolved.tree!, generated.instanceKey);
  assert.ok(instance);
  const target: GraphTarget = {
    rootArtifactKey: "ActionListWidget",
    instancePath: [...instance.instancePath],
    nodeId: "ActionItemWidget",
    componentType: "ButtonEx",
  };
  const prototype: UiPrototype = {
    prototypeKey: "ActionListFlow",
    startReferenceKey: reference.referenceKey,
    interactions: [
      {
        referenceKey: reference.referenceKey,
        trigger: { kind: "Tap", target },
        actions: [{ kind: "Back" }],
      },
    ],
  };

  assert.equal(validatePrototype(prototype, references, sourceCatalog).valid, true);
  const invalid = structuredClone(prototype);
  invalid.interactions[0]!.trigger.target.instancePath = ["__collection_actions_0_key_missing"];
  assert.equal(validatePrototype(invalid, references, sourceCatalog).valid, false);
});
