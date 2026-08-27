import assert from "node:assert/strict";
import test from "node:test";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import {
  PROJECT_ASSET_DRAG_TYPE,
  PROJECT_ITEM_DRAG_TYPE,
  PROJECT_PREFAB_REF_DRAG_TYPE,
  prefabRefDropParentIds,
  prefabRefProjectDragItem,
  readProjectDragData,
  setProjectDragData,
} from "../../src/web/shared/project-drag.js";

function dataTransfer(): DataTransfer {
  const data = new Map<string, string>();
  return {
    effectAllowed: "uninitialized",
    get types() {
      return [...data.keys()];
    },
    getData: (format: string) => data.get(format) ?? "",
    setData: (format: string, value: string) => {
      data.set(format, value);
    },
  } as unknown as DataTransfer;
}

test("marks Widget documents for both Project moves and PrefabRef copies", () => {
  const transfer = dataTransfer();
  setProjectDragData(transfer, {
    kind: "document",
    documentKind: "artifact",
    key: "StatusWidget",
    path: "Hud/StatusWidget.ui.json",
    artifactType: "Widget",
  });

  assert.equal(transfer.effectAllowed, "copyMove");
  assert.ok(transfer.types.includes(PROJECT_ITEM_DRAG_TYPE));
  assert.ok(transfer.types.includes(PROJECT_PREFAB_REF_DRAG_TYPE));
  assert.equal(transfer.types.includes(PROJECT_ASSET_DRAG_TYPE), false);
  const item = readProjectDragData(transfer);
  assert.deepEqual(item, {
    kind: "document",
    documentKind: "artifact",
    key: "StatusWidget",
    path: "Hud/StatusWidget.ui.json",
    artifactType: "Widget",
  });
  assert.deepEqual(item && prefabRefProjectDragItem(item), {
    kind: "artifact",
    artifactKey: "StatusWidget",
    artifactType: "Widget",
  });
});

test("keeps ordinary documents move-only and resolves legacy Artifact documents from the Catalog", () => {
  const transfer = dataTransfer();
  setProjectDragData(transfer, { kind: "document", documentKind: "reference", key: "Hud", path: "Hud.ui-reference.json" });
  assert.equal(transfer.effectAllowed, "move");
  assert.equal(transfer.types.includes(PROJECT_PREFAB_REF_DRAG_TYPE), false);

  const legacy = { kind: "document", documentKind: "artifact", key: "BadgeFragment", path: "BadgeFragment.ui.json" } as const;
  assert.deepEqual(
    prefabRefProjectDragItem(legacy, () => "Fragment"),
    {
      kind: "artifact",
      artifactKey: "BadgeFragment",
      artifactType: "Fragment",
    },
  );
});

test("marks direct Artifact and asset drags with their reusable capabilities", () => {
  const artifactTransfer = dataTransfer();
  setProjectDragData(artifactTransfer, { kind: "artifact", artifactKey: "BadgeFragment", artifactType: "Fragment" });
  assert.equal(artifactTransfer.effectAllowed, "copy");
  assert.ok(artifactTransfer.types.includes(PROJECT_PREFAB_REF_DRAG_TYPE));

  const assetTransfer = dataTransfer();
  setProjectDragData(assetTransfer, { kind: "asset", assetKind: "image", path: "Icons/Ready.png" });
  assert.equal(assetTransfer.effectAllowed, "copyMove");
  assert.ok(assetTransfer.types.includes(PROJECT_ASSET_DRAG_TYPE));
  assert.equal(assetTransfer.types.includes(PROJECT_PREFAB_REF_DRAG_TYPE), false);
});

test("resolves Canvas PrefabRef hits to the nearest legal local parent", () => {
  const source: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "HudCanvas",
    artifactType: "Canvas",
    root: {
      id: "HudCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        {
          id: "hudLayer",
          rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
          children: [
            {
              id: "viewPad",
              rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
              components: { PrefabRef: { artifactKey: "ViewPadWidget" } },
              children: [
                {
                  id: "localDecoration",
                  rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [10, 10] },
                },
              ],
            },
            {
              id: "localPanel",
              rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [100, 100] },
            },
          ],
        },
      ],
    },
  };

  const parents = prefabRefDropParentIds(source);
  assert.equal(parents.get("viewPad"), "hudLayer");
  assert.equal(parents.get("localDecoration"), "hudLayer");
  assert.equal(parents.get("localPanel"), "localPanel");
  assert.equal(parents.get("HudCanvas"), "HudCanvas");
});
