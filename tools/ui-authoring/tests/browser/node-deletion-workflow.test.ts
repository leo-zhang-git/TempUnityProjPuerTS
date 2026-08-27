import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createArtifactSource, createPrefabRefNode } from "../../src/kernel/authoring.js";
import { formatSource } from "../../src/kernel/canonical.js";
import { formatPrototype, formatReference } from "../../src/kernel/prototype-canonical.js";
import type { UiPrototype, UiReference } from "../../src/schema/ui-prototype-schema.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

const rect: UiNode["rect"] = {
  anchorMin: [0, 1],
  anchorMax: [0, 1],
  pivot: [0, 1],
  anchoredPosition: [0, 0],
  sizeDelta: [100, 40],
};

function documents(): {
  readonly panel: UiConcreteSource;
  readonly canvas: UiConcreteSource;
  readonly reference: UiReference;
  readonly prototype: UiPrototype;
} {
  const panel = createArtifactSource({ artifactKey: "BackpackPlayerPanel", artifactType: "Widget", initialSize: [698, 591] });
  panel.root.children = [
    {
      id: "inventoryScrollArea",
      rect,
      components: { Image: {}, ScrollRect: { content: "shanchu", viewport: "inventoryViewport" } },
      children: [
        {
          id: "inventoryViewport",
          rect,
          components: { Image: {}, RectMask2D: {} },
          children: [
            {
              id: "shanchu",
              rect,
              children: [
                { id: "itemGrid", rect },
                { id: "gunHeader", rect },
                { id: "gunSummary", rect, components: { Text: { text: "Summary", fontSize: 18 } } },
                { id: "gunGrid", rect },
              ],
            },
            { id: "inventoryContent", rect },
          ],
        },
      ],
    },
    { id: "safeTrigger", rect, components: { Image: {} } },
  ];
  panel.bindings = [
    { name: "go_container_sections", target: { nodeId: "shanchu", componentType: "GameObject" } },
    { name: "go_item_grid", target: { nodeId: "itemGrid", componentType: "GameObject" } },
    { name: "go_gun_header", target: { nodeId: "gunHeader", componentType: "GameObject" } },
    { name: "txt_gun_summary", target: { nodeId: "gunSummary", componentType: "Text" } },
    { name: "go_gun_grid", target: { nodeId: "gunGrid", componentType: "GameObject" } },
  ];

  const canvas = createArtifactSource({ artifactKey: "BackpackCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
  canvas.root.children = [createPrefabRefNode("playerPanel", panel.artifactKey, [698, 591])];
  const reference: UiReference = {
    referenceKey: "BackpackReview",
    subjectArtifactKey: panel.artifactKey,
    values: {
      go_container_sections: { active: false },
      txt_gun_summary: { text: "Preview summary" },
    },
  };
  const prototype: UiPrototype = {
    prototypeKey: "BackpackFlow",
    startReferenceKey: reference.referenceKey,
    interactions: [
      {
        referenceKey: reference.referenceKey,
        trigger: { kind: "Tap", target: { rootArtifactKey: panel.artifactKey, nodeId: "safeTrigger", componentType: "Image" } },
        actions: [{ kind: "SetValue", owner: { kind: "subject" }, fieldName: "go_container_sections", capability: "active", value: true }],
      },
    ],
  };
  return { panel, canvas, reference, prototype };
}

test("BackpackPlayerPanel deletion keeps its affected documents in one Save scope", async () => {
  const initial = documents();
  await withBrowserFixture(
    {
      name: "node-deletion-workflow",
      prepare: async (workspaceRoot) => {
        const directory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "BackpackGraph");
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "BackpackPlayerPanel.ui.json"), formatSource(initial.panel), "utf8");
        await writeFile(join(directory, "BackpackCanvas.ui.json"), formatSource(initial.canvas), "utf8");
        await writeFile(join(directory, "BackpackReview.ui-reference.json"), formatReference(initial.reference), "utf8");
        await writeFile(join(directory, "BackpackFlow.ui-prototype.json"), formatPrototype(initial.prototype), "utf8");
      },
    },
    async ({ workspaceRoot, page, server }) => {
      const saveBodies: Array<Record<string, unknown>> = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && request.url().endsWith("/api/workspace/save")) {
          saveBodies.push(request.postDataJSON() as Record<string, unknown>);
        }
      });
      const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "BackpackGraph");
      const panelPath = join(sourceDirectory, "BackpackPlayerPanel.ui.json");
      const referencePath = join(sourceDirectory, "BackpackReview.ui-reference.json");
      const prototypePath = join(sourceDirectory, "BackpackFlow.ui-prototype.json");
      const baseline = await readFile(panelPath, "utf8");

      await page.goto(`${server.url}?artifact=BackpackPlayerPanel`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      await page.locator('[data-hierarchy-row][data-node-id="shanchu"] [data-hierarchy-select]').click();
      await page.getByTitle("删除选中节点").click();

      const deletion = page.getByRole("dialog", { name: "删除节点" });
      const impacts = deletion.getByRole("list", { name: "删除影响" });
      await impacts.waitFor();
      for (const binding of ["go_container_sections", "go_item_grid", "go_gun_header", "txt_gun_summary", "go_gun_grid"]) {
        await impacts.getByText(`删除指向待删除节点的 Binder '${binding}'`, { exact: true }).waitFor();
      }
      await impacts
        .locator('[data-impact-action="repair"]')
        .getByText(/ScrollRect\.content/)
        .waitFor();
      await deletion.getByRole("button", { name: "继续" }).click();
      await deletion.getByRole("button", { name: "删除并清理" }).click();
      assert.equal(await page.locator('[data-hierarchy-row][data-node-id="shanchu"]').count(), 0);
      await page.locator('[data-hierarchy-row][data-node-id="inventoryScrollArea"] [data-hierarchy-error]').waitFor();

      await page.getByTitle("保存", { exact: true }).click();
      const saveFailure = page.getByRole("alertdialog", { name: "保存未完成" });
      await saveFailure.waitFor();
      await saveFailure.getByText(/已保存 0 个/).waitFor();
      assert.deepEqual(
        ((saveBodies[0]?.references as readonly { readonly reference: UiReference }[] | undefined) ?? []).map(
          (entry) => entry.reference.referenceKey,
        ),
        ["BackpackReview"],
      );
      assert.deepEqual(
        ((saveBodies[0]?.prototypes as readonly { readonly prototype: UiPrototype }[] | undefined) ?? []).map(
          (entry) => entry.prototype.prototypeKey,
        ),
        ["BackpackFlow"],
      );
      assert.equal(await readFile(panelPath, "utf8"), baseline);
      await saveFailure.getByRole("button", { name: "确认" }).click();

      await page.getByTitle("撤销", { exact: true }).click();
      await page.locator('[data-hierarchy-row][data-node-id="shanchu"] [data-hierarchy-select]').waitFor();
      assert.equal(await page.getByTitle("保存", { exact: true }).isDisabled(), true);
      await page.getByTitle("重做", { exact: true }).click();
      assert.equal(await page.locator('[data-hierarchy-row][data-node-id="shanchu"]').count(), 0);

      await page.locator('[data-hierarchy-row][data-node-id="inventoryScrollArea"] [data-hierarchy-select]').click();
      const scrollRect = page
        .locator("[data-ui~=component-section]")
        .filter({ has: page.getByRole("heading", { name: "Scroll Rect", exact: true }) });
      const content = scrollRect.locator("[data-ui~=component-field]").filter({ has: page.getByText("Content", { exact: true }) });
      await content.getByRole("combobox", { name: "节点引用" }).click();
      await page.getByRole("option", { name: "InventoryContent (inventoryContent)", exact: true }).click();
      await page.locator('[data-hierarchy-row][data-node-id="inventoryScrollArea"] [data-hierarchy-error]').waitFor({ state: "detached" });
      const saveResponse = page.waitForResponse(
        (response) => response.request().method() === "POST" && response.url().endsWith("/api/workspace/save"),
      );
      await page.getByTitle("保存", { exact: true }).click();
      const response = await saveResponse;
      const requestBody = response.request().postDataJSON() as {
        readonly references?: readonly { readonly reference: UiReference }[];
        readonly prototypes?: readonly { readonly prototype: UiPrototype }[];
      };
      assert.deepEqual(
        requestBody.references?.map((entry) => entry.reference.referenceKey),
        ["BackpackReview"],
      );
      assert.deepEqual(
        requestBody.prototypes?.map((entry) => entry.prototype.prototypeKey),
        ["BackpackFlow"],
      );
      const saveResult = (await response.json()) as { readonly writtenDocumentIds?: readonly string[] };
      assert.ok(Array.isArray(saveResult.writtenDocumentIds), JSON.stringify(saveResult));
      assert.deepEqual([...saveResult.writtenDocumentIds].sort(), [
        "artifact:BackpackPlayerPanel",
        "prototype:BackpackFlow",
        "reference:BackpackReview",
      ]);

      const savedPanel = JSON.parse(await readFile(panelPath, "utf8")) as UiConcreteSource;
      const savedReference = JSON.parse(await readFile(referencePath, "utf8")) as UiReference;
      const savedPrototype = JSON.parse(await readFile(prototypePath, "utf8")) as UiPrototype;
      assert.equal(
        savedPanel.root.children?.[0]?.children?.[0]?.children?.some((node) => node.id === "shanchu"),
        false,
      );
      assert.equal(savedPanel.root.children?.[0]?.components?.ScrollRect?.content, "inventoryContent");
      assert.deepEqual(savedPanel.bindings, undefined);
      assert.deepEqual(savedReference.values, undefined);
      assert.deepEqual(savedPrototype.interactions, []);
    },
  );
});
