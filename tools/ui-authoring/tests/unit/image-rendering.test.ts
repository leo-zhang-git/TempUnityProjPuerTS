import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageVisual, imageFillMaskStyle } from "../../src/web/rendering/artifact-renderer/image-rendering.js";

test("renders linear Image fills from the configured Unity origin", () => {
  assert.deepEqual(imageFillMaskStyle({ imageType: "filled", fillMethod: "horizontal", fillOrigin: "right", fillAmount: 0.25 }), {
    clipPath: "inset(0 0 0 75%)",
  });
  assert.deepEqual(imageFillMaskStyle({ imageType: "filled", fillMethod: "vertical", fillOrigin: "bottom", fillAmount: 0.25 }), {
    clipPath: "inset(75% 0 0 0)",
  });
});

test("renders radial Image fills with method, origin and clockwise direction", () => {
  const clockwise = imageFillMaskStyle({
    imageType: "filled",
    fillMethod: "radial180",
    fillOrigin: "left",
    fillAmount: 0.5,
    fillClockwise: true,
  });
  const counterClockwise = imageFillMaskStyle({
    imageType: "filled",
    fillMethod: "radial180",
    fillOrigin: "left",
    fillAmount: 0.5,
    fillClockwise: false,
  });
  assert.match(String(clockwise.maskImage), /from 0deg at 0% 50%.*90deg/);
  assert.match(String(counterClockwise.maskImage), /from -90deg at 0% 50%.*90deg/);
});

test("renders Tiled and Sliced Image types through distinct structures", () => {
  const metrics = { width: 32, height: 16, pixelsPerUnit: 100, border: [2, 3, 4, 5] as const };
  const tiled = renderToStaticMarkup(
    createElement(ImageVisual, { image: { sprite: "Images/Tile.png", imageType: "tiled", color: "#336699FF" }, metrics }),
  );
  const sliced = renderToStaticMarkup(
    createElement(ImageVisual, {
      image: { sprite: "Images/Panel.png", imageType: "sliced", fillCenter: false, color: "#336699FF" },
      metrics,
    }),
  );
  assert.match(tiled, /data-image-type="tiled"/);
  assert.match(tiled, /border-image-repeat:round/);
  assert.match(tiled, /feFuncR type="linear" slope="0.2"/);
  assert.match(tiled, /filter:url\(#image-tint-/);
  assert.match(sliced, /data-image-type="sliced"/);
  assert.doesNotMatch(sliced, /fill/);
  assert.match(sliced, /feFuncB type="linear" slope="0.6"/);
  assert.match(sliced, /filter:url\(#image-tint-/);
});

test("applies RGBA tint to a Tiled Image without sprite borders", () => {
  const metrics = { width: 32, height: 16, pixelsPerUnit: 100, border: [0, 0, 0, 0] as const };
  const tiled = renderToStaticMarkup(
    createElement(ImageVisual, { image: { sprite: "Images/Tile.png", imageType: "tiled", color: "#FFFFFF80" }, metrics }),
  );
  assert.match(tiled, /background-repeat:repeat/);
  assert.match(tiled, /feFuncA type="linear" slope="0\.5019607843137255"/);
  assert.match(tiled, /filter:url\(#image-tint-/);
});
