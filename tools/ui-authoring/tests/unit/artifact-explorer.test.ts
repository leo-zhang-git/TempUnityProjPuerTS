import assert from "node:assert/strict";
import test from "node:test";
import type { DocumentCatalog } from "../../src/web/shared/api/client.js";
import {
  buildExplorerTree,
  documentsInDirectory,
  explorerDirectorySearchScore,
  explorerSemanticCandidates,
  explorerTextSearchMatch,
  filterExplorerDocuments,
  filterExplorerTree,
  galleryDirectoryArtifacts,
  galleryScale,
  galleryScaleFactor,
  layoutDirectoryArtifacts,
  parseWorkspaceLocation,
  workspaceLocationSearch,
} from "../../src/web/workspace/explorer/artifact-explorer-model.js";

const catalog: DocumentCatalog = {
  directories: [{ path: "Flow", displayName: "局内主界面 HUD", description: "局内战斗常驻信息界面", modifiedAt: 0 }],
  artifacts: [
    {
      artifactKey: "MainCanvas",
      artifactType: "Canvas",
      displayName: "主界面",
      description: "玩家进入流程后的主要操作界面",
      path: "Flow/MainCanvas.ui.json",
      prefabPath: "MainCanvas.prefab",
      dependencies: ["PanelWidget", "SharedWidget", "ExternalWidget"],
    },
    {
      artifactKey: "SecondCanvas",
      artifactType: "Canvas",
      path: "Flow/SecondCanvas.ui.json",
      prefabPath: "SecondCanvas.prefab",
      dependencies: ["SharedWidget"],
    },
    {
      artifactKey: "PanelWidget",
      artifactType: "Widget",
      path: "Flow/PanelWidget.ui.json",
      prefabPath: "PanelWidget.prefab",
      dependencies: ["SharedWidget"],
    },
    {
      artifactKey: "SharedWidget",
      artifactType: "Widget",
      path: "Flow/SharedWidget.ui.json",
      prefabPath: "SharedWidget.prefab",
      dependencies: [],
    },
    {
      artifactKey: "LooseFragment",
      artifactType: "Fragment",
      path: "Flow/LooseFragment.ui.json",
      prefabPath: "LooseFragment.prefab",
      dependencies: [],
    },
    {
      artifactKey: "ExternalWidget",
      artifactType: "Widget",
      path: "Common/ExternalWidget.ui.json",
      prefabPath: "ExternalWidget.prefab",
      dependencies: [],
    },
  ],
  references: [
    { referenceKey: "MainCanvas", subjectArtifactKey: "MainCanvas", path: "Flow/MainCanvas.ui-reference.json" },
    { referenceKey: "MainReference", subjectArtifactKey: "MainCanvas", path: "Flow/MainReference.ui-reference.json" },
    { referenceKey: "ReadyReference", subjectArtifactKey: "MainCanvas", path: "Flow/States/ReadyReference.ui-reference.json" },
    { referenceKey: "NestedReference", subjectArtifactKey: "MainCanvas", path: "Flow/States/Nested/NestedReference.ui-reference.json" },
  ],
  prototypes: [
    { prototypeKey: "MainFlow", startReferenceKey: "MainReference", path: "Flow/MainFlow.ui-prototype.json", interactionCount: 3 },
  ],
};

test("builds a stable directory tree for every authoring document kind", () => {
  const root = buildExplorerTree(catalog);
  const flow = root.directories.find((directory) => directory.name === "Flow");
  assert.equal(root.name, "Sources");
  assert.deepEqual(
    flow?.documents.map((document) => `${document.type}:${document.key}`),
    [
      "Fragment:LooseFragment",
      "Canvas:MainCanvas",
      "Prototype:MainFlow",
      "Reference:MainReference",
      "Widget:PanelWidget",
      "Canvas:SecondCanvas",
      "Widget:SharedWidget",
    ],
  );
});

test("keeps unavailable documents visible with their blocking problem counts", () => {
  const partialCatalog: DocumentCatalog = {
    ...catalog,
    unavailable: [
      { kind: "artifact", key: "BrokenWidget", artifactType: "Widget", path: "Flow/BrokenWidget.ui.json" },
      { kind: "reference", key: "BrokenReference", path: "Flow/BrokenReference.ui-reference.json" },
    ],
    problems: [
      {
        path: "Flow/BrokenWidget.ui.json",
        severity: "error",
        category: "syntax",
        code: "document.json.invalid",
        message: "Invalid JSON",
        owner: "artifact",
        safeFixable: false,
        nextAction: "Fix it.",
      },
      {
        path: "Flow/BrokenWidget.ui.json",
        severity: "error",
        category: "schema",
        code: "schema.invalid",
        message: "Invalid Source",
        owner: "artifact",
        safeFixable: false,
        nextAction: "Fix it.",
      },
      {
        path: "Flow/BrokenReference.ui-reference.json",
        severity: "error",
        category: "reference",
        code: "reference.blocked",
        message: "Missing dependency",
        owner: "reference",
        safeFixable: false,
        nextAction: "Fix it.",
      },
    ],
  };

  const flow = buildExplorerTree(partialCatalog).directories.find((directory) => directory.name === "Flow");
  const brokenWidget = flow?.documents.find((document) => document.key === "BrokenWidget");
  const brokenReference = flow?.documents.find((document) => document.key === "BrokenReference");
  assert.deepEqual(brokenWidget, {
    kind: "artifact",
    type: "Widget",
    key: "BrokenWidget",
    path: "Flow/BrokenWidget.ui.json",
    directory: "Flow",
    modifiedAt: 0,
    unavailable: true,
    problemCount: 2,
  });
  assert.equal(brokenReference?.unavailable, true);
  assert.equal(brokenReference?.problemCount, 1);
  assert.equal(flow?.documents.find((document) => document.key === "MainCanvas")?.unavailable, false);
});

test("filters documents while retaining their ancestor directories", () => {
  const filtered = filterExplorerTree(buildExplorerTree(catalog), "shared", new Set(["Widget"]));
  const flow = filtered.directories.find((directory) => directory.name === "Flow");
  assert.deepEqual(
    flow?.documents.map((document) => document.key),
    ["SharedWidget"],
  );
  const multiType = filterExplorerTree(buildExplorerTree(catalog), "", new Set(["Reference", "Prototype"]));
  const multiTypeFlow = multiType.directories.find((directory) => directory.name === "Flow");
  assert.deepEqual(
    multiTypeFlow?.documents.map((document) => document.key),
    ["MainFlow", "MainReference"],
  );
  assert.deepEqual(
    documentsInDirectory(catalog, "Flow").map((document) => document.key),
    ["LooseFragment", "MainCanvas", "MainFlow", "MainReference", "PanelWidget", "SecondCanvas", "SharedWidget"],
  );
  const directoryOnly = filterExplorerTree(buildExplorerTree(catalog), "hud", new Set());
  assert.equal(directoryOnly.directories[0]?.displayName, "局内主界面 HUD");
  assert.deepEqual(directoryOnly.directories[0]?.documents, []);
  assert.ok(explorerDirectorySearchScore(directoryOnly.directories[0]!, "主界面") !== undefined);
});

test("ranks Chinese, pinyin, and linked Artifact context before semantic supplements", () => {
  const root = buildExplorerTree(catalog);
  const flow = root.directories.find((directory) => directory.name === "Flow")!;
  assert.deepEqual(
    filterExplorerDocuments(flow.documents, "主界面", new Set()).map((document) => document.key),
    ["MainCanvas", "MainFlow", "MainReference"],
  );
  assert.deepEqual(
    filterExplorerDocuments(flow.documents, "zjm", new Set()).map((document) => document.key),
    ["MainCanvas", "MainFlow", "MainReference"],
  );
  assert.deepEqual(explorerTextSearchMatch("局内主界面 HUD", "主界面"), { start: 2, end: 5, kind: "direct" });
  assert.deepEqual(explorerTextSearchMatch("局内主界面 HUD", "zjm"), { start: 2, end: 5, kind: "pinyin" });
  const semanticScores = new Map([
    ["artifact:SharedWidget", 0.48],
    ["artifact:PanelWidget", 0.72],
  ]);
  assert.deepEqual(
    filterExplorerDocuments(flow.documents, "商店", new Set(), semanticScores).map((document) => document.key),
    ["PanelWidget", "SharedWidget"],
  );
});

test("builds distinct semantic texts without stripping Artifact suffixes", () => {
  const root = buildExplorerTree(catalog);
  const candidates = new Map(explorerSemanticCandidates(root).map((candidate) => [candidate.id, candidate.texts]));
  assert.deepEqual(candidates.get("artifact:MainCanvas"), ["MainCanvas", "Main Canvas", "主界面", "玩家进入流程后的主要操作界面"]);
  assert.ok(candidates.get("reference:MainReference")?.includes("MainCanvas"));
  assert.ok(candidates.get("prototype:MainFlow")?.includes("主界面"));
  assert.equal(candidates.get("artifact:MainCanvas")?.includes("Main"), false);
  assert.equal(candidates.get("artifact:MainCanvas")?.includes("Canvas"), false);
});

test("lays out shared dependencies once and separates loose artifacts", () => {
  const layout = layoutDirectoryArtifacts(catalog.artifacts, "Flow");
  const byKey = new Map(layout.nodes.map((node) => [node.artifactKey, node]));
  assert.equal(byKey.get("MainCanvas")?.depth, 0);
  assert.equal(byKey.get("PanelWidget")?.depth, 1);
  assert.equal(byKey.get("PanelWidget")?.section, "owned");
  assert.equal(byKey.get("PanelWidget")?.ownerCanvasKey, "MainCanvas");
  assert.equal(byKey.get("SharedWidget")?.section, "shared");
  assert.equal(layout.nodes.filter((node) => node.artifactKey === "SharedWidget").length, 1);
  assert.equal(byKey.get("LooseFragment")?.isolated, true);
  assert.equal(byKey.get("LooseFragment")?.section, "independent");
  assert.equal(layout.clusters.length, 2);
  assert.equal(layout.clusters[0]?.y, layout.clusters[1]?.y);
  assert.notEqual(layout.clusters[0]?.x, layout.clusters[1]?.x);
  assert.deepEqual(layout.externalDependencies, [{ artifactKey: "ExternalWidget", requestedBy: ["MainCanvas"] }]);
  assert.deepEqual(layout, layoutDirectoryArtifacts([...catalog.artifacts].reverse(), "Flow"));
});

test("uses a matrix for three or more Canvas clusters", () => {
  const artifacts = [
    ...catalog.artifacts,
    {
      artifactKey: "ThirdCanvas",
      artifactType: "Canvas" as const,
      path: "Flow/ThirdCanvas.ui.json",
      prefabPath: "ThirdCanvas.prefab",
      dependencies: [],
    },
  ];
  const layout = layoutDirectoryArtifacts(artifacts, "Flow");
  assert.equal(layout.clusters.length, 3);
  assert.equal(new Set(layout.clusters.slice(0, 2).map((cluster) => cluster.y)).size, 1);
  assert.ok(layout.clusters[2]!.y > layout.clusters[0]!.y);
});

test("groups Gallery artifacts by density in stable order", () => {
  const gallery = galleryDirectoryArtifacts(
    { ...catalog, artifacts: [...catalog.artifacts].reverse(), references: [...catalog.references].reverse() },
    "Flow",
  );
  assert.deepEqual(
    gallery.canvases.map((artifact) => artifact.artifactKey),
    ["MainCanvas", "SecondCanvas"],
  );
  assert.deepEqual(
    gallery.widgets.map((artifact) => artifact.artifactKey),
    ["PanelWidget", "SharedWidget"],
  );
  assert.deepEqual(
    gallery.fragments.map((artifact) => artifact.artifactKey),
    ["LooseFragment"],
  );
  assert.deepEqual(
    gallery.referenceGroups.map((group) => [group.label, group.references.map((reference) => reference.referenceKey)]),
    [["Reference", ["MainReference"]]],
  );
  assert.deepEqual(
    gallery.prototypes.map((prototype) => prototype.prototypeKey),
    ["MainFlow"],
  );
});

test("parses one strict Gallery display scale", () => {
  assert.equal(galleryScaleFactor("2:1"), 2);
  assert.equal(galleryScaleFactor("1:1"), 1);
  assert.equal(galleryScaleFactor("1:4"), 0.25);
  assert.equal(galleryScale("3"), "1:3");
});

test("round-trips artifact, directory and prototype URL locations", () => {
  const locations = [
    { kind: "artifact", artifactKey: "MainCanvas" } as const,
    { kind: "relations", artifactKey: "MainCanvas" } as const,
    { kind: "reference", referenceKey: "MainReference" } as const,
    { kind: "directory", path: "Flow", view: "dependency", scale: "1:2" } as const,
    { kind: "directory", path: "Flow", view: "grid", scale: "1:2" } as const,
    { kind: "directory", path: "Flow", view: "grid", scale: "1:3" } as const,
    { kind: "directory", path: "Flow", view: "list", scale: "1:6" } as const,
    { kind: "prototype", prototypeKey: "MainFlow", referenceKey: "MainReference" } as const,
  ];
  for (const location of [{ kind: "overview" } as const, ...locations])
    assert.deepEqual(parseWorkspaceLocation(workspaceLocationSearch(location)), location);
  assert.deepEqual(parseWorkspaceLocation("?directory=Flow&view=invalid&layout=invalid&scale=5"), {
    kind: "directory",
    path: "Flow",
    view: "dependency",
    scale: "1:2",
  });
  assert.deepEqual(parseWorkspaceLocation("?directory=Flow&view=gallery&layout=list&scale=4"), {
    kind: "directory",
    path: "Flow",
    view: "dependency",
    scale: "1:4",
  });
});

test("applies directory metadata and sorts directories by descendant modification time", () => {
  const timed: DocumentCatalog = {
    artifacts: catalog.artifacts.map((entry, index) => ({ ...entry, modifiedAt: index + 1 })),
    references: catalog.references.map((entry, index) => ({ ...entry, modifiedAt: 20 + index })),
    prototypes: catalog.prototypes.map((entry) => ({ ...entry, modifiedAt: 40 })),
    directories: [
      { path: "Flow", displayName: "流程界面", description: "流程描述", cover: { kind: "Prototype", key: "MainFlow" }, modifiedAt: 5 },
    ],
  };
  const flow = buildExplorerTree(timed, "modified").directories[0];
  assert.equal(flow?.displayName, "流程界面");
  assert.equal(flow?.description, "流程描述");
  assert.deepEqual(flow?.cover, { kind: "Prototype", key: "MainFlow" });
  assert.equal(flow?.documents[0]?.key, "MainFlow");
  assert.equal(flow?.modifiedAt, 40);
});
