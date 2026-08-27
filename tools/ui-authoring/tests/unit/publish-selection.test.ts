import assert from "node:assert/strict";
import test from "node:test";
import { parsePublishSelectionFile } from "../../src/cli/application.js";
import { createArtifactSource, createPrefabRefNode } from "../../src/kernel/authoring.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import { selectPublishEntries } from "../../src/server/publish-selection.js";

function catalog() {
  const fragment = createArtifactSource({ artifactKey: "IconFragment", artifactType: "Fragment", initialSize: [32, 32] });
  const widget = createArtifactSource({ artifactKey: "StatusWidget", artifactType: "Widget", initialSize: [200, 60] });
  widget.root.children = [createPrefabRefNode("icon", "IconFragment", [32, 32])];
  const canvas = createArtifactSource({ artifactKey: "MainCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
  canvas.root.children = [createPrefabRefNode("status", "StatusWidget", [200, 60])];
  return createSourceCatalog([fragment, widget, canvas].map((source) => ({ path: `${source.artifactKey}.ui.json`, source })));
}

test("Publish selection supports declared-only, dependency closure, and dependency exclusions", () => {
  const sources = catalog();
  assert.deepEqual(
    selectPublishEntries(sources, ["MainCanvas"]).map((entry) => entry.source.artifactKey),
    ["MainCanvas"],
  );
  assert.deepEqual(
    selectPublishEntries(sources, ["MainCanvas"], { dependencyMode: "declared" }).map((entry) => entry.source.artifactKey),
    ["MainCanvas"],
  );
  assert.deepEqual(
    selectPublishEntries(sources, ["MainCanvas"], { dependencyMode: "dependencies" }).map((entry) => entry.source.artifactKey),
    ["IconFragment", "StatusWidget", "MainCanvas"],
  );
  assert.deepEqual(
    selectPublishEntries(sources, ["MainCanvas"], { dependencyMode: "dependencies", excludeArtifactKeys: ["StatusWidget"] }).map(
      (entry) => entry.source.artifactKey,
    ),
    ["IconFragment", "MainCanvas"],
  );
});

test("Publish selection rejects missing and excluded declared Artifacts", () => {
  const sources = catalog();
  assert.throws(
    () => selectPublishEntries(sources, ["MainCanvas"], { dependencyMode: "dependencies", excludeArtifactKeys: ["MainCanvas"] }),
    /不能排除已声明的 Artifact 'MainCanvas'/,
  );
  assert.throws(() => selectPublishEntries(sources, ["MissingCanvas"], { dependencyMode: "declared" }), /Source Catalog 中缺少 Artifact/);
  assert.throws(
    () => selectPublishEntries(sources, ["MainCanvas"], { dependencyMode: "declared", excludeArtifactKeys: ["StatusWidget"] }),
    /只有在包含依赖时才能排除依赖项/,
  );
});

test("Publish selection file keeps only Artifact scope fields", () => {
  assert.deepEqual(parsePublishSelectionFile({ artifacts: ["MainCanvas"] }), { artifacts: ["MainCanvas"] });
  assert.deepEqual(parsePublishSelectionFile({ artifacts: ["MainCanvas"], dependencies: true, exclude: ["StatusWidget"] }), {
    artifacts: ["MainCanvas"],
    dependencies: true,
    exclude: ["StatusWidget"],
  });
  assert.throws(
    () => parsePublishSelectionFile({ artifacts: ["MainCanvas"], projectPath: "E:/D1/long4" }),
    /unsupported fields: projectPath/,
  );
  assert.throws(
    () => parsePublishSelectionFile({ artifacts: ["MainCanvas"], dependencies: false, exclude: ["StatusWidget"] }),
    /only valid when dependencies are included/,
  );
  assert.throws(() => parsePublishSelectionFile(["MainCanvas"]), /shaped like.*ArtifactKey/);
  assert.throws(
    () => parsePublishSelectionFile({ artifacts: ["Flow/MainCanvas.ui.json"] }),
    /Artifact keys, not Source paths.*Flow\/MainCanvas\.ui\.json/,
  );
  assert.throws(
    () => parsePublishSelectionFile({ artifacts: ["MainCanvas"], dependencies: true, exclude: ["Flow/StatusWidget.ui.json"] }),
    /exclude must contain Artifact keys/,
  );
});
