import { Type } from "@sinclair/typebox";
import { componentField, defineComponent } from "./component-module.js";
import { assetPathSchema } from "./shared-schema.js";

const animationClipListSchema = Type.Array(assetPathSchema, { default: [] });

export const animationComponent = defineComponent({
  key: "Animation",
  label: "Animation",
  bindingSuffix: "Animation",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  unity: { type: "UnityEngine.Animation", pathConvention: "mPascal" },
  fields: {
    defaultClip: componentField(Type.Optional(assetPathSchema), {
      inspector: { label: "Default Clip", control: "animationClipAsset" },
      override: true,
      asset: "animationClip",
      unity: { path: "m_Animation", codec: "asset" },
    }),
    clips: componentField(Type.Optional(animationClipListSchema), {
      inspector: { label: "Clips", control: "animationClipList" },
      override: true,
      asset: "animationClip",
      unity: { path: "m_Animations", codec: "assetArray" },
    }),
    wrapMode: componentField(
      Type.Optional(
        Type.Union(
          [Type.Literal("default"), Type.Literal("once"), Type.Literal("loop"), Type.Literal("pingPong"), Type.Literal("clampForever")],
          { default: "default" },
        ),
      ),
      {
        inspector: {
          label: "Wrap Mode",
          control: "enum",
          options: [
            { value: "default", label: "Default" },
            { value: "once", label: "Once" },
            { value: "loop", label: "Loop" },
            { value: "pingPong", label: "Ping Pong" },
            { value: "clampForever", label: "Clamp Forever" },
          ],
        },
        override: true,
        unity: { path: "m_WrapMode", enumValues: { default: 0, once: 1, loop: 2, pingPong: 4, clampForever: 8 } },
      },
    ),
    playAutomatically: componentField(Type.Optional(Type.Boolean({ default: true })), {
      inspector: { label: "Play Automatically", control: "boolean" },
      override: true,
      unity: { path: "m_PlayAutomatically" },
    }),
    animatePhysics: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Animate Physics", control: "boolean" },
      override: true,
      unity: { path: "m_AnimatePhysics" },
    }),
    updateMode: componentField(
      Type.Optional(
        Type.Union([Type.Literal("normal"), Type.Literal("animatePhysics"), Type.Literal("unscaledTime")], { default: "normal" }),
      ),
      {
        inspector: {
          label: "Update Mode",
          control: "enum",
          options: [
            { value: "normal", label: "Normal" },
            { value: "animatePhysics", label: "Animate Physics" },
            { value: "unscaledTime", label: "Unscaled Time" },
          ],
        },
        override: true,
        unity: { path: "m_UpdateMode" },
      },
    ),
    cullingType: componentField(
      Type.Optional(
        Type.Union(
          [
            Type.Literal("alwaysAnimate"),
            Type.Literal("basedOnRenderers"),
            Type.Literal("basedOnClipBounds"),
            Type.Literal("basedOnUserBounds"),
          ],
          { default: "alwaysAnimate" },
        ),
      ),
      {
        inspector: {
          label: "Culling Type",
          control: "enum",
          options: [
            { value: "alwaysAnimate", label: "Always Animate" },
            { value: "basedOnRenderers", label: "Based On Renderers" },
            { value: "basedOnClipBounds", label: "Based On Clip Bounds" },
            { value: "basedOnUserBounds", label: "Based On User Bounds" },
          ],
        },
        override: true,
        unity: { path: "m_CullingType" },
      },
    ),
  },
});
