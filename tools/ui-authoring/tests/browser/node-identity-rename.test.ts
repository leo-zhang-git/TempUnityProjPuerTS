import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import { formatDeliveryState } from "../../src/kernel/delivery-state.js";
import { formatPrototype, formatReference } from "../../src/kernel/prototype-canonical.js";
import type { UiPrototype, UiReference } from "../../src/schema/ui-prototype-schema.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "MainCanvas",
    artifactType: "Canvas",
    bindings: [{ name: "labelText", target: { nodeId: "label", componentType: "Text" } }],
    root: {
      id: "MainCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        {
          id: "label",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [20, -20], sizeDelta: [200, 40] },
          components: { Text: { text: "Ready", fontSize: 20 } },
        },
      ],
    },
  };
}

const reference: UiReference = { referenceKey: "MainReference", subjectArtifactKey: "MainCanvas" };
const prototype: UiPrototype = {
  prototypeKey: "MainFlow",
  startReferenceKey: "MainReference",
  interactions: [
    {
      referenceKey: "MainReference",
      trigger: { kind: "Tap", target: { rootArtifactKey: "MainCanvas", nodeId: "label", componentType: "Text" } },
      actions: [{ kind: "Back" }],
    },
  ],
};

test("Rename keeps auto mode sparse and saves its cross-document identity closure", async () => {
  await withBrowserFixture(
    {
      name: "node-identity-rename",
      prepare: async (workspaceRoot) => {
        const sourceRoot = join(workspaceRoot, "My project", "UIAuthoring", "Sources");
        const artifactDirectory = join(sourceRoot, "Main");
        const deliveryStateDirectory = join(workspaceRoot, "My project", "UIAuthoring", "DeliveryState");
        await mkdir(artifactDirectory, { recursive: true });
        await mkdir(deliveryStateDirectory, { recursive: true });
        await writeFile(join(artifactDirectory, "MainCanvas.ui.json"), formatSource(source()), "utf8");
        await writeFile(join(sourceRoot, "MainReference.ui-reference.json"), formatReference(reference), "utf8");
        await writeFile(join(sourceRoot, "MainFlow.ui-prototype.json"), formatPrototype(prototype), "utf8");
        await writeFile(
          join(deliveryStateDirectory, "MainCanvas.ui-delivery-state.json"),
          formatDeliveryState({ prefabGuid: "a".repeat(32), nodes: { label: "100" } }),
          "utf8",
        );
      },
    },
    async ({ workspaceRoot, page, server }) => {
      const saveBodies: Array<Record<string, unknown>> = [];
      page.on("request", (request) => {
        if (request.method() !== "POST" || !request.url().endsWith("/api/workspace/save")) return;
        saveBodies.push(request.postDataJSON() as Record<string, unknown>);
      });
      const browserErrors: string[] = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") browserErrors.push(message.text());
      });
      await page.goto(`${server.url}?artifact=MainCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();

      const renameSelected = async (nodeId: string) => {
        await page.locator(`[data-hierarchy-row][data-node-id="${nodeId}"] button[data-hierarchy-select]`).click();
        await page.getByTitle("重命名节点").click();
        return page.getByRole("dialog", { name: "重命名节点" });
      };
      const save = async (expectedNotice: string): Promise<Record<string, unknown>> => {
        const requestCount = saveBodies.length;
        await page.getByTitle("保存", { exact: true }).click();
        for (let attempt = 0; attempt < 100 && saveBodies.length === requestCount; attempt += 1) {
          await page.waitForTimeout(20);
        }
        assert.equal(saveBodies.length, requestCount + 1);
        await page.getByText(expectedNotice, { exact: true }).waitFor();
        return saveBodies.at(-1)!;
      };

      const automaticRow = page.locator('[data-hierarchy-row][data-node-id="label"]');
      await automaticRow.locator("[data-hierarchy-select]").dblclick();
      const automaticRename = automaticRow.getByRole("textbox", { name: "重命名 Label" });
      await automaticRename.fill("/");
      assert.equal(await automaticRename.getAttribute("aria-invalid"), "true");
      assert.match((await automaticRow.locator("[data-hierarchy-inline-rename]").getAttribute("title")) ?? "", /不能包含/);
      await automaticRename.press("Enter");
      assert.equal(await automaticRename.count(), 1);
      await automaticRename.fill("Status Label");
      assert.equal(await automaticRow.locator("[data-inline-node-id-preview]").innerText(), "statusLabel");
      await automaticRename.press("Enter");
      await page.locator('[data-hierarchy-row][data-node-id="statusLabel"][data-selected="true"]').waitFor();
      const automaticSave = await save("已保存 2 个文档");
      assert.deepEqual(
        ((automaticSave.artifacts as { upserts: Array<{ path: string }> }).upserts ?? []).map((entry) => entry.path),
        ["Main/MainCanvas.ui.json"],
      );
      assert.deepEqual(
        ((automaticSave.prototypes as Array<{ path: string }>) ?? []).map((entry) => entry.path),
        ["MainFlow.ui-prototype.json"],
      );
      assert.deepEqual(automaticSave.references, []);
      assert.deepEqual(automaticSave.nodeIdentityOperations, [
        {
          id: "node-identity-1",
          mappings: [{ ownerArtifactKey: "MainCanvas", beforeNodeId: "label", afterNodeId: "statusLabel" }],
        },
      ]);

      const manualRename = await renameSelected("statusLabel");
      await manualRename.getByLabel("GameObject 名称").fill("Result Label");
      await manualRename.getByRole("textbox", { name: "Node ID", exact: true }).fill("stableStatus");
      assert.equal(await manualRename.getByLabel("自动 Node ID").isChecked(), false);
      await manualRename.getByRole("button", { name: "重命名" }).click();
      await page.locator('[data-hierarchy-row][data-node-id="stableStatus"][data-selected="true"]').waitFor();
      await save("已保存 2 个文档");

      const manualRow = page.locator('[data-hierarchy-row][data-node-id="stableStatus"]');
      await manualRow.locator("[data-hierarchy-select]").dblclick();
      const manualNameOnly = manualRow.getByRole("textbox", { name: "重命名 Result Label" });
      await manualNameOnly.fill("Final Label");
      assert.equal(await manualRow.locator("[data-inline-node-id-preview]").innerText(), "stableStatus");
      await manualNameOnly.press("Enter");
      const manualNameSave = await save("已保存 1 个 Artifact");
      assert.equal(Object.hasOwn(manualNameSave, "nodeIdentityOperations"), false);

      const backToAuto = await renameSelected("stableStatus");
      await backToAuto.getByLabel("GameObject 名称").fill("Auto Label");
      await backToAuto.getByLabel("自动 Node ID").check();
      assert.equal(await backToAuto.getByRole("textbox", { name: "Node ID", exact: true }).inputValue(), "autoLabel");
      await backToAuto.getByRole("button", { name: "重命名" }).click();
      await page.locator('[data-hierarchy-row][data-node-id="autoLabel"][data-selected="true"]').waitFor();
      await save("已保存 2 个文档");

      const artifactPath = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Main", "MainCanvas.ui.json");
      const storedText = await readFile(artifactPath, "utf8");
      const stored = JSON.parse(storedText) as UiConcreteSource;
      assert.equal(stored.root.children?.[0]?.id, "autoLabel");
      assert.equal(stored.root.children?.[0]?.idMode, undefined);
      assert.equal(stored.root.children?.[0]?.name, "Auto Label");
      assert.doesNotMatch(storedText, /"idMode"\s*:/);
      const storedPrototype = JSON.parse(
        await readFile(join(workspaceRoot, "My project", "UIAuthoring", "Sources", "MainFlow.ui-prototype.json"), "utf8"),
      ) as UiPrototype;
      assert.equal(storedPrototype.interactions[0]?.trigger.target.nodeId, "autoLabel");
      const storedState = JSON.parse(
        await readFile(join(workspaceRoot, "My project", "UIAuthoring", "DeliveryState", "MainCanvas.ui-delivery-state.json"), "utf8"),
      ) as { nodes: Record<string, string> };
      assert.deepEqual(storedState.nodes, { autoLabel: "100" });
      assert.deepEqual(browserErrors, []);
    },
  );
});
