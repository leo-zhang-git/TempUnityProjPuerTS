import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "MoveCanvas",
    artifactType: "Canvas",
    root: {
      id: "MoveCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [320, 180] },
      children: [
        {
          id: "icon",
          rect: { anchorMin: [0, 0], anchorMax: [0, 0], pivot: [0, 0], anchoredPosition: [0, 0], sizeDelta: [1, 1] },
          components: { Image: { sprite: "Icons/Ready.png" } },
        },
      ],
    },
  };
}

function widget(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "MoveWidget",
    artifactType: "Widget",
    widgetType: "MoveWidget",
    initialSize: [80, 40],
    root: {
      id: "MoveWidget",
      rect: { anchorMin: [0, 0], anchorMax: [0, 0], pivot: [0, 0], anchoredPosition: [0, 0], sizeDelta: [80, 40] },
    },
  };
}

async function image(root: string, path: string, guid: string): Promise<void> {
  const fullPath = join(root, "My project", "Assets", "Resources", "UI", path);
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, png);
  await writeFile(
    `${fullPath}.meta`,
    `guid: ${guid}\ntextureType: 8\nspriteMode: 1\nspritePixelsToUnits: 100\nspriteBorder: {x: 0, y: 0, z: 0, w: 0}\n`,
    "utf8",
  );
}

test("left Project moves Source documents and Assets resources between directories", async () => {
  await withBrowserFixture(
    {
      name: "project-file-operations",
      viewport: { width: 1280, height: 820 },
      prepare: async (workspaceRoot) => {
        const sourceRoot = join(workspaceRoot, "My project", "UIAuthoring", "Sources");
        await mkdir(join(sourceRoot, "Project"), { recursive: true });
        await mkdir(join(sourceRoot, "Archive"), { recursive: true });
        await writeFile(
          join(sourceRoot, "Archive", ".ui-directory.json"),
          `${JSON.stringify({ displayName: "Archive", description: "Move targets" }, null, 2)}\n`,
          "utf8",
        );
        await writeFile(join(sourceRoot, "Project", "MoveCanvas.ui.json"), formatSource(source()), "utf8");
        await writeFile(join(sourceRoot, "Project", "MoveWidget.ui.json"), formatSource(widget()), "utf8");
        await image(workspaceRoot, "Icons/Ready.png", "00000000000000000000000000000001");
        await image(workspaceRoot, "Shared/Keep.png", "00000000000000000000000000000002");
      },
    },
    async ({ workspaceRoot, page, server }) => {
      await page.goto(`${server.url}?artifact=MoveCanvas`, { waitUntil: "networkidle" });
      const project = page.getByRole("region", { name: "左侧 Project" });
      await project.locator('[data-project-directory="source:Project"] [data-ui~=project-directory-select]').click();
      const document = project.locator('[data-project-document="Project/MoveWidget.ui.json"]');
      await document.waitFor();
      await document.dragTo(project.locator('[data-project-directory="source:Archive"]'), { targetPosition: { x: 72, y: 12 } });
      await page.waitForTimeout(700);

      assert.equal(await page.locator('[data-project-document="Project/MoveWidget.ui.json"]').count(), 0);
      assert.equal(
        await readFile(join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Archive", "MoveWidget.ui.json")).then(() => true),
        true,
      );

      await project.locator('[data-project-root="assets"] [data-ui~=project-root-select]').click();
      await project.locator('[data-project-directory="assets:Icons"] [data-ui~=project-directory-select]').click();
      const asset = project.locator('[data-asset-path="Icons/Ready.png"]');
      await asset.waitFor();
      await asset.click({ button: "right" });
      await page.getByRole("menuitem", { name: "重命名 / 移动" }).waitFor();
      await page.keyboard.press("Escape");
      await asset.dragTo(project.locator('[data-project-directory="assets:Shared"]'), { targetPosition: { x: 72, y: 12 } });
      await page.waitForTimeout(700);

      const movedAsset = join(workspaceRoot, "My project", "Assets", "Resources", "UI", "Shared", "Ready.png");
      await readFile(movedAsset);
      await assert.rejects(readFile(join(workspaceRoot, "My project", "Assets", "Resources", "UI", "Icons", "Ready.png")), /ENOENT/);
      const stored = JSON.parse(
        await readFile(join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Project", "MoveCanvas.ui.json"), "utf8"),
      ) as UiConcreteSource;
      assert.equal(stored.root.children?.[0]?.components?.Image?.sprite, "Shared/Ready.png");
    },
  );
});
