import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatSource } from "../../src/kernel/canonical.js";
import { formatPrototype, formatReference } from "../../src/kernel/prototype-canonical.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { png, runCli, source, writeDefaultFontContract } from "./cli-test-fixture.js";

test("CLI queries one Component schema", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-preview-"));
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Main");
  const sourcePath = join(sourceDirectory, "Main.ui.json");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(join(workspaceRoot, "My project", "Assets", "Resources", "UI"), { recursive: true });
  const document = source();
  document.root.components = {
    StateRoot: { currentState: "shown", states: { shown: { label: true }, hidden: { label: false } }, elements: [] },
  };
  await writeFile(sourcePath, formatSource(document), "utf8");

  try {
    const component = JSON.parse((await runCli(workspaceRoot, ["schema", "--component", "StateRoot"])).stdout) as {
      kind: string;
      componentType: string;
      schema: { properties: Record<string, unknown> };
      defaultValue: Record<string, unknown>;
      inspector: Array<{ property?: string }>;
      contract: { previewCapabilities: string[] };
    };
    assert.equal(component.kind, "component-schema");
    assert.equal(component.componentType, "StateRoot");
    assert.ok(component.schema.properties.states);
    assert.equal(component.defaultValue.currentState, "default");
    assert.ok(component.inspector.some((entry) => entry.property === "states"));
    assert.deepEqual(component.contract.previewCapabilities, ["active", "state"]);

    for (const componentType of ["ButtonEx", "Slider"]) {
      const unsupported = JSON.parse((await runCli(workspaceRoot, ["schema", "--component", componentType])).stdout) as {
        contract: { previewCapabilities: string[] };
      };
      assert.deepEqual(unsupported.contract.previewCapabilities, ["active"]);
    }
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI validate dispatches Artifact, Reference, and Prototype through their affected workspace closure", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-validate-"));
  const sourceRoot = join(workspaceRoot, "My project", "UIAuthoring", "Sources");
  const sourceDirectory = join(sourceRoot, "Main");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(join(workspaceRoot, "My project", "Assets", "Resources", "UI"), { recursive: true });
  await writeFile(join(sourceDirectory, "Main.ui.json"), formatSource(source()), "utf8");
  await writeFile(
    join(sourceDirectory, "MainCanvas.ui-reference.json"),
    formatReference({ referenceKey: "MainCanvas", subjectArtifactKey: "MainCanvas" }),
    "utf8",
  );
  await writeFile(
    join(sourceDirectory, "Main.ui-prototype.json"),
    formatPrototype({ prototypeKey: "MainPrototype", startReferenceKey: "MainCanvas", interactions: [] }),
    "utf8",
  );
  await writeFile(
    join(sourceRoot, "Unrelated.ui-reference.json"),
    `${JSON.stringify({ referenceKey: "Unrelated", subjectArtifactKey: "MissingArtifact" }, null, 2)}\n`,
    "utf8",
  );

  try {
    for (const path of ["Main/Main.ui.json", "Main/MainCanvas.ui-reference.json", "Main/Main.ui-prototype.json"]) {
      const result = JSON.parse((await runCli(workspaceRoot, ["validate", path])).stdout) as {
        valid: boolean;
        issues: unknown[];
      };
      assert.equal(result.valid, true, path);
      assert.deepEqual(result.issues, [], path);
    }
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI project commands accept Source-root-relative and repository-relative paths", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-project-"));
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Main");
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(join(sourceDirectory, "MainCanvas.ui.json"), formatSource(source()), "utf8");

  try {
    const inputs = ["Main/MainCanvas.ui.json", "My project/UIAuthoring/Sources/Main/MainCanvas.ui.json"];
    for (const input of inputs) {
      const projection = JSON.parse((await runCli(workspaceRoot, ["project", input])).stdout) as {
        artifactKey: string;
        prefabPath: string;
      };
      assert.equal(projection.artifactKey, "MainCanvas", input);
      assert.equal(projection.prefabPath, "Assets/Resources/UI/Prefab/Main/MainCanvas.prefab", input);
    }

    const graph = JSON.parse((await runCli(workspaceRoot, ["project-graph", inputs[1]!])).stdout) as {
      rootArtifactKey: string;
      projectionPaths: string[];
    };
    assert.equal(graph.rootArtifactKey, "MainCanvas");
    assert.deepEqual(graph.projectionPaths, ["tools/ui-authoring/.runtime/MainCanvas.projection.json"]);
    const storedProjection = JSON.parse(await readFile(join(workspaceRoot, ...graph.projectionPaths[0]!.split("/")), "utf8")) as {
      prefabPath: string;
    };
    assert.equal(storedProjection.prefabPath, "Assets/Resources/UI/Prefab/Main/MainCanvas.prefab");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI full check and selected verify stages produce structured read-only evidence", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-"));
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Main");
  const sourcePath = join(sourceDirectory, "MainCanvas.ui.json");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(join(workspaceRoot, "My project", "Assets", "Resources", "UI"), { recursive: true });
  await writeDefaultFontContract(workspaceRoot);
  await writeFile(sourcePath, formatSource(source()), "utf8");

  try {
    const fullCheck = JSON.parse((await runCli(workspaceRoot, ["check", "--full"])).stdout) as {
      summary: { errors: number };
      diagnostics: unknown[];
    };
    assert.equal(fullCheck.summary.errors, 0);
    assert.deepEqual(fullCheck.diagnostics, []);

    const check = JSON.parse((await runCli(workspaceRoot, ["check"])).stdout) as {
      phase: string;
      ok: boolean;
      files: { artifact: number; reference: number; prototype: number };
    };
    assert.equal(check.phase, "ready");
    assert.equal(check.ok, true);
    assert.deepEqual(check.files, { artifact: 1, reference: 0, prototype: 0 });

    const verify = JSON.parse(
      (await runCli(workspaceRoot, ["verify", "Main/MainCanvas.ui.json", "--stages", "validate,inspect,project"])).stdout,
    ) as {
      status: string;
      stages: Array<{ stage: string; status: string; evidence: Array<{ path: string }> }>;
    };
    assert.equal(verify.status, "passed");
    assert.deepEqual(
      verify.stages.map((stage) => [stage.stage, stage.status]),
      [
        ["validate", "passed"],
        ["inspect", "passed"],
        ["project", "passed"],
      ],
    );
    for (const evidence of verify.stages.flatMap((stage) => stage.evidence)) {
      assert.equal(evidence.path.includes(workspaceRoot.replaceAll("\\", "/")), false);
      await readFile(join(workspaceRoot, ...evidence.path.split("/")), "utf8");
    }
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI full check succeeds when finite text overflow only produces a warning", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-warning-"));
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Main");
  await mkdir(sourceDirectory, { recursive: true });
  await writeDefaultFontContract(workspaceRoot);
  const document = source();
  const label = document.root.children![0]!;
  label.id = "txt_label";
  label.rect.sizeDelta = [200, 20];
  label.components!.Text = { text: "", fontSize: 30, overflow: "ellipsis" };
  document.bindings = [{ name: "txt_label", target: { nodeId: label.id, componentType: "Text" } }];
  await writeFile(join(sourceDirectory, "Main.ui.json"), formatSource(document), "utf8");

  try {
    const report = JSON.parse((await runCli(workspaceRoot, ["check", "--full"])).stdout) as {
      summary: { errors: number; warnings: number };
      diagnostics: Array<{ code: string; identity?: { nodeId?: string } }>;
    };
    assert.equal(report.summary.errors, 0);
    assert.equal(report.summary.warnings, 1);
    assert.equal(report.diagnostics[0]?.code, "text.finiteOverflowInsufficientHeight");
    assert.equal(report.diagnostics[0]?.identity?.nodeId, "txt_label");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI full check uses TMP intrinsic metrics for ContentSizeFitter text", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-content-size-fitter-"));
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Main");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(join(workspaceRoot, "My project", "Assets", "Resources", "UI"), { recursive: true });
  await writeDefaultFontContract(workspaceRoot);
  const document = source();
  const label = document.root.children![0]!;
  label.rect.sizeDelta = [200, 0];
  label.components = {
    ContentSizeFitter: { verticalFit: "preferredSize" },
    Text: { text: "A", fontSize: 20, overflow: "ellipsis" },
  };
  await writeFile(join(sourceDirectory, "Main.ui.json"), formatSource(document), "utf8");

  try {
    const report = JSON.parse((await runCli(workspaceRoot, ["check", "--full"])).stdout) as {
      summary: { errors: number; warnings: number };
      diagnostics: Array<{ code: string; identity?: { nodeId?: string } }>;
    };
    assert.equal(report.summary.errors, 0);
    assert.equal(report.summary.warnings, 0);
    assert.deepEqual(report.diagnostics, []);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI full check blocks Binding naming violations while fast check remains unchanged", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-binding-check-"));
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Main");
  await mkdir(sourceDirectory, { recursive: true });
  await writeDefaultFontContract(workspaceRoot);
  const document = source();
  document.bindings = [
    { name: "txt_title", target: { nodeId: "label", componentType: "Text" } },
    { name: "goToLoadoutButton", target: { nodeId: "label", componentType: "GameObject" } },
  ];
  await writeFile(join(sourceDirectory, "Main.ui.json"), formatSource(document), "utf8");

  try {
    const fastCheck = JSON.parse((await runCli(workspaceRoot, ["check"])).stdout) as { ok: boolean };
    assert.equal(fastCheck.ok, true);

    await assert.rejects(runCli(workspaceRoot, ["check", "--full"]), (error: unknown) => {
      assert.ok(error instanceof Error);
      const stdout = (error as Error & { stdout?: string }).stdout;
      assert.equal(typeof stdout, "string");
      const report = JSON.parse(stdout!) as {
        summary: { errors: number };
        diagnostics: Array<{ code: string; identity?: { fieldPath?: string } }>;
      };
      assert.equal(report.summary.errors, 2);
      assert.deepEqual(
        report.diagnostics.map((item) => [item.code, item.identity?.fieldPath]),
        [
          ["binding.naming.format", "/bindings/1/name"],
          ["binding.naming.prefix", "/bindings/1/name"],
        ],
      );
      return true;
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI verify isolates evidence for same-named Sources by artifact identity", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-verify-identity-"));
  const sourceRoot = join(workspaceRoot, "My project", "UIAuthoring", "Sources");
  const first = source();
  first.artifactKey = "FirstCanvas";
  first.root.id = "FirstCanvas";
  const second = source();
  second.artifactKey = "SecondCanvas";
  second.root.id = "SecondCanvas";
  await mkdir(join(sourceRoot, "First"), { recursive: true });
  await mkdir(join(sourceRoot, "Second"), { recursive: true });
  await writeFile(join(sourceRoot, "First", "Main.ui.json"), formatSource(first), "utf8");
  await writeFile(join(sourceRoot, "Second", "Main.ui.json"), formatSource(second), "utf8");

  try {
    const verify = async (input: string): Promise<string> => {
      const result = JSON.parse((await runCli(workspaceRoot, ["verify", input, "--stages", "inspect"])).stdout) as {
        stages: Array<{ evidence: Array<{ path: string }> }>;
      };
      return result.stages[0]!.evidence[0]!.path;
    };
    const firstEvidence = await verify("First/Main.ui.json");
    const secondEvidence = await verify("Second/Main.ui.json");

    assert.equal(firstEvidence, "tools/ui-authoring/.runtime/verify/FirstCanvas/inspection.json");
    assert.equal(secondEvidence, "tools/ui-authoring/.runtime/verify/SecondCanvas/inspection.json");
    assert.notEqual(firstEvidence, secondEvidence);
    await readFile(join(workspaceRoot, ...firstEvidence.split("/")), "utf8");
    await readFile(join(workspaceRoot, ...secondEvidence.split("/")), "utf8");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI audits assets and moves a resource with all persisted references in one transaction", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-assets-"));
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Main");
  const assetDirectory = join(workspaceRoot, "My project", "Assets", "Resources", "UI");
  const sourcePath = join(sourceDirectory, "Main.ui.json");
  const referencePath = join(sourceDirectory, "AssetReview.ui-reference.json");
  const oldAssetPath = join(assetDirectory, "Prefab", "Canvas", "MainCanvas", "Old.png");
  const unusedAssetPath = join(assetDirectory, "Icons", "Unused.png");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(join(assetDirectory, "Prefab", "Canvas", "MainCanvas"), { recursive: true });
  await mkdir(join(assetDirectory, "Icons"), { recursive: true });
  await writeDefaultFontContract(workspaceRoot);
  const document = source();
  document.root.children![0]!.id = "img_icon";
  document.root.children![0]!.components!.Image = { sprite: "Prefab/Canvas/MainCanvas/Old.png" };
  document.bindings = [{ name: "img_icon", target: { nodeId: "img_icon", componentType: "Image" } }];
  await writeFile(sourcePath, formatSource(document), "utf8");
  await writeFile(
    referencePath,
    formatReference({
      referenceKey: "AssetReview",
      subjectArtifactKey: "MainCanvas",
      values: { img_icon: { sprite: "Prefab/Canvas/MainCanvas/Old.png" } },
    }),
    "utf8",
  );
  await writeFile(oldAssetPath, png(16, 8));
  await writeFile(
    `${oldAssetPath}.meta`,
    "guid: 00000000000000000000000000000001\ntextureType: 8\nspriteMode: 1\nspritePixelsToUnits: 100\n",
    "utf8",
  );
  await writeFile(unusedAssetPath, png(4, 4));
  await writeFile(
    `${unusedAssetPath}.meta`,
    "guid: 00000000000000000000000000000002\ntextureType: 8\nspriteMode: 1\nspritePixelsToUnits: 100\n",
    "utf8",
  );

  try {
    const audit = JSON.parse((await runCli(workspaceRoot, ["asset-audit"])).stdout) as {
      summary: { cataloged: number; referencedAssets: number; persistedReferences: number; unused: number; inventoryIssues: number };
      unused: Array<{ path: string }>;
    };
    assert.deepEqual(audit.summary, {
      cataloged: 2,
      referencedAssets: 1,
      persistedReferences: 3,
      prototypeSessionReferences: 0,
      unused: 1,
      inventoryIssues: 1,
    });
    assert.deepEqual(
      audit.unused.map((asset) => asset.path),
      ["Icons/Unused.png"],
    );
    await writeFile(
      join(sourceDirectory, "UnrelatedBroken.ui-reference.json"),
      formatReference({
        referenceKey: "UnrelatedBroken",
        subjectArtifactKey: "MainCanvas",
        values: { missingBinding: { text: "Unrelated preview issue" } },
      }),
      "utf8",
    );

    const args = ["asset-move", "Prefab/Canvas/MainCanvas/Old.png", "--to", "Shared/Renamed.png"];
    const preview = JSON.parse((await runCli(workspaceRoot, args)).stdout) as {
      written: boolean;
      transport: string;
      documents: Array<{ path: string; references: unknown[] }>;
    };
    assert.equal(preview.written, false);
    assert.equal(preview.transport, "preview");
    assert.deepEqual(
      preview.documents.map((change) => [change.path, change.references.length]),
      [
        ["Main/AssetReview.ui-reference.json", 1],
        ["Main/Main.ui.json", 1],
      ],
    );
    await writeFile(
      join(sourceDirectory, "AffectedBroken.ui-reference.json"),
      formatReference({
        referenceKey: "AffectedBroken",
        subjectArtifactKey: "MainCanvas",
        values: {
          img_icon: { sprite: "Prefab/Canvas/MainCanvas/Old.png" },
          missingBinding: { text: "Affected preview issue" },
        },
      }),
      "utf8",
    );
    await assert.rejects(runCli(workspaceRoot, args), /Preview Values owner 'MainCanvas' has no Binder field 'missingBinding'/);
    await rm(join(sourceDirectory, "AffectedBroken.ui-reference.json"));
    await readFile(oldAssetPath);
    assert.equal(
      (JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource).root.children?.[0]?.components?.Image?.sprite,
      "Prefab/Canvas/MainCanvas/Old.png",
    );

    const applied = JSON.parse((await runCli(workspaceRoot, [...args, "--write"])).stdout) as {
      written: boolean;
      transport: string;
      guid: string;
    };
    assert.deepEqual(applied, { ...applied, written: true, transport: "filesystem", guid: "00000000000000000000000000000001" });
    await assert.rejects(readFile(oldAssetPath), /ENOENT/);
    await assert.rejects(readFile(`${oldAssetPath}.meta`), /ENOENT/);
    await readFile(join(assetDirectory, "Shared", "Renamed.png"));
    await readFile(join(assetDirectory, "Shared", "Renamed.png.meta"));
    const stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
    assert.equal(stored.root.children?.[0]?.components?.Image?.sprite, "Shared/Renamed.png");
    const storedReference = JSON.parse(await readFile(referencePath, "utf8")) as { values?: Record<string, Record<string, unknown>> };
    assert.equal(storedReference.values?.img_icon?.sprite, "Shared/Renamed.png");

    await rm(join(sourceDirectory, "UnrelatedBroken.ui-reference.json"));
    const fullCheck = JSON.parse((await runCli(workspaceRoot, ["check", "--full"])).stdout) as { summary: { errors: number } };
    assert.equal(fullCheck.summary.errors, 0);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI verify reports invalid JSON through the validate stage and skips later stages", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-"));
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Broken");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(join(workspaceRoot, "My project", "Assets", "Resources", "UI"), { recursive: true });
  await writeFile(join(sourceDirectory, "Broken.ui.json"), "{ invalid", "utf8");

  try {
    await assert.rejects(
      runCli(workspaceRoot, ["verify", "Broken/Broken.ui.json", "--stages", "validate,inspect"]),
      (error: Error & { stdout?: string }) => {
        const report = JSON.parse(error.stdout ?? "") as {
          status: string;
          stages: Array<{ stage: string; status: string; blockedBy?: string }>;
        };
        assert.equal(report.status, "failed");
        assert.deepEqual(
          report.stages.map((stage) => [stage.stage, stage.status, stage.blockedBy]),
          [
            ["validate", "failed", undefined],
            ["inspect", "skipped", "validate"],
          ],
        );
        return true;
      },
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
