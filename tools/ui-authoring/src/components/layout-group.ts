import { Type } from "@sinclair/typebox";
import { alignmentOptions } from "../registry/component-options.js";
import { componentField } from "./component-module.js";
import { childAlignmentSchema } from "./shared-schema.js";

export const layoutGroupFields = () => ({
  padding: componentField(Type.Optional(Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()])), {
    inspector: { label: "Padding", control: "vector4", defaultValue: [0, 0, 0, 0], labels: ["L", "R", "T", "B"] },
    override: true,
    unity: { codec: "rectOffset" },
  }),
  spacing: componentField(Type.Optional(Type.Number({ default: 0 })), {
    inspector: { label: "Spacing", control: "number", step: 0.5 },
    override: true,
  }),
  childAlignment: componentField(Type.Optional(childAlignmentSchema), {
    inspector: { label: "Child Alignment", control: "enum", options: alignmentOptions },
    override: true,
  }),
  reverseArrangement: componentField(Type.Optional(Type.Boolean({ default: false })), {
    inspector: { label: "Reverse Arrangement", control: "boolean" },
    override: true,
  }),
  childControlWidth: componentField(Type.Optional(Type.Boolean({ default: true })), {
    inspector: { label: "Control Child Width", control: "boolean" },
    override: true,
  }),
  childControlHeight: componentField(Type.Optional(Type.Boolean({ default: true })), {
    inspector: { label: "Control Child Height", control: "boolean" },
    override: true,
  }),
  childScaleWidth: componentField(Type.Optional(Type.Boolean({ default: false })), {
    inspector: { label: "Use Child Scale Width", control: "boolean" },
    override: true,
  }),
  childScaleHeight: componentField(Type.Optional(Type.Boolean({ default: false })), {
    inspector: { label: "Use Child Scale Height", control: "boolean" },
    override: true,
  }),
  childForceExpandWidth: componentField(Type.Optional(Type.Boolean({ default: true })), {
    inspector: { label: "Force Expand Width", control: "boolean" },
    override: true,
  }),
  childForceExpandHeight: componentField(Type.Optional(Type.Boolean({ default: true })), {
    inspector: { label: "Force Expand Height", control: "boolean" },
    override: true,
  }),
});
