import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import { formatReference } from "../../src/kernel/prototype-canonical.js";
import type { UiReference } from "../../src/schema/ui-prototype-schema.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

const rect: UiNode["rect"] = {
  anchorMin: [0.5, 0.5],
  anchorMax: [0.5, 0.5],
  pivot: [0.5, 0.5],
  anchoredPosition: [0, 0],
  sizeDelta: [160, 48],
};

function baseCanvas(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "BaseCanvas",
    artifactType: "Canvas",
    bindings: [{ name: "mountPoint", target: { nodeId: "mountPoint", componentType: "GameObject" } }],
    root: {
      id: "BaseCanvas",
      rect,
      children: [{ id: "mountPoint", rect }],
    },
  };
}

function mountedWidget(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "MountedWidget",
    artifactType: "Widget",
    widgetType: "MountedWidget",
    initialSize: [180, 64],
    bindings: [
      { name: "label", target: { nodeId: "label", componentType: "Text" } },
      { name: "mountPoint", target: { nodeId: "mountPoint", componentType: "GameObject" } },
    ],
    root: {
      id: "MountedWidget",
      rect,
      children: [
        { id: "label", rect, components: { Text: { text: "Mounted" } } },
        { id: "mountPoint", rect },
      ],
    },
  };
}

test("Reference mounts can be added, targeted, and saved manually", async () => {
  await withBrowserFixture(
    {
      name: "reference-mount-authoring",
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "ManualPaths");
        await mkdir(sourceDirectory, { recursive: true });
        const reference: UiReference = {
          referenceKey: "MountReference",
          subjectArtifactKey: "BaseCanvas",
          mounts: [{ key: "outerMount", targetBinding: "mountPoint", artifactKey: "MountedWidget" }],
        };
        await writeFile(join(sourceDirectory, "BaseCanvas.ui.json"), formatSource(baseCanvas()), "utf8");
        await writeFile(join(sourceDirectory, "MountedWidget.ui.json"), formatSource(mountedWidget()), "utf8");
        await writeFile(join(sourceDirectory, "MountReference.ui-reference.json"), formatReference(reference), "utf8");
      },
    },
    async ({ workspaceRoot, page, server }) => {
      const referencePath = join(
        workspaceRoot,
        "My project",
        "UIAuthoring",
        "Sources",
        "ManualPaths",
        "MountReference.ui-reference.json",
      );
      await page.goto(`${server.url}?reference=MountReference`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "编辑预览", exact: true }).click();
      await page.locator('[data-reference-mount="outerMount"]').waitFor();

      await page.getByTitle("添加挂载").click();
      const createdMount = page.locator('[data-reference-mount="mount"]');
      await createdMount.waitFor();
      const mount = createdMount;
      await mount.getByText("text", { exact: true }).locator("..").getByRole("textbox").fill("Review mounted content");
      await mount.getByLabel("目标").click();
      await page.getByRole("option", { name: "mountPoint", exact: true }).click();

      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("当前文档已保存", { exact: true }).waitFor();
      const stored = JSON.parse(await readFile(referencePath, "utf8")) as UiReference;
      const savedMount = stored.mounts?.find((entry) => entry.key === "mount");
      assert.equal(savedMount?.artifactKey, "MountedWidget");
      assert.equal(savedMount?.targetBinding, "mountPoint");
      assert.equal(savedMount?.values?.label?.text, "Review mounted content");
    },
  );
});
