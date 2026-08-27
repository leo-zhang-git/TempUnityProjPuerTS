import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page, Route } from "playwright";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function source(artifactKey: string): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey,
    artifactType: "Canvas",
    root: {
      id: artifactKey,
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
    },
  };
}

async function createText(page: Page, parentId: string): Promise<void> {
  await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
  await page.locator(`[data-hierarchy-row][data-node-id="${parentId}"] button[data-hierarchy-select]`).click();
  await page.getByTitle("新建子节点").click();
  await page.getByRole("button", { name: "自定义 TMP...", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建子节点" });
  await dialog.getByRole("button", { name: "创建" }).click();
  await page.locator('[data-hierarchy-row][data-node-id="text"] button[data-hierarchy-select]').waitFor();
}

test("per-document Save isolates unrelated drafts and retries only the failed document", async () => {
  await withBrowserFixture(
    {
      name: "save-reliability",
      prepare: async (workspaceRoot) => {
        const directory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Save");
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "ACanvas.ui.json"), formatSource(source("ACanvas")), "utf8");
        await writeFile(join(directory, "BCanvas.ui.json"), formatSource(source("BCanvas")), "utf8");
      },
    },
    async ({ workspaceRoot, page, server }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      const firstPath = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Save", "ACanvas.ui.json");
      const secondPath = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Save", "BCanvas.ui.json");
      await page.goto(`${server.url}?artifact=ACanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      await createText(page, "ACanvas");

      await page.getByRole("button", { name: "Project", exact: true }).click();
      const project = page.getByRole("region", { name: "左侧 Project" });
      await project.locator('[data-project-directory="source:Save"] [data-ui~=project-directory-select]').click();
      await project.locator('[data-project-document="Save/BCanvas.ui.json"]').dblclick();
      await page.waitForURL(/artifact=BCanvas/);
      await createText(page, "BCanvas");

      const writes: string[][] = [];
      let blockSave = true;
      await page.route("**/api/workspace/save", async (route: Route) => {
        const body = route.request().postDataJSON() as {
          readonly artifacts?: { readonly upserts?: readonly { readonly source?: { readonly artifactKey?: string } }[] };
        };
        writes.push(body.artifacts?.upserts?.map((entry) => entry.source?.artifactKey ?? "unknown").sort() ?? []);
        if (!blockSave) return route.continue();
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            valid: false,
            issues: [{ path: "/root", code: "source.testFailure", message: "测试保存阻断" }],
            path: "Save/BCanvas.ui.json",
            diagnostics: [
              {
                path: "Save/BCanvas.ui.json",
                severity: "error",
                category: "source",
                code: "source.testFailure",
                message: "测试保存阻断",
                owner: "artifact",
                safeFixable: false,
                nextAction: "修正测试问题后重试保存。",
                identity: { documentKind: "artifact", documentKey: "BCanvas", fieldPath: "/root" },
              },
            ],
          }),
        });
      });

      await page.getByTitle("更多工具").click();
      await page.getByTitle("查看改动").click();
      const changes = page.getByRole("dialog", { name: "改动" });
      await changes.getByText("ACanvas", { exact: true }).waitFor();
      await changes.getByText("BCanvas", { exact: true }).waitFor();
      await changes.getByText("BCanvas", { exact: true }).locator("xpath=ancestor::section[1]").getByTitle("保存", { exact: true }).click();

      const failure = page.getByRole("alertdialog", { name: "保存未完成" });
      await failure.waitFor();
      await failure.getByText(/已保存 0 个/).waitFor();
      const failureDiagnostics = failure.getByText("Save/BCanvas.ui.json · source.testFailure", { exact: true });
      await failureDiagnostics.first().waitFor();
      assert.equal(await failureDiagnostics.count(), 1);
      assert.deepEqual(writes, [["BCanvas"]]);
      assert.equal((JSON.parse(await readFile(firstPath, "utf8")) as UiConcreteSource).root.children, undefined);
      assert.equal((JSON.parse(await readFile(secondPath, "utf8")) as UiConcreteSource).root.children, undefined);
      assert.equal(await changes.isVisible(), true);

      await failure.getByRole("button", { name: "打开问题列表" }).click();
      const diagnostics = page.locator('main[aria-label="诊断"]');
      await diagnostics.getByText("source.testFailure", { exact: true }).waitFor();
      await diagnostics.getByText("修正测试问题后重试保存。", { exact: true }).waitFor();
      await diagnostics.getByTitle("关闭诊断").click();

      blockSave = false;
      const saveAResponse = page.waitForResponse(
        (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/workspace/save",
      );
      await changes.getByText("ACanvas", { exact: true }).locator("xpath=ancestor::section[1]").getByTitle("保存", { exact: true }).click();
      const savedA = await saveAResponse;
      const savedABody = (await savedA.json()) as { readonly writtenDocumentIds?: readonly string[] };
      assert.equal(savedA.status(), 200, JSON.stringify(savedABody));
      assert.deepEqual(savedABody.writtenDocumentIds, ["artifact:ACanvas"]);
      await changes.getByText("ACanvas", { exact: true }).waitFor({ state: "detached" });
      assert.deepEqual(writes, [["BCanvas"], ["ACanvas"]]);
      assert.ok((JSON.parse(await readFile(firstPath, "utf8")) as UiConcreteSource).root.children?.some((node) => node.id === "text"));
      assert.equal((JSON.parse(await readFile(secondPath, "utf8")) as UiConcreteSource).root.children, undefined);
      await changes.getByText("BCanvas", { exact: true }).locator("xpath=ancestor::section[1]").getByTitle("保存", { exact: true }).click();
      for (let attempt = 0; attempt < 100 && writes.length < 3; attempt += 1) await page.waitForTimeout(20);
      assert.deepEqual(writes, [["BCanvas"], ["ACanvas"], ["BCanvas"]]);
      await changes.getByText("BCanvas", { exact: true }).waitFor({ state: "detached" });
      assert.ok((JSON.parse(await readFile(secondPath, "utf8")) as UiConcreteSource).root.children?.some((node) => node.id === "text"));
      assert.deepEqual(pageErrors, []);
    },
  );
});

test("external-change retry keeps local edits and merges disjoint disk changes", async () => {
  await withBrowserFixture(
    {
      name: "save-external-change-recovery",
      prepare: async (workspaceRoot) => {
        const directory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Save");
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "ACanvas.ui.json"), formatSource(source("ACanvas")), "utf8");
      },
    },
    async ({ workspaceRoot, page, server }) => {
      const sourcePath = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Save", "ACanvas.ui.json");
      await page.goto(`${server.url}?artifact=ACanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      await createText(page, "ACanvas");

      const external = source("ACanvas");
      external.description = "external description";
      await writeFile(sourcePath, formatSource(external), "utf8");
      const saveResponse = page.waitForResponse(
        (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/workspace/save",
      );
      await page.getByTitle("保存", { exact: true }).click();
      const failedSave = await saveResponse;
      const failedBody = (await failedSave.json()) as {
        readonly diagnostics?: readonly { readonly code?: string }[];
        readonly failure?: { readonly diagnostics?: readonly { readonly code?: string }[] };
      };
      assert.equal(failedSave.status(), 409, JSON.stringify(failedBody));
      assert.equal(
        failedBody.diagnostics?.[0]?.code ?? failedBody.failure?.diagnostics?.[0]?.code,
        "save.externalModification",
        JSON.stringify(failedBody),
      );

      const failure = page.getByRole("alertdialog", { name: "保存未完成" });
      await failure.getByText(/失败 1 个，未执行 0 个/u).waitFor();
      await failure.getByText("Save/ACanvas.ui.json · save.externalModification", { exact: true }).waitFor();
      await failure.getByRole("button", { name: "重新读取并重试", exact: true }).click();
      await page.getByText("已保存 1 个 Artifact", { exact: true }).waitFor();

      const saved = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
      assert.equal(saved.description, "external description");
      assert.ok(saved.root.children?.some((node) => node.id === "text"));
    },
  );
});
