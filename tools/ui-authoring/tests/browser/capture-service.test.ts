import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { createArtifactSource } from "../../src/kernel/authoring.js";
import { formatSource } from "../../src/kernel/canonical.js";
import { formatReference } from "../../src/kernel/prototype-canonical.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

test("Capture reuses the suite browser and resolves the session workspace", async () => {
  await withBrowserFixture(
    {
      name: "capture-service",
      async prepare(workspaceRoot) {
        const sourceRoot = join(workspaceRoot, "My project", "UIAuthoring", "Sources");
        const source = createArtifactSource({ artifactKey: "CaptureCanvas", artifactType: "Canvas", initialSize: [320, 180] });
        await writeFile(join(sourceRoot, "CaptureCanvas.ui.json"), formatSource(source), "utf8");
        const stateRect: UiConcreteSource["root"]["rect"] = {
          anchorMin: [0, 1],
          anchorMax: [0, 1],
          pivot: [0, 1],
          anchoredPosition: [0, 0],
          sizeDelta: [200, 40],
        };
        const stateSource: UiConcreteSource = {
          sourceKind: "artifact",
          artifactKey: "CaptureStateWidget",
          artifactType: "Widget",
          widgetType: "CaptureStateWidget",
          initialSize: [200, 40],
          bindings: [{ name: "viewState", target: { nodeId: "stateRoot", componentType: "StateRoot" } }],
          root: {
            id: "CaptureStateWidget",
            rect: stateRect,
            children: [
              {
                id: "stateRoot",
                rect: stateRect,
                components: {
                  StateRoot: { currentState: "a", states: { a: { labelA: true, labelB: false }, b: { labelA: false, labelB: true } } },
                },
                children: [
                  {
                    id: "labelA",
                    rect: stateRect,
                    components: { Image: { color: "#FF0000FF" }, Text: { text: "STATE A", fontSize: 16 } },
                  },
                  {
                    id: "labelB",
                    active: false,
                    rect: stateRect,
                    components: { Image: { color: "#00FF00FF" }, Text: { text: "STATE B", fontSize: 16 } },
                  },
                ],
              },
            ],
          },
        };
        await writeFile(join(sourceRoot, "CaptureStateWidget.ui.json"), formatSource(stateSource), "utf8");
        await writeFile(
          join(sourceRoot, "CaptureStateWidget.ui-reference.json"),
          formatReference({
            referenceKey: "CaptureStateWidget",
            subjectArtifactKey: "CaptureStateWidget",
            viewport: [200, 40],
            values: { viewState: { state: "a" } },
          }),
          "utf8",
        );
      },
    },
    async ({ fetchApi, workspaceRoot }) => {
      const response = await fetchApi("/api/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "CaptureCanvas.ui.json", viewport: [320, 180] }),
      });
      const body = (await response.json()) as {
        readonly manifest?: { readonly document: { readonly key: string }; readonly output: string };
        readonly error?: string;
      };
      assert.equal(response.status, 200, body.error);
      assert.equal(body.manifest?.document.key, "CaptureCanvas");
      const png = await readFile(join(workspaceRoot, body.manifest!.output));
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

      const captureState = async (state: "a" | "b") => {
        const stateResponse = await fetchApi("/api/capture", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            path: "CaptureStateWidget.ui-reference.json",
            viewport: [200, 40],
            preview: { states: { stateRoot: state } },
          }),
        });
        const stateBody = (await stateResponse.json()) as typeof body;
        assert.equal(stateResponse.status, 200, stateBody.error);
        return PNG.sync.read(await readFile(join(workspaceRoot, stateBody.manifest!.output)));
      };
      const stateA = await captureState("a");
      const stateB = await captureState("b");
      const changedPixels = pixelmatch(stateA.data, stateB.data, undefined, stateA.width, stateA.height, { threshold: 0.1 });
      assert.ok(changedPixels > 0, "Capture preview state must change the rendered Reference pixels");
    },
  );
});
