import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultStateRootElementValue,
  mapStateRootElementAssetValue,
  readCurrentStateRootElementValue,
  type StateRootElementType,
  stateRootElementAssetPath,
  stateRootElementDescriptor,
  stateRootElementReferenceFilter,
  stateRootElementTargetIssue,
  stateRootElementTypes,
} from "../../src/components/state-root-elements.js";
import { DEFAULT_UI_FONT_ASSET } from "../../src/registry/component-contract.js";
import type { UiNode } from "../../src/schema/ui-source-schema.js";

function node(components: UiNode["components"] = {}): UiNode {
  return {
    id: "target",
    rect: {
      anchorMin: [0.1, 0.2],
      anchorMax: [0.6, 0.8],
      pivot: [0.25, 0.75],
      anchoredPosition: [12, -8],
      sizeDelta: [100, 40],
      rotation: 35,
      scale: [2, 3],
    },
    components,
  };
}

test("StateRoot descriptor owns the exact 20 element types and semantic defaults", () => {
  assert.deepEqual(stateRootElementTypes, [
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
  ]);
  const expected: Record<StateRootElementType, unknown> = {
    ULocalPos: [0, 0],
    UPivot: [0.5, 0.5],
    UAnchorsMin: [0, 0],
    UAnchorsMax: [0, 0],
    ULocalPosX: 0,
    ULocalPosY: 0,
    UWidth: 0,
    UHeight: 0,
    UTMP_Text: "",
    UTMP_FontSize: 24,
    USprite: { sprite: null, setNativeSize: false },
    UColor: "#FFFFFFFF",
    UAlpha: 1,
    UGray: false,
    UInteractable: true,
    URaycastTarget: false,
    CanvasGroup: { alpha: 1, blocksRaycasts: true },
    ULocalScale: [1, 1, 1],
    LocalRotation: [0, 0, 0],
    UTMP_Font: DEFAULT_UI_FONT_ASSET,
  };
  for (const type of stateRootElementTypes) assert.deepEqual(defaultStateRootElementValue(type), expected[type]);

  const first = defaultStateRootElementValue("USprite") as { sprite: string | null; setNativeSize: boolean };
  first.setNativeSize = true;
  assert.deepEqual(defaultStateRootElementValue("USprite"), { sprite: null, setNativeSize: false });

  const canvasGroup = defaultStateRootElementValue("CanvasGroup") as { alpha: number; blocksRaycasts: boolean };
  canvasGroup.alpha = 0;
  assert.deepEqual(defaultStateRootElementValue("CanvasGroup"), { alpha: 1, blocksRaycasts: true });
});

test("reads current values from the matching Source target semantics", () => {
  const rectNode = node();
  assert.deepEqual(readCurrentStateRootElementValue("ULocalPos", rectNode), [12, -8]);
  assert.deepEqual(readCurrentStateRootElementValue("UPivot", rectNode), [0.25, 0.75]);
  assert.deepEqual(readCurrentStateRootElementValue("UAnchorsMin", rectNode), [0.1, 0.2]);
  assert.deepEqual(readCurrentStateRootElementValue("UAnchorsMax", rectNode), [0.6, 0.8]);
  assert.equal(readCurrentStateRootElementValue("ULocalPosX", rectNode), 12);
  assert.equal(readCurrentStateRootElementValue("ULocalPosY", rectNode), -8);
  assert.equal(
    readCurrentStateRootElementValue("UWidth", rectNode, { x: 0, y: 0, width: 150, height: 75, rotation: 0, scaleX: 1, scaleY: 1 }),
    150,
  );
  assert.equal(
    readCurrentStateRootElementValue("UHeight", rectNode, { x: 0, y: 0, width: 150, height: 75, rotation: 0, scaleX: 1, scaleY: 1 }),
    75,
  );
  assert.deepEqual(readCurrentStateRootElementValue("ULocalScale", rectNode), [2, 3, 1]);
  assert.deepEqual(readCurrentStateRootElementValue("LocalRotation", rectNode), [0, 0, 35]);

  const textNode = node({ Text: { text: "Ready", fontSize: 31, color: "#12345680", font: "Font/Alternate.asset" } });
  assert.equal(readCurrentStateRootElementValue("UTMP_Text", textNode), "Ready");
  assert.equal(readCurrentStateRootElementValue("UTMP_FontSize", textNode), 31);
  assert.equal(readCurrentStateRootElementValue("UColor", textNode), "#12345680");
  assert.equal(readCurrentStateRootElementValue("UAlpha", textNode), 128 / 255);
  assert.equal(readCurrentStateRootElementValue("URaycastTarget", textNode), false);
  assert.equal(readCurrentStateRootElementValue("UTMP_Font", textNode), "Font/Alternate.asset");

  const imageNode = node({ Image: { sprite: "Generated/Shapes/Round12.png", color: "#ABCDEF40", raycastTarget: true } });
  assert.deepEqual(readCurrentStateRootElementValue("USprite", imageNode), {
    sprite: "Generated/Shapes/Round12.png",
    setNativeSize: false,
  });
  assert.equal(readCurrentStateRootElementValue("URaycastTarget", imageNode), true);
  assert.equal(readCurrentStateRootElementValue("UGray", imageNode), false);
  assert.equal(
    readCurrentStateRootElementValue(
      "UInteractable",
      node({ Toggle: { targetGraphic: "target", graphic: "target", interactable: false } }),
    ),
    false,
  );
  assert.deepEqual(readCurrentStateRootElementValue("CanvasGroup", node({ CanvasGroup: { alpha: 0.4, blocksRaycasts: false } })), {
    alpha: 0.4,
    blocksRaycasts: false,
  });
});

test("enforces component capability and exactly-one target matching", () => {
  assert.equal(stateRootElementTargetIssue("UTMP_Text", node()), "target 'target' has no compatible tmpText component");
  assert.equal(
    stateRootElementTargetIssue("UColor", node({ Image: {}, Text: {} })),
    "target 'target' has ambiguous graphic components: Image, Text",
  );
  assert.equal(stateRootElementTargetIssue("UColor", node({ Image: {} })), undefined);
  assert.equal(stateRootElementTargetIssue("UGray", node({ Text: {} })), "target 'target' has no compatible graphic component");
  assert.equal(stateRootElementTargetIssue("UGray", node({ RoundedRect: {} })), undefined);
  assert.equal(stateRootElementTargetIssue("CanvasGroup", node()), "target 'target' has no compatible canvasGroup component");
  assert.equal(stateRootElementTargetIssue("CanvasGroup", node({ CanvasGroup: {} })), undefined);
  assert.equal(stateRootElementReferenceFilter("ULocalPos"), "any");
  assert.deepEqual(stateRootElementReferenceFilter("UTMP_Font"), { componentTypes: ["Text"], match: "exactlyOne" });
  assert.deepEqual(stateRootElementReferenceFilter("CanvasGroup"), { componentTypes: ["CanvasGroup"], match: "exactlyOne" });
});

test("applies layout, visual, Sprite native-size, and font-null Preview semantics", () => {
  let result = stateRootElementDescriptor("UAnchorsMin").applyPreview(node(), [0.2, 0.3], {});
  result = stateRootElementDescriptor("UAnchorsMax").applyPreview(result, [0.7, 0.9], {});
  result = stateRootElementDescriptor("UWidth").applyPreview(result, 160, { parentSize: [200, 100] });
  result = stateRootElementDescriptor("UHeight").applyPreview(result, 90, { parentSize: [200, 100] });
  assert.ok(Math.abs(result.rect.sizeDelta[0] - 60) < 0.000001);
  assert.ok(Math.abs(result.rect.sizeDelta[1] - 30) < 0.000001);

  result = stateRootElementDescriptor("ULocalScale").applyPreview(result, [4, 5, 6], {});
  result = stateRootElementDescriptor("LocalRotation").applyPreview(result, [10, 20, 70], {});
  assert.deepEqual(result.rect.scale, [4, 5]);
  assert.equal(result.rect.rotation, 70);

  const diagnostics: string[] = [];
  const imageNode = node({ Image: { sprite: "old.png" } });
  const native = stateRootElementDescriptor("USprite").applyPreview(
    imageNode,
    { sprite: "new.png", setNativeSize: true },
    {
      spriteMetrics: () => ({ width: 128, height: 64, pixelsPerUnit: 200, border: [0, 0, 0, 0] }),
      report: (diagnostic) => diagnostics.push(diagnostic.code),
    },
  );
  assert.equal(native.components?.Image?.sprite, "new.png");
  assert.deepEqual(native.rect.anchorMax, native.rect.anchorMin);
  assert.deepEqual(native.rect.sizeDelta, [64, 32]);
  assert.equal(diagnostics.length, 0);

  stateRootElementDescriptor("USprite").applyPreview(
    imageNode,
    { sprite: "missing.png", setNativeSize: true },
    {
      report: (diagnostic) => diagnostics.push(diagnostic.code),
    },
  );
  assert.deepEqual(diagnostics, ["stateRoot.spriteMetrics"]);

  const withoutFont = stateRootElementDescriptor("UTMP_Font").applyPreview(node({ Text: { font: DEFAULT_UI_FONT_ASSET } }), null, {});
  assert.equal(withoutFont.components?.Text?.font, "");
  assert.equal(stateRootElementDescriptor("UInteractable").applyPreview(imageNode, false, {}), imageNode);
  assert.equal(stateRootElementDescriptor("UGray").applyPreview(imageNode, true, {}), imageNode);
  assert.equal(stateRootElementDescriptor("URaycastTarget").applyPreview(imageNode, false, {}), imageNode);
  const canvasGroup = stateRootElementDescriptor("CanvasGroup").applyPreview(
    node({ CanvasGroup: { alpha: 1, blocksRaycasts: true, interactable: false, ignoreParentGroups: true } }),
    { alpha: 0.25, blocksRaycasts: false },
    {},
  );
  assert.deepEqual(canvasGroup.components?.CanvasGroup, {
    alpha: 0.25,
    blocksRaycasts: false,
    interactable: false,
    ignoreParentGroups: true,
  });
});

test("maps StateRoot image and font assets without changing non-asset values", () => {
  assert.deepEqual(
    mapStateRootElementAssetValue("USprite", { sprite: "Generated/Icon.png", setNativeSize: true }, (path, kind) => `${kind}:${path}`),
    { sprite: "image:Generated/Icon.png", setNativeSize: true },
  );
  assert.equal(
    mapStateRootElementAssetValue("UTMP_Font", "Font/Default.asset", (path, kind) => `${kind}:${path}`),
    "font:Font/Default.asset",
  );
  assert.equal(stateRootElementAssetPath("USprite", { sprite: "Generated/Icon.png", setNativeSize: false }), "Generated/Icon.png");
  assert.equal(stateRootElementAssetPath("UTMP_Font", "Font/Default.asset"), "Font/Default.asset");
  assert.equal(stateRootElementAssetPath("USprite", { sprite: null, setNativeSize: true }), undefined);
  assert.deepEqual(
    mapStateRootElementAssetValue("ULocalPos", [1, 2], () => "unexpected"),
    [1, 2],
  );
});
