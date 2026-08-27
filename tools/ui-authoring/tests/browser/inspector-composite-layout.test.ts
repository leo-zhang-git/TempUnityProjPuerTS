import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const spriteMeta =
  "guid: 00000000000000000000000000000012\ntextureType: 8\nspriteMode: 1\nspritePixelsToUnits: 100\nspriteBorder: {x: 0, y: 0, z: 0, w: 0}\n";

function rect(size: readonly [number, number]): UiNode["rect"] {
  return { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [...size] };
}

test("Artifact Inspector edits StateRoot and resolves renamed targets across composite controls", async () => {
  const template: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "InspectorTemplate",
    artifactType: "Widget",
    widgetType: "InspectorTemplate",
    initialSize: [32, 32],
    root: { id: "InspectorTemplate", rect: rect([32, 32]), components: { Image: { color: "#36CC9BFF" } } },
  };
  const source: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "InspectorWidget",
    artifactType: "Widget",
    widgetType: "InspectorWidget",
    initialSize: [240, 180],
    root: {
      id: "InspectorWidget",
      rect: rect([240, 180]),
      children: [
        {
          id: "stateRoot",
          rect: rect([200, 160]),
          components: {
            Crosshair: {
              edges: [{ target: "targetGraphic", direction: [1, 0] }],
            },
            StateRoot: {
              currentState: "filled",
              states: {
                dragGhost: { targetGraphic: false, targetLabel: false },
                filled: { targetGraphic: true, targetLabel: false },
              },
              elements: [
                { targetNodeId: "targetGraphic", elementType: "UColor", values: { dragGhost: "#FFFFFFFF", filled: "#36CC9BFF" } },
                {
                  targetNodeId: "targetGraphic",
                  elementType: "USprite",
                  values: {
                    dragGhost: { sprite: null, setNativeSize: false },
                    filled: { sprite: "Generated/Shapes/Round12.png", setNativeSize: true },
                  },
                },
                { targetNodeId: "targetLabel", elementType: "UTMP_Text", values: { dragGhost: "Ghost", filled: "Filled" } },
                {
                  targetNodeId: "targetGroup",
                  elementType: "CanvasGroup",
                  values: {
                    dragGhost: { alpha: 0.35, blocksRaycasts: false },
                    filled: { alpha: 0.8, blocksRaycasts: true },
                  },
                },
              ],
            },
          },
          children: [
            { id: "targetGraphic", rect: rect([80, 40]), components: { Image: { color: "#36CC9BFF", raycastPadding: [1, 2, 3, 4] } } },
            { id: "targetLabel", rect: rect([80, 24]), components: { Text: { text: "Filled", fontSize: 16 } } },
            { id: "targetGroup", rect: rect([80, 40]), components: { CanvasGroup: { alpha: 0.8, blocksRaycasts: true } } },
            { id: "templateRef", rect: rect([32, 32]), components: { PrefabRef: { artifactKey: "InspectorTemplate" } } },
          ],
        },
      ],
    },
  };

  await withBrowserFixture(
    {
      name: "inspector-layout",
      viewport: { width: 1366, height: 900 },
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "InspectorLayout");
        await mkdir(sourceDirectory, { recursive: true });
        const targetSpriteDirectory = join(workspaceRoot, "My project", "Assets", "Resources", "UI", "Generated", "Shapes");
        await mkdir(targetSpriteDirectory, { recursive: true });
        await writeFile(join(targetSpriteDirectory, "Round12.png"), png);
        await writeFile(join(targetSpriteDirectory, "Round12.png.meta"), spriteMeta, "utf8");
        await writeFile(join(sourceDirectory, "InspectorTemplate.ui.json"), formatSource(template), "utf8");
        await writeFile(join(sourceDirectory, "InspectorWidget.ui.json"), formatSource(source), "utf8");
      },
    },
    async ({ page, server }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });

      await page.goto(`${server.url}?artifact=InspectorWidget`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      await page.locator('[data-hierarchy-row][data-node-id="targetGraphic"] button[data-hierarchy-select]').click();
      await page.getByTitle("重命名节点").click();
      const rename = page.getByRole("dialog", { name: "重命名节点" });
      await rename.getByLabel("GameObject 名称").fill("Panel");
      await rename.getByRole("button", { name: "重命名" }).click();
      const renamedNode = page.locator('[data-hierarchy-row][data-node-id="panel"] [data-hierarchy-select] > span');
      await renamedNode.filter({ hasText: "Panel" }).waitFor();
      assert.equal(await renamedNode.innerText(), "Panel");
      await page.locator('[data-hierarchy-row][data-node-id="stateRoot"] button[data-hierarchy-select]').click();
      const stateSection = page
        .locator("[data-ui~=component-section]")
        .filter({ has: page.getByRole("heading", { name: "State Root", exact: true }) });
      assert.deepEqual(await stateSection.locator('[data-ui-select][data-select-value="panel"]').allTextContents(), [
        "Panel (panel)",
        "Panel (panel)",
        "Panel (panel)",
      ]);
      await stateSection.getByLabel("公共元素目标").click();
      assert.equal(await page.locator('[role="option"][data-select-value="panel"]').innerText(), "Panel (panel)（已添加）");
      await stateSection.getByLabel("公共元素目标").click();
      assert.equal(await stateSection.getByLabel("当前状态").innerText(), "1 (filled)");
      assert.equal(await stateSection.locator('[data-state-name="filled"]').count(), 1);
      await stateSection.getByLabel("公共元素类型").click();
      assert.deepEqual(
        await page
          .locator('[role="option"][data-select-value]')
          .evaluateAll((options) => options.map((option) => option.getAttribute("data-select-value"))),
        [
          "Active",
          "ULocalPos",
          "UPivot",
          "UAnchorsMin",
          "UAnchorsMax",
          "ULocalPosX",
          "ULocalPosY",
          "UWidth",
          "UHeight",
          "UTMP_Text",
          "UTMP_FontSize",
          "USprite",
          "UColor",
          "UAlpha",
          "UGray",
          "UInteractable",
          "URaycastTarget",
          "CanvasGroup",
          "ULocalScale",
          "LocalRotation",
          "UTMP_Font",
        ],
      );
      await page.locator('[role="option"][data-select-value="UWidth"]').click();
      await stateSection.getByLabel("公共元素目标").click();
      await page.locator('[role="option"][data-select-value="panel"]').click();
      await stateSection.getByRole("button", { name: "增加公共元素", exact: true }).click();
      await stateSection.getByTitle("展开状态 filled").click();
      assert.equal(await stateSection.getByLabel("状态1名称").inputValue(), "filled");
      assert.equal(await stateSection.locator('[data-state-name="filled"] [title="Panel (panel) · Active"]').innerText(), "Panel");
      const filledWidthValue = stateSection
        .locator('[data-state-name="filled"] [data-ui~=state-root-value-row]')
        .filter({ has: page.locator('[title="Panel (panel) · UWidth"]') })
        .locator("input");
      assert.equal(await filledWidthValue.inputValue(), "80");
      const filledCanvasGroup = stateSection
        .locator('[data-state-name="filled"] [data-ui~=state-root-value-row]')
        .filter({ has: page.locator('[title="TargetGroup (targetGroup) · CanvasGroup"]') });
      const filledAlpha = filledCanvasGroup.getByLabel("TargetGroup (targetGroup) · filled Alpha");
      const filledBlocksRaycasts = filledCanvasGroup.getByLabel("TargetGroup (targetGroup) · filled Blocks Raycasts");
      assert.equal(await filledAlpha.inputValue(), "0.8");
      assert.equal(await filledBlocksRaycasts.isChecked(), true);
      await filledAlpha.fill("0.7");
      await filledAlpha.press("Tab");
      await filledBlocksRaycasts.click();

      const stateAddButton = stateSection.getByRole("button", { name: "增加状态", exact: true });
      await stateAddButton.click();
      assert.equal(await stateSection.getByLabel("当前状态").innerText(), "1 (filled)");
      assert.equal(await stateSection.locator('[data-state-name="name_2"]').count(), 1);
      await stateSection.getByTitle("展开状态 name_2").click();
      assert.equal(await stateSection.getByLabel("状态2名称").inputValue(), "name_2");
      const defaultTextValue = stateSection
        .locator('[data-state-name="name_2"] [data-ui~=state-root-value-row]')
        .filter({ has: page.locator('[title="TargetLabel (targetLabel) · UTMP_Text"]') })
        .locator("input");
      assert.equal(await defaultTextValue.inputValue(), "");
      const defaultWidthValue = stateSection
        .locator('[data-state-name="name_2"] [data-ui~=state-root-value-row]')
        .filter({ has: page.locator('[title="Panel (panel) · UWidth"]') })
        .locator("input");
      assert.equal(await defaultWidthValue.inputValue(), "0");
      const defaultSpriteValue = stateSection
        .locator('[data-state-name="name_2"] [data-ui~=state-root-value-row]')
        .filter({ has: page.locator('[title="Panel (panel) · USprite"]') });
      assert.match(await defaultSpriteValue.innerText(), /无/);
      const filledSpriteValue = stateSection
        .locator('[data-state-name="filled"] [data-ui~=state-root-value-row]')
        .filter({ has: page.locator('[title="Panel (panel) · USprite"]') });
      await filledSpriteValue.getByTitle("Generated/Shapes/Round12.png").click();
      assert.equal(await page.getByRole("dialog", { name: "Panel (panel) · filled" }).count(), 1);
      await page.getByTitle("关闭", { exact: true }).click();
      await filledSpriteValue.getByTitle("清除").click();
      assert.match(await filledSpriteValue.innerText(), /无/);
      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("已保存 1 个 Artifact", { exact: true }).waitFor();
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      await page.locator('[data-hierarchy-row][data-node-id="stateRoot"] button[data-hierarchy-select]').click();
      const reloadedStateSection = page
        .locator("[data-ui~=component-section]")
        .filter({ has: page.getByRole("heading", { name: "State Root", exact: true }) });
      const reloadedFilled = reloadedStateSection.locator('[data-state-name="filled"]');
      const expandReloadedFilled = reloadedStateSection.getByTitle("展开状态 filled");
      if ((await expandReloadedFilled.count()) > 0) await expandReloadedFilled.click();
      await reloadedFilled.locator("[data-ui~=state-root-value-row]").first().waitFor();
      assert.equal(
        await reloadedFilled
          .locator("[data-ui~=state-root-value-row]")
          .filter({ has: page.locator('[title="Panel (panel) · UWidth"]') })
          .locator("input")
          .inputValue(),
        "80",
      );
      assert.match(
        await reloadedFilled
          .locator("[data-ui~=state-root-value-row]")
          .filter({ has: page.locator('[title="Panel (panel) · USprite"]') })
          .innerText(),
        /无/,
      );
      const reloadedCanvasGroup = reloadedFilled
        .locator("[data-ui~=state-root-value-row]")
        .filter({ has: page.locator('[title="TargetGroup (targetGroup) · CanvasGroup"]') });
      assert.equal(await reloadedCanvasGroup.getByLabel("TargetGroup (targetGroup) · filled Alpha").inputValue(), "0.7");
      assert.equal(await reloadedCanvasGroup.getByLabel("TargetGroup (targetGroup) · filled Blocks Raycasts").isChecked(), false);
      await reloadedStateSection.getByTitle("展开状态 name_2").click();
      assert.equal(
        await reloadedStateSection
          .locator('[data-state-name="name_2"] [data-ui~=state-root-value-row]')
          .filter({ has: page.locator('[title="Panel (panel) · UWidth"]') })
          .locator("input")
          .inputValue(),
        "0",
      );
      await page.locator('[data-hierarchy-row][data-node-id="panel"] button[data-hierarchy-select]').click();
      const imageSection = page
        .locator("[data-ui~=component-section]")
        .filter({ has: page.getByRole("heading", { name: "Image", exact: true }) });
      assert.equal(await imageSection.locator("[data-ui~=number-field] input").count(), 4);
      assert.equal(await imageSection.getByLabel("RGB (RRGGBB)").inputValue(), "36CC9B");

      await page.locator('[data-hierarchy-row][data-node-id="templateRef"] button[data-hierarchy-select]').click();
      const artifactReference = page.locator("[data-ui~=artifact-reference-field]");
      assert.equal(await artifactReference.locator("input").inputValue(), "InspectorTemplate");
      assert.deepEqual(errors, []);
    },
  );
});
