import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function validSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "HealthyCanvas",
    artifactType: "Canvas",
    root: {
      id: "HealthyCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
    },
  };
}

test("blocking Source problems stay visible without preventing healthy pages from opening", async () => {
  await withBrowserFixture(
    {
      name: "workspace-problems",
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Problems");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(join(sourceDirectory, "HealthyCanvas.ui.json"), formatSource(validSource()), "utf8");
        await writeFile(join(sourceDirectory, "BrokenWidget.ui.json"), "{", "utf8");
      },
    },
    async ({ page, server }) => {
      const browserErrors: string[] = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") browserErrors.push(message.text());
      });

      await page.goto(`${server.url}?artifact=BrokenWidget`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Hierarchy", exact: true }).waitFor();
      assert.match(page.url(), /artifact=HealthyCanvas/);
      const diagnosticsTrigger = page.locator("[data-diagnostics-count]");
      await diagnosticsTrigger.waitFor();
      assert.equal(await diagnosticsTrigger.getAttribute("data-diagnostics-count"), "1");
      assert.equal(await page.locator(".ui-workspace__fatal-state").count(), 0);

      await page.getByRole("button", { name: "Project", exact: true }).click();
      const leftProject = page.getByRole("region", { name: "左侧 Project" });
      await leftProject.locator('[data-project-directory="source:Problems"] [data-ui~=project-directory-select]').click();
      const brokenDocument = leftProject.locator('[data-unavailable-document="Problems/BrokenWidget.ui.json"]');
      await brokenDocument.waitFor();
      await brokenDocument.dblclick();
      const diagnostics = page.locator("[data-diagnostics-page]");
      await diagnostics.waitFor();
      assert.match(await diagnostics.innerText(), /BrokenWidget/);
      assert.match(await diagnostics.innerText(), /document\.json\.invalid/);
      assert.match(page.url(), /diagnostics=problems/);
      assert.match(page.url(), /artifact=HealthyCanvas/);

      await page.getByTitle("关闭诊断").click();
      assert.equal(await diagnostics.count(), 0);
      await page.evaluate(() =>
        window.dispatchEvent(new CustomEvent("ui-authoring:error", { detail: { message: "browser runtime failure" } })),
      );
      await page.locator('[data-diagnostics-count="2"]').waitFor();
      assert.equal(await page.locator("[data-diagnostics-count]").count(), 1);
      assert.equal(await page.locator("[data-diagnostics-count]").getAttribute("data-diagnostics-tone"), "danger");
      await page.locator("[data-diagnostics-count]").click();
      await page.getByRole("tab", { name: /运行时错误/ }).click();
      await page.getByText("browser runtime failure", { exact: true }).waitFor();
      await page.getByTitle("清理运行时错误").click();
      await page.getByText("暂无运行时错误", { exact: true }).waitFor();
      await page.getByTitle("关闭诊断").click();
      const remainingProblem = page.locator('[data-diagnostics-count="1"]');
      await remainingProblem.waitFor();
      assert.equal(await remainingProblem.getAttribute("data-diagnostics-tone"), "danger");
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      await page.locator('button[data-hierarchy-select][title="HealthyCanvas"]').waitFor();
      assert.deepEqual(browserErrors, []);
    },
  );
});
