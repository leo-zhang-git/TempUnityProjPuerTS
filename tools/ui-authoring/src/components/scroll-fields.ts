import { Type } from "@sinclair/typebox";
import { componentField } from "./component-module.js";
import { nodeIdSchema, requiredNodeReferenceSchema } from "./shared-schema.js";

const visibilityOptions = [
  { value: "permanent", label: "Permanent" },
  { value: "autoHide", label: "Auto Hide" },
  { value: "autoHideAndExpandViewport", label: "Auto Hide And Expand Viewport" },
] as const;

export function scrollFields() {
  return {
    content: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Content", control: "nodeReference", referenceFilter: "any" },
      materializeDefault: true,
    }),
    horizontal: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Horizontal", control: "boolean" },
      override: true,
    }),
    vertical: componentField(Type.Optional(Type.Boolean({ default: true })), {
      inspector: { label: "Vertical", control: "boolean" },
      override: true,
    }),
    movementType: componentField(
      Type.Optional(Type.Union([Type.Literal("unrestricted"), Type.Literal("elastic"), Type.Literal("clamped")], { default: "elastic" })),
      {
        inspector: {
          label: "Movement Type",
          control: "enum",
          options: [
            { value: "unrestricted", label: "Unrestricted" },
            { value: "elastic", label: "Elastic" },
            { value: "clamped", label: "Clamped" },
          ],
        },
        override: true,
      },
    ),
    elasticity: componentField(Type.Optional(Type.Number({ minimum: 0, default: 0.1 })), {
      inspector: {
        label: "Elasticity",
        control: "number",
        minimum: 0,
        step: 0.01,
        visibleWhen: { property: "movementType", equals: "elastic" },
      },
      override: true,
    }),
    inertia: componentField(Type.Optional(Type.Boolean({ default: true })), {
      inspector: { label: "Inertia", control: "boolean" },
      override: true,
    }),
    decelerationRate: componentField(Type.Optional(Type.Number({ minimum: 0, maximum: 1, default: 0.135 })), {
      inspector: {
        label: "Deceleration Rate",
        control: "number",
        minimum: 0,
        maximum: 1,
        step: 0.001,
        visibleWhen: { property: "inertia", equals: true },
      },
      override: true,
    }),
    scrollSensitivity: componentField(Type.Optional(Type.Number({ minimum: 0, default: 1 })), {
      inspector: { label: "Scroll Sensitivity", control: "number", minimum: 0, step: 0.1 },
      override: true,
    }),
    viewport: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Viewport", control: "nodeReference", referenceFilter: "any" },
      materializeDefault: true,
    }),
    horizontalScrollbar: componentField(Type.Optional(Type.Union([nodeIdSchema, Type.Null()], { default: null })), {
      inspector: { label: "Horizontal Scrollbar", control: "nodeReference", referenceFilter: "any", nullable: true },
    }),
    horizontalScrollbarVisibility: componentField(
      Type.Optional(
        Type.Union([Type.Literal("permanent"), Type.Literal("autoHide"), Type.Literal("autoHideAndExpandViewport")], {
          default: "permanent",
        }),
      ),
      {
        inspector: {
          label: "Horizontal Visibility",
          control: "enum",
          options: visibilityOptions,
          visibleWhen: { property: "horizontalScrollbar", present: true },
        },
        override: true,
      },
    ),
    horizontalScrollbarSpacing: componentField(Type.Optional(Type.Number({ default: -3 })), {
      inspector: {
        label: "Horizontal Spacing",
        control: "number",
        step: 0.5,
        visibleWhen: {
          all: [
            { property: "horizontalScrollbar", present: true },
            { property: "horizontalScrollbarVisibility", equals: "autoHideAndExpandViewport" },
          ],
        },
      },
      override: true,
    }),
    verticalScrollbar: componentField(Type.Optional(Type.Union([nodeIdSchema, Type.Null()], { default: null })), {
      inspector: { label: "Vertical Scrollbar", control: "nodeReference", referenceFilter: "any", nullable: true },
    }),
    verticalScrollbarVisibility: componentField(
      Type.Optional(
        Type.Union([Type.Literal("permanent"), Type.Literal("autoHide"), Type.Literal("autoHideAndExpandViewport")], {
          default: "permanent",
        }),
      ),
      {
        inspector: {
          label: "Vertical Visibility",
          control: "enum",
          options: visibilityOptions,
          visibleWhen: { property: "verticalScrollbar", present: true },
        },
        override: true,
      },
    ),
    verticalScrollbarSpacing: componentField(Type.Optional(Type.Number({ default: -3 })), {
      inspector: {
        label: "Vertical Spacing",
        control: "number",
        step: 0.5,
        visibleWhen: {
          all: [
            { property: "verticalScrollbar", present: true },
            { property: "verticalScrollbarVisibility", equals: "autoHideAndExpandViewport" },
          ],
        },
      },
      override: true,
    }),
  };
}
