import { Type } from "@sinclair/typebox";
import { componentField, defineComponent } from "./component-module.js";
import { nodeIdSchema } from "./shared-schema.js";

function componentRecord(
  node: { readonly components?: Readonly<Record<string, unknown>> },
  type: string,
): Readonly<Record<string, unknown>> | undefined {
  const value = node.components?.[type];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function selectedList(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((entry): entry is number => Number.isInteger(entry)) : [];
}

const TOGGLE_STATE_NAMES = ["unselected", "selected"] as const;

function hasToggleStates(stateRoot: Readonly<Record<string, unknown>>): boolean {
  const states = stateRoot.states;
  return Boolean(
    states &&
      typeof states === "object" &&
      !Array.isArray(states) &&
      Object.keys(states).length === TOGGLE_STATE_NAMES.length &&
      Object.keys(states).every((stateName, index) => stateName === TOGGLE_STATE_NAMES[index]),
  );
}

function normalizeSelection(
  component: Readonly<Record<string, unknown>>,
  property: string,
  previous: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const stateRoots = stringList(component.stateRoots);
  const previousSelected = selectedList(previous.selectedIndices);
  let selected = selectedList(component.selectedIndices);
  if (property === "stateRoots") {
    const previousRoots = stringList(previous.stateRoots);
    selected = previousSelected.flatMap((index) => {
      const nodeId = previousRoots[index];
      const nextIndex = nodeId === undefined ? -1 : stateRoots.indexOf(nodeId);
      return nextIndex >= 0 ? [nextIndex] : [];
    });
  }
  selected = [...new Set(selected.filter((index) => index >= 0 && index < stateRoots.length))].sort((left, right) => left - right);
  if (component.multipleSelect !== true && selected.length > 1) {
    const newlySelected = property === "selectedIndices" ? selected.find((index) => !previousSelected.includes(index)) : undefined;
    selected = [newlySelected ?? selected[0]!];
  }
  if (component.allowSwitchOff !== true && selected.length === 0 && stateRoots.length > 0) {
    const previousInRange =
      property === "selectedIndices" ? previousSelected.find((index) => index >= 0 && index < stateRoots.length) : undefined;
    selected = [previousInRange ?? 0];
  }
  return { ...component, selectedIndices: selected };
}

export const stateToggleComponent = defineComponent({
  key: "StateToggle",
  label: "State Toggle",
  bindingSuffix: "StateToggle",
  previewRenderer: "none",
  projectionHandler: "copy",
  roundtrip: "bidirectional",
  multiEdit: false,
  mutateInspectorField: (component, context) => normalizeSelection(component, context.property, context.previous),
  unity: { type: "UIState.StateToggle", capability: "stateToggle" },
  fields: {
    stateRoots: componentField(Type.Array(nodeIdSchema, { default: [] }), {
      inspector: {
        label: "State Roots",
        control: "nodeReferenceList",
        referenceFilter: "stateRoot",
        indexedSelection: {
          selectionProperty: "selectedIndices",
          multipleProperty: "multipleSelect",
          allowEmptyProperty: "allowSwitchOff",
        },
      },
      inspectorOrder: 3,
      materializeDefault: true,
    }),
    multipleSelect: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Multiple Select", control: "boolean" },
      inspectorOrder: 2,
      override: true,
    }),
    allowSwitchOff: componentField(Type.Optional(Type.Boolean({ default: false })), {
      inspector: { label: "Allow Switch Off", control: "boolean" },
      inspectorOrder: 1,
      override: true,
    }),
    selectedIndices: componentField(Type.Optional(Type.Array(Type.Integer({ minimum: 0 }), { default: [] })), {
      override: true,
      customInspector: true,
    }),
  },
  canAdd: ({ nodes }) => (nodes.some((candidate) => componentRecord(candidate, "StateRoot")) ? undefined : "Requires a State Root target"),
  validate: ({ value, findNode, report }) => {
    const stateRoots = Array.isArray(value.stateRoots)
      ? value.stateRoots.filter((entry): entry is string => typeof entry === "string")
      : [];
    const seenRoots = new Set<string>();
    for (const [rootIndex, rootNodeId] of stateRoots.entries()) {
      if (seenRoots.has(rootNodeId)) {
        report(`stateRoots/${rootIndex}`, "stateToggle.duplicate", `StateToggle target '${rootNodeId}' is duplicated`);
      }
      seenRoots.add(rootNodeId);
      const target = findNode(rootNodeId);
      if (!target) {
        report(`stateRoots/${rootIndex}`, "stateToggle.stateRoot", `target node '${rootNodeId}' does not exist`);
        continue;
      }
      const stateRoot = componentRecord(target, "StateRoot");
      if (!stateRoot) {
        report(`stateRoots/${rootIndex}`, "stateToggle.component", `target '${rootNodeId}' has no StateRoot component`);
      } else if (!hasToggleStates(stateRoot)) {
        report(
          `stateRoots/${rootIndex}`,
          "stateToggle.states",
          `target '${rootNodeId}' must declare exactly two ordered states: unselected, selected`,
        );
      }
    }

    const selected = Array.isArray(value.selectedIndices)
      ? value.selectedIndices.filter((entry): entry is number => Number.isInteger(entry))
      : [];
    const seenIndices = new Set<number>();
    for (const [selectedIndex, rootIndex] of selected.entries()) {
      if (rootIndex >= stateRoots.length) {
        report(
          `selectedIndices/${selectedIndex}`,
          "stateToggle.selectionRange",
          `selected index '${rootIndex}' is outside StateToggle stateRoots`,
        );
      }
      if (seenIndices.has(rootIndex)) {
        report(`selectedIndices/${selectedIndex}`, "stateToggle.selectionDuplicate", `selected index '${rootIndex}' is duplicated`);
      }
      seenIndices.add(rootIndex);
    }
    if (value.multipleSelect !== true && selected.length > 1) {
      report("selectedIndices", "stateToggle.single", "single-selection StateToggle allows at most one selected index");
    }
    if (stateRoots.length > 0 && value.allowSwitchOff !== true && selected.length === 0) {
      report("selectedIndices", "stateToggle.requiredSelection", "StateToggle must select one item when allowSwitchOff is false");
    }
  },
});
