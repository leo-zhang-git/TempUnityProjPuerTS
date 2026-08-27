import assert from "node:assert/strict";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "playwright";
import { formatSource } from "../../src/kernel/canonical.js";
import { findNode } from "../../src/kernel/tree.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";
import { copyDefaultFontAssets } from "./fixture-assets.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function rect(size: readonly [number, number], stretch = false): UiNode["rect"] {
  return {
    anchorMin: stretch ? [0, 0] : [0.5, 0.5],
    anchorMax: stretch ? [1, 1] : [0.5, 0.5],
    pivot: [0.5, 0.5],
    anchoredPosition: [0, 0],
    sizeDelta: stretch ? [0, 0] : [...size],
  };
}

function artifact(artifactKey: string, artifactType: "Canvas" | "Widget" | "Fragment", children: readonly UiNode[] = []): UiConcreteSource {
  const common = {
    sourceKind: "artifact" as const,
    artifactKey,
    root: { id: artifactKey, rect: rect([320, 180], true), ...(children.length > 0 ? { children: [...children] } : {}) },
  };
  if (artifactType === "Canvas") return { ...common, artifactType: "Canvas" };
  if (artifactType === "Widget") return { ...common, artifactType: "Widget", widgetType: artifactKey, initialSize: [120, 60] };
  return { ...common, artifactType: "Fragment", initialSize: [120, 60] };
}

function hierarchyRow(page: Page, nodeId: string): Locator {
  return page.locator(`[data-hierarchy-row][data-node-id="${nodeId}"]`);
}

async function prepareProjectWorkspace(workspaceRoot: string): Promise<void> {
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Project");
  const assetDirectory = join(workspaceRoot, "My project", "Assets", "Resources", "UI");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(assetDirectory, { recursive: true });
  await copyDefaultFontAssets(workspaceRoot);
  const fontDirectory = join(assetDirectory, "Font");
  await cp(join(fontDirectory, "alipuhui SDF.asset"), join(fontDirectory, "alternate SDF.asset"));
  const fontMeta = await readFile(join(fontDirectory, "alipuhui SDF.asset.meta"), "utf8");
  await writeFile(
    join(fontDirectory, "alternate SDF.asset.meta"),
    fontMeta.replace(/guid: [0-9a-f]+/, "guid: 00000000000000000000000000000002"),
    "utf8",
  );
  const label: UiNode = {
    id: "label",
    rect: rect([100, 5]),
    components: { Text: { text: "Project label", font: "Font/alipuhui SDF.asset", fontSize: 24 } },
  };
  const container: UiNode = { id: "container", rect: rect([240, 120]), children: [label] };
  const coverWidget: UiNode = { id: "coverWidget", rect: rect([0, 0], true), components: { PrefabRef: { artifactKey: "CoverWidget" } } };
  await writeFile(
    join(sourceDirectory, "ProjectCanvas.ui.json"),
    formatSource(artifact("ProjectCanvas", "Canvas", [container, coverWidget])),
    "utf8",
  );
  await writeFile(join(sourceDirectory, "CardWidget.ui.json"), formatSource(artifact("CardWidget", "Widget")), "utf8");
  await writeFile(
    join(sourceDirectory, "InteractionHintWidget.ui.json"),
    formatSource(artifact("InteractionHintWidget", "Widget")),
    "utf8",
  );
  await writeFile(join(sourceDirectory, "BadgeFragment.ui.json"), formatSource(artifact("BadgeFragment", "Fragment")), "utf8");
  await writeFile(join(sourceDirectory, "CoverWidget.ui.json"), formatSource(artifact("CoverWidget", "Widget")), "utf8");
  await writeFile(join(assetDirectory, "Ready.png"), png);
  await writeFile(
    join(assetDirectory, "Ready.png.meta"),
    "guid: 00000000000000000000000000000001\ntextureType: 8\nspriteMode: 1\nspritePixelsToUnits: 100\nspriteBorder: {x: 0, y: 0, z: 0, w: 0}\n",
    "utf8",
  );
}

async function dragProjectItem(item: Locator, target: Locator): Promise<void> {
  await item.dragTo(target, { targetPosition: { x: 80, y: 11 } });
}

test("Project docks independently and drags authoring content into Hierarchy without publishing editor visibility", async () => {
  await withBrowserFixture(
    {
      name: "project-panel",
      viewport: { width: 1440, height: 900 },
      prepare: prepareProjectWorkspace,
    },
    async ({ workspaceRoot, page, server }) => {
      await page.goto(`${server.url}?artifact=ProjectCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      const leftProject = page.getByRole("region", { name: "左侧 Project" });
      await leftProject.waitFor();
      assert.equal(await leftProject.getByTitle("全部", { exact: true }).count(), 0);
      await leftProject.getByTitle("网格", { exact: true }).click();
      assert.equal(await leftProject.getByTitle("网格", { exact: true }).getAttribute("aria-pressed"), "true");
      await leftProject.locator('[data-project-root="assets"]').waitFor();
      await leftProject.locator('[data-project-root="source"]').waitFor();
      await leftProject.locator('[data-project-directory="source:Project"] [data-ui~=project-directory-select]').click();
      await leftProject.locator('[data-project-document="Project/CardWidget.ui.json"]').waitFor();

      await page.getByTitle("打开底部 Project").click();
      const bottomProject = page.getByRole("region", { name: "底部 Project" });
      await bottomProject.waitFor();
      assert.equal(await bottomProject.getByTitle("全部", { exact: true }).count(), 0);
      assert.equal(
        await bottomProject
          .locator('[data-project-directory="source:Project"] [data-ui~="project-directory-select"]')
          .getAttribute("aria-current"),
        "page",
      );
      assert.equal(await bottomProject.getByTitle("列表", { exact: true }).getAttribute("aria-pressed"), "true");

      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      const containerRow = hierarchyRow(page, "container");
      await dragProjectItem(bottomProject.getByTitle("Project/CardWidget.ui.json"), containerRow);
      await hierarchyRow(page, "cardWidget").waitFor();
      await dragProjectItem(bottomProject.getByTitle("Project/BadgeFragment.ui.json"), containerRow);
      await hierarchyRow(page, "badgeFragment").waitFor();

      await bottomProject.locator('[data-project-root="assets"] [data-ui~="project-root-select"]').click();
      await dragProjectItem(bottomProject.getByTitle("Ready.png"), containerRow);
      await page.waitForTimeout(750);
      if ((await hierarchyRow(page, "ready").count()) === 0) {
        const notice = await page.locator("[data-ui~=status-notice]").textContent();
        throw new Error(`Image Project drop failed: ${notice ?? "missing notice"}`);
      }
      await bottomProject.locator('[data-asset-folder="Font"]').click();
      await dragProjectItem(bottomProject.getByTitle("Font/alternate SDF.asset"), hierarchyRow(page, "label"));
      await page.getByText("已更新 Label 的字体", { exact: true }).waitFor();

      await hierarchyRow(page, "label").getByRole("button", { name: "隐藏 Label", exact: true }).click();
      const canvasLabel = page.locator('.ui-rendering__canvas-node[data-node-id="label"]');
      await assert.doesNotReject(() => canvasLabel.waitFor({ state: "hidden" }));
      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("已保存 1 个 Artifact", { exact: true }).waitFor();
      const sourcePath = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Project", "ProjectCanvas.ui.json");
      let stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
      const storedContainer = stored.root.children?.find((node) => node.id === "container");
      const storedLabel = storedContainer?.children?.find((node) => node.id === "label");
      assert.equal(storedLabel?.active, undefined);
      assert.ok((storedLabel?.rect.sizeDelta[1] ?? 0) > 5);
      assert.equal(storedLabel?.components?.Text?.font, "Font/alternate SDF.asset");
      assert.ok(storedContainer?.children?.some((node) => node.components?.PrefabRef?.artifactKey === "CardWidget"));
      assert.ok(storedContainer?.children?.some((node) => node.components?.PrefabRef?.artifactKey === "BadgeFragment"));
      assert.ok(storedContainer?.children?.some((node) => node.components?.Image?.sprite === "Ready.png"));

      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      await assert.doesNotReject(() => page.locator('.ui-rendering__canvas-node[data-node-id="label"]').waitFor({ state: "hidden" }));
      await hierarchyRow(page, "label").getByRole("button", { name: "显示 Label", exact: true }).click();
      await page.locator('.ui-rendering__canvas-node[data-node-id="label"]').waitFor({ state: "visible" });

      await hierarchyRow(page, "label").getByRole("button", { name: "Label", exact: true }).click();
      await hierarchyRow(page, "container").getByTitle("折叠").click();
      assert.equal(await hierarchyRow(page, "label").count(), 0);
      await hierarchyRow(page, "container").getByTitle("展开").click();
      await hierarchyRow(page, "label").waitFor();

      stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
      assert.equal(
        stored.root.children?.find((node) => node.id === "container")?.children?.find((node) => node.id === "label")?.active,
        undefined,
      );
    },
  );
});

test("Project drags Widget and Fragment sources into the resolved Preview authoring surface", async () => {
  await withBrowserFixture(
    {
      name: "project-canvas-drop",
      viewport: { width: 1440, height: 900 },
      prepare: prepareProjectWorkspace,
    },
    async ({ workspaceRoot, page, server }) => {
      await page.goto(`${server.url}?artifact=ProjectCanvas`, { waitUntil: "networkidle" });
      const modes = page.getByRole("group", { name: "预览显示模式" });
      await modes.getByRole("button", { name: "预览", exact: true }).click();
      const leftProject = page.getByRole("region", { name: "左侧 Project" });
      await leftProject.locator('[data-project-directory="source:Project"] [data-ui~=project-directory-select]').click();

      const canvasRoot = page.locator("[data-reference-source-authoring-surface] [data-canvas-root]");
      await canvasRoot.waitFor();
      await dragProjectItem(leftProject.locator('[data-project-document="Project/InteractionHintWidget.ui.json"]'), canvasRoot);
      await page.locator('[data-ui~=canvas-node][data-node-id="interactionHintWidget"]').waitFor();

      await dragProjectItem(leftProject.locator('[data-project-document="Project/BadgeFragment.ui.json"]'), canvasRoot);
      await page.locator('[data-ui~=canvas-node][data-node-id="badgeFragment"]').waitFor();

      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      await hierarchyRow(page, "ProjectCanvas").locator("[data-hierarchy-select]").click();
      const viewport = page.getByRole("region", { name: "Canvas 可视区域" });
      const canvasBounds = await canvasRoot.boundingBox();
      const viewportBounds = await viewport.boundingBox();
      assert.ok(canvasBounds && viewportBounds);
      const drawStart = {
        x: Math.max(canvasBounds.x, viewportBounds.x) + 80,
        y: Math.max(canvasBounds.y, viewportBounds.y) + 80,
      };
      await page.getByTitle("矩形工具").click();
      await page.mouse.move(drawStart.x, drawStart.y);
      await page.mouse.down();
      await page.mouse.move(drawStart.x + 90, drawStart.y + 55, { steps: 3 });
      await page.locator("[data-ui~=node-draw-preview]").waitFor();
      await page.mouse.up();
      await page.locator('[data-ui~=canvas-node][data-node-id="image"]').waitFor();

      await page.getByTitle("文本工具").click();
      await page.mouse.click(drawStart.x + 180, drawStart.y + 100);
      const inlineText = page.locator("[data-ui~=canvas-inline-text]");
      await inlineText.waitFor();
      await inlineText.fill("Preview authored text");
      await inlineText.press("Enter");
      await page.locator(".ui-rendering__canvas-text").filter({ hasText: "Preview authored text" }).waitFor();

      await canvasRoot.click({ button: "right", position: { x: 24, y: 24 } });
      await page.getByRole("menuitem", { name: "新建 PrefabRef", exact: true }).waitFor();
      await page.keyboard.press("Escape");

      await modes.getByRole("button", { name: "Unity 基线", exact: true }).click();
      await page.locator('[data-ui~=canvas-node][data-node-id="interactionHintWidget"]').waitFor();
      await page.locator('[data-ui~=canvas-node][data-node-id="badgeFragment"]').waitFor();

      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("已保存 1 个 Artifact", { exact: true }).waitFor();
      const stored = JSON.parse(
        await readFile(join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Project", "ProjectCanvas.ui.json"), "utf8"),
      ) as UiConcreteSource;
      assert.equal(
        stored.root.children?.some((node) => node.components?.PrefabRef?.artifactKey === "InteractionHintWidget"),
        true,
      );
      assert.equal(
        stored.root.children?.some((node) => node.components?.PrefabRef?.artifactKey === "BadgeFragment"),
        true,
      );
      assert.notEqual(findNode(stored, "image")?.components?.Image, undefined);
      assert.equal(findNode(stored, "text")?.components?.Text?.text, "Preview authored text");
      assert.equal(stored.root.children?.find((node) => node.id === "coverWidget")?.children, undefined);
    },
  );
});

test("PrefabRef creation searches compatible Widget and Fragment names before selection", async () => {
  await withBrowserFixture(
    {
      name: "prefab-ref-search",
      viewport: { width: 1440, height: 900 },
      prepare: prepareProjectWorkspace,
    },
    async ({ workspaceRoot, page, server }) => {
      await page.goto(`${server.url}?artifact=ProjectCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      await hierarchyRow(page, "container").click({ button: "right" });
      await page.getByText("新建 PrefabRef", { exact: true }).click();

      const dialog = page.getByRole("dialog", { name: "新建子节点" });
      const picker = dialog.getByRole("combobox", { name: "Widget / Fragment" });
      const pickerContainer = picker.locator("..");
      assert.equal(await pickerContainer.getAttribute("data-select-value"), "");
      await picker.click();
      const search = page.getByPlaceholder("搜索 Widget 或 Fragment");
      await search.fill("missing");
      await page.getByText("没有匹配的 Widget 或 Fragment", { exact: true }).waitFor();
      await search.fill("badge frag");
      await page.getByRole("option", { name: "BadgeFragment · Fragment", exact: true }).waitFor();
      await search.press("Enter");
      assert.equal(await pickerContainer.getAttribute("data-select-value"), "BadgeFragment");
      await dialog.getByRole("button", { name: "创建", exact: true }).click();
      await hierarchyRow(page, "prefab").waitFor();

      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("已保存 1 个 Artifact", { exact: true }).waitFor();
      const stored = JSON.parse(
        await readFile(join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Project", "ProjectCanvas.ui.json"), "utf8"),
      ) as UiConcreteSource;
      const container = stored.root.children?.find((node) => node.id === "container");
      assert.equal(container?.children?.find((node) => node.id === "prefab")?.components?.PrefabRef?.artifactKey, "BadgeFragment");
    },
  );
});

test("Project persists an independent single-column UIAuthoring explorer in each dock", async () => {
  await withBrowserFixture(
    {
      name: "project-single-column",
      viewport: { width: 1440, height: 900 },
      prepare: prepareProjectWorkspace,
    },
    async ({ page, server }) => {
      await page.goto(`${server.url}?artifact=ProjectCanvas`, { waitUntil: "networkidle" });
      await page
        .getByRole("tablist", { name: "Artifact 侧栏" })
        .getByRole("button", { name: "Hierarchy", exact: true })
        .click({ modifiers: ["Control"] });
      const leftProject = page.getByRole("region", { name: "左侧 Project" });
      const leftBrowser = leftProject.locator("[data-project-orientation]");
      await leftProject.getByTitle("单栏 UIAuthoring").click();
      assert.equal(await leftBrowser.getAttribute("data-project-orientation"), "single");
      assert.equal(await leftProject.getByLabel("Project 目录", { exact: true }).count(), 0);
      assert.equal(await leftProject.locator('[data-project-root="assets"]').count(), 0);
      await leftProject.locator("[data-project-single-tree]").waitFor();
      await leftProject.locator('[data-project-document="Project/ProjectCanvas.ui.json"]').waitFor();
      await leftProject.locator('[data-project-document="Project/CardWidget.ui.json"]').waitFor();
      assert.equal(await leftProject.locator('[data-project-directory] [aria-current="page"]').count(), 0);
      assert.equal(await leftProject.locator('[data-project-document="Project/ProjectCanvas.ui.json"][aria-current="page"]').count(), 1);

      const search = leftProject.getByLabel("搜索 Source");
      await search.fill("CardWidget");
      await leftProject.locator('[data-project-document="Project/CardWidget.ui.json"]').waitFor();
      assert.equal(await leftProject.locator('[data-project-document="Project/ProjectCanvas.ui.json"]').count(), 0);
      await search.fill("");

      await leftProject.getByTitle("网格").click();
      assert.equal(await leftProject.locator("[data-project-single-tree]").count(), 0);
      await leftProject.locator('[data-project-document="Project/ProjectCanvas.ui.json"]').waitFor();
      await leftProject.locator('[data-project-document="Project/CardWidget.ui.json"]').waitFor();
      await leftProject.getByTitle("列表").click();

      await page.reload({ waitUntil: "networkidle" });
      assert.equal(await leftBrowser.getAttribute("data-project-orientation"), "single");
      await leftProject.locator("[data-project-single-tree]").waitFor();

      await page.getByTitle("打开底部 Project").click();
      const bottomProject = page.getByRole("region", { name: "底部 Project" });
      const bottomBrowser = bottomProject.locator("[data-project-orientation]");
      assert.equal(await bottomBrowser.getAttribute("data-project-orientation"), "horizontal");
      await bottomProject.getByTitle("单栏 UIAuthoring").click();
      assert.equal(await bottomBrowser.getAttribute("data-project-orientation"), "single");
      await bottomProject.locator('[data-project-document="Project/CardWidget.ui.json"]').waitFor();
      assert.equal(await leftBrowser.getAttribute("data-project-orientation"), "single");

      await bottomProject.getByTitle("上下排布").click();
      assert.equal(await bottomBrowser.getAttribute("data-project-orientation"), "vertical");
      assert.equal(await leftBrowser.getAttribute("data-project-orientation"), "single");

      await leftProject.locator('[data-project-directory="source:Project"] [data-ui~="project-directory-select"]').click();
      await page.waitForURL(/directory=Project/);
      const directorySidebar = page.getByRole("tablist", { name: "目录侧栏" });
      assert.equal(await directorySidebar.getByRole("button", { name: "Project", exact: true }).getAttribute("aria-pressed"), "true");
      assert.equal(await directorySidebar.getByRole("button", { name: "Hierarchy", exact: true }).getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator('[data-sidebar-pane="hierarchy"]').count(), 1);
      await page.getByText("未选择文档", { exact: true }).waitFor();
      assert.equal(await leftProject.locator('[data-project-directory] [aria-current="page"]').count(), 1);
      assert.equal(await leftProject.locator('[data-project-document][aria-current="page"]').count(), 0);
    },
  );
});

test("Project preserves layout across routes and exposes one current directory", async () => {
  await withBrowserFixture(
    {
      name: "project-navigation",
      viewport: { width: 1440, height: 900 },
      prepare: prepareProjectWorkspace,
    },
    async ({ page, server }) => {
      await page.goto(`${server.url}?artifact=ProjectCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      const artifactTabs = page.getByRole("tablist", { name: "Artifact 侧栏" });
      assert.equal(await artifactTabs.getByRole("button", { name: "Artifact", exact: true }).count(), 0);
      await artifactTabs.getByRole("button", { name: "Hierarchy", exact: true }).click({ modifiers: ["Control"] });
      const leftProject = page.getByRole("region", { name: "左侧 Project" });
      const resize = leftProject.locator("[data-project-browser-resize]");
      const tree = leftProject.getByLabel("Project 目录", { exact: true });
      await tree.waitFor();
      assert.equal(await resize.getAttribute("aria-orientation"), "horizontal");
      assert.equal(
        await leftProject.locator('[data-project-root="source"] [data-ui~="project-root-select"]').getAttribute("aria-current"),
        null,
      );
      assert.equal(
        await leftProject
          .locator('[data-ui~="project-root-select"][aria-current="page"], [data-ui~="project-directory-select"][aria-current="page"]')
          .count(),
        1,
      );

      await leftProject.locator('[data-project-root="source"] [data-ui~="project-root-select"]').click();
      await leftProject.locator('[data-project-content-directory="Project"]').waitFor();
      await leftProject.getByTitle("网格").click();
      await leftProject.locator('[data-project-content-directory="Project"]').waitFor();
      await leftProject.getByTitle("左右排布").click();
      assert.equal(await resize.getAttribute("aria-orientation"), "vertical");
      const before = Number(await resize.getAttribute("aria-valuenow"));
      await resize.press("ArrowRight");
      const storedSplit = Number(await resize.getAttribute("aria-valuenow"));
      assert.ok(storedSplit > before);

      await leftProject.locator('[data-project-root="assets"] [data-ui~=project-root-select]').click();
      await leftProject.locator('[data-asset-path="Ready.png"]').dblclick();
      await leftProject.getByRole("status").getByText("暂不支持打开 Ready.png", { exact: true }).waitFor();

      await leftProject.locator('[data-project-directory="source:Project"] [data-ui~=project-directory-select]').dblclick();
      await page.waitForURL((url) => url.searchParams.get("directory") === "Project");
      assert.equal(await page.getByRole("tablist", { name: "Workspace browser" }).count(), 0);
      const directorySidebar = page.getByRole("tablist", { name: "目录侧栏" });
      assert.equal(await directorySidebar.getByRole("button", { name: "Hierarchy", exact: true }).getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator('[data-sidebar-pane="hierarchy"]').count(), 1);
      const directoryProject = page.getByRole("region", { name: "左侧 Project" });
      assert.equal(await directoryProject.locator("[data-project-browser-resize]").getAttribute("aria-orientation"), "vertical");
      assert.equal(Number(await directoryProject.locator("[data-project-browser-resize]").getAttribute("aria-valuenow")), storedSplit);
      assert.equal(
        await directoryProject
          .locator('[data-ui~="project-root-select"][aria-current="page"], [data-ui~="project-directory-select"][aria-current="page"]')
          .count(),
        1,
      );

      await directoryProject.locator('[data-project-document="Project/CardWidget.ui.json"]').dblclick();
      await page.waitForURL((url) => url.searchParams.get("artifact") === "CardWidget");
      assert.equal(await artifactTabs.getByRole("button", { name: "Project", exact: true }).getAttribute("aria-pressed"), "true");
      const widgetProject = page.getByRole("region", { name: "左侧 Project" });
      assert.equal(await widgetProject.locator("[data-project-browser-resize]").getAttribute("aria-orientation"), "vertical");
      await widgetProject.locator('[data-project-directory="source:Project"] [data-ui~=project-directory-select]').click();
      await widgetProject.locator('[data-project-document="Project/ProjectCanvas.ui.json"]').dblclick();
      await page.waitForURL((url) => url.searchParams.get("artifact") === "ProjectCanvas");
      assert.equal(
        await page
          .getByRole("tablist", { name: "Artifact 侧栏" })
          .getByRole("button", { name: "Project", exact: true })
          .getAttribute("aria-pressed"),
        "true",
      );
    },
  );
});
