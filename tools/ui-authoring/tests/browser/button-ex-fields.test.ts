import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function rect(width: number, height: number) {
  return {
    anchorMin: [0.5, 0.5] as [number, number],
    anchorMax: [0.5, 0.5] as [number, number],
    pivot: [0.5, 0.5] as [number, number],
    anchoredPosition: [0, 0] as [number, number],
    sizeDelta: [width, height] as [number, number],
  };
}

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "ButtonFieldWidget",
    artifactType: "Widget",
    widgetType: "ButtonFieldWidget",
    initialSize: [640, 480],
    root: {
      id: "ButtonFieldWidget",
      rect: rect(640, 480),
      components: {
        Image: { raycastTarget: true },
        ButtonEx: { targetGraphic: "ButtonFieldWidget" },
      },
      children: [
        { id: "scaleTarget", rect: rect(280, 60) },
        { id: "activeTarget", active: false, rect: rect(24, 24) },
      ],
    },
  };
}

test("ButtonEx Inspector edits conditional feedback fields and clears optional targets", async () => {
  await withBrowserFixture(
    {
      name: "button-ex-fields",
      async prepare(workspaceRoot) {
        await writeFile(
          join(workspaceRoot, "My project", "UIAuthoring", "Sources", "ButtonFieldWidget.ui.json"),
          formatSource(source()),
          "utf8",
        );
      },
    },
    async ({ workspaceRoot, page, server }) => {
      const sourcePath = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "ButtonFieldWidget.ui.json");
      await page.goto(`${server.url}?artifact=ButtonFieldWidget`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      const field = (label: string) => page.locator("[data-ui~=component-field]").filter({ has: page.getByText(label, { exact: true }) });

      const statePolicyReason = "项目内禁用：按钮可用性由 StateRoot 的 UGray 与 UInteractable 控制";
      const stylePolicyReason = "项目内禁用：每种按钮视觉样式使用独立 Prefab";
      assert.equal(await field("Interactable").getByRole("checkbox").isDisabled(), true);
      assert.equal(await field("Transition").getByRole("combobox").isDisabled(), true);
      assert.equal(await field("Disabled Sprite").locator("fieldset").getAttribute("title"), statePolicyReason);
      assert.equal(await field("Transition").locator("fieldset").getAttribute("title"), stylePolicyReason);

      assert.equal(await field("Press Feedback Scale").count(), 0);
      await field("Use Press Feedback").getByRole("checkbox").check();
      await field("Press Feedback Scale").getByRole("spinbutton").fill("0.88");
      const selectTarget = async (label: string, option: string): Promise<void> => {
        await field(label).getByRole("combobox", { name: "节点引用" }).click();
        await page.getByRole("option", { name: option, exact: true }).click();
      };
      await selectTarget("Press Feedback Scale Target", "ScaleTarget (scaleTarget)");
      await selectTarget("Press Feedback Scale Target", "未选择");
      await selectTarget("Press Feedback Active Target", "ActiveTarget (activeTarget)");

      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("已保存 1 个 Artifact").waitFor();
      const stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
      const button = stored.root.components?.ButtonEx;
      assert.equal(button?.transition, undefined);
      assert.equal(button?.disabledSprite, undefined);
      assert.equal(button?.usePressFeedback, true);
      assert.equal(button?.pressFeedbackScale, 0.88);
      assert.equal(button?.pressFeedbackScaleTarget, undefined);
      assert.equal(button?.pressFeedbackActiveTarget, "activeTarget");
    },
  );
});
