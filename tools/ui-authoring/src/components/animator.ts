import { Type } from "@sinclair/typebox";
import { componentField, defineComponent } from "./component-module.js";
import { assetPathSchema } from "./shared-schema.js";

export const animatorComponent = defineComponent({
  key: "Animator",
  label: "Animator",
  bindingSuffix: "Animator",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  unity: { type: "UnityEngine.Animator", pathConvention: "mPascal" },
  fields: {
    controller: componentField(Type.Optional(assetPathSchema), {
      inspector: { label: "Controller", control: "animatorControllerAsset" },
      override: true,
      asset: "animatorController",
      unity: { path: "m_Controller", codec: "asset" },
    }),
    updateMode: componentField(
      Type.Optional(Type.Union([Type.Literal("normal"), Type.Literal("fixed"), Type.Literal("unscaledTime")], { default: "normal" })),
      {
        inspector: {
          label: "Update Mode",
          control: "enum",
          options: [
            { value: "normal", label: "Normal" },
            { value: "fixed", label: "Fixed" },
            { value: "unscaledTime", label: "Unscaled Time" },
          ],
        },
        override: true,
        unity: { path: "m_UpdateMode" },
      },
    ),
    cullingMode: componentField(
      Type.Optional(
        Type.Union([Type.Literal("alwaysAnimate"), Type.Literal("cullUpdateTransforms"), Type.Literal("cullCompletely")], {
          default: "alwaysAnimate",
        }),
      ),
      {
        inspector: {
          label: "Culling Mode",
          control: "enum",
          options: [
            { value: "alwaysAnimate", label: "Always Animate" },
            { value: "cullUpdateTransforms", label: "Cull Update Transforms" },
            { value: "cullCompletely", label: "Cull Completely" },
          ],
        },
        override: true,
        unity: { path: "m_CullingMode" },
      },
    ),
    applyRootMotion: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Apply Root Motion", control: "boolean" },
      override: true,
      unity: { path: "m_ApplyRootMotion" },
    }),
    keepStateOnDisable: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Keep State On Disable", control: "boolean" },
      override: true,
      unity: { path: "m_KeepAnimatorStateOnDisable" },
    }),
  },
});
