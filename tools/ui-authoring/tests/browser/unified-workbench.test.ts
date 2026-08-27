import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import { formatPrototype, formatReference } from "../../src/kernel/prototype-canonical.js";
import type { UiPrototype, UiReference } from "../../src/schema/ui-prototype-schema.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

const rootRect: UiNode["rect"] = {
  anchorMin: [0, 0],
  anchorMax: [1, 1],
  pivot: [0.5, 0.5],
  anchoredPosition: [0, 0],
  sizeDelta: [0, 0],
};

const childRect: UiNode["rect"] = {
  anchorMin: [0.5, 0.5],
  anchorMax: [0.5, 0.5],
  pivot: [0.5, 0.5],
  anchoredPosition: [0, 0],
  sizeDelta: [360, 72],
};

function documents(): {
  readonly source: UiConcreteSource;
  readonly detailWidget: UiConcreteSource;
  readonly reference: UiReference;
  readonly prototype: UiPrototype;
} {
  return {
    source: {
      sourceKind: "artifact",
      artifactKey: "WorkbenchCanvas",
      artifactType: "Canvas",
      bindings: [{ name: "title", target: { nodeId: "titleText", componentType: "Text" } }],
      root: {
        id: "WorkbenchCanvas",
        rect: rootRect,
        children: [
          {
            id: "titleText",
            name: "Title Text",
            rect: childRect,
            components: { Text: { text: "Source title", fontSize: 28, alignment: "center" } },
          },
          {
            id: "detailWidget",
            name: "Detail Widget",
            rect: childRect,
            components: { PrefabRef: { artifactKey: "WorkbenchDetailWidget" } },
          },
        ],
      },
    },
    detailWidget: {
      sourceKind: "artifact",
      artifactKey: "WorkbenchDetailWidget",
      artifactType: "Widget",
      widgetType: "WorkbenchDetailWidget",
      initialSize: [360, 72],
      root: {
        id: "WorkbenchDetailWidget",
        rect: rootRect,
        children: [
          {
            id: "detailText",
            name: "Detail Label",
            rect: childRect,
            components: { Text: { text: "Nested detail", fontSize: 18, alignment: "center" } },
          },
        ],
      },
    },
    reference: {
      referenceKey: "WorkbenchReview",
      subjectArtifactKey: "WorkbenchCanvas",
      values: { title: { text: "Reference title" } },
      viewport: [800, 500],
      description: "Unified workbench fixture",
    },
    prototype: {
      prototypeKey: "WorkbenchFlow",
      startReferenceKey: "WorkbenchReview",
      interactions: [],
    },
  };
}

test("Reference and Prototype share the workbench navigation, viewport, and resolved inspection contract", async () => {
  const initial = documents();
  await withBrowserFixture(
    {
      name: "unified-workbench",
      viewport: { width: 1200, height: 760 },
      prepare: async (workspaceRoot) => {
        const directory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Workbench");
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "WorkbenchCanvas.ui.json"), formatSource(initial.source), "utf8");
        await writeFile(join(directory, "WorkbenchDetailWidget.ui.json"), formatSource(initial.detailWidget), "utf8");
        await writeFile(join(directory, "WorkbenchReview.ui-reference.json"), formatReference(initial.reference), "utf8");
        await writeFile(join(directory, "WorkbenchFlow.ui-prototype.json"), formatPrototype(initial.prototype), "utf8");
      },
    },
    async ({ page, server }) => {
      const browserErrors: string[] = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") browserErrors.push(message.text());
      });

      await page.addInitScript(() => {
        if (!localStorage.getItem("ui-authoring:workbench-sidebar:v3"))
          localStorage.setItem("ui-authoring:workbench-sidebar:v3", JSON.stringify({ views: ["project"], focused: "project", split: 0.5 }));
      });
      await page.goto(`${server.url}?reference=WorkbenchReview`, { waitUntil: "networkidle" });
      const referenceSidebar = page.getByRole("tablist", { name: "Reference 侧栏" });
      const referenceInspectorTabs = page.getByRole("tablist", { name: "Reference inspector" });
      for (const label of ["Project", "Hierarchy", "关系"])
        await referenceSidebar.getByRole("button", { name: label, exact: true }).waitFor();
      for (const label of ["节点", "Reference", "改动"])
        await referenceInspectorTabs.getByRole("button", { name: label, exact: true }).waitFor();
      const projectTab = referenceSidebar.getByRole("button", { name: "Project", exact: true });
      const hierarchyTab = referenceSidebar.getByRole("button", { name: "Hierarchy", exact: true });
      const relationsTab = referenceSidebar.getByRole("button", { name: "关系", exact: true });
      assert.equal(await projectTab.getAttribute("aria-pressed"), "true");
      assert.equal(await hierarchyTab.getAttribute("aria-pressed"), "false");
      assert.equal(await page.locator('[data-sidebar-pane="project"]').count(), 1);
      assert.equal(await page.locator('[data-sidebar-pane="hierarchy"]').count(), 0);
      await hierarchyTab.click({ modifiers: ["Control"] });
      assert.equal(await page.locator('[data-sidebar-pane="project"]').count(), 1);
      assert.equal(await page.locator('[data-sidebar-pane="hierarchy"]').count(), 1);
      const sidebarResize = page.locator("[data-sidebar-resize]");
      const initialSidebarSplit = Number(await sidebarResize.getAttribute("aria-valuenow"));
      await sidebarResize.press("ArrowDown");
      assert.ok(Number(await sidebarResize.getAttribute("aria-valuenow")) > initialSidebarSplit);
      await hierarchyTab.click({ modifiers: ["Control"] });
      assert.equal(await page.locator('[data-sidebar-pane="hierarchy"]').count(), 0);
      assert.equal(await page.locator('[data-sidebar-pane="project"]').count(), 1);
      await hierarchyTab.click({ modifiers: ["Control"] });
      assert.equal(await page.locator('[data-sidebar-pane="hierarchy"]').count(), 1);

      const viewport = page.getByRole("region", { name: "Canvas 可视区域" });
      await viewport.locator(".ui-rendering__prototype-canvas").waitFor();
      await viewport.getByText("Reference title", { exact: true }).waitFor();
      await page.getByRole("group", { name: "Canvas 缩放" }).getByText("65%", { exact: true }).waitFor();
      await page.getByTitle("放大").click();
      await page.getByRole("group", { name: "Canvas 缩放" }).getByText("75%", { exact: true }).waitFor();
      await page.getByRole("group", { name: "Canvas 缩放" }).getByTitle("适合画布").last().click();

      await hierarchyTab.click();
      const referenceHierarchy = page.locator('[data-sidebar-pane="hierarchy"]');
      const referenceRootRow = referenceHierarchy.locator('[data-hierarchy-row][data-node-id="WorkbenchCanvas"]');
      assert.equal(await referenceRootRow.count(), 1);
      assert.equal(await referenceRootRow.getAttribute("data-selected"), "true");
      assert.equal(await referenceHierarchy.locator('[data-selected="true"]').count(), 1);

      const detailUseSite = referenceHierarchy.locator('[data-hierarchy-row][data-node-id="detailWidget"]');
      const detailLabelRow = referenceHierarchy.locator('[data-hierarchy-row][data-node-id="detailText"]');
      assert.equal(await detailUseSite.getAttribute("data-artifact-reference"), "WorkbenchDetailWidget");
      assert.equal(await detailLabelRow.getAttribute("data-reference"), "true");
      assert.equal(await detailUseSite.getByTitle("打开 WorkbenchDetailWidget").count(), 1);
      const detailDisclosure = detailUseSite.locator('[title="折叠"]');
      assert.equal(await detailDisclosure.getAttribute("aria-expanded"), "true");
      await detailDisclosure.click();
      assert.equal(await detailLabelRow.count(), 0);
      const collapsedDisclosure = detailUseSite.locator('[title="展开"]');
      assert.equal(await collapsedDisclosure.getAttribute("aria-expanded"), "false");
      await collapsedDisclosure.click();
      assert.equal(await detailLabelRow.count(), 1);
      await detailUseSite.locator("[data-hierarchy-select]").click();
      assert.equal(await detailUseSite.getAttribute("data-selected"), "true");
      assert.equal(await referenceHierarchy.locator('[data-selected="true"]').count(), 1);

      const referenceHierarchySearch = referenceHierarchy.getByPlaceholder("实例 / 节点 / Component");
      await referenceHierarchySearch.fill("Detail Label");
      assert.equal(await referenceRootRow.count(), 1);
      assert.equal(await detailUseSite.count(), 1);
      assert.equal(await detailLabelRow.count(), 1);
      assert.equal(await referenceHierarchy.locator('[data-hierarchy-row][data-node-id="titleText"]').count(), 0);
      await referenceHierarchySearch.fill("");

      const referenceTitleRow = referenceHierarchy.locator('[data-hierarchy-row][data-node-id="titleText"]');
      const referenceTitleNode = referenceTitleRow.locator("[data-hierarchy-select]");
      await referenceTitleNode.waitFor();
      assert.equal(await referenceTitleNode.locator("span").textContent(), "Title Text");
      assert.equal(await referenceTitleNode.getAttribute("title"), "Title Text (titleText)");
      await referenceTitleNode.click();
      const referenceInspector = page.locator('[data-ui~="inspector-panel"]');
      await referenceInspector.getByText("生效状态", { exact: true }).waitFor();
      await referenceInspector.getByText("Reference 值", { exact: true }).waitFor();
      await referenceInspector.getByText("title.text", { exact: true }).waitFor();
      await referenceInspector.getByText("Reference 覆写 + Source 基线", { exact: true }).waitFor();

      await referenceInspectorTabs.getByRole("button", { name: "改动", exact: true }).click();
      await referenceInspector.getByText("主体值", { exact: true }).waitFor();
      await referenceInspector.getByText("预览尺寸", { exact: true }).waitFor();
      await referenceInspector.getByText("描述", { exact: true }).waitFor();

      await relationsTab.click();
      await page.getByTitle("打开 WorkbenchCanvas").waitFor();
      await page.getByTitle("打开 WorkbenchFlow").waitFor();
      await hierarchyTab.click({ modifiers: ["Control"] });
      assert.equal(await page.locator('[data-sidebar-pane="hierarchy"]').count(), 1);

      const treeResize = page.locator('[data-panel-resize="tree"]');
      const inspectorResize = page.locator('[data-panel-resize="inspector"]');
      const initialTreeWidth = Number(await treeResize.getAttribute("aria-valuenow"));
      await treeResize.press("ArrowRight");
      assert.ok(Number(await treeResize.getAttribute("aria-valuenow")) > initialTreeWidth);
      await inspectorResize.waitFor();
      await page.getByTitle("折叠左侧栏").click();
      await treeResize.waitFor({ state: "hidden" });
      await page.getByTitle("展开左侧栏").click();
      await treeResize.waitFor();

      await page.setViewportSize({ width: 960, height: 720 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
        true,
        "Reference workbench must not overflow the page at a narrow desktop viewport",
      );

      await page.goto(`${server.url}?prototype=WorkbenchFlow`, { waitUntil: "networkidle" });
      const prototypeSidebar = page.getByRole("tablist", { name: "Prototype 侧栏" });
      const prototypeInspectorTabs = page.getByRole("tablist", { name: "Prototype inspector" });
      for (const label of ["Project", "流程", "Hierarchy", "关系"])
        await prototypeSidebar.getByRole("button", { name: label, exact: true }).waitFor();
      for (const label of ["节点", "Reference", "改动", "交互"])
        await prototypeInspectorTabs.getByRole("button", { name: label, exact: true }).waitFor();
      assert.equal(await prototypeSidebar.getByRole("button", { name: "流程", exact: true }).getAttribute("aria-pressed"), "false");
      assert.equal(await prototypeSidebar.getByRole("button", { name: "Hierarchy", exact: true }).getAttribute("aria-pressed"), "true");
      assert.equal(await prototypeSidebar.getByRole("button", { name: "关系", exact: true }).getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator('[data-sidebar-pane="flow"]').count(), 0);
      await prototypeSidebar.getByRole("button", { name: "关系", exact: true }).click({ modifiers: ["Control"] });
      await prototypeSidebar.getByRole("button", { name: "流程", exact: true }).click({ modifiers: ["Control"] });
      assert.equal(await page.locator('[data-sidebar-pane="flow"]').count(), 1);
      assert.equal(await page.locator('[data-sidebar-pane="hierarchy"]').count(), 1);
      await page.getByText("起始 Reference", { exact: true }).waitFor();
      await page.getByRole("group", { name: "Canvas 缩放" }).getByText("65%", { exact: true }).waitFor();
      await page.getByTitle("放大").click();
      await page.getByRole("group", { name: "Canvas 缩放" }).getByText("75%", { exact: true }).waitFor();

      const prototypeTitleNode = page.locator('[data-hierarchy-row][data-node-id="titleText"] [data-hierarchy-select]');
      await prototypeTitleNode.waitFor({ timeout: 5_000 }).catch(async () => {
        throw new Error(`Prototype hierarchy did not resolve: ${(await page.locator("body").innerText()).slice(0, 2_000)}`);
      });
      await prototypeTitleNode.click();
      await page.locator('[data-ui~="inspector-panel"]').getByText("生效状态", { exact: true }).waitFor();
      await prototypeSidebar.getByRole("button", { name: "关系", exact: true }).click();
      await page.getByTitle("打开 WorkbenchReview").waitFor();
      await prototypeInspectorTabs.getByRole("button", { name: "改动", exact: true }).click();
      await page.getByText("主体值", { exact: true }).waitFor();
      await prototypeInspectorTabs.getByRole("button", { name: "交互", exact: true }).click();
      await page.getByText("请选择 ButtonEx 目标", { exact: true }).waitFor();

      await page.getByRole("button", { name: "开始演示", exact: true }).click();
      await page.getByTitle("退出演示").waitFor();
      await page.getByTitle("退出演示").click();
      await prototypeSidebar.getByRole("button", { name: "流程", exact: true }).waitFor();

      await prototypeSidebar.getByRole("button", { name: "Hierarchy", exact: true }).click({ modifiers: ["Control"] });
      await page.goto(`${server.url}?directory=Workbench`, { waitUntil: "networkidle" });
      const directorySidebar = page.getByRole("tablist", { name: "目录侧栏" });
      assert.equal(await directorySidebar.getByRole("button", { name: "Hierarchy", exact: true }).getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator('[data-sidebar-pane="hierarchy"]').count(), 1);
      await page.getByText("未选择文档", { exact: true }).waitFor();

      await page.goto(`${server.url}?reference=WorkbenchReview`, { waitUntil: "networkidle" });
      const restoredReferenceSidebar = page.getByRole("tablist", { name: "Reference 侧栏" });
      const restoredProjectTab = restoredReferenceSidebar.getByRole("button", { name: "Project", exact: true });
      const restoredHierarchyTab = restoredReferenceSidebar.getByRole("button", { name: "Hierarchy", exact: true });
      assert.equal(await restoredHierarchyTab.getAttribute("aria-pressed"), "true");
      await restoredProjectTab.click();
      assert.equal(await restoredHierarchyTab.getAttribute("aria-pressed"), "false");

      await page.goto(`${server.url}?prototype=WorkbenchFlow`, { waitUntil: "networkidle" });
      const restoredPrototypeSidebar = page.getByRole("tablist", { name: "Prototype 侧栏" });
      assert.equal(
        await restoredPrototypeSidebar.getByRole("button", { name: "Project", exact: true }).getAttribute("aria-pressed"),
        "true",
      );
      assert.equal(
        await restoredPrototypeSidebar.getByRole("button", { name: "Hierarchy", exact: true }).getAttribute("aria-pressed"),
        "false",
      );
      assert.deepEqual(browserErrors, []);
    },
  );
});
