import assert from "node:assert/strict";
import test from "node:test";
import { createArtifactSource } from "../../src/kernel/authoring.js";
import {
  authoringTemplate,
  authoringTemplateRegistry,
  authoringTemplateUnavailableReason,
  availableAuthoringTemplates,
  canRestoreAuthoringScrollbars,
  materializeAuthoringTemplate,
  restoreAuthoringScrollbars,
} from "../../src/kernel/authoring-templates.js";
import { effectiveNodeIdMode, isDisplayNameAlignedNodeId, unityNodeName } from "../../src/kernel/naming.js";
import { removeNode } from "../../src/kernel/semantic.js";
import { findNode, walkNodes } from "../../src/kernel/tree.js";
import { validateSourceReadiness } from "../../src/kernel/validation.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";

test("generated templates are complete and use unique ids", () => {
  const source = createArtifactSource({ artifactKey: "TemplateCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
  source.root.children = [
    plainNode("buttonEx"),
    plainNode("buttonExLabel"),
    plainNode("scrollViewEx"),
    plainNode("scrollViewExViewport"),
    plainNode("scrollViewExContent"),
  ];

  const button = materializeAuthoringTemplate(source, authoringTemplate("button-ex"), { anchoredPosition: [12, 34] });
  source.root.children.push(button);
  const scroll = materializeAuthoringTemplate(source, authoringTemplate("scroll-view-ex-vertical"), { anchoredPosition: [56, 78] });
  source.root.children.push(scroll);

  assert.equal(button.id, "buttonEx_1");
  assert.equal(button.components?.ButtonEx?.targetGraphic, "buttonEx_1");
  assert.equal(button.children?.[0]?.id, "buttonExLabel_1");
  assert.deepEqual(button.rect.anchoredPosition, [12, 34]);

  assert.equal(scroll.id, "scrollViewEx_1");
  assert.deepEqual(scroll.rect.anchoredPosition, [56, 78]);
  assert.deepEqual(scroll.components?.ScrollRectEx, {
    content: "scrollViewEx_1Content",
    viewport: "scrollViewEx_1Viewport",
    horizontal: false,
    vertical: true,
    verticalScrollbar: "scrollViewEx_1VerticalScrollbar",
    templates: {},
  });
  assert.equal(scroll.children?.[0]?.components?.Image?.color, "#00000000");
  assert.equal(scroll.children?.[0]?.components?.Image?.raycastTarget, true);
  assert.ok(scroll.children?.[0]?.components?.RectMask2D);
  assert.equal(validateSourceReadiness(source).valid, true);
});

test("every built-in template materializes a ready local Source subtree", () => {
  const source = createArtifactSource({ artifactKey: "TemplateCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
  for (const definition of authoringTemplateRegistry) {
    source.root.children ??= [];
    const referencedArtifact =
      definition.materialization.kind === "artifactReference"
        ? referenceArtifact(definition.materialization.artifactKey, referenceSize(definition.materialization.artifactKey))
        : undefined;
    source.root.children.push(materializeAuthoringTemplate(source, definition, { referencedArtifact }));
  }
  const readiness = validateSourceReadiness(source);
  assert.equal(readiness.valid, true, readiness.issues.map((issue) => issue.message).join("\n"));
  for (const { node } of walkNodes(source).slice(1)) {
    if (effectiveNodeIdMode(node) === "auto") {
      assert.equal(isDisplayNameAlignedNodeId(node.id, unityNodeName(node)), true, `${node.id} must be aligned while auto`);
    }
  }
  assert.equal(findNode(source, "sliderBackground")?.idMode, "manual");
  assert.deepEqual(
    authoringTemplateRegistry.map((entry) => entry.label),
    [
      "Image",
      "TMP",
      "Panel",
      "Toggle",
      "Slider",
      "Scroll View",
      "Scroll View Ex / Vertical",
      "Scroll View Ex / Horizontal",
      "Scroll View Ex / Grid",
      "Button Ex",
      "Button Action / Primary Neutral",
      "Button Action / Secondary Neutral",
      "Button Action / Tertiary Neutral",
      "Button Close",
      "Input Field (TMP)",
      "Scrollbar",
      "CustomDropDown",
      "Dropdown (TMP)",
    ],
  );
});

test("Scroll View modes create matching default scrollbars and Grid content", () => {
  const source = createArtifactSource({ artifactKey: "TemplateCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
  const standard = materializeAuthoringTemplate(source, authoringTemplate("scroll-view"));
  source.root.children = [standard];
  const horizontal = materializeAuthoringTemplate(source, authoringTemplate("scroll-view-ex-horizontal"));
  source.root.children.push(horizontal);
  const grid = materializeAuthoringTemplate(source, authoringTemplate("scroll-view-ex-grid"));
  source.root.children.push(grid);

  assert.equal(standard.components?.ScrollRect?.horizontal, true);
  assert.equal(standard.components?.ScrollRect?.vertical, true);
  assert.ok(findNode(source, standard.components?.ScrollRect?.horizontalScrollbar ?? "")?.components?.Scrollbar);
  assert.ok(findNode(source, standard.components?.ScrollRect?.verticalScrollbar ?? "")?.components?.Scrollbar);
  assert.equal(horizontal.components?.ScrollRectEx?.horizontal, true);
  assert.equal(horizontal.components?.ScrollRectEx?.vertical, false);
  assert.ok(horizontal.components?.ScrollRectEx?.horizontalScrollbar);
  assert.equal(horizontal.components?.ScrollRectEx?.verticalScrollbar, undefined);
  const gridContent = findNode(source, grid.components?.ScrollRectEx?.content ?? "");
  assert.equal(grid.components?.ScrollRectEx?.horizontal, false);
  assert.equal(grid.components?.ScrollRectEx?.vertical, true);
  assert.deepEqual(gridContent?.components?.GridLayoutGroup, {
    cellSize: [100, 100],
    spacing: [8, 8],
    constraint: "fixedColumnCount",
    constraintCount: 2,
  });
  assert.ok(gridContent?.components?.ContentSizeFitter);
});

test("CustomDropDown uses a standard ScrollRect and keeps its clone template hidden", () => {
  const source = createArtifactSource({ artifactKey: "TemplateCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
  const dropdown = materializeAuthoringTemplate(source, authoringTemplate("custom-dropdown"));
  source.root.children = [dropdown];

  const optionView = findNode(source, dropdown.components?.CustomDropDown?.optionView ?? "");
  const optionTemplate = findNode(source, dropdown.components?.CustomDropDown?.optionTemplate ?? "");
  const currentButton = findNode(source, dropdown.components?.CustomDropDown?.currentButton ?? "");

  assert.ok(optionView?.components?.ScrollRect);
  assert.equal(optionView?.components?.ScrollRectEx, undefined);
  assert.equal(optionView?.components?.LayoutSettings, undefined);
  assert.equal(optionTemplate?.active, false);
  assert.ok(currentButton?.components?.ButtonEx);
  assert.deepEqual(optionTemplate?.components?.CustomDropDownOption, {
    button: optionTemplate?.id,
    contentHost: optionTemplate.children?.[1]?.id,
    selectedVisual: optionTemplate.children?.[0]?.id,
  });
  assert.equal(validateSourceReadiness(source).valid, true);
});

test("deleting a default scrollbar clears its optional owner reference and restore adds it back", () => {
  const source = createArtifactSource({ artifactKey: "TemplateCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
  const scroll = materializeAuthoringTemplate(source, authoringTemplate("scroll-view-ex-vertical"));
  source.root.children = [scroll];
  const originalScrollbarId = scroll.components?.ScrollRectEx?.verticalScrollbar;
  assert.ok(originalScrollbarId);

  const removed = removeNode(source, originalScrollbarId);
  const removedScroll = findNode(removed, scroll.id)!;
  assert.equal(removedScroll.components?.ScrollRectEx?.verticalScrollbar, null);
  assert.equal(canRestoreAuthoringScrollbars(removedScroll), true);

  const restored = restoreAuthoringScrollbars(removed, scroll.id);
  const restoredScroll = findNode(restored.source, scroll.id)!;
  assert.equal(restored.addedNodeIds.length, 1);
  assert.equal(restoredScroll.components?.ScrollRectEx?.verticalScrollbar, restored.addedNodeIds[0]);
  const restoredScrollbar = findNode(restored.source, restored.addedNodeIds[0]!);
  assert.ok(restoredScrollbar?.components?.Scrollbar);
  assert.equal(restoredScrollbar?.idMode, "manual");
  assert.equal(validateSourceReadiness(restored.source).valid, true);
});

test("artifactReference templates use the resolved Artifact identity and initial size", () => {
  const source = createArtifactSource({ artifactKey: "TemplateCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
  const definition = authoringTemplate("button-action-primary-neutral");
  const referencedArtifact = referenceArtifact("ButtonActionPrimaryNeutral", [200, 56]);
  const node = materializeAuthoringTemplate(source, definition, { referencedArtifact, anchoredPosition: [30, -20] });
  assert.equal(node.id, "buttonActionPrimaryNeutral");
  assert.deepEqual(node.rect.sizeDelta, [200, 56]);
  assert.deepEqual(node.rect.anchoredPosition, [30, -20]);
  assert.deepEqual(node.components?.PrefabRef, { artifactKey: "ButtonActionPrimaryNeutral" });
});

test("artifactReference template availability follows the current Artifact catalog and owner type", () => {
  const canvas = createArtifactSource({ artifactKey: "TemplateCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
  const close = referenceArtifact("ButtonClose", [61, 59]);
  const available = availableAuthoringTemplates(canvas, (artifactKey) => (artifactKey === close.artifactKey ? close : undefined));
  assert.equal(
    available.some((definition) => definition.id === "button-close"),
    true,
  );
  assert.equal(
    available.some((definition) => definition.id === "button-action-primary-neutral"),
    false,
  );
  assert.equal(
    available.some((definition) => definition.id === "slider"),
    true,
  );

  const widgetTarget = createArtifactSource({ artifactKey: "ButtonClose", artifactType: "Widget", initialSize: [61, 59] });
  const fragmentOwner = createArtifactSource({ artifactKey: "OwnerFragment", artifactType: "Fragment", initialSize: [100, 100] });
  assert.match(
    authoringTemplateUnavailableReason(fragmentOwner, authoringTemplate("button-close"), widgetTarget) ?? "",
    /only reference Fragment templates/,
  );
  assert.throws(
    () => materializeAuthoringTemplate(canvas, authoringTemplate("button-action-primary-neutral")),
    /requires available Artifact 'ButtonActionPrimaryNeutral'/,
  );
});

function referenceSize(artifactKey: string): readonly [number, number] {
  if (artifactKey === "ButtonActionPrimaryNeutral") return [200, 56];
  if (artifactKey === "ButtonActionSecondaryNeutral") return [200, 56];
  if (artifactKey === "ButtonActionTertiaryNeutral") return [200, 56];
  if (artifactKey === "ButtonClose") return [61, 59];
  throw new Error(`Unknown reference fixture '${artifactKey}'`);
}

function referenceArtifact(artifactKey: string, initialSize: readonly [number, number]): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey,
    artifactType: "Fragment",
    initialSize: [initialSize[0], initialSize[1]],
    root: { id: artifactKey, rect: plainNode("root").rect },
  };
}

function plainNode(id: string) {
  return {
    id,
    rect: {
      anchorMin: [0.5, 0.5] as [number, number],
      anchorMax: [0.5, 0.5] as [number, number],
      pivot: [0.5, 0.5] as [number, number],
      anchoredPosition: [0, 0] as [number, number],
      sizeDelta: [10, 10] as [number, number],
    },
  };
}
