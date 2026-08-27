import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { modifiedSourcePathsFromStatus, parseSvnStatus } from "../../src/server/svn-local-changes.js";

test("parseSvnStatus preserves fixed-column statuses and paths", () => {
  assert.deepEqual(
    parseSvnStatus(
      ["M       C:\\workspace\\Changed.ui.json", "A  +    C:\\workspace\\Copied.ui.json", "        ignored continuation", ""].join("\r\n"),
    ),
    [
      { columns: "M      ", path: "C:\\workspace\\Changed.ui.json" },
      { columns: "A  +   ", path: "C:\\workspace\\Copied.ui.json" },
      { columns: "       ", path: "ignored continuation" },
    ],
  );
});

test("modifiedSourcePathsFromStatus selects changed Sources and expands unversioned directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-svn-status-"));
  const unversioned = join(root, "NewFolder");
  await mkdir(unversioned);
  await writeFile(join(root, "Changed.ui.json"), "{}", "utf8");
  await writeFile(join(root, "PropertyChanged.ui.json"), "{}", "utf8");
  await writeFile(join(root, "Deleted.ui.json"), "{}", "utf8");
  await writeFile(join(unversioned, "NewWidget.ui.json"), "{}", "utf8");
  await writeFile(join(unversioned, "Flow.ui-reference.json"), "{}", "utf8");
  try {
    const paths = await modifiedSourcePathsFromStatus(
      root,
      parseSvnStatus(
        [
          `M       ${join(root, "Changed.ui.json")}`,
          ` M      ${join(root, "PropertyChanged.ui.json")}`,
          `D       ${join(root, "Deleted.ui.json")}`,
          `?       ${unversioned}`,
        ].join("\n"),
      ),
    );
    assert.deepEqual(paths, ["Changed.ui.json", "NewFolder/NewWidget.ui.json", "PropertyChanged.ui.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("modifiedSourcePathsFromStatus blocks conflicted Sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-svn-conflict-"));
  try {
    await assert.rejects(
      modifiedSourcePathsFromStatus(root, parseSvnStatus(`C       ${join(root, "Conflict.ui.json")}`)),
      /SVN 冲突或工作副本异常.*Conflict\.ui\.json/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("modifiedSourcePathsFromStatus expands an unversioned Source root", async () => {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-svn-root-"));
  await writeFile(join(root, "NewCanvas.ui.json"), "{}", "utf8");
  try {
    const paths = await modifiedSourcePathsFromStatus(root, parseSvnStatus(`?       ${root}`));
    assert.deepEqual(paths, ["NewCanvas.ui.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
