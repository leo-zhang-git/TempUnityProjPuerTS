import assert from "node:assert/strict";
import test from "node:test";
import { contentType } from "../../src/server/mime.js";

test("resolves production Web and UI asset content types", () => {
  assert.equal(contentType("index.html"), "text/html; charset=utf-8");
  assert.equal(contentType("assets/index.css"), "text/css; charset=utf-8");
  assert.equal(contentType("assets/index.js"), "text/javascript; charset=utf-8");
  assert.equal(contentType("Font/alipuhui.ttf"), "font/ttf");
  assert.equal(contentType("Icons/item.PNG"), "image/png");
});

test("uses a binary fallback for unknown extensions", () => {
  assert.equal(contentType("asset.custom"), "application/octet-stream");
});
