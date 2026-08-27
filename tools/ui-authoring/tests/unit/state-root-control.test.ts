import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveStateRootPreviewContext,
  stateRootActiveControllers,
  stateRootPreviewContextIssues,
} from "../../src/kernel/state-root-control.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { stateRootControlledActiveNodes } from "../../src/web/editors/artifact/inspector/state-root-active-control.js";

function rect(): UiNode["rect"] {
  return { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] };
}

function shopSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "ShopCanvas",
    artifactType: "Canvas",
    root: {
      id: "viewState",
      rect: rect(),
      components: {
        StateRoot: {
          currentState: "purchase",
          states: {
            purchase: { purchasePage: true, sellPage: false, sharedPanel: true },
            sell: { purchasePage: false, sellPage: true, sharedPanel: true },
          },
        },
      },
      children: [
        { id: "purchasePage", rect: rect() },
        {
          id: "sellPage",
          rect: rect(),
          components: {
            StateRoot: {
              currentState: "sell",
              states: {
                sell: { sellList: true, confirmDialog: false },
                confirm: { sellList: true, confirmDialog: true },
                buyback: { sellList: false, confirmDialog: false },
              },
            },
          },
          children: [
            { id: "sellList", rect: rect() },
            { id: "confirmDialog", rect: rect() },
          ],
        },
        {
          id: "secondaryState",
          rect: rect(),
          components: {
            StateRoot: {
              currentState: "visible",
              states: { visible: { sharedPanel: true }, hidden: { sharedPanel: false } },
            },
          },
        },
        { id: "sharedPanel", rect: rect() },
      ],
    },
  };
}

test("derives the upstream state that makes a nested StateRoot visible", () => {
  const resolution = resolveStateRootPreviewContext(shopSource(), "sellPage", undefined);
  assert.deepEqual(resolution.states, { viewState: "sell" });
  assert.deepEqual(resolution.automaticStates, { viewState: "sell" });
  assert.deepEqual(resolution.issues, []);
});

test("explicit preview context overrides automatic upstream selection", () => {
  const resolution = resolveStateRootPreviewContext(shopSource(), "sellPage", {
    sellPage: { viewState: "purchase" },
  });
  assert.deepEqual(resolution.states, { viewState: "purchase" });
  assert.deepEqual(resolution.automaticStates, { viewState: "sell" });
  assert.deepEqual(resolution.issues, []);
});

test("reports invalid context roots, states, and self overrides", () => {
  const source = shopSource();
  assert.deepEqual(stateRootPreviewContextIssues(source, { missing: { viewState: "sell" } }), [
    "State preview context target 'missing' has no StateRoot component",
  ]);
  assert.deepEqual(stateRootPreviewContextIssues(source, { sellPage: { missing: "sell", viewState: "missing", sellPage: "sell" } }), [
    "State preview context 'sellPage' references missing StateRoot 'missing'",
    "State preview context 'sellPage' references missing state 'viewState.missing'",
    "State preview context 'sellPage' cannot override its own state",
  ]);
});

test("enumerates every StateRoot that controls a node Active baseline", () => {
  const source = shopSource();
  assert.deepEqual(
    stateRootActiveControllers(source, "sharedPanel").map((control) => [
      control.stateRootNodeId,
      control.currentState,
      control.currentValue,
    ]),
    [
      ["viewState", "purchase", true],
      ["secondaryState", "visible", true],
    ],
  );
  assert.deepEqual(
    stateRootControlledActiveNodes(source, [source.root.children![3]!]).map((entry) => entry.node.id),
    ["sharedPanel"],
  );
});
