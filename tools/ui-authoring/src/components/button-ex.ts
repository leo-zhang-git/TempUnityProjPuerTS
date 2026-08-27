import { Type } from "@sinclair/typebox";
import { componentField, defineComponent, nodesHaveAnyComponent } from "./component-module.js";
import { nodeIdSchema, requiredNodeReferenceSchema } from "./shared-schema.js";

const BUTTON_STATE_POLICY_REASON = "项目内禁用：按钮可用性由 StateRoot 的 UGray 与 UInteractable 控制";
const BUTTON_STYLE_POLICY_REASON = "项目内禁用：每种按钮视觉样式使用独立 Prefab";

function fixedEmptyButtonSpriteSchema() {
  return Type.Optional(Type.Null({ default: null }));
}

export const buttonExComponent = defineComponent({
  key: "ButtonEx",
  label: "Button Ex",
  bindingSuffix: "Button",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  unity: { type: "UnityEngine.UI.ButtonEx", pathConvention: "mPascal" },
  canAdd: ({ nodes }) => (nodesHaveAnyComponent(nodes, ["Image", "RoundedRect"]) ? undefined : "Requires an Image or Rounded Rect target"),
  initialize: (value, { node }) => (node.components?.Image || node.components?.RoundedRect ? { ...value, targetGraphic: node.id } : value),
  fields: {
    targetGraphic: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Target Graphic", control: "nodeReference", referenceFilter: "graphic" },
      materializeDefault: true,
    }),
    interactable: componentField(Type.Optional(Type.Literal(true, { default: true })), {
      inspector: { label: "Interactable", control: "boolean", projectDisabledReason: BUTTON_STATE_POLICY_REASON },
    }),
    transition: componentField(Type.Optional(Type.Literal("none", { default: "none" })), {
      inspector: {
        label: "Transition",
        control: "enum",
        options: [{ value: "none", label: "None" }],
        projectDisabledReason: BUTTON_STYLE_POLICY_REASON,
      },
      unity: { enumValues: { none: 0, colorTint: 1, spriteSwap: 2, animation: 3 } },
    }),
    highlightedSprite: componentField(fixedEmptyButtonSpriteSchema(), {
      inspector: {
        label: "Highlighted Sprite",
        control: "imageAsset",
        nullable: true,
        projectDisabledReason: BUTTON_STYLE_POLICY_REASON,
        visibleWhen: { property: "transition", equals: "spriteSwap" },
      },
      materializeDefault: true,
      asset: "image",
      unity: { path: "m_SpriteState.m_HighlightedSprite", codec: "asset" },
    }),
    pressedSprite: componentField(fixedEmptyButtonSpriteSchema(), {
      inspector: {
        label: "Pressed Sprite",
        control: "imageAsset",
        nullable: true,
        projectDisabledReason: BUTTON_STYLE_POLICY_REASON,
        visibleWhen: { property: "transition", equals: "spriteSwap" },
      },
      materializeDefault: true,
      asset: "image",
      unity: { path: "m_SpriteState.m_PressedSprite", codec: "asset" },
    }),
    selectedSprite: componentField(fixedEmptyButtonSpriteSchema(), {
      inspector: {
        label: "Selected Sprite",
        control: "imageAsset",
        nullable: true,
        projectDisabledReason: BUTTON_STYLE_POLICY_REASON,
        visibleWhen: { property: "transition", equals: "spriteSwap" },
      },
      materializeDefault: true,
      asset: "image",
      unity: { path: "m_SpriteState.m_SelectedSprite", codec: "asset" },
    }),
    disabledSprite: componentField(fixedEmptyButtonSpriteSchema(), {
      inspector: {
        label: "Disabled Sprite",
        control: "imageAsset",
        nullable: true,
        projectDisabledReason: BUTTON_STATE_POLICY_REASON,
      },
      materializeDefault: true,
      asset: "image",
      unity: { path: "m_SpriteState.m_DisabledSprite", codec: "asset" },
    }),
    usePressFeedback: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Use Press Feedback", control: "boolean" },
      override: true,
    }),
    pressFeedbackScale: componentField(Type.Optional(Type.Number({ exclusiveMinimum: 0, default: 0.95 })), {
      inspector: {
        label: "Press Feedback Scale",
        control: "number",
        minimum: 0.01,
        step: 0.01,
        visibleWhen: { property: "usePressFeedback", equals: true },
      },
      override: true,
    }),
    pressFeedbackScaleTarget: componentField(Type.Optional(Type.Union([nodeIdSchema, Type.Null()], { default: null })), {
      inspector: {
        label: "Press Feedback Scale Target",
        control: "nodeReference",
        referenceFilter: "any",
        nullable: true,
        visibleWhen: { property: "usePressFeedback", equals: true },
      },
      override: true,
      unity: { path: "m_PressFeedbackScaleGo" },
    }),
    pressFeedbackActiveTarget: componentField(Type.Optional(Type.Union([nodeIdSchema, Type.Null()], { default: null })), {
      inspector: {
        label: "Press Feedback Active Target",
        control: "nodeReference",
        referenceFilter: "any",
        nullable: true,
        visibleWhen: { property: "usePressFeedback", equals: true },
      },
      override: true,
      unity: { path: "m_PressFeedbackActiveGo" },
    }),
    useClickInterval: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Use Click Interval", control: "boolean" },
      override: true,
    }),
    clickInterval: componentField(Type.Optional(Type.Number({ minimum: 0, default: 0.3 })), {
      inspector: {
        label: "Click Interval",
        control: "number",
        minimum: 0,
        step: 0.05,
        visibleWhen: { property: "useClickInterval", equals: true },
      },
      override: true,
    }),
    useDoubleClick: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Use Double Click", control: "boolean" },
      override: true,
    }),
    useLongPress: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Use Long Press", control: "boolean" },
      override: true,
    }),
    longPressThreshold: componentField(Type.Optional(Type.Number({ minimum: 0, default: 0.7 })), {
      inspector: {
        label: "Long Press Threshold",
        control: "number",
        minimum: 0,
        step: 0.05,
        visibleWhen: { property: "useLongPress", equals: true },
      },
      override: true,
    }),
    longPressInterval: componentField(Type.Optional(Type.Number({ minimum: 0, default: 0.1 })), {
      inspector: {
        label: "Long Press Interval",
        control: "number",
        minimum: 0,
        step: 0.05,
        visibleWhen: { property: "useLongPress", equals: true },
      },
      override: true,
    }),
  },
});
