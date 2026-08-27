import assert from "node:assert/strict";
import test from "node:test";
import type { Browser } from "playwright";
import { inspectArtifactDocument, inspectReferenceDocument } from "../../src/kernel/document-inspection.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import type { CaptureSession } from "../../src/schema/ui-capture.js";
import type { UiReference } from "../../src/schema/ui-prototype-schema.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import {
  CaptureService,
  capturePageUrl,
  createCaptureManifest,
  defaultCaptureViewport,
  referenceCaptureViewport,
} from "../../src/server/capture-service.js";
import { captureIntrinsicSources } from "../../src/web/capture/capture-page.js";
import { defaultPreviewCaptureTarget } from "../../src/web/editors/artifact/artifact-editor-context-preview.js";
import { captureOverlays } from "../../src/web/editors/artifact/artifact-editor-controller.js";
import type { ArtifactDocument, ReferenceDocument } from "../../src/web/shared/types.js";

function rect(): UiNode["rect"] {
  return { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [100, 40] };
}

function source(artifactKey: string, artifactType: "Canvas" | "Widget", children: UiNode[]): UiConcreteSource {
  const root = { id: artifactKey, rect: rect(), children };
  return artifactType === "Canvas"
    ? {
        sourceKind: "artifact",
        artifactKey,
        artifactType: "Canvas",
        root,
      }
    : {
        sourceKind: "artifact",
        artifactKey,
        artifactType: "Widget",
        widgetType: artifactKey,
        initialSize: [320, 180],
        root,
      };
}

test("capture manifest omits default fields", () => {
  const manifest = createCaptureManifest(
    { kind: "Artifact", key: "MainCanvas", path: "MainCanvas.ui.json" },
    "tools/ui-authoring/.runtime/captures/MainCanvas.png",
    [1280, 720],
    {
      path: "MainCanvas.ui.json",
      scale: 1,
      background: "transparent",
      draft: false,
      preview: { states: {}, inputs: {} },
    },
  );
  assert.deepEqual(manifest, {
    document: { kind: "Artifact", key: "MainCanvas", path: "MainCanvas.ui.json" },
    output: "tools/ui-authoring/.runtime/captures/MainCanvas.png",
    viewport: [1280, 720],
  });
});

test("capture manifest retains only non-default capture context", () => {
  const manifest = createCaptureManifest(
    { kind: "Reference", key: "MainReference", path: "MainReference.ui-reference.json" },
    "tools/ui-authoring/.runtime/captures/MainReference.png",
    [640, 360],
    {
      path: "MainReference.ui-reference.json",
      scale: 2,
      background: "#202624FF",
      draft: true,
      clip: { nodeId: "label", instancePath: ["panel"] },
      preview: { states: { "MainCanvas/panel/stateRoot": "ready" } },
    },
  );
  assert.equal(manifest.scale, 2);
  assert.equal(manifest.draft, true);
  assert.equal(manifest.background, "#202624FF");
  assert.deepEqual(manifest.clip, { nodeId: "label", instancePath: ["panel"] });
  assert.deepEqual(manifest.preview, { states: { "MainCanvas/panel/stateRoot": "ready" } });
});

test("capture manifest records Unity Baseline display mode", () => {
  const manifest = createCaptureManifest(
    { kind: "Artifact", key: "MainCanvas", path: "MainCanvas.ui.json" },
    "tools/ui-authoring/.runtime/captures/MainCanvas-baseline.png",
    [1280, 720],
    { path: "MainCanvas.ui.json", displayMode: "unityBaseline" },
  );
  assert.equal(manifest.displayMode, "unityBaseline");
});

test("rounds fractional Artifact initial sizes up for browser capture", () => {
  assert.deepEqual(defaultCaptureViewport([69.333, 69.333]), [70, 70]);
  assert.deepEqual(defaultCaptureViewport([392, 591]), [392, 591]);
});

test("capture page URL preserves suite session routing", () => {
  const url = new URL(capturePageUrl("http://127.0.0.1:14400/?__ui_authoring_test_session=runtime-1", "capture 1"));
  assert.equal(url.pathname, "/capture");
  assert.equal(url.searchParams.get("__ui_authoring_test_session"), "runtime-1");
  assert.equal(url.searchParams.get("id"), "capture 1");
});

test("capture service does not close an injected suite browser", async () => {
  let closeCalls = 0;
  const browser = {
    close: async () => {
      closeCalls += 1;
    },
  } as Browser;
  const service = new CaptureService({} as ConstructorParameters<typeof CaptureService>[0], { browser });

  await service.close();

  assert.equal(closeCalls, 0);
});

test("capture intrinsic readiness includes Reference-mounted Widget sources", () => {
  const host = source("MainCanvas", "Canvas", [{ id: "messageFlow", rect: rect() }]);
  host.bindings = [{ name: "messageFlow", target: { nodeId: "messageFlow", componentType: "GameObject" } }];
  const widget = source("MessageWidget", "Widget", [
    { id: "messageText", rect: rect(), components: { Text: { text: "Preview", font: "Font/Preview.asset", fontSize: 18 } } },
  ]);
  widget.bindings = [{ name: "messageText", target: { nodeId: "messageText", componentType: "Text" } }];
  const artifacts = new Map<string, ArtifactDocument>(
    [host, widget].map((artifact) => [
      artifact.artifactKey,
      {
        artifactKey: artifact.artifactKey,
        artifactType: artifact.artifactType,
        path: `${artifact.artifactKey}.ui.json`,
        prefabPath: "",
        dependencies: [],
        source: artifact,
        resolvedSource: artifact,
      },
    ]),
  );
  const reference: UiReference = {
    referenceKey: "MainCanvas",
    subjectArtifactKey: host.artifactKey,
    mounts: [
      {
        key: "message",
        targetBinding: "messageFlow",
        artifactKey: widget.artifactKey,
        values: { messageText: { text: "Mounted preview" } },
      },
    ],
  };
  const references = new Map<string, ReferenceDocument>([
    [
      reference.referenceKey,
      {
        referenceKey: reference.referenceKey,
        subjectArtifactKey: reference.subjectArtifactKey,
        path: "MainCanvas.ui-reference.json",
        reference,
      },
    ],
  ]);
  const session: CaptureSession = {
    id: "capture",
    document: { kind: "Reference", key: reference.referenceKey, path: "MainCanvas.ui-reference.json" },
    viewport: [1280, 720],
    background: "transparent",
    includeDebug: false,
    reference,
    references: [...references.values()].map((document) => ({ path: document.path, reference: document.reference })),
    artifacts: [...artifacts.values()].map((artifact) => ({ path: artifact.path, source: artifact.source })),
  };

  assert.deepEqual(
    captureIntrinsicSources(session, artifacts, references).map((artifact) => artifact.artifactKey),
    ["MainCanvas", "MessageWidget"],
  );
});

test("capture overlays omit transaction-only saved baselines", () => {
  const overlay = source("PanelWidget", "Widget", []);
  assert.deepEqual(
    captureOverlays([
      {
        path: "PanelWidget.ui.json",
        source: overlay,
        expectedContent: "saved canonical baseline",
      },
    ]),
    [{ path: "PanelWidget.ui.json", source: overlay }],
  );
});

test("default Reference capture target follows the global context preview switch", () => {
  const host = source("HostCanvas", "Canvas", []);
  const widget = source("PanelWidget", "Widget", []);
  const artifacts = new Map<string, ArtifactDocument>([
    [
      host.artifactKey,
      {
        artifactKey: host.artifactKey,
        artifactType: host.artifactType,
        path: "Context/HostCanvas.ui.json",
        prefabPath: "",
        dependencies: [],
        source: host,
        resolvedSource: host,
      },
    ],
  ]);
  const reference: ReferenceDocument = {
    referenceKey: "PanelContextReference",
    subjectArtifactKey: host.artifactKey,
    path: "Context/PanelContextReference.ui-reference.json",
    reference: {
      referenceKey: "PanelContextReference",
      subjectArtifactKey: widget.artifactKey,
      context: { parentArtifactKey: host.artifactKey, placement: { instancePath: ["panel"] } },
      viewport: [1280, 720],
    },
  };

  assert.equal(defaultPreviewCaptureTarget("preview", true, widget, artifacts, reference, [320, 180]), undefined);
  assert.equal(defaultPreviewCaptureTarget("unityBaseline", false, widget, artifacts, reference, [320, 180]), undefined);
  assert.deepEqual(defaultPreviewCaptureTarget("preview", false, widget, artifacts, reference, [320, 180]), {
    path: reference.path,
    viewport: [1280, 720],
    reference: reference.reference,
  });
  const catalog = createSourceCatalog([
    { path: "Context/HostCanvas.ui.json", source: host },
    { path: "Context/PanelWidget.ui.json", source: widget },
  ]);
  assert.deepEqual(referenceCaptureViewport(reference.reference, catalog), [1280, 720]);
  assert.deepEqual(referenceCaptureViewport(reference.reference, catalog, [960, 540]), [960, 540]);
});

test("Artifact and Reference inspection report owner, bindings and bounded graph depth", () => {
  const panel = source("PanelWidget", "Widget", [
    { id: "txt_panel_label", name: "txt_panel_label", rect: rect(), components: { Text: { text: "Panel", fontSize: 16 } } },
  ]);
  panel.bindings = [{ name: "txt_panel_label", target: { nodeId: "txt_panel_label", componentType: "Text" } }];
  const canvas = source("MainCanvas", "Canvas", [{ id: "panel", rect: rect(), components: { PrefabRef: { artifactKey: "PanelWidget" } } }]);
  canvas.bindings = [
    { name: "panel", target: { nodeId: "panel", componentType: "PrefabRef" } },
    { name: "txt_panel_label", target: { instancePath: ["panel"], nodeId: "txt_panel_label", componentType: "Text" } },
  ];
  const catalog = createSourceCatalog([
    { path: "MainCanvas.ui.json", source: canvas },
    { path: "PanelWidget.ui.json", source: panel },
  ]);
  const reference: UiReference = { referenceKey: "MainReference", subjectArtifactKey: "MainCanvas" };

  const artifact = inspectArtifactDocument(canvas, { nodeId: "panel", depth: 0, details: new Set(["bindings", "refs"]) });
  assert.equal(artifact.nodes.length, 1);
  assert.deepEqual(artifact.nodes[0]?.bindings, ["panel"]);
  assert.equal(artifact.nodes[0]?.artifactReference, "PanelWidget");

  const shallow = inspectReferenceDocument(reference, catalog, { depth: 1 });
  assert.deepEqual(
    shallow.nodes.map((node) => [node.nodeId, node.depth]),
    [
      ["MainCanvas", 0],
      ["panel", 1],
    ],
  );

  const nested = inspectReferenceDocument(reference, catalog, {
    nodeId: "txt_panel_label",
    instancePath: ["panel"],
    depth: 0,
    details: new Set(["bindings"]),
  });
  assert.equal(nested.nodes.length, 1);
  assert.equal(nested.nodes[0]?.artifactKey, "PanelWidget");
  assert.deepEqual(nested.nodes[0]?.instancePath, ["panel"]);
  assert.deepEqual(nested.nodes[0]?.bindings, ["txt_panel_label"]);
});
