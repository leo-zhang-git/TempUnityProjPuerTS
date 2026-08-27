import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiPrototype, UiReference } from "../../src/schema/ui-prototype-schema.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { loadPartialWorkspaceCatalog } from "../../src/server/workspace-catalog.js";

function rect(): UiNode["rect"] {
  return {
    anchorMin: [0, 1],
    anchorMax: [0, 1],
    pivot: [0, 1],
    anchoredPosition: [0, 0],
    sizeDelta: [100, 40],
  };
}

function source(artifactKey: string, dependency?: string): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey,
    artifactType: "Widget",
    widgetType: artifactKey,
    initialSize: [100, 40],
    root: {
      id: artifactKey,
      rect: rect(),
      ...(dependency ? { children: [{ id: "dependency", rect: rect(), components: { PrefabRef: { artifactKey: dependency } } }] } : {}),
    },
  };
}

async function put(root: string, path: string, content: string): Promise<void> {
  const target = join(root, ...path.split("/"));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function withWorkspace(action: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-partial-catalog-"));
  try {
    await action(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("loads independent documents while quarantining invalid and blocked documents", async () => {
  await withWorkspace(async (root) => {
    await put(root, "Good.ui.json", formatSource(source("Good")));
    await put(root, "Broken.ui.json", "{ invalid json");
    await put(root, "Blocked.ui.json", formatSource(source("Blocked", "Missing")));
    const reference: UiReference = {
      referenceKey: "BlockedReference",
      subjectArtifactKey: "Blocked",
    };
    const prototype: UiPrototype = {
      prototypeKey: "BlockedPrototype",
      startReferenceKey: "BlockedReference",
      interactions: [],
    };
    await put(root, "Blocked.ui-reference.json", `${JSON.stringify(reference, null, 2)}\n`);
    await put(root, "Blocked.ui-prototype.json", `${JSON.stringify(prototype, null, 2)}\n`);

    const catalog = await loadPartialWorkspaceCatalog(root);

    assert.deepEqual([...catalog.sourceCatalog.entries.keys()], ["Good"]);
    assert.deepEqual([...catalog.referenceCatalog.entries.keys()], []);
    assert.deepEqual([...catalog.prototypeCatalog.entries.keys()], []);
    assert.deepEqual(
      catalog.unavailable.map((entry) => entry.path),
      ["Blocked.ui-prototype.json", "Blocked.ui-reference.json", "Blocked.ui.json", "Broken.ui.json"],
    );
    assert.ok(catalog.problems.some((problem) => problem.path === "Broken.ui.json" && problem.code === "document.json.invalid"));
    assert.ok(catalog.problems.some((problem) => problem.path === "Blocked.ui.json" && problem.category === "catalog"));
    assert.ok(catalog.problems.some((problem) => problem.path === "Blocked.ui-reference.json" && problem.code === "reference.blocked"));
    assert.ok(catalog.problems.some((problem) => problem.path === "Blocked.ui-prototype.json" && problem.code === "prototype.blocked"));
    assert.ok(catalog.problems.every((problem) => problem.severity === "error" && !["resource", "canonical"].includes(problem.category)));
  });
});

test("quarantines every duplicate identity without hiding unrelated artifacts", async () => {
  await withWorkspace(async (root) => {
    await put(root, "A/Shared.ui.json", formatSource(source("Shared")));
    await put(root, "B/Shared.ui.json", formatSource(source("Shared")));
    await put(root, "Independent.ui.json", formatSource(source("Independent")));

    const catalog = await loadPartialWorkspaceCatalog(root);

    assert.deepEqual([...catalog.sourceCatalog.entries.keys()], ["Independent"]);
    assert.deepEqual(
      catalog.unavailable.map((entry) => entry.path),
      ["A/Shared.ui.json", "B/Shared.ui.json"],
    );
    assert.ok(catalog.problems.every((problem) => problem.category === "catalog"));
  });
});

test("validates Reference dependencies against the complete Reference Catalog", async () => {
  await withWorkspace(async (root) => {
    const mountSource: UiConcreteSource = {
      ...source("MountHost"),
      bindings: [{ name: "mountTarget", target: { nodeId: "MountHost", componentType: "RectTransform" } }],
    };
    const preset: UiReference = {
      referenceKey: "ItemPreset",
      subjectArtifactKey: "MountHost",
    };
    const scenario: UiReference = {
      referenceKey: "MountScenario",
      subjectArtifactKey: "MountHost",
      mounts: [
        {
          key: "presetItem",
          targetBinding: "mountTarget",
          artifactKey: "MountHost",
          referenceKey: "ItemPreset",
        },
      ],
    };
    await put(root, "MountHost.ui.json", formatSource(mountSource));
    await put(root, "References/ItemPreset.ui-reference.json", `${JSON.stringify(preset, null, 2)}\n`);
    await put(root, "References/MountScenario.ui-reference.json", `${JSON.stringify(scenario, null, 2)}\n`);

    const catalog = await loadPartialWorkspaceCatalog(root);

    assert.deepEqual([...catalog.referenceCatalog.entries.keys()], ["ItemPreset", "MountScenario"]);
    assert.deepEqual(catalog.unavailable, []);
  });
});
