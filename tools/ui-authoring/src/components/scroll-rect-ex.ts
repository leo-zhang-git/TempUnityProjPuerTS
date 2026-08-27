import { Type } from "@sinclair/typebox";
import { componentField, defineComponent } from "./component-module.js";
import { scrollFields } from "./scroll-fields.js";
import { nodeIdSchema, requiredNodeReferenceSchema } from "./shared-schema.js";

export const scrollRectExComponent = defineComponent({
  key: "ScrollRectEx",
  label: "Scroll Rect Ex",
  bindingSuffix: "ScrollView",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  previewCollectionOwner: true,
  unity: { type: "UnityEngine.UI.ScrollRectEx", pathConvention: "mPascal", capability: "scrollRectEx" },
  fields: {
    ...scrollFields(),
    autoAlignCenter: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Auto Align Center", control: "boolean" },
      override: true,
    }),
    autoClamped: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Auto Clamped", control: "boolean" },
      override: true,
    }),
    emptyDefaultTarget: componentField(Type.Optional(Type.Union([nodeIdSchema, Type.Null()], { default: null })), {
      inspector: { label: "Empty Default Target", control: "nodeReference", referenceFilter: "any", nullable: true },
      override: true,
    }),
    emptyDefaultStateRoot: componentField(Type.Optional(Type.Union([nodeIdSchema, Type.Null()], { default: null })), {
      inspector: { label: "Empty Default StateRoot", control: "nodeReference", referenceFilter: "stateRoot", nullable: true },
      override: true,
    }),
    templates: componentField(Type.Record(nodeIdSchema, requiredNodeReferenceSchema, { default: {} }), {
      inspector: { label: "Templates", control: "templateMap" },
      materializeDefault: true,
      unity: { path: "m_Templates", capability: "scrollRectTemplates" },
    }),
  },
  nodeReferences: {
    collect: (value) =>
      Object.entries(value.templates as Record<string, string>).flatMap(([templateName, targetNodeId]) =>
        targetNodeId ? [{ targetNodeId, field: `ScrollRectEx.templates.${templateName}` }] : [],
      ),
    remap: (value, remap) => ({
      ...value,
      templates: Object.fromEntries(
        Object.entries(value.templates as Record<string, string>).map(([templateName, targetNodeId]) => [
          templateName,
          targetNodeId ? remap(targetNodeId) : targetNodeId,
        ]),
      ),
    }),
    removeTargets: (value, removedNodeIds) => {
      const removals: Array<{ targetNodeId: string; field: string; requiresRepair: boolean }> = [];
      const templates = Object.fromEntries(
        Object.entries(value.templates as Record<string, string>).map(([templateName, targetNodeId]) => {
          if (!removedNodeIds.has(targetNodeId)) return [templateName, targetNodeId];
          removals.push({ targetNodeId, field: `ScrollRectEx.templates.${templateName}`, requiresRepair: true });
          return [templateName, ""];
        }),
      );
      return { value: { ...value, templates }, removals };
    },
  },
});
