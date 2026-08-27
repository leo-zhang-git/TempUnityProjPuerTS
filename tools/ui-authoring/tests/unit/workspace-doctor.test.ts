import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { formatSource } from "../../src/kernel/canonical.js";
import { formatPrototype, formatReference } from "../../src/kernel/prototype-canonical.js";
import type { UiPrototype, UiReference } from "../../src/schema/ui-prototype-schema.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { doctorWorkspace } from "../../src/server/workspace-doctor.js";

const defaultFontAsset = `m_SourceFontFileGUID: db3631bac854eb44a968d613bfe1a62d
m_AtlasPopulationMode: 0
m_FaceInfo:
  m_PointSize: 30
  m_Scale: 1
  m_LineHeight: 42
  m_AscentLine: 31.8
  m_DescentLine: -10.2
m_GlyphTable:
- m_Index: 1
  m_Metrics:
    m_HorizontalAdvance: 15
  m_Scale: 1
m_CharacterTable:
- m_ElementType: 1
  m_Unicode: 65
  m_GlyphIndex: 1
  m_Scale: 1
m_AtlasTextures:
`;

function rect(): UiNode["rect"] {
  return {
    anchorMin: [0.5, 0.5],
    anchorMax: [0.5, 0.5],
    pivot: [0.5, 0.5],
    anchoredPosition: [0, 0],
    sizeDelta: [100, 40],
  };
}

function source(artifactKey = "MainCanvas", children?: UiNode[]): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey,
    artifactType: "Canvas",
    root: {
      id: artifactKey,
      rect: { ...rect(), anchorMin: [0, 0], anchorMax: [1, 1], sizeDelta: [0, 0] },
      ...(children ? { children } : {}),
    },
  };
}

async function put(root: string, path: string, content: string): Promise<void> {
  const target = join(root, ...path.split("/"));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function withWorkspace(action: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-doctor-"));
  try {
    await action(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function doctor(root: string) {
  return doctorWorkspace(root, join(root, "Assets", "Resources", "UI"));
}

async function putDefaultFont(root: string): Promise<void> {
  await put(root, "Assets/Resources/UI/Font/alipuhui SDF.asset", defaultFontAsset);
  await put(root, "Assets/Resources/UI/Font/alipuhui SDF.asset.meta", "guid: 00000000000000000000000000000003\n");
}

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

test("aggregates per-file problems and reports canonical Source as a safe fix", async () => {
  await withWorkspace(async (root) => {
    await put(root, "B/Broken.ui.json", "{ not json");
    await put(root, "A/NonCanonical.ui.json", JSON.stringify(source()));
    await put(root, "C/Invalid.ui-reference.json", JSON.stringify({}));

    const report = await doctor(root);

    assert.deepEqual(report.files, { artifact: 2, reference: 1, prototype: 0 });
    assert.equal(report.root, ".");
    assert.ok(report.diagnostics.some((item) => item.code === "document.json.invalid" && item.path === "B/Broken.ui.json"));
    assert.ok(report.diagnostics.some((item) => item.code === "schema.required" && item.path === "C/Invalid.ui-reference.json"));
    const canonical = report.diagnostics.find((item) => item.code === "source.nonCanonical");
    assert.deepEqual(
      canonical && {
        path: canonical.path,
        severity: canonical.severity,
        owner: canonical.owner,
        safeFixable: canonical.safeFixable,
        key: canonical.identity?.documentKey,
      },
      {
        path: "A/NonCanonical.ui.json",
        severity: "warning",
        owner: "artifact",
        safeFixable: true,
        key: "MainCanvas",
      },
    );
    assert.equal(report.summary.safeFixable, 1);
    assert.equal(JSON.stringify(report).includes(root), false);
    assert.ok(report.diagnostics.every((item) => !item.path.includes("\\") && !/^[A-Za-z]:\//.test(item.path)));
    assert.deepEqual(
      report.diagnostics.map((item) => item.path),
      [...report.diagnostics.map((item) => item.path)].sort((left, right) => left.localeCompare(right)),
    );
  });
});

test("reports every Binding naming violation as a blocking Source diagnostic", async () => {
  await withWorkspace(async (root) => {
    const document = source("BindingCanvas", [
      { id: "legacyTarget", rect: rect() },
      { id: "actionTarget", rect: rect() },
    ]);
    document.bindings = [
      { name: "txt_title", target: { nodeId: "legacyTarget", componentType: "GameObject" } },
      { name: "goToLoadoutButton", target: { nodeId: "actionTarget", componentType: "GameObject" } },
    ];
    await put(root, "Bindings.ui.json", formatSource(document));

    const report = await doctor(root);
    const naming = report.diagnostics.filter((item) => item.code.startsWith("binding.naming."));

    assert.equal(report.summary.errors, 3, JSON.stringify(report.diagnostics, null, 2));
    assert.deepEqual(
      naming.map((item) => ({
        code: item.code,
        category: item.category,
        severity: item.severity,
        owner: item.owner,
        safeFixable: item.safeFixable,
        identity: item.identity,
      })),
      [
        {
          code: "binding.naming.format",
          category: "source",
          severity: "error",
          owner: "artifact",
          safeFixable: false,
          identity: { documentKind: "artifact", documentKey: "BindingCanvas", fieldPath: "/bindings/1/name" },
        },
        {
          code: "binding.naming.prefix",
          category: "source",
          severity: "error",
          owner: "artifact",
          safeFixable: false,
          identity: { documentKind: "artifact", documentKey: "BindingCanvas", fieldPath: "/bindings/0/name" },
        },
        {
          code: "binding.naming.prefix",
          category: "source",
          severity: "error",
          owner: "artifact",
          safeFixable: false,
          identity: { documentKind: "artifact", documentKey: "BindingCanvas", fieldPath: "/bindings/1/name" },
        },
      ],
    );
    assert.equal(naming.filter((item) => item.message.includes("goToLoadoutButton")).length, 2);
  });
});

test("warns when Ellipsis or Truncate cannot fit one TMP line, including empty Binding text", async () => {
  await withWorkspace(async (root) => {
    const textNode = (id: string, height: number, overflow: "ellipsis" | "truncate" | "overflow"): UiNode => ({
      id,
      rect: { ...rect(), sizeDelta: [100, height] },
      components: { Text: { text: "", fontSize: 30, overflow } },
    });
    const document = source("FiniteOverflowCanvas", [
      textNode("txt_bound_ellipsis", 42, "ellipsis"),
      textNode("boundTruncate", 40, "truncate"),
      textNode("sufficientEllipsis", 42.01, "ellipsis"),
      textNode("shortOverflow", 1, "overflow"),
    ]);
    document.bindings = [{ name: "txt_bound_ellipsis", target: { nodeId: "txt_bound_ellipsis", componentType: "Text" } }];
    await putDefaultFont(root);
    await put(root, "FiniteOverflow.ui.json", formatSource(document));

    const report = await doctor(root);
    const finiteOverflow = report.diagnostics.filter((item) => item.code === "text.finiteOverflowInsufficientHeight");

    assert.equal(report.summary.errors, 0, JSON.stringify(report.diagnostics, null, 2));
    assert.deepEqual(
      finiteOverflow.map((item) => [item.identity?.nodeId, item.identity?.fieldPath, item.severity]),
      [
        ["boundTruncate", "components.Text.overflow", "warning"],
        ["txt_bound_ellipsis", "components.Text.overflow", "warning"],
      ],
    );
  });
});

test("checks Reference backdrop assets in the dedicated preview asset root", async () => {
  await withWorkspace(async (root) => {
    const referenceAssetsRoot = join(root, "ReferenceAssets");
    const reference: UiReference = {
      referenceKey: "BackdropReference",
      subjectArtifactKey: "MainCanvas",
      backdrop: { images: [{ path: "Backdrops/Main.png", viewport: [1280, 720] }] },
    };
    await put(root, "Main.ui.json", formatSource(source()));
    await put(root, "Backdrop.ui-reference.json", formatReference(reference));

    const missing = await doctorWorkspace(root, join(root, "Assets", "Resources", "UI"), undefined, referenceAssetsRoot);
    assert.ok(
      missing.diagnostics.some(
        (item) => item.code === "reference.backdropMissing" && item.identity?.fieldPath === "/backdrop/images/0/path",
      ),
    );

    const assetPath = join(referenceAssetsRoot, "Backdrops", "Main.png");
    await mkdir(dirname(assetPath), { recursive: true });
    await writeFile(assetPath, png(1, 1));
    const present = await doctorWorkspace(root, join(root, "Assets", "Resources", "UI"), undefined, referenceAssetsRoot);
    assert.equal(
      present.diagnostics.some((item) => item.code === "reference.backdropMissing"),
      false,
    );
  });
});

test("reports current non-canonical authoring documents as safe fixes", async () => {
  await withWorkspace(async (root) => {
    await put(root, "Screens/Main.ui.json", JSON.stringify(source()));
    await put(
      root,
      "References/Main.ui-reference.json",
      JSON.stringify({
        referenceKey: "MainReference",
        subjectArtifactKey: "MainCanvas",
        viewport: [1280, 720],
      }),
    );
    await put(
      root,
      "Flows/Main.ui-prototype.json",
      JSON.stringify({
        prototypeKey: "MainFlow",
        startReferenceKey: "MainReference",
        interactions: [],
      }),
    );

    const report = await doctor(root);
    assert.equal(
      report.diagnostics.some((item) => item.category === "schema"),
      false,
    );
    assert.deepEqual(
      report.diagnostics.map((item) => [item.code, item.safeFixable]),
      [
        ["prototype.nonCanonical", true],
        ["reference.nonCanonical", true],
        ["source.nonCanonical", true],
      ],
    );
  });
});

test("normalizes Source Catalog failures instead of exposing raw exceptions", async () => {
  await withWorkspace(async (root) => {
    const document = source("MainCanvas", [
      {
        id: "missingWidget",
        rect: rect(),
        components: { PrefabRef: { artifactKey: "MissingWidget" } },
      },
    ]);
    await put(root, "Screens/Main.ui.json", formatSource(document));

    const report = await doctor(root);
    const problem = report.diagnostics.find((item) => item.category === "catalog");

    assert.deepEqual(
      problem && {
        path: problem.path,
        code: problem.code,
        message: problem.message,
        owner: problem.owner,
        safeFixable: problem.safeFixable,
      },
      {
        path: "Screens/Main.ui.json",
        code: "catalog.missingArtifact",
        message: "Artifact 'MainCanvas' references missing artifact 'MissingWidget'.",
        owner: "artifact",
        safeFixable: false,
      },
    );
  });
});

test("runs Reference and Prototype relationship validation for all valid documents", async () => {
  await withWorkspace(async (root) => {
    const reference: UiReference = {
      referenceKey: "MissingRootReference",
      subjectArtifactKey: "MissingCanvas",
    };
    const prototype: UiPrototype = {
      prototypeKey: "BrokenFlow",
      startReferenceKey: "MissingStartReference",
      interactions: [],
    };
    await put(root, "Screens/Main.ui.json", formatSource(source()));
    const presetWidget = source("PresetWidget");
    presetWidget.artifactType = "Widget";
    presetWidget.widgetType = "PresetWidget";
    presetWidget.initialSize = [100, 40];
    const presetHost = source("PresetHostCanvas", [{ id: "go_slot", name: "go_slot", rect: rect() }]);
    presetHost.bindings = [{ name: "go_slot", target: { nodeId: "go_slot", componentType: "GameObject" } }];
    await put(root, "Screens/PresetWidget.ui.json", formatSource(presetWidget));
    await put(root, "Screens/PresetHost.ui.json", formatSource(presetHost));
    await put(
      root,
      "References/Preset.ui-reference.json",
      formatReference({ referenceKey: "PresetReference", subjectArtifactKey: "PresetWidget" }),
    );
    await put(
      root,
      "References/PresetHost.ui-reference.json",
      formatReference({
        referenceKey: "PresetHostReference",
        subjectArtifactKey: "PresetHostCanvas",
        mounts: [{ key: "preset", targetBinding: "go_slot", artifactKey: "PresetWidget", referenceKey: "PresetReference" }],
        description: "Standalone preset composition review.",
      }),
    );
    await put(root, "References/Missing.ui-reference.json", `${JSON.stringify(reference, null, 2)}\n`);
    await put(root, "Flows/Broken.ui-prototype.json", `${JSON.stringify(prototype, null, 2)}\n`);

    const report = await doctor(root);

    const referenceProblem = report.diagnostics.find((item) => item.code === "previewResolver.subject.missing");
    assert.equal(referenceProblem?.path, "References/Missing.ui-reference.json");
    assert.equal(referenceProblem?.identity?.documentKey, "MissingRootReference");
    const prototypeProblem = report.diagnostics.find((item) => item.code === "prototype.startReference");
    assert.equal(prototypeProblem?.path, "Flows/Broken.ui-prototype.json");
    assert.equal(prototypeProblem?.identity?.documentKey, "BrokenFlow");
    assert.equal(
      report.diagnostics.some((item) => item.path === "References/PresetHost.ui-reference.json"),
      false,
      JSON.stringify(report.diagnostics, null, 2),
    );
  });
});

test("reports missing component resources with stable node identities", async () => {
  await withWorkspace(async (root) => {
    const document = source("ResourceCanvas", [
      {
        id: "visual",
        rect: rect(),
        components: {
          Animator: { controller: "Animation/Missing.controller" },
          Text: { text: "Missing", fontSize: 20, font: "Font/Missing.asset" },
          Image: { sprite: "Sprite/Missing.png" },
        },
      },
    ]);
    await put(root, "Screens/Resource.ui.json", formatSource(document));

    const report = await doctor(root);
    const resources = report.diagnostics.filter((item) => item.category === "resource");
    assert.deepEqual(
      resources.map((item) => item.code),
      ["resource.animatorControllerMissing", "resource.fontMissing", "resource.spriteMissing"],
    );
    assert.ok(resources.every((item) => item.path === "Screens/Resource.ui.json"));
    assert.ok(resources.every((item) => item.identity?.documentKey === "ResourceCanvas" && item.identity.nodeId === "visual"));
  });
});

test("checks Preview, Reference, and Prototype session asset references", async () => {
  await withWorkspace(async (root) => {
    const document = source("PreviewCanvas", [
      {
        id: "img_icon",
        rect: rect(),
        components: { Image: { sprite: "Sprites/MissingSource.png" } },
      },
    ]);
    document.bindings = [{ name: "img_icon", target: { nodeId: "img_icon", componentType: "Image" } }];
    const reference: UiReference = {
      referenceKey: "PreviewReference",
      subjectArtifactKey: "PreviewCanvas",
      values: { img_icon: { sprite: "Sprites/MissingReference.png" } },
    };
    const prototype: UiPrototype = {
      prototypeKey: "PreviewFlow",
      startReferenceKey: "PreviewReference",
      interactions: [],
    };
    await put(root, "Screens/Preview.ui.json", formatSource(document));
    await put(root, "References/Preview.ui-reference.json", formatReference(reference));
    await put(root, "Flows/Preview.ui-prototype.json", `${JSON.stringify(prototype, null, 2)}\n`);

    const report = await doctor(root);
    const resources = report.diagnostics.filter((item) => item.category === "resource");
    assert.deepEqual(
      resources.map((item) => [item.identity?.documentKind, item.identity?.documentKey, item.identity?.fieldPath]),
      [
        ["prototype", "PreviewFlow", "session/PreviewReference/values/img_icon/sprite"],
        ["reference", "PreviewReference", "values/img_icon/sprite"],
        ["artifact", "PreviewCanvas", "components.Image.sprite"],
      ],
    );
  });
});

test("uses the explicit Unity UI asset root for resource checks", async () => {
  await withWorkspace(async (root) => {
    const sourceRoot = join(root, "UIAuthoring", "Sources");
    const assetRoot = join(root, "UnityAssets", "UI");
    const document = source("ResourceCanvas", [
      {
        id: "visual",
        rect: rect(),
        components: { Image: { sprite: "Sprite/Ready.png" } },
      },
    ]);
    await put(sourceRoot, "Screens/Resource.ui.json", formatSource(document));
    const spritePath = join(assetRoot, "Sprite", "Ready.png");
    await mkdir(dirname(spritePath), { recursive: true });
    await writeFile(spritePath, png(16, 8));
    await writeFile(
      `${spritePath}.meta`,
      "guid: 00000000000000000000000000000001\ntextureType: 8\nspriteMode: 1\nspritePixelsToUnits: 100\nspriteBorder: {x: 0, y: 0, z: 0, w: 0}\n",
      "utf8",
    );

    const report = await doctorWorkspace(sourceRoot, assetRoot);
    assert.equal(
      report.diagnostics.some((item) => item.category === "resource"),
      false,
    );
  });
});

test("reports non-canonical Reference and Prototype documents as safe fixes", async () => {
  await withWorkspace(async (root) => {
    const reference: UiReference = {
      referenceKey: "MainReference",
      subjectArtifactKey: "MainCanvas",
    };
    const prototype: UiPrototype = {
      prototypeKey: "MainFlow",
      startReferenceKey: "MainReference",
      interactions: [],
    };
    await put(root, "Screens/Main.ui.json", formatSource(source()));
    await put(root, "References/Main.ui-reference.json", JSON.stringify(reference));
    await put(root, "Flows/Main.ui-prototype.json", JSON.stringify(prototype));

    const report = await doctor(root);
    assert.ok(report.diagnostics.some((item) => item.code === "reference.nonCanonical" && item.safeFixable));
    assert.ok(report.diagnostics.some((item) => item.code === "prototype.nonCanonical" && item.safeFixable));
  });
});

test("reports semantically redundant Reference viewport overrides", async () => {
  await withWorkspace(async (root) => {
    const document = source("MainCanvas", [{ id: "label", rect: rect(), components: { Text: { text: "", fontSize: 16 } } }]);
    const reference: UiReference = {
      referenceKey: "MainReference",
      subjectArtifactKey: "MainCanvas",
      viewport: [1280, 720],
    };
    await put(root, "Screens/Main.ui.json", formatSource(document));
    await put(root, "References/Main.ui-reference.json", formatReference(reference));

    const report = await doctor(root);
    const problem = report.diagnostics.find((item) => item.code === "reference.nonCanonical");
    assert.equal(problem?.message, "Reference contains redundant preview overrides or is not in canonical form.");
    assert.equal(problem?.safeFixable, true);
  });
});

test("warns about duplicate default evidence and unexplained standalone References", async () => {
  await withWorkspace(async (root) => {
    const defaultReference: UiReference = {
      referenceKey: "MainCanvas",
      subjectArtifactKey: "MainCanvas",
      description: "Default lobby state.",
    };
    const duplicateReference: UiReference = {
      referenceKey: "DuplicateReference",
      subjectArtifactKey: "MainCanvas",
    };
    const standaloneReference: UiReference = {
      referenceKey: "StandaloneReference",
      subjectArtifactKey: "MainCanvas",
      viewport: [640, 360],
    };
    const prototype: UiPrototype = {
      prototypeKey: "MainFlow",
      startReferenceKey: "DuplicateReference",
      interactions: [],
    };
    await put(root, "Screens/MainCanvas.ui.json", formatSource(source()));
    await put(root, "Screens/MainCanvas.ui-reference.json", formatReference(defaultReference));
    await put(root, "References/Duplicate.ui-reference.json", formatReference(duplicateReference));
    await put(root, "References/Standalone.ui-reference.json", formatReference(standaloneReference));
    await put(root, "Flows/Main.ui-prototype.json", formatPrototype(prototype));

    const report = await doctor(root);
    assert.ok(
      report.diagnostics.some(
        (item) => item.code === "reference.duplicatesDefaultEvidence" && item.identity?.documentKey === "DuplicateReference",
      ),
    );
    assert.equal(
      report.diagnostics.some(
        (item) => item.code === "reference.unclassifiedStandalone" && item.identity?.documentKey === "DuplicateReference",
      ),
      false,
    );
    assert.ok(
      report.diagnostics.some(
        (item) => item.code === "reference.unclassifiedStandalone" && item.identity?.documentKey === "StandaloneReference",
      ),
    );
  });
});
