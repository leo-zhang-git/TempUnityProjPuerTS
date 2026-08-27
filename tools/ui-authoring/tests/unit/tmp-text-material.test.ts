import assert from "node:assert/strict";
import test from "node:test";
import { formatSource } from "../../src/kernel/canonical.js";
import { createUnityProjection } from "../../src/kernel/projection.js";
import { componentInspectorFields } from "../../src/registry/component-registry.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { textMaterialStyle } from "../../src/web/rendering/artifact-renderer/artifact-rendering.js";

function source(material?: "normal" | "outline", font?: string): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "TextMaterialWidget",
    artifactType: "Widget",
    widgetType: "TextMaterialWidget",
    initialSize: [320, 80],
    root: {
      id: "TextMaterialWidget",
      rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [320, 80] },
      components: { Text: { text: "Outlined", fontSize: 24, ...(font ? { font } : {}), ...(material ? { material } : {}) } },
    },
  };
}

test("TMP material uses a canonical enum and projects the normal default", () => {
  assert.doesNotMatch(formatSource(source("normal")), /"material"/);
  assert.equal((createUnityProjection(source()).root.components.Text as { readonly material?: string }).material, "normal");
  assert.equal((createUnityProjection(source("outline")).root.components.Text as { readonly material?: string }).material, "outline");
  assert.throws(() => createUnityProjection(source("outline", "Font/Alternate.asset")), /Outline material requires the default UI font/);
});

test("TMP material Inspector and Web Preview expose only normal and outline", () => {
  const field = componentInspectorFields("Text").find((entry) => "property" in entry && entry.property === "material");
  assert.deepEqual(field && "options" in field ? field.options : undefined, [
    { value: "normal", label: "普通" },
    { value: "outline", label: "描边" },
  ]);
  assert.equal(textMaterialStyle({ material: "normal" }).textShadow, undefined);
  assert.match(String(textMaterialStyle({ material: "outline", fontSize: 24 }).textShadow), /rgba\(0, 0, 0, 0\.95\)/);
});
