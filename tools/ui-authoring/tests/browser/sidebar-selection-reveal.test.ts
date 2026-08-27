import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function rect(size: readonly [number, number], stretch = false): UiNode["rect"] {
  return {
    anchorMin: stretch ? [0, 0] : [0.5, 0.5],
    anchorMax: stretch ? [1, 1] : [0.5, 0.5],
    pivot: [0.5, 0.5],
    anchoredPosition: [0, 0],
    sizeDelta: stretch ? [0, 0] : [...size],
  };
}

function canvasSource(): UiConcreteSource {
  const children: UiNode[] = Array.from({ length: 44 }, (_, index) => ({
    id: `node${String(index).padStart(2, "0")}`,
    rect: rect([40, 20]),
  }));
  children.push({ id: "targetNode", name: "Selected Target", rect: rect([80, 30]) });
  return {
    sourceKind: "artifact",
    artifactKey: "ProjectCanvas",
    artifactType: "Canvas",
    root: { id: "ProjectCanvas", rect: rect([640, 360], true), children },
  };
}

function widgetSource(artifactKey: string): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey,
    artifactType: "Widget",
    widgetType: artifactKey,
    initialSize: [120, 60],
    root: { id: artifactKey, rect: rect([120, 60]) },
  };
}

async function prepareWorkspace(workspaceRoot: string): Promise<void> {
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Project");
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(join(sourceDirectory, "ProjectCanvas.ui.json"), formatSource(canvasSource()), "utf8");
  await Promise.all(
    Array.from({ length: 36 }, async (_, index) => {
      const artifactKey = `AlphaWidget${String(index).padStart(2, "0")}`;
      await writeFile(join(sourceDirectory, `${artifactKey}.ui.json`), formatSource(widgetSource(artifactKey)), "utf8");
    }),
  );
}

async function waitForContained(page: Page, containerSelector: string, itemSelector: string): Promise<void> {
  await page.waitForFunction(
    ({ containerSelector, itemSelector }) => {
      const container = document.querySelector(containerSelector);
      const item = document.querySelector(itemSelector);
      if (!(container instanceof HTMLElement) || !(item instanceof HTMLElement)) return false;
      const viewport = container.getBoundingClientRect();
      const bounds = item.getBoundingClientRect();
      return bounds.top >= viewport.top - 1 && bounds.bottom <= viewport.bottom + 1;
    },
    { containerSelector, itemSelector },
  );
}

test("Project and Hierarchy reveal selection with F only in the focused split pane", async () => {
  await withBrowserFixture(
    {
      name: "sidebar-selection-reveal",
      viewport: { width: 1180, height: 640 },
      prepare: prepareWorkspace,
    },
    async ({ page, server }) => {
      const browserErrors: string[] = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" && !message.text().includes("status of 404")) browserErrors.push(message.text());
      });
      await page.goto(`${server.url}?artifact=ProjectCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();

      await page.getByRole("button", { name: "Hierarchy", exact: true }).click({ modifiers: ["Control"] });
      const hierarchy = page.locator("[data-editor-hierarchy]");
      const hierarchySearch = page.getByPlaceholder("Node ID / GameObject 名称 / Component / Binding");
      const targetSelector = '[data-hierarchy-row][data-node-id="targetNode"]';
      await hierarchySearch.fill("targetNode");
      await page.locator(`${targetSelector} [data-hierarchy-select]`).click();
      await hierarchySearch.fill("");
      await waitForContained(page, "[data-editor-hierarchy]", targetSelector);
      assert.equal(await page.locator(targetSelector).getAttribute("data-selected"), "true");

      const hierarchyFrame = page.locator("[data-ui~=selection-scroll-frame]").filter({ has: hierarchy });
      await hierarchy.evaluate((element) => {
        element.scrollTop = 0;
      });
      await hierarchyFrame.locator('[data-selection-edge="below"]').waitFor();
      await hierarchyFrame.locator('[data-selection-edge="below"]').click();
      await waitForContained(page, "[data-editor-hierarchy]", targetSelector);

      const rootSelector = '[data-hierarchy-row][data-node-id="ProjectCanvas"]';
      await page.locator(`${rootSelector} [data-hierarchy-select]`).click();
      await hierarchy.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await hierarchyFrame.locator('[data-selection-edge="above"]').waitFor();
      await hierarchyFrame.locator('[data-selection-edge="above"]').click();
      await waitForContained(page, "[data-editor-hierarchy]", rootSelector);

      await hierarchySearch.fill("targetNode");
      await page.locator(`${targetSelector} [data-hierarchy-select]`).click();
      await hierarchySearch.fill("missing");
      await hierarchySearch.press("f");
      assert.equal(await hierarchySearch.inputValue(), "missingf");
      await page.locator("[data-ui~=hierarchy-list-header]").click();
      await page.keyboard.press("f");
      assert.equal(await hierarchySearch.inputValue(), "");
      await waitForContained(page, "[data-editor-hierarchy]", targetSelector);

      assert.equal(await page.locator('[data-sidebar-pane="hierarchy"]').count(), 1);
      assert.equal(await page.locator('[data-sidebar-pane="project"]').count(), 1);
      const leftProject = page.getByRole("region", { name: "左侧 Project" });
      const selectedProjectSelector = '[data-project-document="Project/ProjectCanvas.ui.json"]';
      const projectScrollSelector = "[data-ui~=project-source-scroll]";
      await leftProject.locator(`${selectedProjectSelector}[aria-current="page"]`).waitFor();
      const projectSearch = leftProject.getByLabel("搜索 Source");
      await projectSearch.fill("ProjectCanvas");
      await projectSearch.fill("");
      await waitForContained(page, projectScrollSelector, selectedProjectSelector);
      const projectScroll = leftProject.locator(projectScrollSelector);
      const projectContentFrame = projectScroll.locator("..");
      const projectEdge = await projectScroll.evaluate((element, selectedSelector) => {
        const selected = element.querySelector(selectedSelector);
        if (!(selected instanceof HTMLElement)) throw new Error("Selected Project document is missing");
        const selectedCenter = selected.offsetTop + selected.offsetHeight / 2;
        const scrollRange = element.scrollHeight - element.clientHeight;
        if (selectedCenter > element.scrollHeight / 2) {
          element.scrollTop = 0;
          return "below";
        }
        element.scrollTop = scrollRange;
        return "above";
      }, selectedProjectSelector);
      await projectContentFrame.locator(`[data-selection-edge="${projectEdge}"]`).waitFor();
      await projectContentFrame.locator(`[data-selection-edge="${projectEdge}"]`).click();
      await waitForContained(page, projectScrollSelector, selectedProjectSelector);

      await leftProject.locator('[data-project-root="assets"] [data-ui~=project-root-select]').click();
      assert.equal(await leftProject.locator(selectedProjectSelector).count(), 0);
      await page.keyboard.press("f");
      await leftProject.locator(`${selectedProjectSelector}[aria-current="page"]`).waitFor();
      await projectSearch.fill("missing");
      await leftProject.locator("[data-ui~=project-content-heading]").click();
      await page.keyboard.press("f");
      assert.equal(await projectSearch.inputValue(), "");
      await waitForContained(page, projectScrollSelector, selectedProjectSelector);

      await leftProject.locator('[data-project-root="assets"] [data-ui~=project-root-select]').click();
      await hierarchySearch.fill("missing");
      await page.locator('[data-sidebar-pane="hierarchy"] [data-ui~=hierarchy-list-header]').click();
      await page.keyboard.press("f");
      assert.equal(await hierarchySearch.inputValue(), "");
      assert.equal(await leftProject.locator(selectedProjectSelector).count(), 0);
      assert.deepEqual(browserErrors, []);
    },
  );
});
