import { Type } from "@sinclair/typebox";
import { componentField, defineComponent, nodesHaveAnyComponent } from "./component-module.js";
import { requiredNodeReferenceSchema } from "./shared-schema.js";

export const virtualJoystickComponent = defineComponent({
  key: "VirtualJoystick",
  label: "Virtual Joystick",
  bindingSuffix: "VirtualJoystick",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  unity: { type: "PuerTsTemplate.UI.VirtualJoystick", pathConvention: "exact", capability: "virtualJoystick" },
  canAdd: ({ nodes }) => (nodesHaveAnyComponent(nodes, ["Image"]) ? undefined : "Requires an Image target"),
  fields: {
    area: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Area", control: "nodeReference", referenceFilter: "image" },
      materializeDefault: true,
    }),
    background: componentField(requiredNodeReferenceSchema, {
      inspector: { label: "Background", control: "nodeReference", referenceFilter: "image" },
      materializeDefault: true,
      unity: { path: "backGround" },
    }),
    knob: componentField(Type.Optional(requiredNodeReferenceSchema), {
      inspector: { label: "Knob", control: "nodeReference", referenceFilter: "any" },
      materializeDefault: true,
      unity: { path: "stickNob" },
    }),
    isActiveJoystick: componentField(Type.Optional(Type.Boolean({ default: true })), {
      inspector: { label: "Active Joystick", control: "boolean" },
    }),
    staticBackground: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: {
        label: "Static Background",
        control: "boolean",
        visibleWhen: { property: "isActiveJoystick", equals: true },
      },
    }),
    keepKnobVisibleWhenIdle: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Keep Knob Visible When Idle", control: "boolean" },
    }),
    maxOffsetScale: componentField(Type.Optional(Type.Number({ minimum: 0, default: 1 })), {
      inspector: { label: "Max Offset Scale", control: "number", minimum: 0, step: 0.1 },
      unity: { path: "knobMaxOffsetScale" },
    }),
  },
});
