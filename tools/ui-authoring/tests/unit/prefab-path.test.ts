import assert from "node:assert/strict";
import test from "node:test";
import { artifactPrefabPath, artifactSourceIdentityFromPath, assertArtifactPrefabPath } from "../../src/kernel/prefab-path.js";

test("derives canonical Formal Artifact Prefab paths from Source-relative identity", () => {
  const identity = artifactSourceIdentityFromPath("Status/Shared/StatusWidget.ui.json");
  const formal = artifactPrefabPath(identity);

  assert.equal(formal, "Assets/Resources/UI/Prefab/Status/Shared/StatusWidget.prefab");
  assert.doesNotThrow(() => assertArtifactPrefabPath(formal, identity));
});

test("rejects invalid Source identities and non-canonical Prefab paths", () => {
  assert.throws(() => artifactSourceIdentityFromPath("../StatusWidget.ui.json"), /Invalid Artifact Source path/);
  assert.throws(() => artifactSourceIdentityFromPath("Status/Other.json"), /Invalid Artifact Source path/);
  assert.throws(
    () =>
      assertArtifactPrefabPath(
        "Assets/Resources/UI/Prefab/Widget/StatusWidget.prefab",
        artifactSourceIdentityFromPath("Status/StatusWidget.ui.json"),
      ),
    /must be/,
  );
});
