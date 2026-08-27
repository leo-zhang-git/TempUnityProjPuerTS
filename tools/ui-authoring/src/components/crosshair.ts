import { type Static, Type } from "@sinclair/typebox";
import { componentField, defineComponent } from "./component-module.js";
import { requiredNodeReferenceSchema, vector2Schema } from "./shared-schema.js";

const crosshairEdgeSchema = Type.Object(
  {
    target: requiredNodeReferenceSchema,
    direction: vector2Schema,
  },
  { additionalProperties: false },
);

const crosshairPunchSchema = Type.Object(
  {
    duration: Type.Optional(Type.Number({ minimum: 0.0001, default: 0.1 })),
    vibrato: Type.Optional(Type.Integer({ minimum: 1, default: 3 })),
    elasticity: Type.Optional(Type.Number({ minimum: 0, maximum: 1, default: 0.5 })),
    scale: Type.Optional(Type.Number({ minimum: -1, maximum: 1, default: 0.1 })),
    rotationEnabled: Type.Optional(Type.Boolean({ default: true })),
    rotationZ: Type.Optional(Type.Number({ minimum: -180, maximum: 180, default: 0 })),
    randomRotationZ: Type.Optional(Type.Number({ minimum: 0, maximum: 180, default: 15 })),
  },
  { additionalProperties: false },
);

export type CrosshairEdge = Static<typeof crosshairEdgeSchema>;
export type CrosshairPunch = Static<typeof crosshairPunchSchema>;

export const DEFAULT_CROSSHAIR_PUNCH: Required<CrosshairPunch> = {
  duration: 0.1,
  vibrato: 3,
  elasticity: 0.5,
  scale: 0.1,
  rotationEnabled: true,
  rotationZ: 0,
  randomRotationZ: 15,
};

export const crosshairComponent = defineComponent({
  key: "Crosshair",
  label: "Crosshair",
  bindingSuffix: "Crosshair",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  unity: { type: "PuerTsTemplate.UI.ComponentCross", capability: "crosshair" },
  fields: {
    scatterScale: componentField(Type.Optional(Type.Number({ minimum: 0, default: 5 })), {
      inspector: { label: "Scatter Scale", control: "number", minimum: 0 },
    }),
    edges: componentField(Type.Optional(Type.Array(crosshairEdgeSchema, { default: [] })), {
      inspector: { label: "Edges", control: "crosshairEdges", defaultValue: [] },
    }),
    punch: componentField(Type.Optional(crosshairPunchSchema), {
      inspector: { label: "Punch", control: "crosshairPunch", defaultValue: DEFAULT_CROSSHAIR_PUNCH },
    }),
  },
  nodeReferences: {
    collect: (value) =>
      (Array.isArray(value.edges) ? value.edges : []).flatMap((rawEdge, index) => {
        const edge = rawEdge as Partial<CrosshairEdge>;
        return typeof edge.target === "string" && edge.target
          ? [{ targetNodeId: edge.target, field: `Crosshair.edges.${index}.target` }]
          : [];
      }),
    remap: (value, remap) => ({
      ...value,
      ...(Array.isArray(value.edges)
        ? {
            edges: value.edges.map((rawEdge) => {
              const edge = rawEdge as CrosshairEdge;
              return { ...edge, target: edge.target ? remap(edge.target) : edge.target };
            }),
          }
        : {}),
    }),
    removeTargets: (value, removedNodeIds) => {
      const removals: Array<{ targetNodeId: string; field: string; requiresRepair: boolean }> = [];
      const edges = (Array.isArray(value.edges) ? value.edges : []).map((rawEdge, index) => {
        const edge = rawEdge as CrosshairEdge;
        if (!removedNodeIds.has(edge.target)) return edge;
        removals.push({ targetNodeId: edge.target, field: `Crosshair.edges.${index}.target`, requiresRepair: true });
        return { ...edge, target: "" };
      });
      return { value: { ...value, edges }, removals };
    },
  },
  validate: ({ value, findNode, report }) => {
    const seenTargets = new Set<string>();
    const edges = Array.isArray(value.edges) ? value.edges : [];
    for (const [index, rawEdge] of edges.entries()) {
      const edge = rawEdge as Partial<CrosshairEdge>;
      const target = typeof edge.target === "string" ? edge.target : "";
      if (!target) {
        report(`edges/${index}/target`, "crosshair.edgeTargetRequired", "Crosshair edge target is required", {
          fieldPath: "edges",
          readiness: true,
        });
      } else if (!findNode(target)) {
        report(`edges/${index}/target`, "crosshair.edgeTargetMissing", `target node '${target}' does not exist`, { fieldPath: "edges" });
      } else if (seenTargets.has(target)) {
        report(`edges/${index}/target`, "crosshair.edgeTargetDuplicate", `target node '${target}' is duplicated`, { fieldPath: "edges" });
      }
      seenTargets.add(target);
      const direction = edge.direction;
      if (Array.isArray(direction) && direction.length === 2 && Number(direction[0]) === 0 && Number(direction[1]) === 0) {
        report(`edges/${index}/direction`, "crosshair.edgeDirectionZero", "Crosshair edge direction must be non-zero", {
          fieldPath: "edges",
        });
      }
    }
  },
});
