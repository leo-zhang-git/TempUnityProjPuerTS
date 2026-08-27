import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadDirectoryCatalog } from "../../src/server/directory-catalog.js";

test("loads current Directory metadata without writing during catalog reads", async () => {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-directory-"));
  const path = join(root, ".ui-directory.json");
  const text = `${JSON.stringify(
    {
      displayName: "Current",
      description: "Current metadata",
    },
    null,
    2,
  )}\n`;
  try {
    await writeFile(path, text, "utf8");
    const catalog = await loadDirectoryCatalog(root);
    assert.equal(catalog[0]?.displayName, "Current");
    assert.equal(await readFile(path, "utf8"), text);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects version fields in Directory metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-directory-version-"));
  const path = join(root, ".ui-directory.json");
  try {
    await writeFile(
      path,
      `${JSON.stringify({ displayName: "Current", description: "Current metadata", schemaVersion: 1 }, null, 2)}\n`,
      "utf8",
    );
    await assert.rejects(() => loadDirectoryCatalog(root), /Directory metadata is invalid/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
