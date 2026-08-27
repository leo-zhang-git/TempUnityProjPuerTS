import assert from "node:assert/strict";
import test from "node:test";
import { nonPrefabComponentModules } from "../../src/components/component-list.js";
import { visualCases } from "../visual/visual-cases.js";
import type { VisualCaseDefinition } from "../visual/visual-contract.js";
import { parseVisualCaptureOptions, selectVisualCases } from "../visual/visual-selection.js";

const target = { kind: "page", label: "page" } as const;
const viewport = { width: 100, height: 100 };
const cases: readonly VisualCaseDefinition[] = [
  {
    id: "text-default",
    title: "Text",
    description: "",
    route: "/",
    viewport,
    actions: [],
    target,
    componentType: "Text",
    stateId: "default",
  },
  {
    id: "text-long",
    title: "Text long",
    description: "",
    route: "/",
    viewport,
    actions: [],
    target,
    componentType: "Text",
    stateId: "long",
  },
  {
    id: "image-default",
    title: "Image",
    description: "",
    route: "/",
    viewport,
    actions: [],
    target,
    componentType: "Image",
    stateId: "default",
  },
  { id: "editor", title: "Editor", description: "", route: "/", viewport, actions: [], target },
];

test("visual capture options parse compare, case and component filters", () => {
  assert.deepEqual(parseVisualCaptureOptions(["--compare", "before", "--case", "text-default", "--component", "Text"]), {
    compareName: "before",
    caseId: "text-default",
    componentType: "Text",
  });
  assert.throws(() => parseVisualCaptureOptions(["--case"]), /requires a value/);
  assert.throws(() => parseVisualCaptureOptions(["--unknown", "value"]), /Unknown visual capture option/);
  assert.throws(() => parseVisualCaptureOptions(["--case", "one", "--case", "two"]), /only be specified once/);
});

test("visual case selection supports component and exact case intersections", () => {
  assert.deepEqual(
    selectVisualCases(cases, { componentType: "Text" }).map((entry) => entry.id),
    ["text-default", "text-long"],
  );
  assert.deepEqual(
    selectVisualCases(cases, { caseId: "text-default", componentType: "Text" }).map((entry) => entry.id),
    ["text-default"],
  );
  assert.throws(() => selectVisualCases(cases, { caseId: "image-default", componentType: "Text" }), /No visual case matches/);
  assert.throws(() => selectVisualCases(cases, { componentType: "Missing" }), /No visual cases are registered/);
});

test("every registered Component has an Inspector visual case", () => {
  const covered = new Set(visualCases.flatMap((entry) => (entry.componentType ? [entry.componentType] : [])));
  const expected = ["PrefabRef", ...Object.keys(nonPrefabComponentModules)];
  assert.deepEqual(
    expected.filter((componentType) => !covered.has(componentType)),
    [],
  );
});
