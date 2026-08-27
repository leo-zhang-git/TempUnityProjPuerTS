import assert from "node:assert/strict";
import test from "node:test";
import { auditBindingName, bindingNamingRuleCodes } from "../../src/kernel/binding-naming.js";

test("Binding naming audit accepts confirmed prefixes and nested Widget identities", () => {
  assert.deepEqual(auditBindingName("txt_title", "Text", "txt_title"), []);
  assert.deepEqual(auditBindingName("img_icon", "Image", "img_icon"), []);
  assert.deepEqual(auditBindingName("btn_close", "ButtonEx", "btn_close"), []);
  assert.deepEqual(auditBindingName("StatusWidget", "PrefabRef", "StatusWidget"), []);
  assert.deepEqual(auditBindingName("left_item", "PrefabRef", "left_item"), []);
});

test("Binding naming audit reports format, prefix, node and unconfirmed-type violations", () => {
  assert.deepEqual(
    auditBindingName("titleText", "Text").map((violation) => violation.rule),
    ["format", "prefix"],
  );
  assert.deepEqual(
    auditBindingName("img_title", "Text").map((violation) => violation.rule),
    ["prefix"],
  );
  assert.deepEqual(
    auditBindingName("txt_title", "Text", "Title").map((violation) => violation.rule),
    ["node_name"],
  );
  assert.deepEqual(
    auditBindingName("animation", "Animation").map((violation) => violation.rule),
    ["unconfirmed_type"],
  );
});

test("Binding naming rule codes are stable and complete", () => {
  assert.deepEqual(bindingNamingRuleCodes(), [
    "binding.naming.format",
    "binding.naming.prefix",
    "binding.naming.node_name",
    "binding.naming.primary_reference",
    "binding.naming.unconfirmed_type",
  ]);
});
