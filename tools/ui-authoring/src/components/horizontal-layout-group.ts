import { defineComponent } from "./component-module.js";
import { layoutGroupFields } from "./layout-group.js";

export const horizontalLayoutGroupComponent = defineComponent({
  key: "HorizontalLayoutGroup",
  label: "Horizontal Layout Group",
  bindingSuffix: "Layout",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  useSiteAddable: true,
  exclusiveGroup: "layoutDriver",
  unity: { type: "UnityEngine.UI.HorizontalLayoutGroup", pathConvention: "mPascal" },
  fields: layoutGroupFields(),
});
