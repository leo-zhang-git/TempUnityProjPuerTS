import { defineComponent } from "./component-module.js";
import { layoutGroupFields } from "./layout-group.js";

export const verticalLayoutGroupComponent = defineComponent({
  key: "VerticalLayoutGroup",
  label: "Vertical Layout Group",
  bindingSuffix: "Layout",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  useSiteAddable: true,
  exclusiveGroup: "layoutDriver",
  unity: { type: "UnityEngine.UI.VerticalLayoutGroup", pathConvention: "mPascal" },
  fields: layoutGroupFields(),
});
