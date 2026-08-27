import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { formatSource } from "../../src/kernel/canonical.js";
import { formatDeliveryState } from "../../src/kernel/delivery-state.js";
import { createUnityProjectionGraph } from "../../src/kernel/projection-graph.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import type { UiConcreteSource, UiPropertyOverride, UiVariantSource } from "../../src/schema/ui-source-schema.js";
import { observationNodes, runCli, source } from "./cli-test-fixture.js";

test("CLI previews semantic edits and writes only with --write", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-"));
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Main");
  const sourcePath = join(sourceDirectory, "Main.ui.json");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(join(workspaceRoot, "My project", "Assets", "Resources", "UI"), { recursive: true });
  await writeFile(sourcePath, formatSource(source()), "utf8");

  try {
    const preview = await runCli(workspaceRoot, [
      "set",
      "Main/Main.ui.json",
      "--node",
      "label",
      "--field",
      "rect.sizeDelta",
      "--value",
      "[320,48]",
    ]);
    const previewResult = JSON.parse(preview.stdout) as { written: boolean; path: string };
    assert.equal(previewResult.written, false);
    assert.equal(previewResult.path, "My project/UIAuthoring/Sources/Main/Main.ui.json");
    assert.deepEqual((JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource).root.children?.[0]?.rect.sizeDelta, [200, 40]);

    const applied = await runCli(workspaceRoot, [
      "set",
      "Main/Main.ui.json",
      "--node",
      "label",
      "--field",
      "rect.sizeDelta",
      "--value",
      "[320,48]",
      "--write",
    ]);
    assert.equal((JSON.parse(applied.stdout) as { written: boolean }).written, true);
    assert.deepEqual((JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource).root.children?.[0]?.rect.sizeDelta, [320, 48]);

    const inspected = await runCli(workspaceRoot, ["inspect", "Main/Main.ui.json", "--node", "label"]);
    assert.equal((JSON.parse(inspected.stdout) as { selected: { id: string } }).selected.id, "label");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI creates Artifacts through preview and guarded write", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-create-"));
  const sourcePath = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Widgets", "PanelWidget.ui.json");
  try {
    const args = [
      "create-artifact",
      "Widgets/PanelWidget.ui.json",
      "--artifact-key",
      "PanelWidget",
      "--artifact-type",
      "Widget",
      "--initial-size",
      "320x180",
    ];
    const preview = JSON.parse((await runCli(workspaceRoot, args)).stdout) as {
      written: boolean;
      canWrite: boolean;
      source: UiConcreteSource;
    };
    assert.equal(preview.written, false);
    assert.equal(preview.canWrite, true);
    assert.deepEqual(preview.source.initialSize, [320, 180]);
    await assert.rejects(readFile(sourcePath, "utf8"), /ENOENT/);

    const written = JSON.parse((await runCli(workspaceRoot, [...args, "--write"])).stdout) as { written: boolean };
    assert.equal(written.written, true);
    const stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
    assert.equal(stored.root.id, "PanelWidget");
    await assert.rejects(runCli(workspaceRoot, [...args, "--write"]), /already exists/);
    await assert.rejects(
      runCli(workspaceRoot, [
        "create-artifact",
        "Widgets/MissingSize.ui.json",
        "--artifact-key",
        "MissingSize",
        "--artifact-type",
        "Widget",
      ]),
      /requires --initial-size/,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI inserts authoring templates through preview and explicit write", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-template-"));
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Main");
  const commonDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Common");
  const sourcePath = join(sourceDirectory, "Main.ui.json");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(commonDirectory, { recursive: true });
  await mkdir(join(workspaceRoot, "My project", "Assets", "Resources", "UI"), { recursive: true });
  await writeFile(sourcePath, formatSource(source()), "utf8");
  await writeFile(
    join(commonDirectory, "ButtonActionPrimaryNeutral.ui.json"),
    formatSource({
      sourceKind: "artifact",
      artifactKey: "ButtonActionPrimaryNeutral",
      artifactType: "Fragment",
      initialSize: [200, 56],
      root: {
        id: "ButtonActionPrimaryNeutral",
        rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      },
    }),
    "utf8",
  );

  try {
    const args = ["template", "Main/Main.ui.json", "--parent", "MainCanvas", "--template", "slider", "--position", "120,-40"];
    const preview = JSON.parse((await runCli(workspaceRoot, args)).stdout) as { written: boolean; canWrite: boolean };
    assert.equal(preview.written, false);
    assert.equal(preview.canWrite, true);
    assert.equal((JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource).root.children?.length, 1);

    const applied = JSON.parse((await runCli(workspaceRoot, [...args, "--write"])).stdout) as { written: boolean };
    assert.equal(applied.written, true);
    const stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
    const slider = stored.root.children?.find((node) => node.components?.Slider);
    assert.deepEqual(slider?.rect.anchoredPosition, [120, -40]);
    assert.ok(slider?.children?.some((node) => node.children?.some((child) => child.id === slider.components?.Slider?.fillRect)));

    const referenceArgs = [
      "template",
      "Main/Main.ui.json",
      "--parent",
      "MainCanvas",
      "--template",
      "button-action-primary-neutral",
      "--position",
      "30,-20",
      "--write",
    ];
    assert.equal((JSON.parse((await runCli(workspaceRoot, referenceArgs)).stdout) as { written: boolean }).written, true);
    const referenced = (JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource).root.children?.find(
      (node) => node.components?.PrefabRef?.artifactKey === "ButtonActionPrimaryNeutral",
    );
    assert.deepEqual(referenced?.rect.sizeDelta, [200, 56]);
    assert.deepEqual(referenced?.rect.anchoredPosition, [30, -20]);

    await assert.rejects(
      runCli(workspaceRoot, ["template", "Main/Main.ui.json", "--parent", "MainCanvas", "--template", "button-close"]),
      /requires available Artifact 'ButtonClose'/,
    );

    await assert.rejects(
      runCli(workspaceRoot, ["template", "Main/Main.ui.json", "--parent", "MainCanvas", "--template", "slider", "--position", ","]),
      /--position must use the form X,Y/,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI extracts a Widget as one guarded multi-document transaction", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-extract-"));
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Main");
  const widgetDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Widgets");
  const sourcePath = join(sourceDirectory, "Main.ui.json");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(widgetDirectory, { recursive: true });
  await mkdir(join(workspaceRoot, "My project", "Assets", "Resources", "UI"), { recursive: true });
  await writeFile(sourcePath, formatSource(source()), "utf8");
  const occupied: UiConcreteSource = {
    ...source(),
    artifactKey: "OccupiedWidget",
    artifactType: "Widget",
    widgetType: "OccupiedWidget",
    initialSize: [1280, 720],
    root: { ...source().root, id: "OccupiedWidget" },
  };
  await writeFile(join(widgetDirectory, "Occupied.ui.json"), formatSource(occupied), "utf8");

  try {
    const occupiedPreview = JSON.parse(
      (
        await runCli(workspaceRoot, [
          "extract-widget",
          "Main/Main.ui.json",
          "--node",
          "label",
          "--artifact-key",
          "LabelWidget",
          "--out",
          "Widgets/Occupied.ui.json",
        ])
      ).stdout,
    ) as { written: boolean; canWrite: boolean; issues: Array<{ message: string }> };
    assert.equal(occupiedPreview.written, false);
    assert.equal(occupiedPreview.canWrite, false);
    assert.ok(occupiedPreview.issues.some((issue) => issue.message.includes("already exists")));

    const args = [
      "extract-widget",
      "Main/Main.ui.json",
      "--node",
      "label",
      "--artifact-key",
      "LabelWidget",
      "--out",
      "Widgets/LabelWidget.ui.json",
    ];
    const preview = JSON.parse((await runCli(workspaceRoot, args)).stdout) as {
      written: boolean;
      canWrite: boolean;
      affectedDocuments: string[];
      createdArtifact: { artifactKey: string };
    };
    assert.equal(preview.written, false);
    assert.equal(preview.canWrite, true);
    assert.equal(preview.createdArtifact.artifactKey, "LabelWidget");
    assert.equal(preview.affectedDocuments.length, 2);

    const applied = JSON.parse((await runCli(workspaceRoot, [...args, "--write"])).stdout) as { written: boolean };
    assert.equal(applied.written, true);
    const parent = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
    assert.equal(parent.root.children?.[0]?.components?.PrefabRef?.artifactKey, "LabelWidget");
    assert.equal(parent.bindings?.find((binding) => binding.name === "label")?.target.componentType, "PrefabRef");
    const widget = JSON.parse(await readFile(join(widgetDirectory, "LabelWidget.ui.json"), "utf8")) as UiConcreteSource;
    assert.equal(widget.artifactKey, "LabelWidget");
    assert.equal(widget.root.components?.Text?.text, "Ready");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI extracts a Fragment as one guarded multi-document transaction", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-extract-fragment-"));
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Main");
  const fragmentDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Fragments");
  const sourcePath = join(sourceDirectory, "Main.ui.json");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(fragmentDirectory, { recursive: true });
  await mkdir(join(workspaceRoot, "My project", "Assets", "Resources", "UI"), { recursive: true });
  const parent = source();
  parent.bindings = [{ name: "labelText", target: { nodeId: "label", componentType: "Text" } }];
  await writeFile(sourcePath, formatSource(parent), "utf8");
  const occupied: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "OccupiedFragment",
    artifactType: "Fragment",
    initialSize: [200, 40],
    root: { ...parent.root.children![0]!, id: "OccupiedFragment" },
  };
  await writeFile(join(fragmentDirectory, "Occupied.ui.json"), formatSource(occupied), "utf8");

  try {
    const occupiedArgs = [
      "extract-fragment",
      "Main/Main.ui.json",
      "--node",
      "label",
      "--artifact-key",
      "LabelFragment",
      "--out",
      "Fragments/Occupied.ui.json",
    ];
    const occupiedPreview = JSON.parse((await runCli(workspaceRoot, occupiedArgs)).stdout) as {
      written: boolean;
      canWrite: boolean;
      issues: Array<{ message: string }>;
    };
    assert.equal(occupiedPreview.written, false);
    assert.equal(occupiedPreview.canWrite, false);
    assert.ok(occupiedPreview.issues.some((issue) => issue.message.includes("already exists")));
    await assert.rejects(runCli(workspaceRoot, [...occupiedArgs, "--write"]), /Fragment extraction has blocking workspace issues/);
    assert.equal((JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource).root.children?.[0]?.id, "label");

    const args = [
      "extract-fragment",
      "Main/Main.ui.json",
      "--node",
      "label",
      "--artifact-key",
      "LabelFragment",
      "--out",
      "Fragments/LabelFragment.ui.json",
    ];
    const preview = JSON.parse((await runCli(workspaceRoot, args)).stdout) as {
      fragmentPath: string;
      written: boolean;
      canWrite: boolean;
      affectedDocuments: string[];
      createdArtifact: { artifactKey: string; artifactType: string };
    };
    assert.equal(preview.fragmentPath, "My project/UIAuthoring/Sources/Fragments/LabelFragment.ui.json");
    assert.equal(preview.written, false);
    assert.equal(preview.canWrite, true);
    assert.deepEqual(preview.createdArtifact, {
      artifactKey: "LabelFragment",
      artifactType: "Fragment",
      initialSize: [200, 40],
    });
    assert.equal(preview.affectedDocuments.length, 2);

    const applied = JSON.parse((await runCli(workspaceRoot, [...args, "--write"])).stdout) as { written: boolean };
    assert.equal(applied.written, true);
    const storedParent = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
    assert.deepEqual(storedParent.root.children?.[0]?.components?.PrefabRef, { artifactKey: "LabelFragment" });
    assert.deepEqual(storedParent.bindings, [
      {
        name: "labelText",
        target: { instancePath: ["label"], nodeId: "LabelFragment", componentType: "Text" },
      },
    ]);
    const storedFragment = JSON.parse(await readFile(join(fragmentDirectory, "LabelFragment.ui.json"), "utf8")) as UiConcreteSource;
    assert.equal(storedFragment.artifactType, "Fragment");
    assert.equal(storedFragment.bindings, undefined);
    assert.equal(storedFragment.root.components?.Text?.text, "Ready");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI edit previews and writes a preconditioned multi-operation transaction", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-"));
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Main");
  const sourcePath = join(sourceDirectory, "Main.ui.json");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(join(workspaceRoot, "My project", "Assets", "Resources", "UI"), { recursive: true });
  await writeFile(sourcePath, formatSource(source()), "utf8");
  const transaction = {
    preconditions: [
      { kind: "nodeExists", nodeId: "label" },
      { kind: "fieldEquals", nodeId: "label", field: "components.Text.text", value: "Ready" },
      { kind: "childrenEqual", nodeId: "MainCanvas", children: ["label"] },
    ],
    operations: [
      { kind: "set", nodeId: "label", field: "components.Text.text", value: "Edited" },
      { kind: "duplicate", nodeId: "label" },
      { kind: "move", nodeId: "label_1", parentId: "MainCanvas", index: 0 },
    ],
  };

  try {
    const args = ["edit", "Main/Main.ui.json", "--ops-json", JSON.stringify(transaction)];
    const preview = JSON.parse((await runCli(workspaceRoot, args)).stdout) as {
      written: boolean;
      canWrite: boolean;
      affectedDocuments: string[];
      diff: { changes: Array<{ kind: string }> };
    };
    assert.equal(preview.written, false);
    assert.equal(preview.canWrite, true);
    assert.deepEqual(preview.affectedDocuments, ["My project/UIAuthoring/Sources/Main/Main.ui.json"]);
    assert.ok(preview.diff.changes.some((change) => change.kind === "fieldUpdated"));
    assert.equal((JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource).root.children?.[0]?.id, "label");

    const applied = JSON.parse((await runCli(workspaceRoot, [...args, "--write"])).stdout) as { written: boolean };
    assert.equal(applied.written, true);
    const stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
    assert.deepEqual(
      stored.root.children?.map((node) => node.id),
      ["label_1", "label"],
    );
    assert.equal(stored.root.children?.[1]?.components?.Text?.text, "Edited");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI edit ignores unavailable Preview documents outside the affected dependency closure", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-"));
  const sourceRoot = join(workspaceRoot, "My project", "UIAuthoring", "Sources");
  const sourceDirectory = join(sourceRoot, "Main");
  const sourcePath = join(sourceDirectory, "Main.ui.json");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(join(workspaceRoot, "My project", "Assets", "Resources", "UI"), { recursive: true });
  await writeFile(sourcePath, formatSource(source()), "utf8");
  await writeFile(
    join(sourceRoot, "Unrelated.ui-reference.json"),
    `${JSON.stringify({ referenceKey: "Unrelated", subjectArtifactKey: "MissingArtifact" }, null, 2)}\n`,
    "utf8",
  );

  const args = ["set", "Main/Main.ui.json", "--node", "label", "--field", "rect.sizeDelta", "--value", "[320,48]"];
  try {
    const preview = JSON.parse((await runCli(workspaceRoot, args)).stdout) as { canWrite: boolean; issues: unknown[] };
    assert.equal(preview.canWrite, true);
    assert.deepEqual(preview.issues, []);

    await runCli(workspaceRoot, [...args, "--write"]);
    assert.deepEqual((JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource).root.children?.[0]?.rect.sizeDelta, [320, 48]);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI edit blocks unavailable Preview documents inside the affected dependency closure", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-"));
  const sourceRoot = join(workspaceRoot, "My project", "UIAuthoring", "Sources");
  const sourceDirectory = join(sourceRoot, "Main");
  const sourcePath = join(sourceDirectory, "Main.ui.json");
  const document = source();
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(join(workspaceRoot, "My project", "Assets", "Resources", "UI"), { recursive: true });
  await writeFile(sourcePath, formatSource(document), "utf8");
  await writeFile(
    join(sourceRoot, "Broken.ui-reference.json"),
    `${JSON.stringify({ referenceKey: "Broken", subjectArtifactKey: document.artifactKey, unsupportedField: true }, null, 2)}\n`,
    "utf8",
  );

  try {
    const preview = JSON.parse(
      (await runCli(workspaceRoot, ["set", "Main/Main.ui.json", "--node", "label", "--field", "rect.sizeDelta", "--value", "[320,48]"]))
        .stdout,
    ) as { canWrite: boolean; issues: Array<{ message: string }> };
    assert.equal(preview.canWrite, false);
    assert.match(preview.issues[0]?.message ?? "", /Broken\.ui-reference\.json/);
    assert.deepEqual((JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource).root.children?.[0]?.rect.sizeDelta, [200, 40]);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI edit previews reverse PrefabRef layout impacts and blocks the write", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-layout-impact-"));
  const sourceRoot = join(workspaceRoot, "My project", "UIAuthoring", "Sources");
  const commonDirectory = join(sourceRoot, "Common");
  const screenDirectory = join(sourceRoot, "Screens");
  const progressPath = join(commonDirectory, "ProgressFragment.ui.json");
  const ownerPath = join(screenDirectory, "OwnerCanvas.ui.json");
  const fixedRect = {
    anchorMin: [0, 1] as [number, number],
    anchorMax: [0, 1] as [number, number],
    pivot: [0, 1] as [number, number],
    anchoredPosition: [0, 0] as [number, number],
    sizeDelta: [100, 20] as [number, number],
  };
  const progress: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "ProgressFragment",
    artifactType: "Fragment",
    initialSize: [100, 20],
    root: {
      id: "ProgressFragment",
      rect: fixedRect,
      children: [{ id: "track", rect: fixedRect }],
    },
  };
  const overrides: UiPropertyOverride[] = [
    { target: { nodeId: "track", componentType: "RectTransform", fieldPath: "anchoredPosition" }, value: [0, 0] },
    { target: { nodeId: "track", componentType: "RectTransform", fieldPath: "sizeDelta" }, value: [240, 12] },
  ];
  const owner: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "OwnerCanvas",
    artifactType: "Canvas",
    root: {
      id: "OwnerCanvas",
      rect: { ...fixedRect, anchorMin: [0, 0], anchorMax: [1, 1], sizeDelta: [0, 0] },
      children: [
        {
          id: "progressUse",
          rect: fixedRect,
          components: { PrefabRef: { artifactKey: progress.artifactKey, overrides } },
        },
      ],
    },
  };
  await mkdir(commonDirectory, { recursive: true });
  await mkdir(screenDirectory, { recursive: true });
  await mkdir(join(workspaceRoot, "My project", "Assets", "Resources", "UI"), { recursive: true });
  const baseline = formatSource(progress);
  await writeFile(progressPath, baseline, "utf8");
  await writeFile(ownerPath, formatSource(owner), "utf8");
  const transaction = {
    preconditions: [],
    operations: [
      { kind: "set", nodeId: "track", field: "rect.anchorMin", value: [0, 0] },
      { kind: "set", nodeId: "track", field: "rect.anchorMax", value: [1, 1] },
    ],
  };
  const args = ["edit", "Common/ProgressFragment.ui.json", "--ops-json", JSON.stringify(transaction)];

  try {
    const preview = JSON.parse((await runCli(workspaceRoot, args)).stdout) as {
      canWrite: boolean;
      affectedDocuments: string[];
      issues: Array<{ message: string }>;
    };
    assert.equal(preview.canWrite, false);
    assert.deepEqual(preview.affectedDocuments, [
      "My project/UIAuthoring/Sources/Common/ProgressFragment.ui.json",
      "My project/UIAuthoring/Sources/Screens/OwnerCanvas.ui.json",
    ]);
    assert.match(preview.issues[0]?.message ?? "", /OwnerCanvas\/progressUse/);
    assert.match(preview.issues[0]?.message ?? "", /RectTransform\.anchoredPosition/);

    await assert.rejects(runCli(workspaceRoot, [...args, "--write"]), /PrefabRef layout impact/);
    assert.equal(await readFile(progressPath, "utf8"), baseline);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI edit rejects display-name mutations outside the workspace rename command", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-"));
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Main");
  const sourcePath = join(sourceDirectory, "Main.ui.json");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(join(workspaceRoot, "My project", "Assets", "Resources", "UI"), { recursive: true });
  const original = formatSource(source());
  await writeFile(sourcePath, original, "utf8");

  try {
    const transaction = {
      preconditions: [],
      operations: [{ kind: "setNodeName", nodeId: "label", displayName: "Title" }],
    };
    await assert.rejects(
      runCli(workspaceRoot, ["edit", "Main/Main.ui.json", "--ops-json", JSON.stringify(transaction), "--write"]),
      /top-level 'rename' command/,
    );
    assert.equal(await readFile(sourcePath, "utf8"), original);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI edit loads repo-relative ops files and leaves the document untouched on a stale precondition", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-"));
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Main");
  const sourcePath = join(sourceDirectory, "Main.ui.json");
  const runtimeDirectory = join(workspaceRoot, "tools", "ui-authoring", ".runtime");
  const operationsPath = join(runtimeDirectory, "edit.json");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(runtimeDirectory, { recursive: true });
  await mkdir(join(workspaceRoot, "My project", "Assets", "Resources", "UI"), { recursive: true });
  const original = formatSource(source());
  await writeFile(sourcePath, original, "utf8");
  await writeFile(
    operationsPath,
    JSON.stringify({
      preconditions: [{ kind: "fieldEquals", nodeId: "label", field: "components.Text.text", value: "Stale" }],
      operations: [{ kind: "set", nodeId: "label", field: "components.Text.text", value: "Changed" }],
    }),
    "utf8",
  );

  try {
    await assert.rejects(
      runCli(workspaceRoot, ["edit", "Main/Main.ui.json", "--ops", "tools/ui-authoring/.runtime/edit.json", "--write"]),
      /precondition\[0\] failed/,
    );
    assert.equal(await readFile(sourcePath, "utf8"), original);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI edit rejects an invalid later operation without persisting earlier in-memory changes", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-"));
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Main");
  const sourcePath = join(sourceDirectory, "Main.ui.json");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(join(workspaceRoot, "My project", "Assets", "Resources", "UI"), { recursive: true });
  const original = formatSource(source());
  await writeFile(sourcePath, original, "utf8");
  const transaction = {
    preconditions: [],
    operations: [
      { kind: "set", nodeId: "label", field: "components.Text.text", value: "In memory only" },
      { kind: "remove", nodeId: "missingNode" },
    ],
  };

  try {
    await assert.rejects(
      runCli(workspaceRoot, ["edit", "Main/Main.ui.json", "--ops-json", JSON.stringify(transaction), "--write"]),
      /operation\[1\] failed/,
    );
    assert.equal(await readFile(sourcePath, "utf8"), original);
    await assert.rejects(
      runCli(workspaceRoot, ["edit", "Main/Main.ui.json", "--ops-json", JSON.stringify(transaction), "--ops", "ops.json"]),
      /exactly one of --ops or --ops-json/,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI rejects absolute file arguments", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-"));
  try {
    await assert.rejects(runCli(workspaceRoot, ["inspect", resolve(workspaceRoot, "absolute.ui.json")]), /Absolute paths are not allowed/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI reconciles an observation through preview and explicit write", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-"));
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Main");
  const sourcePath = join(sourceDirectory, "MainCanvas.ui.json");
  const observationPath = join(workspaceRoot, "tools", "ui-authoring", ".runtime", "main.observation.json");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(join(workspaceRoot, "My project", "Assets", "Resources", "UI"), { recursive: true });
  await mkdir(join(workspaceRoot, "tools", "ui-authoring", ".runtime"), { recursive: true });
  const document = source();
  await writeFile(sourcePath, formatSource(document), "utf8");
  const projection = createUnityProjectionGraph(
    createSourceCatalog([{ path: "Main/MainCanvas.ui.json", source: document }]),
    document.artifactKey,
  ).at(-1)!.projection;
  const nodes = observationNodes(projection.root) as Array<{ components: Record<string, Record<string, unknown>> }>;
  nodes[1]!.components.Text!.text = "Roundtrip";
  await writeFile(
    observationPath,
    JSON.stringify({
      artifactKey: document.artifactKey,
      prefabPath: projection.prefabPath,
      nodes,
      issues: [],
    }),
    "utf8",
  );

  try {
    const args = ["reconcile", "Main\\MainCanvas.ui.json", "--observation", "tools/ui-authoring/.runtime/main.observation.json"];
    const preview = JSON.parse((await runCli(workspaceRoot, args)).stdout) as {
      written: boolean;
      reconcile: { patches: Array<{ field: string }> };
    };
    assert.equal(preview.written, false);
    assert.deepEqual(
      preview.reconcile.patches.map((patch) => patch.field),
      ["components.Text.text"],
    );
    assert.equal((JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource).root.children?.[0]?.components?.Text?.text, "Ready");

    const applied = JSON.parse((await runCli(workspaceRoot, [...args, "--write"])).stdout) as { written: boolean };
    assert.equal(applied.written, true);
    assert.equal(
      (JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource).root.children?.[0]?.components?.Text?.text,
      "Roundtrip",
    );

    const invalidNodes = observationNodes(projection.root) as Array<{
      namePath: string[];
      components: Record<string, Record<string, unknown>>;
    }>;
    invalidNodes[1]!.namePath = ["MainCanvas", "Other"];
    invalidNodes[1]!.components.Text!.text = "Roundtrip";
    await writeFile(
      observationPath,
      JSON.stringify({
        artifactKey: document.artifactKey,
        prefabPath: projection.prefabPath,
        nodes: invalidNodes,
        issues: [],
      }),
      "utf8",
    );
    const blockedPreview = JSON.parse((await runCli(workspaceRoot, args)).stdout) as { written: boolean; reconcile: { issues: string[] } };
    assert.equal(blockedPreview.written, false);
    assert.ok(blockedPreview.reconcile.issues.some((issue) => issue.includes("namePath mismatch")));
    await assert.rejects(runCli(workspaceRoot, [...args, "--write"]), /blocking issues/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI sync and reconcile resolve Variant-local PrefabRefs from the Source Catalog", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-variant-prefab-ref-"));
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Main");
  const observationDirectory = join(workspaceRoot, "tools", "ui-authoring", ".runtime");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(join(workspaceRoot, "My project", "Assets", "Resources", "UI"), { recursive: true });
  await mkdir(observationDirectory, { recursive: true });

  const base = source();
  const child: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "ChildWidget",
    artifactType: "Widget",
    widgetType: "ChildWidget",
    initialSize: [80, 40],
    root: {
      id: "ChildWidget",
      rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [80, 40] },
    },
  };
  const variant: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: "MainVariantCanvas",
    artifactType: "Canvas",
    variantOf: base.artifactKey,
    nodeAdditions: [
      {
        parentId: base.artifactKey,
        siblingIndex: 0,
        node: {
          id: "childWidget",
          rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [80, 40] },
          components: { PrefabRef: { artifactKey: child.artifactKey } },
        },
      },
    ],
    overrides: [],
  };
  const inputs = [
    { path: "Main/MainCanvas.ui.json", source: base },
    { path: "Main/MainVariantCanvas.ui.json", source: variant },
    { path: "Main/ChildWidget.ui.json", source: child },
  ];
  for (const input of inputs)
    await writeFile(join(workspaceRoot, "My project", "UIAuthoring", "Sources", input.path), formatSource(input.source), "utf8");
  const catalog = createSourceCatalog(inputs);
  const projection = createUnityProjectionGraph(catalog, variant.artifactKey).at(-1)!.projection;
  const nodes: Array<Record<string, unknown>> = [];
  const visit = (node: typeof projection.root, parentId: string | null, siblingIndex: number, parentPath: readonly string[]): void => {
    const namePath = [...parentPath, node.name];
    const prefabPath = (node.components.PrefabRef as { readonly prefabPath?: string } | undefined)?.prefabPath;
    nodes.push({
      id: node.id,
      identity: "projection",
      name: node.name,
      namePath,
      parentId,
      siblingIndex,
      active: node.active,
      rect: node.rect,
      components: node.components,
      completeComponents: true,
      ...(prefabPath ? { prefabPath } : {}),
      unityOnlyComponents: [],
    });
    node.children.forEach((childNode, index) => {
      visit(childNode, node.id, index, namePath);
    });
  };
  visit(projection.root, null, 0, []);
  const observationPath = join(observationDirectory, "main-variant-canvas.observation.json");
  await writeFile(
    observationPath,
    JSON.stringify({ artifactKey: variant.artifactKey, prefabPath: projection.prefabPath, nodes, bindings: [], issues: [] }),
    "utf8",
  );

  try {
    const sourcePath = "Main/MainVariantCanvas.ui.json";
    const observationArgument = "tools/ui-authoring/.runtime/main-variant-canvas.observation.json";
    const synced = JSON.parse(
      (await runCli(workspaceRoot, ["sync-status", sourcePath, "--formal-observation", observationArgument])).stdout,
    ) as { reconcile: { issues: string[]; patches: unknown[] } };
    assert.deepEqual(synced.reconcile.issues, []);
    assert.deepEqual(synced.reconcile.patches, []);

    const reconciled = JSON.parse(
      (await runCli(workspaceRoot, ["reconcile", sourcePath, "--observation", observationArgument])).stdout,
    ) as { reconcile: { issues: string[]; patches: unknown[] } };
    assert.deepEqual(reconciled.reconcile.issues, []);
    assert.deepEqual(reconciled.reconcile.patches, []);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI reconcile routes node names through auto and manual identity semantics", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-reconcile-identity-"));
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Main");
  const sourcePath = join(sourceDirectory, "MainCanvas.ui.json");
  const deliveryStateDirectory = join(workspaceRoot, "My project", "UIAuthoring", "DeliveryState");
  const deliveryStatePath = join(deliveryStateDirectory, "MainCanvas.ui-delivery-state.json");
  const observationDirectory = join(workspaceRoot, "tools", "ui-authoring", ".runtime");
  const observationPath = join(observationDirectory, "main-name.observation.json");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(deliveryStateDirectory, { recursive: true });
  await mkdir(join(workspaceRoot, "My project", "Assets", "Resources", "UI"), { recursive: true });
  await mkdir(observationDirectory, { recursive: true });

  const document = source();
  await writeFile(sourcePath, formatSource(document), "utf8");
  await writeFile(deliveryStatePath, formatDeliveryState({ prefabGuid: "a".repeat(32), nodes: { label: "100" } }), "utf8");

  const writeObservation = async (input: UiConcreteSource, nodeId: string, displayName: string): Promise<void> => {
    const projection = createUnityProjectionGraph(
      createSourceCatalog([{ path: "Main/MainCanvas.ui.json", source: input }]),
      input.artifactKey,
    ).at(-1)!.projection;
    const nodes = observationNodes(projection.root) as Array<Record<string, unknown>>;
    nodes[1] = {
      ...nodes[1],
      identity: "marker",
      name: displayName,
      namePath: [input.artifactKey, displayName],
      parentId: input.root.id,
      siblingIndex: 0,
      id: nodeId,
    };
    await writeFile(
      observationPath,
      JSON.stringify({ artifactKey: input.artifactKey, prefabPath: projection.prefabPath, nodes, issues: [] }),
      "utf8",
    );
  };

  try {
    await writeObservation(document, "label", "Status Label");
    const args = ["reconcile", "Main/MainCanvas.ui.json", "--observation", "tools/ui-authoring/.runtime/main-name.observation.json"];
    const autoResult = JSON.parse((await runCli(workspaceRoot, [...args, "--write"])).stdout) as { written: boolean };
    assert.equal(autoResult.written, true);
    const automatic = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
    assert.equal(automatic.root.children?.[0]?.id, "statusLabel");
    assert.equal(automatic.root.children?.[0]?.idMode, undefined);
    assert.equal(automatic.root.children?.[0]?.name, "Status Label");
    assert.deepEqual((JSON.parse(await readFile(deliveryStatePath, "utf8")) as { nodes: Record<string, string> }).nodes, {
      statusLabel: "100",
    });

    const manual = structuredClone(automatic);
    const manualNode = manual.root.children![0]!;
    manualNode.id = "successExtractionPointLabel";
    manualNode.idMode = "manual";
    manualNode.name = "Label";
    await writeFile(sourcePath, formatSource(manual), "utf8");
    await writeFile(
      deliveryStatePath,
      formatDeliveryState({ prefabGuid: "a".repeat(32), nodes: { successExtractionPointLabel: "100" } }),
      "utf8",
    );
    await writeObservation(manual, manualNode.id, "Result Label");
    const manualResult = JSON.parse((await runCli(workspaceRoot, [...args, "--write"])).stdout) as { written: boolean };
    assert.equal(manualResult.written, true);
    const preserved = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
    assert.equal(preserved.root.children?.[0]?.id, "successExtractionPointLabel");
    assert.equal(preserved.root.children?.[0]?.idMode, "manual");
    assert.equal(preserved.root.children?.[0]?.name, "Result Label");
    assert.deepEqual((JSON.parse(await readFile(deliveryStatePath, "utf8")) as { nodes: Record<string, string> }).nodes, {
      successExtractionPointLabel: "100",
    });

    const synced = source();
    await writeFile(sourcePath, formatSource(synced), "utf8");
    await writeFile(deliveryStatePath, formatDeliveryState({ prefabGuid: "a".repeat(32), nodes: { label: "100" } }), "utf8");
    await writeObservation(synced, "label", "Synced Label");
    const syncResult = JSON.parse(
      (
        await runCli(workspaceRoot, [
          "sync-pull",
          "Main/MainCanvas.ui.json",
          "--formal-observation",
          "tools/ui-authoring/.runtime/main-name.observation.json",
          "--write",
        ])
      ).stdout,
    ) as { written: boolean };
    assert.equal(syncResult.written, true);
    const synchronized = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
    assert.equal(synchronized.root.children?.[0]?.id, "syncedLabel");
    assert.equal(synchronized.root.children?.[0]?.idMode, undefined);
    assert.equal(synchronized.root.children?.[0]?.name, "Synced Label");
    assert.deepEqual((JSON.parse(await readFile(deliveryStatePath, "utf8")) as { nodes: Record<string, string> }).nodes, {
      syncedLabel: "100",
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI renames a Binder target without invalidating an external Reference", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-"));
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Main");
  const sourcePath = join(sourceDirectory, "Main.ui.json");
  const referenceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "References");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(referenceDirectory, { recursive: true });
  await mkdir(join(workspaceRoot, "My project", "Assets", "Resources", "UI"), { recursive: true });
  const document = source();
  document.root.children![0]!.components!.StateRoot = { currentState: "default", states: { default: {} } };
  document.bindings = [{ name: "labelState", target: { nodeId: "label", componentType: "StateRoot" } }];
  await writeFile(sourcePath, formatSource(document), "utf8");
  await writeFile(
    join(referenceDirectory, "MainReference.ui-reference.json"),
    JSON.stringify({
      referenceKey: "MainReference",
      subjectArtifactKey: "MainCanvas",
      values: { labelState: { state: "default" } },
    }),
    "utf8",
  );

  try {
    const args = ["rename", "Main/Main.ui.json", "--node", "label", "--to", "title"];
    const preview = JSON.parse((await runCli(workspaceRoot, args)).stdout) as {
      written: boolean;
      writeAvailable: boolean;
      blockers: string[];
      changes: Array<{ beforeNodeId: string; afterNodeId: string }>;
    };
    assert.equal(preview.written, false);
    assert.equal(preview.writeAvailable, true);
    assert.deepEqual(preview.blockers, []);
    assert.deepEqual(
      preview.changes.map((change) => [change.beforeNodeId, change.afterNodeId]),
      [["label", "title"]],
    );
    const written = JSON.parse((await runCli(workspaceRoot, [...args, "--write"])).stdout) as {
      written: boolean;
      writeResult: { writtenPaths: string[] };
    };
    assert.equal(written.written, true);
    assert.deepEqual(written.writeResult.writtenPaths, ["Main/Main.ui.json"]);
    const stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
    assert.equal(stored.root.children?.[0]?.id, "title");
    assert.equal(stored.root.children?.[0]?.name, "title");
    assert.equal(stored.root.children?.[0]?.idMode, undefined);
    assert.deepEqual(stored.bindings?.[0], { name: "labelState", target: { nodeId: "title", componentType: "StateRoot" } });

    await runCli(workspaceRoot, [
      "rename",
      "Main/Main.ui.json",
      "--node",
      "title",
      "--to",
      "Result Label",
      "--node-id",
      "successExtractionPointLabel",
      "--write",
    ]);
    const manual = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
    assert.equal(manual.root.children?.[0]?.id, "successExtractionPointLabel");
    assert.equal(manual.root.children?.[0]?.idMode, "manual");

    await runCli(workspaceRoot, [
      "rename",
      "Main/Main.ui.json",
      "--node",
      "successExtractionPointLabel",
      "--to",
      "Result Label",
      "--auto-id",
      "--write",
    ]);
    const automatic = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
    assert.equal(automatic.root.children?.[0]?.id, "resultLabel");
    assert.equal(automatic.root.children?.[0]?.idMode, undefined);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI previews and writes Node ID alignment and exact refactors", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-identity-"));
  try {
    const sourcePath = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Main", "Main.ui.json");
    await mkdir(join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Main"), { recursive: true });
    const value = source();
    value.root.children![0]!.id = "legacy";
    value.root.children![0]!.name = "Ready Icon";
    await writeFile(sourcePath, formatSource(value), "utf8");

    const align = JSON.parse((await runCli(workspaceRoot, ["align-node-ids", "Main/Main.ui.json"])).stdout) as {
      writeAvailable: boolean;
      changes: Array<{ beforeNodeId: string; afterNodeId: string }>;
    };
    assert.equal(align.writeAvailable, true);
    assert.deepEqual(
      align.changes.map((change) => [change.beforeNodeId, change.afterNodeId]),
      [["legacy", "readyIcon"]],
    );
    assert.equal((JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource).root.children?.[0]?.id, "legacy");
    await runCli(workspaceRoot, ["align-node-ids", "Main/Main.ui.json", "--write"]);
    const aligned = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
    assert.equal(aligned.root.children?.[0]?.id, "readyIcon");
    assert.equal(aligned.root.children?.[0]?.idMode, undefined);

    const refactor = JSON.parse(
      (await runCli(workspaceRoot, ["refactor-node-id", "Main/Main.ui.json", "--node", "readyIcon", "--to", "caption"])).stdout,
    ) as {
      writeAvailable: boolean;
      changes: Array<{ afterNodeId: string }>;
    };
    assert.equal(refactor.writeAvailable, true);
    assert.equal(refactor.changes[0]?.afterNodeId, "caption");
    await runCli(workspaceRoot, ["refactor-node-id", "Main/Main.ui.json", "--node", "readyIcon", "--to", "caption", "--write"]);
    const refactored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
    assert.equal(refactored.root.children?.[0]?.id, "caption");
    assert.equal(refactored.root.children?.[0]?.idMode, "manual");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
