import assert from "node:assert/strict";
import test from "node:test";
import { affineRectCorners } from "../../src/kernel/affine.js";
import { artifactInitialSize } from "../../src/kernel/artifact-size.js";
import { canvasViewport, createLayoutSnapshot, evaluateLayout, evaluateLocalLayout } from "../../src/kernel/layout.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";

function rect(width: number, height: number, x = 0, y = 0) {
  return {
    anchorMin: [0, 1] as [number, number],
    anchorMax: [0, 1] as [number, number],
    pivot: [0, 1] as [number, number],
    anchoredPosition: [x, -y] as [number, number],
    sizeDelta: [width, height] as [number, number],
  };
}

function child(id: string, preferredWidth: number, preferredHeight: number, extra: Partial<UiNode> = {}): UiNode {
  return {
    id,
    rect: rect(preferredWidth, preferredHeight),
    components: { LayoutElement: { preferredWidth, preferredHeight } },
    ...extra,
  };
}

function source(container: UiNode): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "LayoutTestCanvas",
    artifactType: "Canvas",
    root: {
      id: "LayoutTestCanvas",
      rect: {
        anchorMin: [0, 0],
        anchorMax: [1, 1],
        pivot: [0.5, 0.5],
        anchoredPosition: [0, 0],
        sizeDelta: [0, 0],
      },
      children: [container],
    },
  };
}

test("rejects non-positive artifact and screen sizes before layout math", () => {
  const canvas = source(child("content", 100, 40));
  const invalidWidget = {
    ...canvas,
    artifactType: "Widget" as const,
    widgetType: canvas.artifactKey,
    initialSize: [0, 100] as [number, number],
  };

  assert.throws(() => artifactInitialSize(invalidWidget), /initialSize must contain finite positive width and height/);
  assert.throws(() => canvasViewport(canvas, [0, 720]), /screenSize must contain finite positive width and height/);
  assert.throws(() => canvasViewport(canvas, [1280, 0]), /screenSize must contain finite positive width and height/);
  assert.throws(() => canvasViewport(canvas, [Number.POSITIVE_INFINITY, 720]), /screenSize must contain finite positive width and height/);
});

test("uses CanvasScaler Expand semantics for narrow, reference, and wide screens", () => {
  const canvas = source(child("content", 100, 40));
  assert.deepEqual(canvasViewport(canvas, [1280, 960]), {
    screenSize: [1280, 960],
    canvasSize: [1280, 960],
    scaleFactor: 1,
  });
  assert.deepEqual(canvasViewport(canvas, [1920, 1080]), {
    screenSize: [1920, 1080],
    canvasSize: [1280, 720],
    scaleFactor: 1.5,
  });
  assert.deepEqual(canvasViewport(canvas, [1680, 720]), {
    screenSize: [1680, 720],
    canvasSize: [1680, 720],
    scaleFactor: 1,
  });
});

test("composes parent rotation and scale into descendant world transforms", () => {
  const canvas = source({
    id: "rotatedParent",
    rect: { ...rect(200, 100, 300, 200), pivot: [0.5, 0.5], rotation: 90, scale: [2, 1] },
    children: [
      {
        id: "child",
        rect: { ...rect(40, 20, 20, 10), pivot: [0, 1] },
      },
    ],
  });
  const parent = evaluateLayout(canvas).children[0]!;
  const descendant = parent.children[0]!;
  assert.deepEqual(descendant.parentToCanvas, parent.localToCanvas);
  assert.ok(descendant.localToCanvas);
  const corners = affineRectCorners(descendant.localToCanvas, descendant.rect.width, descendant.rect.height);
  const rounded = corners.map((point) => point.map((value) => Math.round(value * 1000) / 1000));
  assert.deepEqual(rounded, [
    [260, 360],
    [260, 280],
    [280, 280],
    [280, 360],
  ]);
});

test("drives a direct Canvas child from an explicit screen safe area", () => {
  const canvas = source({
    id: "safeArea",
    rect: {
      anchorMin: [0, 0],
      anchorMax: [1, 1],
      pivot: [0.5, 0.5],
      anchoredPosition: [0, 0],
      sizeDelta: [0, 0],
    },
    components: {
      SafeArea: { referenceOrientation: "landscapeLeft", edges: "all", alignment: "none" },
    },
    children: [
      {
        id: "fixedStage",
        rect: {
          anchorMin: [0.5, 0.5],
          anchorMax: [0.5, 0.5],
          pivot: [0.5, 0.5],
          anchoredPosition: [0, 0],
          sizeDelta: [1280, 720],
        },
      },
    ],
  });

  const padded = evaluateLayout(canvas, [1680, 720], { safeArea: [80, 0, 1600, 720] }).children[0]!;
  assert.deepEqual([padded.rect.x, padded.rect.y, padded.rect.width, padded.rect.height], [80, 0, 1600, 720]);
  assert.deepEqual(
    [padded.children[0]!.rect.x, padded.children[0]!.rect.y, padded.children[0]!.rect.width, padded.children[0]!.rect.height],
    [240, 0, 1280, 720],
  );

  const horizontallyCenteredCanvas = structuredClone(canvas);
  horizontallyCenteredCanvas.root.children![0]!.components!.SafeArea!.alignment = "horizontal";
  const horizontallyCentered = evaluateLayout(horizontallyCenteredCanvas, [1680, 720], {
    safeArea: [80, 0, 1600, 720],
  }).children[0]!;
  assert.deepEqual(
    [horizontallyCentered.rect.x, horizontallyCentered.rect.y, horizontallyCentered.rect.width, horizontallyCentered.rect.height],
    [80, 0, 1520, 720],
  );
  assert.deepEqual(
    [
      horizontallyCentered.children[0]!.rect.x,
      horizontallyCentered.children[0]!.rect.y,
      horizontallyCentered.children[0]!.rect.width,
      horizontallyCentered.children[0]!.rect.height,
    ],
    [200, 0, 1280, 720],
  );

  const fourByThree = evaluateLayout(canvas, [1280, 960]).children[0]!;
  assert.deepEqual([fourByThree.children[0]!.rect.x, fourByThree.children[0]!.rect.y], [0, 120]);
  assert.throws(() => evaluateLayout(canvas, [1280, 720], { safeArea: [80, 0, 1280, 720] }), /safeArea must stay within screenSize/);
});

test("evaluates horizontal layout with padding, spacing and preferred sizes", () => {
  const value = source({
    id: "row",
    rect: rect(300, 100),
    components: {
      HorizontalLayoutGroup: {
        padding: [10, 10, 10, 10],
        spacing: 5,
        childControlWidth: true,
        childControlHeight: true,
        childForceExpandWidth: false,
        childForceExpandHeight: false,
      },
    },
    children: [child("first", 50, 20), child("second", 70, 30)],
  });
  const row = evaluateLayout(value).children[0]!;
  assert.deepEqual(
    row.children.map(({ rect: item }) => [item.x, item.y, item.width, item.height]),
    [
      [10, 10, 50, 20],
      [65, 10, 70, 30],
    ],
  );
});

test("force expand uses parent inner width after LayoutElement preferred width", () => {
  const value = source({
    id: "column",
    rect: rect(400, 100),
    components: { VerticalLayoutGroup: { childForceExpandWidth: true, childForceExpandHeight: false } },
    children: [child("divider", 378, 10)],
  });
  const divider = evaluateLayout(value).children[0]!.children[0]!;
  assert.equal(divider.rect.width, 400);
});

test("LayoutElement maximum size clamps its preferred layout size", () => {
  const value = source({
    id: "row",
    rect: rect(400, 100),
    components: {
      HorizontalLayoutGroup: {
        childControlWidth: true,
        childControlHeight: true,
        childForceExpandWidth: false,
        childForceExpandHeight: false,
      },
    },
    children: [
      child("limited", 240, 80, {
        components: { LayoutElement: { preferredWidth: 240, preferredHeight: 80, maxWidth: 120, maxHeight: 40 } },
      }),
    ],
  });
  const limited = evaluateLayout(value).children[0]!.children[0]!;
  assert.deepEqual([limited.rect.width, limited.rect.height], [120, 40]);
});

test("reflows stretched descendants after a layout group resizes their parent", () => {
  const value = source({
    id: "column",
    rect: rect(400, 100),
    components: { VerticalLayoutGroup: { childForceExpandWidth: true, childForceExpandHeight: false } },
    children: [
      {
        id: "panel",
        rect: rect(240, 40),
        components: { LayoutElement: { preferredWidth: 240, preferredHeight: 40 } },
        children: [
          {
            id: "viewport",
            rect: {
              anchorMin: [0, 0],
              anchorMax: [1, 1],
              pivot: [0.5, 0.5],
              anchoredPosition: [-10, 0],
              sizeDelta: [-20, 0],
            },
          },
        ],
      },
    ],
  });
  const panel = evaluateLayout(value).children[0]!.children[0]!;
  const viewport = panel.children[0]!;
  assert.equal(panel.rect.width, 400);
  assert.deepEqual([viewport.rect.x, viewport.rect.width], [0, 380]);
});

test("a LayoutElement on a group affects its parent but not its own child arrangement totals", () => {
  const value = source({
    id: "row",
    rect: rect(300, 40),
    components: {
      HorizontalLayoutGroup: {
        childAlignment: "upperCenter",
        childForceExpandWidth: false,
        childForceExpandHeight: false,
      },
      LayoutElement: { preferredWidth: 300 },
    },
    children: [child("first", 50, 20), child("second", 50, 20)],
  });
  const row = evaluateLayout(value).children[0]!;
  assert.deepEqual(
    row.children.map(({ rect: item }) => [item.x, item.width]),
    [
      [100, 50],
      [150, 50],
    ],
  );
});

test("content fitter and vertical layout use active non-ignored children", () => {
  const value = source({
    id: "column",
    rect: rect(100, 100),
    components: {
      VerticalLayoutGroup: {
        padding: [5, 5, 5, 5],
        spacing: 2,
        childControlWidth: false,
        childControlHeight: true,
        childForceExpandWidth: false,
        childForceExpandHeight: false,
      },
      ContentSizeFitter: { verticalFit: "preferredSize" },
    },
    children: [
      child("first", 40, 20),
      child("ignored", 40, 200, { components: { LayoutElement: { ignoreLayout: true, preferredHeight: 200 } } }),
      child("inactive", 40, 200, { active: false }),
      child("second", 40, 30),
    ],
  });
  const column = evaluateLayout(value).children[0]!;
  assert.equal(column.rect.height, 62);
  assert.deepEqual(
    column.children.map((item) => [item.node.id, item.rect.y, item.rect.height]),
    [
      ["first", 5, 20],
      ["ignored", 0, 200],
      ["inactive", 0, 200],
      ["second", 27, 30],
    ],
  );
});

test("Widget root content fitter overrides its persisted initial size", () => {
  const value: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "DynamicWidget",
    artifactType: "Widget",
    widgetType: "DynamicWidget",
    initialSize: [200, 160],
    root: {
      id: "DynamicWidget",
      rect: rect(200, 160),
      components: {
        ContentSizeFitter: { verticalFit: "preferredSize" },
        VerticalLayoutGroup: { spacing: 4, childForceExpandHeight: false },
      },
      children: [child("first", 100, 20), child("second", 100, 30)],
    },
  };

  assert.equal(evaluateLocalLayout(value).rect.height, 54);
});

test("scroll content provides preferred size when the scroll LayoutElement only sets a minimum", () => {
  const value: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "DynamicScrollWidget",
    artifactType: "Widget",
    widgetType: "DynamicScrollWidget",
    initialSize: [200, 160],
    root: {
      id: "DynamicScrollWidget",
      rect: rect(200, 160),
      components: {
        ContentSizeFitter: { verticalFit: "preferredSize" },
        VerticalLayoutGroup: { childForceExpandHeight: false },
      },
      children: [
        {
          id: "scroll",
          rect: rect(200, 40),
          components: {
            LayoutElement: { minHeight: 40, preferredWidth: 200 },
            ScrollRectEx: { content: "content", viewport: "viewport", templates: {} },
          },
          children: [
            {
              id: "viewport",
              rect: rect(200, 40),
              children: [
                {
                  id: "content",
                  rect: rect(200, 40),
                  components: {
                    ContentSizeFitter: { verticalFit: "preferredSize" },
                    VerticalLayoutGroup: { childForceExpandHeight: false },
                  },
                  children: [child("description", 180, 90)],
                },
              ],
            },
          ],
        },
      ],
    },
  };

  const evaluated = evaluateLocalLayout(value);
  assert.equal(evaluated.rect.height, 90);
  assert.equal(evaluated.children[0]!.rect.height, 90);
  assert.equal(evaluated.children[0]!.children[0]!.children[0]!.rect.height, 90);
});

test("evaluates fixed-column grid placement", () => {
  const value = source({
    id: "grid",
    rect: rect(130, 70),
    components: {
      GridLayoutGroup: {
        cellSize: [40, 20],
        spacing: [10, 10],
        padding: [5, 5, 5, 5],
        constraint: "fixedColumnCount",
        constraintCount: 2,
      },
    },
    children: [child("a", 1, 1), child("b", 1, 1), child("c", 1, 1)],
  });
  const grid = evaluateLayout(value).children[0]!;
  assert.deepEqual(
    grid.children.map(({ rect: item }) => [item.x, item.y, item.width, item.height]),
    [
      [5, 5, 40, 20],
      [55, 5, 40, 20],
      [5, 35, 40, 20],
    ],
  );
});

test("AutoLayoutGroup linear modes match native layout groups", () => {
  const children = [child("first", 50, 20), child("second", 70, 30)];
  const config = {
    padding: [10, 10, 10, 10] as [number, number, number, number],
    spacing: 5,
    childControlWidth: true,
    childControlHeight: true,
    childForceExpandWidth: false,
    childForceExpandHeight: false,
  };
  const native = evaluateLayout(
    source({ id: "row", rect: rect(300, 100), components: { HorizontalLayoutGroup: config }, children: structuredClone(children) }),
  ).children[0]!;
  const auto = evaluateLayout(
    source({
      id: "row",
      rect: rect(300, 100),
      components: { AutoLayoutGroup: { mode: "horizontal", ...config } },
      children: structuredClone(children),
    }),
  ).children[0]!;
  assert.deepEqual(
    auto.children.map(({ rect: item }) => [item.x, item.y, item.width, item.height]),
    native.children.map(({ rect: item }) => [item.x, item.y, item.width, item.height]),
  );
});

test("AutoLayoutGroup linear modes preserve baseline child size when control fields are omitted", () => {
  const document = source({
    id: "row",
    rect: rect(300, 100),
    components: { AutoLayoutGroup: { mode: "horizontal" } },
    children: [
      {
        ...child("item", 50, 20),
        components: { LayoutElement: { preferredWidth: 140, preferredHeight: 80 } },
      },
    ],
  });
  const item = evaluateLayout(document).children[0]!.children[0]!.rect;
  assert.deepEqual([item.width, item.height], [50, 20]);
});

test("AutoLayoutGroup grid capacity follows current width and returns after resize", () => {
  const document = source({
    id: "grid",
    rect: rect(520, 200),
    components: { AutoLayoutGroup: { mode: "grid", cellSize: [100, 40], gridSpacing: [20, 10] } },
    children: ["a", "b", "c", "d", "e"].map((id) => child(id, 1, 1)),
  });
  const columns = (width: number): number => {
    document.root.children![0]!.rect.sizeDelta[0] = width;
    const children = evaluateLayout(document).children[0]!.children;
    return new Set(children.slice(0, 4).map((entry) => entry.rect.y)).size === 1 ? 4 : 2;
  };
  assert.deepEqual([columns(520), columns(300), columns(520)], [4, 2, 4]);
});

test("AutoLayoutGroup fixed grid constrains only the Start Axis capacity", () => {
  const document = source({
    id: "grid",
    rect: rect(520, 240),
    components: {
      AutoLayoutGroup: {
        mode: "grid",
        autoGrid: false,
        columnCount: 3,
        cellSize: [100, 40],
        gridSpacing: [20, 10],
        childAlignment: "middleCenter",
      },
    },
    children: ["a", "b", "c", "d"].map((id) => child(id, 1, 1)),
  });
  const grid = evaluateLayout(document).children[0]!;
  assert.deepEqual(
    grid.children.map((entry) => [entry.rect.x, entry.rect.y]),
    [
      [90, 75],
      [210, 75],
      [330, 75],
      [90, 125],
    ],
  );
  document.root.children![0]!.rect.sizeDelta = [760, 360];
  const resized = evaluateLayout(document).children[0]!;
  assert.deepEqual(
    resized.children.map((entry) => [entry.rect.x, entry.rect.y]),
    [
      [210, 135],
      [330, 135],
      [450, 135],
      [210, 185],
    ],
  );
  document.root.children![0]!.components!.AutoLayoutGroup = {
    mode: "grid",
    autoGrid: false,
    startAxis: "vertical",
    rowCount: 3,
    cellSize: [100, 40],
    gridSpacing: [20, 10],
    childAlignment: "middleCenter",
  };
  const vertical = evaluateLayout(document).children[0]!;
  assert.deepEqual(
    vertical.children.map((entry) => [entry.rect.x, entry.rect.y]),
    [
      [270, 110],
      [270, 160],
      [270, 210],
      [390, 110],
    ],
  );
});

test("uses injected intrinsic text metrics in layout", () => {
  const value = source({
    id: "row",
    rect: rect(200, 40),
    components: {
      HorizontalLayoutGroup: {
        childControlWidth: true,
        childControlHeight: true,
        childForceExpandWidth: false,
        childForceExpandHeight: false,
      },
    },
    children: [
      {
        id: "label",
        rect: rect(1, 1),
        components: { Text: { text: "Measured", fontSize: 20 } },
      },
    ],
  });
  const row = evaluateLayout(value, artifactInitialSize(value), {
    intrinsic: {
      measureText: () => ({ minWidth: 30, preferredWidth: 80, minHeight: 12, preferredHeight: 24 }),
    },
  }).children[0]!;
  assert.deepEqual([row.children[0]!.rect.width, row.children[0]!.rect.height], [80, 24]);
});

test("applies aspect ratio fitter without CSS layout", () => {
  const value = source({
    id: "aspect",
    rect: rect(120, 80),
    components: { AspectRatioFitter: { aspectMode: "widthControlsHeight", aspectRatio: 2 } },
  });
  assert.deepEqual([evaluateLayout(value).children[0]!.rect.width, evaluateLayout(value).children[0]!.rect.height], [120, 60]);
});

test("does not audit intrinsic text metrics for inactive hierarchy", () => {
  const value = source({
    id: "inactiveParent",
    active: false,
    rect: rect(120, 80),
    children: [{ id: "label", rect: rect(100, 20), components: { Text: { text: "Hidden", fontSize: 20 } } }],
  });
  const snapshot = createLayoutSnapshot(value, [artifactInitialSize(value)], {
    intrinsic: { measureText: () => ({ preferredWidth: 60, preferredHeight: 20 }) },
  });
  assert.equal(snapshot.screens[0]!.nodes.find((node) => node.id === "label")!.textIntrinsic, undefined);
});
