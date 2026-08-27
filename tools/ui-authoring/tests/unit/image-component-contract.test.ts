import assert from "node:assert/strict";
import test from "node:test";
import { createArtifactSource } from "../../src/kernel/authoring.js";
import { formatSource } from "../../src/kernel/canonical.js";
import { defaultImageFillOrigin, imageFillOriginIndex, imageFillOriginToken } from "../../src/kernel/image-contract.js";
import { validateSource } from "../../src/kernel/validation.js";
import type { UiComponents } from "../../src/schema/ui-source-schema.js";

function sourceWithImage(image: NonNullable<UiComponents["Image"]>) {
  const source = createArtifactSource({ artifactKey: "ImageContractCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
  source.root.components = { Image: image };
  return source;
}

test("accepts complete Image type fields and rejects an origin outside its Fill Method", () => {
  const tiled = sourceWithImage({ imageType: "tiled", fillCenter: false, pixelsPerUnitMultiplier: 2 });
  assert.equal(validateSource(tiled).valid, true);

  const validFilled = sourceWithImage({ imageType: "filled", fillMethod: "horizontal", fillOrigin: "right", fillAmount: 0.25 });
  assert.equal(validateSource(validFilled).valid, true);

  const invalidFilled = sourceWithImage({ imageType: "filled", fillMethod: "horizontal", fillOrigin: "top" });
  const result = validateSource(invalidFilled);
  assert.equal(result.valid, false);
  assert.equal(result.issues[0]?.code, "image.fillOrigin");
});

test("maps semantic Image origins onto Unity indices", () => {
  assert.equal(defaultImageFillOrigin("horizontal"), "left");
  assert.equal(defaultImageFillOrigin("radial90"), "bottomLeft");
  assert.equal(imageFillOriginIndex("radial360", "left"), 3);
  assert.equal(imageFillOriginToken("vertical", 1), "top");
  assert.equal(imageFillOriginToken("horizontal", 9), "left");
});

test("canonical Source keeps hidden non-default Image values", () => {
  const source = sourceWithImage({
    imageType: "simple",
    fillMethod: "horizontal",
    fillOrigin: "right",
    fillAmount: 0.5,
    fillClockwise: false,
  });
  const formatted = formatSource(source);
  assert.match(formatted, /"fillMethod": "horizontal"/);
  assert.match(formatted, /"fillOrigin": "right"/);
  assert.match(formatted, /"fillAmount": 0.5/);
  assert.match(formatted, /"fillClockwise": false/);
});
