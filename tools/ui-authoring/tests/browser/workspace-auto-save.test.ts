import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import { formatReference } from "../../src/kernel/prototype-canonical.js";
import type { UiReference } from "../../src/schema/ui-prototype-schema.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

const AUTO_SAVE_OBSERVATION_MS = 550;

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "AutoSaveCanvas",
    artifactType: "Canvas",
    root: {
      id: "AutoSaveCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        {
          id: "label",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [80, -60], sizeDelta: [260, 50] },
          components: { Text: { text: "Auto Save", fontSize: 24 } },
        },
      ],
    },
  };
}

async function waitForReferenceDescription(path: string, description: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const current = await readFile(path, "utf8")
      .then((text) => JSON.parse(text) as UiReference)
      .catch(() => undefined);
    if (current?.description === description) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`Reference did not reach description '${description}'`);
}

async function waitForArtifactPosition(path: string, expected: readonly [number, number]): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const current = await readFile(path, "utf8")
      .then((text) => JSON.parse(text) as UiConcreteSource)
      .catch(() => undefined);
    const label = current?.root.children?.find((node) => node.id === "label");
    if (label?.rect.anchoredPosition[0] === expected[0] && label.rect.anchoredPosition[1] === expected[1]) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`Artifact did not reach position [${expected.join(", ")}]`);
}

async function waitForArtifactKey(path: string, expected: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const current = await readFile(path, "utf8")
      .then((text) => JSON.parse(text) as UiConcreteSource)
      .catch(() => undefined);
    if (current?.artifactKey === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`Artifact '${expected}' was not saved`);
}

async function waitForCount(read: () => number, expected: number, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (read() === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`${label} did not reach ${expected}; current=${read()}`);
}

test("Auto Save scopes writes to the current editor, keeps latest snapshots, stops after failure, and waits for transient settlement", async () => {
  let sourceDirectory = "";
  let artifactPath = "";
  let firstReferencePath = "";
  let conflictReferencePath = "";
  await withBrowserFixture(
    {
      name: "auto-save",
      viewport: { width: 1280, height: 720 },
      async prepare(workspaceRoot) {
        sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "AutoSave");
        artifactPath = join(sourceDirectory, "AutoSaveCanvas.ui.json");
        firstReferencePath = join(sourceDirectory, "FirstReference.ui-reference.json");
        conflictReferencePath = join(sourceDirectory, "ConflictReference.ui-reference.json");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(artifactPath, formatSource(source()), "utf8");
        await writeFile(
          firstReferencePath,
          formatReference({ referenceKey: "FirstReference", subjectArtifactKey: "AutoSaveCanvas" }),
          "utf8",
        );
        await writeFile(
          conflictReferencePath,
          formatReference({ referenceKey: "ConflictReference", subjectArtifactKey: "AutoSaveCanvas" }),
          "utf8",
        );
      },
    },
    async ({ page, server }) => {
      await page.goto(`${server.url}?reference=FirstReference`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "编辑预览", exact: true }).click();

      const toggle = page.getByRole("switch", { name: "自动保存" });
      const referenceSaveCompanion = page.locator('button[title="保存"] + label').getByRole("switch", { name: "自动保存" });
      assert.equal(await referenceSaveCompanion.count(), 1);
      assert.equal(await page.getByTitle("保存", { exact: true }).isDisabled(), true);
      assert.equal(await referenceSaveCompanion.isDisabled(), false);
      assert.equal(await toggle.getAttribute("aria-checked"), "false");
      await page.getByLabel("检查说明").fill("Manual repair");
      await page.waitForTimeout(AUTO_SAVE_OBSERVATION_MS);
      assert.equal((JSON.parse(await readFile(firstReferencePath, "utf8")) as UiReference).description, undefined);

      let blockedWrites = 0;
      await page.route("**/api/workspace/save", async (route) => {
        blockedWrites += 1;
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            valid: false,
            issues: [{ path: "/description", code: "source.testFailure", message: "测试保存阻断" }],
            path: "AutoSave/FirstReference.ui-reference.json",
            diagnostics: [
              {
                path: "AutoSave/FirstReference.ui-reference.json",
                severity: "error",
                category: "source",
                code: "source.testFailure",
                message: "测试保存阻断",
                owner: "reference",
                safeFixable: false,
                nextAction: "修正测试问题后重试保存。",
                identity: { documentKind: "reference", documentKey: "FirstReference", fieldPath: "/description" },
              },
            ],
          }),
        });
      });
      await page.getByTitle("保存", { exact: true }).click();
      const blocked = page.getByRole("alertdialog", { name: "保存未完成" });
      await blocked.waitFor();
      await blocked.getByText(/已保存 0 个/).waitFor();
      assert.equal(blockedWrites, 1);
      assert.equal((JSON.parse(await readFile(firstReferencePath, "utf8")) as UiReference).description, undefined);
      await blocked.getByRole("button", { name: "确认" }).click();
      await page.waitForTimeout(AUTO_SAVE_OBSERVATION_MS);
      assert.equal(blockedWrites, 1);
      await page.unroute("**/api/workspace/save");

      await page.getByTitle("保存", { exact: true }).click();
      await waitForReferenceDescription(firstReferencePath, "Manual repair");
      await page.waitForFunction(() => document.querySelector('button[title="保存"]')?.hasAttribute("disabled") === true);
      await toggle.click();
      let automaticWrites = 0;
      await page.route("**/api/workspace/save", async (route) => {
        automaticWrites += 1;
        await route.continue();
      });
      await page.getByLabel("检查说明").fill("Manual only");
      await waitForReferenceDescription(firstReferencePath, "Manual only");
      await waitForCount(() => automaticWrites, 1, "automatic workspace writes");
      await page.waitForFunction(() => document.querySelector('button[title="保存"]')?.hasAttribute("disabled") === true);
      assert.equal(automaticWrites, 1);
      await page.unroute("**/api/workspace/save");
      await page.getByRole("switch", { name: "自动保存" }).waitFor();

      await page.reload({ waitUntil: "networkidle" });
      assert.equal(await page.getByRole("switch", { name: "自动保存" }).getAttribute("aria-checked"), "true");
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "编辑预览", exact: true }).click();

      let releaseFirstSave!: () => void;
      let firstSaveSeen!: () => void;
      const firstSave = new Promise<void>((resolve) => {
        firstSaveSeen = resolve;
      });
      const releaseSave = new Promise<void>((resolve) => {
        releaseFirstSave = resolve;
      });
      let referenceWrites = 0;
      await page.route("**/api/workspace/save", async (route) => {
        referenceWrites += 1;
        if (referenceWrites === 1) {
          const response = await route.fetch();
          firstSaveSeen();
          await releaseSave;
          await route.fulfill({ response });
          return;
        }
        await route.continue();
      });
      await page.getByLabel("检查说明").fill("First in flight");
      await firstSave;
      await page.getByLabel("检查说明").fill("Latest while saving");
      await page.waitForTimeout(AUTO_SAVE_OBSERVATION_MS);
      assert.equal(await page.getByRole("dialog", { name: "共享未保存改动冲突" }).count(), 0);
      releaseFirstSave();
      await waitForReferenceDescription(firstReferencePath, "Latest while saving");
      await waitForCount(() => referenceWrites, 2, "latest workspace writes");
      await page.waitForFunction(() => document.querySelector('button[title="保存"]')?.hasAttribute("disabled") === true);
      assert.equal(referenceWrites, 2);
      await page.unroute("**/api/workspace/save");

      await page.goto(`${server.url}?reference=ConflictReference`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "编辑预览", exact: true }).click();
      let conflictWrites = 0;
      await page.route("**/api/workspace/save", async (route) => {
        conflictWrites += 1;
        await route.continue();
      });
      const external = formatReference({
        referenceKey: "ConflictReference",
        subjectArtifactKey: "AutoSaveCanvas",
        description: "External edit",
      });
      await writeFile(conflictReferencePath, external, "utf8");
      await page.getByLabel("检查说明").fill("Browser edit");
      const saveFailure = page.getByRole("alertdialog", { name: "保存未完成" });
      await saveFailure.waitFor({ timeout: 5_000 });
      await saveFailure
        .getByText(/已被其他程序或协作者修改/)
        .first()
        .waitFor();
      assert.equal(await readFile(conflictReferencePath, "utf8"), external);
      assert.equal(await page.getByLabel("检查说明").inputValue(), "Browser edit");
      await saveFailure.getByRole("button", { name: "确认" }).click();
      await page.waitForTimeout(AUTO_SAVE_OBSERVATION_MS);
      assert.equal(conflictWrites, 1);
      await page.unroute("**/api/workspace/save");

      await page.getByTitle("菜单", { exact: true }).click();
      await page.getByRole("menuitem", { name: "显示 Diff" }).click();
      const conflictChanges = page.getByRole("dialog", { name: "改动" });
      await conflictChanges
        .getByText("ConflictReference", { exact: true })
        .locator("xpath=ancestor::section[1]")
        .getByTitle("放弃改动")
        .click();
      await conflictChanges.locator("footer").getByRole("button", { name: "关闭", exact: true }).click();
      await page.setViewportSize({ width: 1440, height: 900 });

      await page.goto(`${server.url}?artifact=AutoSaveCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      assert.equal(await page.getByRole("dialog", { name: "恢复未保存修改" }).count(), 0);
      let artifactWrites = 0;
      await page.route("**/api/workspace/save", async (route) => {
        artifactWrites += 1;
        await route.continue();
      });
      await page.locator('.ui-rendering__canvas-node[data-node-id="label"]').click();
      const rectSection = page
        .locator("[data-ui~=component-section]")
        .filter({ has: page.getByRole("heading", { name: "Rect Transform", exact: true }) });
      const scrub = rectSection.locator("[data-numeric-scrub]").filter({ hasText: "Pos X" });
      const box = await scrub.boundingBox();
      assert.ok(box);
      const saveCompanion = page.locator('button[title="保存"] + label').getByRole("switch", { name: "自动保存" });
      assert.equal(await saveCompanion.count(), 1);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 36, box.y + box.height / 2, { steps: 4 });
      await page.waitForTimeout(AUTO_SAVE_OBSERVATION_MS);
      assert.equal(artifactWrites, 0);
      await page.mouse.up();
      await waitForCount(() => artifactWrites, 1, "settled artifact writes");
      await page.waitForFunction(() => document.querySelector('button[title="保存"]')?.hasAttribute("disabled") === true);
      await page.getByTitle("撤销", { exact: true }).click();
      await waitForArtifactPosition(artifactPath, [80, -60]);
      await waitForCount(() => artifactWrites, 2, "undo artifact writes");
      await page.waitForFunction(() => document.querySelector('button[title="保存"]')?.hasAttribute("disabled") === true);
      assert.equal(await page.getByTitle("保存", { exact: true }).isDisabled(), true);
      await page.unroute("**/api/workspace/save");

      await page.getByRole("tablist", { name: "Artifact 侧栏" }).getByRole("button", { name: "Project" }).click();
      const leftProject = page.getByRole("region", { name: "左侧 Project" });
      await leftProject.locator('[data-project-directory="source:AutoSave"]').click({ button: "right" });
      await page.getByRole("menuitem", { name: "在此新建文档" }).click();
      const createDialog = page.getByRole("dialog", { name: "新建文档" });
      await createDialog.getByLabel("宽度").fill("0");
      await createDialog.getByText("宽度必须大于 0", { exact: true }).waitFor();
      assert.equal(await createDialog.getByRole("button", { name: "创建" }).isDisabled(), true);
      await createDialog.getByLabel("宽度").fill("1280");
      await createDialog.getByText("宽度必须大于 0", { exact: true }).waitFor({ state: "detached" });
      await createDialog.getByLabel("Artifact Key").fill("AutoCreatedCanvas");
      await createDialog.getByRole("button", { name: "创建" }).click();
      await page.waitForURL(/artifact=AutoCreatedCanvas/);
      await waitForArtifactKey(join(sourceDirectory, "AutoCreatedCanvas.ui.json"), "AutoCreatedCanvas");
      await page.waitForFunction(() => document.querySelector('button[title="保存"]')?.hasAttribute("disabled") === true);
      assert.equal(await page.getByTitle("保存", { exact: true }).isDisabled(), true);
      assert.equal(await page.locator('button[title="保存"] + label').getByRole("switch", { name: "自动保存" }).isDisabled(), false);

      await page.goto(`${server.url}?directory=AutoSave&view=dependency`, { waitUntil: "networkidle" });
      assert.equal(await page.getByTitle("保存", { exact: true }).count(), 0);
      assert.equal(await page.getByRole("switch", { name: "自动保存" }).count(), 0);
    },
  );
});
