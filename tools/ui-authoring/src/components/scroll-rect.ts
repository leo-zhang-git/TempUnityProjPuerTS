import { defineComponent } from "./component-module.js";
import { scrollFields } from "./scroll-fields.js";

export const scrollRectComponent = defineComponent({
  key: "ScrollRect",
  label: "Scroll Rect",
  bindingSuffix: "ScrollView",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  unity: { type: "UnityEngine.UI.ScrollRect", exactType: true, pathConvention: "mPascal" },
  fields: scrollFields(),
});
