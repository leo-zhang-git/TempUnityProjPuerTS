import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatSource } from "../../src/kernel/canonical.js";
import { formatReference } from "../../src/kernel/prototype-canonical.js";
import type { UiReference } from "../../src/schema/ui-prototype-schema.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { runCli } from "./cli-test-fixture.js";

function rect(width: number, height: number): UiNode["rect"] {
  return {
    anchorMin: [0, 1],
    anchorMax: [0, 1],
    pivot: [0, 1],
    anchoredPosition: [0, 0],
    sizeDelta: [width, height],
  };
}

function itemSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "ReferenceItemWidget",
    artifactType: "Widget",
    widgetType: "ReferenceItemWidget",
    initialSize: [120, 32],
    bindings: [{ name: "label", target: { nodeId: "label", componentType: "Text" } }],
    root: {
      id: "ReferenceItemWidget",
      rect: rect(120, 32),
      children: [{ id: "label", rect: rect(120, 32), components: { Text: { text: "", fontSize: 16 } } }],
    },
  };
}

function canvasSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "ReferenceCanvas",
    artifactType: "Canvas",
    bindings: [
      { name: "title", target: { nodeId: "title", componentType: "Text" } },
      { name: "items", target: { nodeId: "itemList", componentType: "ScrollRectEx" } },
      { name: "slot", target: { nodeId: "mountSlot", componentType: "GameObject" } },
      { name: "viewState", target: { nodeId: "viewState", componentType: "StateRoot" } },
      { name: "panelState", target: { nodeId: "panelState", componentType: "StateRoot" } },
    ],
    root: {
      id: "ReferenceCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        { id: "title", rect: rect(300, 40), components: { Text: { text: "", fontSize: 20 } } },
        {
          id: "viewState",
          rect: rect(1, 1),
          components: {
            StateRoot: {
              currentState: "browse",
              states: { browse: { panel: true }, details: { panel: true } },
            },
          },
        },
        {
          id: "panel",
          rect: rect(300, 180),
          children: [
            {
              id: "panelState",
              rect: rect(1, 1),
              components: {
                StateRoot: {
                  currentState: "list",
                  states: { list: { detailText: true }, empty: { detailText: false } },
                },
              },
            },
            { id: "detailText", rect: rect(160, 24), components: { Text: { text: "Details", fontSize: 14 } } },
          ],
        },
        {
          id: "itemList",
          rect: rect(260, 120),
          components: {
            LayoutSettings: { spacing: [0, 4] },
            ScrollRectEx: { content: "content", viewport: "viewport", templates: { Item: "itemTemplate" } },
          },
          children: [
            { id: "viewport", rect: rect(260, 120) },
            {
              id: "content",
              rect: rect(260, 120),
              children: [
                {
                  id: "itemTemplate",
                  active: false,
                  rect: rect(120, 32),
                  components: { PrefabRef: { artifactKey: "ReferenceItemWidget" } },
                },
              ],
            },
          ],
        },
        { id: "mountSlot", rect: rect(120, 32) },
      ],
    },
  };
}

const createOperations = {
  operations: [
    { kind: "valueSet", fieldName: "title", capability: "text", value: "Reference Preview" },
    {
      kind: "statePreviewContextSet",
      targetStateRoot: "panelState",
      upstreamStateRoot: "viewState",
      stateName: "details",
    },
    {
      kind: "collectionSet",
      collection: {
        key: "items",
        targetBinding: "items",
        groups: [{ templateKey: "Item", items: [{ key: "first", values: { label: { text: "Dynamic Item" } } }] }],
      },
    },
    {
      kind: "mountSet",
      mount: {
        key: "promo",
        targetBinding: "slot",
        artifactKey: "ReferenceItemWidget",
        values: { label: { text: "Mounted Item" } },
      },
    },
    {
      kind: "instanceValuesSet",
      owner: { kind: "mount", mountKey: "promo" },
      referenceKey: "ReferenceItemPreset",
      values: { label: { color: "#44AAFFFF" } },
    },
  ],
};

test("CLI creates and edits a default Reference through typed preview operations", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-reference-edit-"));
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Reference");
  const referencePath = join(sourceDirectory, "ReferenceCanvas.ui-reference.json");
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(join(sourceDirectory, "ReferenceCanvas.ui.json"), formatSource(canvasSource()), "utf8");
  await writeFile(join(sourceDirectory, "ReferenceItemWidget.ui.json"), formatSource(itemSource()), "utf8");

  try {
    const namedArgs = [
      "reference-edit",
      "Reference/ReferenceItemWidget.ui.json",
      "--reference-key",
      "ReferenceItemPreset",
      "--out",
      "Reference/ReferenceItemPreset.ui-reference.json",
      "--ops-json",
      JSON.stringify({ operations: [{ kind: "valueSet", fieldName: "label", capability: "text", value: "Preset Item" }] }),
    ];
    const namedPreview = JSON.parse((await runCli(workspaceRoot, namedArgs)).stdout) as { written: boolean; canWrite: boolean };
    assert.equal(namedPreview.written, false);
    assert.equal(namedPreview.canWrite, true);
    await runCli(workspaceRoot, [...namedArgs, "--write"]);

    const args = ["reference-edit", "Reference/ReferenceCanvas.ui.json", "--ops-json", JSON.stringify(createOperations)];
    const preview = JSON.parse((await runCli(workspaceRoot, args)).stdout) as {
      written: boolean;
      canWrite: boolean;
      diff: { created: boolean; changes: unknown[] };
    };
    assert.equal(preview.written, false);
    assert.equal(preview.canWrite, true);
    assert.equal(preview.diff.created, true);
    await assert.rejects(readFile(referencePath, "utf8"), /ENOENT/);

    const applied = JSON.parse((await runCli(workspaceRoot, [...args, "--write"])).stdout) as { written: boolean; canWrite: boolean };
    assert.equal(applied.written, true);
    assert.equal(applied.canWrite, true);
    const stored = JSON.parse(await readFile(referencePath, "utf8")) as UiReference;
    assert.equal(stored.values?.title?.text, "Reference Preview");
    assert.deepEqual(stored.statePreviewContexts, { panelState: { viewState: "details" } });
    assert.equal(stored.collections?.[0]?.groups[0]?.templateKey, "Item");
    assert.equal(stored.mounts?.[0]?.key, "promo");
    assert.deepEqual(stored.instanceValues?.[0]?.owner, { kind: "mount", mountKey: "promo" });
    assert.equal("referenceKey" in stored.instanceValues![0]! ? stored.instanceValues![0]!.referenceKey : undefined, "ReferenceItemPreset");

    await writeFile(
      referencePath,
      formatReference({
        ...stored,
        values: { ...stored.values, missingBinding: { text: "Stale preview value" } },
      }),
      "utf8",
    );
    await writeFile(
      join(sourceDirectory, "UnrelatedBroken.ui-reference.json"),
      formatReference({
        referenceKey: "UnrelatedBroken",
        subjectArtifactKey: "ReferenceCanvas",
        values: { anotherMissingBinding: { text: "Unrelated preview issue" } },
      }),
      "utf8",
    );
    const repairArgs = [
      "reference-edit",
      "Reference/ReferenceCanvas.ui-reference.json",
      "--ops-json",
      JSON.stringify({ operations: [{ kind: "valueRemove", fieldName: "missingBinding" }] }),
    ];
    const repairPreview = JSON.parse((await runCli(workspaceRoot, repairArgs)).stdout) as { canWrite: boolean; written: boolean };
    assert.equal(repairPreview.canWrite, true);
    assert.equal(repairPreview.written, false);
    await runCli(workspaceRoot, [...repairArgs, "--write"]);

    const removeOperations = {
      operations: [
        { kind: "valueRemove", fieldName: "title", capability: "text" },
        { kind: "statePreviewContextRemove", targetStateRoot: "panelState" },
        { kind: "collectionRemove", key: "items" },
        { kind: "instanceValuesRemove", owner: { kind: "mount", mountKey: "promo" } },
        { kind: "mountRemove", key: "promo" },
      ],
    };
    const removed = JSON.parse(
      (
        await runCli(workspaceRoot, [
          "reference-edit",
          "Reference/ReferenceCanvas.ui-reference.json",
          "--ops-json",
          JSON.stringify(removeOperations),
          "--write",
        ])
      ).stdout,
    ) as { written: boolean; diff: { created: boolean; changes: Array<{ path: string }> } };
    assert.equal(removed.written, true);
    assert.equal(removed.diff.created, false);
    assert.ok(removed.diff.changes.some((change) => change.path === "/values"));
    const minimal = JSON.parse(await readFile(referencePath, "utf8")) as UiReference;
    assert.deepEqual(minimal, { referenceKey: "ReferenceCanvas", subjectArtifactKey: "ReferenceCanvas" });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI reports Reference workspace issues before write", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-reference-invalid-"));
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Reference");
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(join(sourceDirectory, "ReferenceCanvas.ui.json"), formatSource(canvasSource()), "utf8");
  await writeFile(join(sourceDirectory, "ReferenceItemWidget.ui.json"), formatSource(itemSource()), "utf8");

  const operations = {
    operations: [
      {
        kind: "collectionSet",
        collection: { key: "broken", targetBinding: "missing", groups: [{ templateKey: "Item", count: 1 }] },
      },
    ],
  };
  const args = ["reference-edit", "Reference/ReferenceCanvas.ui.json", "--ops-json", JSON.stringify(operations)];
  try {
    const preview = JSON.parse((await runCli(workspaceRoot, args)).stdout) as {
      written: boolean;
      canWrite: boolean;
      issues: Array<{ message: string }>;
    };
    assert.equal(preview.written, false);
    assert.equal(preview.canWrite, false);
    assert.match(preview.issues[0]?.message ?? "", /no Binder field 'missing'/);
    await assert.rejects(runCli(workspaceRoot, [...args, "--write"]), /blocking workspace issues/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
