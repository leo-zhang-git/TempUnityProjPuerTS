import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource, UiRect } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "LoadingCanvas",
    artifactType: "Canvas",
    bindings: [{ name: "statusRoot", target: { nodeId: "boundStatus", componentType: "GameObject" } }],
    root: {
      id: "LoadingCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        {
          id: "boundStatus",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [160, 40] },
        },
      ],
    },
  };
}

function multiSelectionSource(): UiConcreteSource {
  const childRect = (): UiRect => ({
    anchorMin: [0, 1],
    anchorMax: [0, 1],
    pivot: [0, 1],
    anchoredPosition: [0, 0],
    sizeDelta: [100, 100],
  });
  return {
    sourceKind: "artifact",
    artifactKey: "MultiMoveCanvas",
    artifactType: "Canvas",
    root: {
      id: "MultiMoveCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        { id: "first", rect: childRect() },
        { id: "panel", rect: childRect(), children: [{ id: "anchor", rect: childRect() }] },
        { id: "second", rect: childRect() },
        { id: "third", rect: childRect() },
      ],
    },
  };
}

async function createChild(page: Page, parentId: string, nodeId: string): Promise<void> {
  await page.locator(`[data-hierarchy-row][data-node-id="${parentId}"] button[data-hierarchy-select]`).click();
  await page.getByTitle("新建子节点").click();
  await page.getByRole("button", { name: "空节点", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建子节点" });
  await dialog.getByLabel("Node ID").fill(nodeId);
  await dialog.getByRole("button", { name: "创建" }).click();
  await page.locator(`[data-hierarchy-row][data-node-id="${nodeId}"] button[data-hierarchy-select]`).waitFor();
}

function loadedChunk(scripts: ReadonlySet<string>, prefix: string): boolean {
  return [...scripts].some((name) => name.startsWith(`${prefix}-`) && name.endsWith(".js"));
}

test("Hierarchy create, drag, duplicate, rename, delete, undo, save and reload persist one transaction history", async () => {
  let sourcePath = "";
  await withBrowserFixture(
    {
      name: "hierarchy-editing",
      viewport: { width: 1366, height: 768 },
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "LoadingCanvas");
        sourcePath = join(sourceDirectory, "LoadingCanvas.ui.json");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(sourcePath, formatSource(source()), "utf8");
      },
    },
    async ({ page, server }) => {
      const loadedScripts = new Set<string>();
      page.on("response", (response) => {
        if (response.request().resourceType() !== "script") return;
        const name = new URL(response.url()).pathname.split("/").pop();
        if (name) loadedScripts.add(name);
      });
      const browserErrors: string[] = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") browserErrors.push(message.text());
      });
      await page.goto(server.url, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      if ((await page.getByRole("button", { name: "Hierarchy", exact: true }).count()) === 0) {
        throw new Error(
          `Artifact editor did not render: ${(await page.locator("body").innerText()).slice(0, 1200)} | ${browserErrors.join(" | ")}`,
        );
      }
      assert.equal(loadedChunk(loadedScripts, "artifact-editor"), true, [...loadedScripts].join(", "));
      for (const deferredChunk of ["capture-page", "directory-shell", "document-create-dialog", "prototype-editor", "reference-editor"]) {
        assert.equal(loadedChunk(loadedScripts, deferredChunk), false, `${deferredChunk}: ${[...loadedScripts].join(", ")}`);
      }
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      await page.waitForTimeout(500);
      if ((await page.locator('button[data-hierarchy-select][title="LoadingCanvas"]').count()) === 0) {
        throw new Error(
          `Editor did not open the default Artifact at ${page.url()}: ${(await page.locator("body").innerText()).slice(0, 1000)} | ${browserErrors.join(" | ")}`,
        );
      }

      const rootRow = page
        .locator("[data-hierarchy-row]")
        .filter({ has: page.locator('button[data-hierarchy-select][title="LoadingCanvas"]') });
      if ((await rootRow.getByTitle("展开").count()) > 0) await rootRow.getByTitle("展开").click();
      const boundStatusSelect = page.locator('[data-hierarchy-row][data-node-id="boundStatus"] [data-hierarchy-select]');
      await boundStatusSelect.click();
      await page.getByTitle("删除选中节点").click();
      const referencedDelete = page.getByRole("dialog", { name: "删除节点" });
      await referencedDelete.getByRole("list", { name: "删除影响" }).waitFor();
      assert.match(await referencedDelete.locator('[data-impact-action="remove"]').innerText(), /statusRoot/);
      await referencedDelete.getByRole("button", { name: "继续" }).click();
      await referencedDelete.getByText(/再次确认删除完整子树/).waitFor();
      await referencedDelete.getByRole("button", { name: "删除并清理" }).click();
      assert.equal(await boundStatusSelect.count(), 0);

      await page.locator('button[data-hierarchy-select][title="LoadingCanvas"]').click();
      await page.getByTitle("新建子节点").click();
      await page.getByRole("button", { name: "空节点", exact: true }).click();
      const zeroSizeDialog = page.getByRole("dialog", { name: "新建子节点" });
      await zeroSizeDialog.getByLabel("Node ID").fill("zeroSize");
      await zeroSizeDialog.getByLabel("宽度").fill("-1");
      await zeroSizeDialog.getByText("宽度不能小于 0", { exact: true }).waitFor();
      assert.equal(await zeroSizeDialog.getByRole("button", { name: "创建" }).isDisabled(), true);
      await zeroSizeDialog.getByLabel("宽度").fill("0");
      await zeroSizeDialog.getByLabel("高度").fill("0");
      await zeroSizeDialog.getByText("宽度不能小于 0", { exact: true }).waitFor({ state: "detached" });
      assert.equal(await zeroSizeDialog.getByRole("button", { name: "创建" }).isDisabled(), false);
      await zeroSizeDialog.getByRole("button", { name: "创建" }).click();
      await page.locator('[data-hierarchy-row][data-node-id="zeroSize"] button[data-hierarchy-select]').waitFor();

      await createChild(page, "LoadingCanvas", "container");
      await createChild(page, "LoadingCanvas", "item");
      const itemRow = page.locator('[data-hierarchy-row][data-node-id="item"]');
      const containerRow = page.locator('[data-hierarchy-row][data-node-id="container"]');
      await itemRow.dragTo(containerRow);

      await page.locator('[data-hierarchy-row][data-node-id="item"] button[data-hierarchy-select]').click();
      await page.locator('[data-hierarchy-row][data-node-id="item"] button[data-hierarchy-select]').click({ button: "right" });
      const contextMenu = page.getByRole("menu");
      await contextMenu.getByRole("menuitem", { name: "创建副本" }).waitFor();
      await page.getByRole("menuitem", { name: "创建副本" }).click();
      const itemCopyRow = page.locator('[data-hierarchy-row][data-selected="true"]:not([data-node-id="item"])').first();
      await itemCopyRow.waitFor();
      const itemCopyNodeId = await itemCopyRow.getAttribute("data-node-id");
      assert.ok(itemCopyNodeId && itemCopyNodeId !== "item");
      await itemCopyRow.locator("button[data-hierarchy-select]").waitFor();
      await page.getByTitle("重命名节点").click();
      const rename = page.getByRole("dialog", { name: "重命名节点" });
      assert.equal(await rename.getByLabel("自动 Node ID").isChecked(), true);
      assert.equal(await rename.getByRole("textbox", { name: "Node ID", exact: true }).inputValue(), itemCopyNodeId);
      await rename.getByLabel("GameObject 名称").fill("/");
      await rename.getByText(/不能包含 \/ 或 \\/).waitFor();
      assert.equal(await rename.getByRole("button", { name: "重命名" }).isDisabled(), true);
      await rename.getByLabel("GameObject 名称").fill("item");
      await rename.getByText(/不能包含 \/ 或 \\/).waitFor({ state: "detached" });
      assert.equal(await rename.getByRole("button", { name: "重命名" }).isDisabled(), false);
      await rename.getByRole("button", { name: "重命名" }).click();
      assert.equal(
        await page
          .locator("[data-hierarchy-select] > span")
          .filter({ hasText: /^item$/ })
          .count(),
        1,
      );
      assert.equal(await page.locator('[data-hierarchy-row][data-node-id="item"] > [data-hierarchy-select] > span').innerText(), "Item");
      assert.equal(await itemCopyRow.locator("[data-hierarchy-select] > span").innerText(), "item");

      await page.getByTitle("删除选中节点").click();
      await page.getByRole("dialog", { name: "删除节点" }).getByRole("button", { name: "删除" }).click();
      assert.equal(await page.locator(`[data-hierarchy-row][data-node-id="${itemCopyNodeId}"] button[data-hierarchy-select]`).count(), 0);
      await page.getByTitle("撤销").click();
      await page.locator(`[data-hierarchy-row][data-node-id="${itemCopyNodeId}"] button[data-hierarchy-select]`).waitFor();

      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("已保存 1 个 Artifact").waitFor();
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      await page.locator(`[data-hierarchy-row][data-node-id="${itemCopyNodeId}"] button[data-hierarchy-select]`).waitFor();
      assert.equal(
        await page
          .locator("[data-hierarchy-select] > span")
          .filter({ hasText: /^item$/ })
          .count(),
        1,
      );

      const stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
      const zeroSize = stored.root.children?.find((node) => node.id === "zeroSize");
      assert.deepEqual(zeroSize?.rect.sizeDelta, [0, 0]);
      const container = stored.root.children?.find((node) => node.id === "container");
      assert.deepEqual(
        container?.children?.map((node) => node.id),
        ["item", itemCopyNodeId],
      );
      assert.equal(container?.children?.find((node) => node.id === itemCopyNodeId)?.name, "item");
      assert.deepEqual(stored.bindings ?? [], []);
      assert.deepEqual(browserErrors, []);
    },
  );
});

test("Hierarchy drags the selected roots as one ordered undoable move", async () => {
  let sourcePath = "";
  await withBrowserFixture(
    {
      name: "hierarchy-multi-move",
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "MultiMoveCanvas");
        sourcePath = join(sourceDirectory, "MultiMoveCanvas.ui.json");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(sourcePath, formatSource(multiSelectionSource()), "utf8");
      },
    },
    async ({ page, server }) => {
      await page.goto(`${server.url}?artifact=MultiMoveCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();

      const first = page.locator('[data-hierarchy-row][data-node-id="first"]');
      const third = page.locator('[data-hierarchy-row][data-node-id="third"]');
      const panel = page.locator('[data-hierarchy-row][data-node-id="panel"]');
      await first.locator("[data-hierarchy-select]").click();
      await third.locator("[data-hierarchy-select]").click({ modifiers: ["Control"] });
      assert.equal(await page.locator('[data-hierarchy-row][data-selected="true"]').count(), 2);

      await first.dragTo(panel);
      assert.equal(await page.locator('[data-hierarchy-row][data-selected="true"]').count(), 2);
      assert.equal(await first.getAttribute("data-hierarchy-depth"), "2");
      assert.equal(await third.getAttribute("data-hierarchy-depth"), "2");

      await page.getByTitle("撤销").click();
      assert.equal(await first.getAttribute("data-hierarchy-depth"), "1");
      assert.equal(await third.getAttribute("data-hierarchy-depth"), "1");

      await page.getByTitle("重做").click();
      assert.equal(await first.getAttribute("data-hierarchy-depth"), "2");
      assert.equal(await third.getAttribute("data-hierarchy-depth"), "2");
      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("已保存 1 个 Artifact").waitFor();

      const stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
      assert.deepEqual(
        stored.root.children?.map((node) => node.id),
        ["panel", "second"],
      );
      assert.deepEqual(
        stored.root.children?.[0]?.children?.map((node) => node.id),
        ["anchor", "first", "third"],
      );
    },
  );
});
