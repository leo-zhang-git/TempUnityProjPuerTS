import { Type } from "@sinclair/typebox";
import { componentField, defineComponent } from "./component-module.js";
import { nodeIdSchema, stateNameSchema } from "./shared-schema.js";
import {
  type StateRootElement,
  type StateRootElementType,
  stateRootElementSchema,
  stateRootElementTargetIssue,
} from "./state-root-elements.js";

export { stateRootElementSchema } from "./state-root-elements.js";

export const stateRootComponent = defineComponent({
  key: "StateRoot",
  label: "State Root",
  bindingSuffix: "StateRoot",
  previewRenderer: "none",
  projectionHandler: "stateRoot",
  roundtrip: "bidirectional",
  unity: { type: "UIState.StateRoot", capability: "stateRoot" },
  fields: {
    currentState: componentField(stateNameSchema, {
      inspector: { label: "默认状态", control: "stateName" },
      override: true,
      materializeDefault: true,
      componentDefault: "default",
      preview: { name: "state", handler: "stateRootState" },
    }),
    states: componentField(Type.Record(stateNameSchema, Type.Record(nodeIdSchema, Type.Boolean())), {
      inspector: { label: "状态列表", control: "stateMap" },
      materializeDefault: true,
      componentDefault: { default: {} },
    }),
    elements: componentField(Type.Optional(Type.Array(stateRootElementSchema, { default: [] })), {
      inspector: { label: "状态属性", control: "stateElements" },
      materializeDefault: true,
      inheritSchemaDefault: false,
    }),
    interactable: componentField(Type.Optional(Type.Boolean({ default: true })), {
      inspector: { label: "Interactable", control: "boolean" },
      override: true,
    }),
  },
  validate: ({ value, findNode, report }) => {
    const states = value.states && typeof value.states === "object" ? (value.states as Record<string, Record<string, boolean>>) : {};
    const stateNames = Object.keys(states);
    if (stateNames.length === 0) report("states", "state.empty", "StateRoot must declare at least one state");
    if (typeof value.currentState !== "string" || !(value.currentState in states))
      report("currentState", "state.current", `current state '${String(value.currentState ?? "")}' is not declared`);

    const firstTargets = stateNames.length > 0 ? Object.keys(states[stateNames[0]!] ?? {}).sort() : [];
    for (const stateName of stateNames) {
      const targets = Object.keys(states[stateName] ?? {}).sort();
      if (targets.join("\0") !== firstTargets.join("\0"))
        report(`states/${stateName}`, "state.targets", "all active-only states must control the same node set");
      for (const nodeId of targets) {
        if (!findNode(nodeId)) report(`states/${stateName}/${nodeId}`, "state.target", `target node '${nodeId}' does not exist`);
      }
    }

    const elements = (Array.isArray(value.elements) ? value.elements : []) as StateRootElement[];
    const elementKeys = new Set<string>();
    const expectedStates = [...stateNames].sort().join("\0");
    for (const [elementIndex, element] of elements.entries()) {
      const elementPath = `elements/${elementIndex}`;
      const key = `${element.targetNodeId}\0${element.elementType}`;
      if (elementKeys.has(key))
        report(elementPath, "state.elementDuplicate", `duplicate StateRoot element '${element.targetNodeId}/${element.elementType}'`);
      elementKeys.add(key);
      if (!element.targetNodeId) {
        report(`${elementPath}/targetNodeId`, "required.empty", "State property target is required", {
          fieldPath: "elements",
          readiness: true,
        });
        continue;
      }
      const target = findNode(element.targetNodeId);
      if (!target) {
        report(`${elementPath}/targetNodeId`, "state.elementTarget", `target node '${element.targetNodeId}' does not exist`);
      } else {
        const targetIssue = stateRootElementTargetIssue(element.elementType as StateRootElementType, target);
        if (targetIssue) report(`${elementPath}/targetNodeId`, "state.elementCapability", targetIssue);
      }
      if (Object.keys(element.values).sort().join("\0") !== expectedStates)
        report(`${elementPath}/values`, "state.elementStates", "StateRoot element values must cover exactly the declared states");
    }
  },
  nodeReferences: {
    collect: (value) => {
      const references: Array<{ targetNodeId: string; field: string }> = [];
      const states = value.states && typeof value.states === "object" ? (value.states as Record<string, Record<string, boolean>>) : {};
      for (const [stateName, targets] of Object.entries(states)) {
        for (const targetNodeId of Object.keys(targets)) references.push({ targetNodeId, field: `StateRoot.states.${stateName}` });
      }
      for (const [index, rawElement] of (Array.isArray(value.elements) ? value.elements : []).entries()) {
        const element = rawElement as Partial<StateRootElement>;
        if (element.targetNodeId)
          references.push({ targetNodeId: element.targetNodeId, field: `StateRoot.elements.${index}.targetNodeId` });
      }
      return references;
    },
    remap: (value, remap) => ({
      ...value,
      states: Object.fromEntries(
        Object.entries(value.states as Record<string, Record<string, boolean>>).map(([stateName, targets]) => [
          stateName,
          Object.fromEntries(Object.entries(targets).map(([targetNodeId, active]) => [remap(targetNodeId), active])),
        ]),
      ),
      ...(Array.isArray(value.elements)
        ? {
            elements: value.elements.map((rawElement) => {
              const element = rawElement as StateRootElement;
              return { ...element, targetNodeId: element.targetNodeId ? remap(element.targetNodeId) : element.targetNodeId };
            }),
          }
        : {}),
    }),
    removeTargets: (value, removedNodeIds) => {
      const removals: Array<{ targetNodeId: string; field: string; requiresRepair: boolean }> = [];
      const states = Object.fromEntries(
        Object.entries(value.states as Record<string, Record<string, boolean>>).map(([stateName, targets]) => [
          stateName,
          Object.fromEntries(
            Object.entries(targets).filter(([targetNodeId]) => {
              if (!removedNodeIds.has(targetNodeId)) return true;
              removals.push({ targetNodeId, field: `StateRoot.states.${stateName}`, requiresRepair: false });
              return false;
            }),
          ),
        ]),
      );
      const elements = (Array.isArray(value.elements) ? value.elements : []).map((rawElement, index) => {
        const element = rawElement as StateRootElement;
        if (!removedNodeIds.has(element.targetNodeId)) return element;
        removals.push({ targetNodeId: element.targetNodeId, field: `StateRoot.elements.${index}.targetNodeId`, requiresRepair: true });
        return { ...element, targetNodeId: "" };
      });
      return { value: { ...value, states, ...(Array.isArray(value.elements) ? { elements } : {}) }, removals };
    },
  },
});
