import assert from "node:assert/strict";
import test from "node:test";
import { createWebClasses } from "../../src/web/styles/web-styles.js";

test("Web classes resolve only explicit modules and already-scoped inputs", () => {
  const classes = createWebClasses({ button: "ui-shared__button" }, { button: "ui-feature__button", active: "ui-feature__active" });

  assert.equal(classes("button active"), "ui-shared__button ui-feature__button ui-feature__active");
  assert.equal(classes("unknown"), "");
  assert.equal(classes("ui-workspace__external unknown"), "ui-workspace__external");
  assert.equal(classes(false), "");
});
