import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import { formatReference } from "../../src/kernel/prototype-canonical.js";
import type { UiReference } from "../../src/schema/ui-prototype-schema.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "InteractionHintWidget",
    artifactType: "Widget",
    widgetType: "InteractionHintWidget",
    initialSize: [236, 46],
    bindings: [{ name: "prompt", target: { nodeId: "promptText", componentType: "Text" } }],
    root: {
      id: "InteractionHintWidget",
      rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [236, 46] },
      children: [
        {
          id: "promptText",
          rect: { anchorMin: [0, 0.5], anchorMax: [0, 0.5], pivot: [0.5, 0.5], anchoredPosition: [137.778, 0], sizeDelta: [185.556, 26] },
          components: { Text: { text: "", font: "Font/alipuhui SDF.asset", fontSize: 20, alignment: "left", overflow: "ellipsis" } },
        },
      ],
    },
  };
}

function dynamicSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "DynamicDetailWidget",
    artifactType: "Widget",
    widgetType: "DynamicDetailWidget",
    initialSize: [236, 46],
    bindings: [{ name: "description", target: { nodeId: "descriptionText", componentType: "Text" } }],
    root: {
      id: "DynamicDetailWidget",
      rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [236, 46] },
      components: {
        ContentSizeFitter: { verticalFit: "preferredSize" },
        VerticalLayoutGroup: { childForceExpandHeight: false },
      },
      children: [
        {
          id: "scroll",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0.5, 0.5], anchoredPosition: [118, -23], sizeDelta: [236, 46] },
          components: {
            LayoutElement: { minHeight: 32, preferredWidth: 236 },
            ScrollRectEx: { content: "content", viewport: "viewport", templates: {} },
          },
          children: [
            {
              id: "viewport",
              rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
              children: [
                {
                  id: "content",
                  rect: { anchorMin: [0, 1], anchorMax: [1, 1], pivot: [0.5, 1], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
                  components: {
                    ContentSizeFitter: { verticalFit: "preferredSize" },
                    VerticalLayoutGroup: { padding: [8, 8, 8, 8], childForceExpandHeight: false },
                  },
                  children: [
                    {
                      id: "descriptionText",
                      rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0.5, 0.5], anchoredPosition: [110, 0], sizeDelta: [204, 0] },
                      components: {
                        LayoutElement: {},
                        Text: { text: "", font: "Font/alipuhui SDF.asset", fontSize: 20, alignment: "left", wordWrapping: true },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function reference(referenceKey = "InteractionHintReference", viewport?: readonly [number, number]): UiReference {
  return {
    referenceKey,
    subjectArtifactKey: "InteractionHintWidget",
    ...(viewport ? { viewport: [...viewport] } : {}),
    values: { prompt: { text: "开启终端" } },
  };
}

function dynamicReference(referenceKey = "DynamicDetailReference", viewport?: readonly [number, number]): UiReference {
  return {
    referenceKey,
    subjectArtifactKey: "DynamicDetailWidget",
    ...(viewport ? { viewport: [...viewport] } : {}),
    values: {
      description: { text: "这是一段会自动换行的物品说明文本，用来验证预览内容高度能够穿过 ScrollRect content 继续扩大 Widget 底板。" },
    },
  };
}

test("Reference derives its viewport mode from the root Artifact and preserves text editing", async () => {
  let referencePath = "";
  await withBrowserFixture(
    {
      name: "reference-viewport",
      viewport: { width: 1200, height: 700 },
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "ReferenceViewport");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(join(sourceDirectory, "InteractionHintWidget.ui.json"), formatSource(source()), "utf8");
        await writeFile(join(sourceDirectory, "DynamicDetailWidget.ui.json"), formatSource(dynamicSource()), "utf8");
        referencePath = join(sourceDirectory, "InteractionHintReference.ui-reference.json");
        await writeFile(referencePath, formatReference(reference()), "utf8");
        await writeFile(
          join(sourceDirectory, "InteractionHintTallReference.ui-reference.json"),
          formatReference(reference("InteractionHintTallReference", [236, 120])),
          "utf8",
        );
        await writeFile(join(sourceDirectory, "DynamicDetailReference.ui-reference.json"), formatReference(dynamicReference()), "utf8");
        await writeFile(
          join(sourceDirectory, "DynamicDetailFixedReference.ui-reference.json"),
          formatReference(dynamicReference("DynamicDetailFixedReference", [236, 60])),
          "utf8",
        );
      },
    },
    async ({ page, server }) => {
      const browserErrors: string[] = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") browserErrors.push(message.text());
      });

      await page.goto(`${server.url}?reference=InteractionHintReference`, { waitUntil: "networkidle" });
      const canvas = page.locator(".ui-rendering__prototype-canvas");
      const text = canvas.locator(".ui-rendering__canvas-text");
      await canvas.waitFor();
      assert.equal(await text.innerText(), "开启终端");

      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "编辑预览" }).click();
      const promptValues = page.locator('[data-reference-values-scope="主体值"][data-reference-values-field="prompt"]');
      await promptValues.getByRole("textbox", { name: "text", exact: true }).fill("启动控制台");
      await page.locator(".ui-rendering__canvas-text").filter({ hasText: "启动控制台" }).waitFor();
      await page.getByTitle("添加挂载").click();
      await page.locator('[data-reference-mount="mount"]').waitFor();
      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("当前文档已保存", { exact: true }).waitFor();
      const storedReference = JSON.parse(await readFile(referencePath, "utf8")) as UiReference;
      assert.equal(storedReference.values?.prompt?.text, "启动控制台");
      assert.equal(storedReference.mounts?.[0]?.artifactKey, "DynamicDetailWidget");

      await page.goto(`${server.url}?reference=InteractionHintTallReference`, { waitUntil: "networkidle" });
      const tallCanvas = page.locator(".ui-rendering__prototype-canvas");
      const tallText = tallCanvas.locator(".ui-rendering__canvas-text");
      await tallCanvas.waitFor();
      assert.equal(await tallText.innerText(), "开启终端");

      await page.goto(`${server.url}?reference=DynamicDetailReference`, { waitUntil: "networkidle" });
      const dynamicCanvas = page.locator(".ui-rendering__prototype-canvas");
      await dynamicCanvas.locator(".ui-rendering__prototype-artifact-layer").first().waitFor();
      assert.equal(await dynamicCanvas.getAttribute("data-reference-viewport"), "auto");

      await page.goto(`${server.url}?reference=DynamicDetailFixedReference`, { waitUntil: "networkidle" });
      const fixedCanvas = page.locator(".ui-rendering__prototype-canvas");
      const fixedLayer = fixedCanvas.locator(".ui-rendering__prototype-artifact-layer").first();
      await fixedLayer.waitFor();
      assert.equal(await fixedCanvas.getAttribute("data-reference-viewport"), "fixed");
      assert.deepEqual(browserErrors, []);
    },
  );
});
