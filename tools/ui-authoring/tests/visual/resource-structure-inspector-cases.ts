import { inspectorFixtureArtifactKey } from "./inspector-fixture.js";
import type { VisualAction, VisualCaptureTarget, VisualCaseDefinition, VisualViewport } from "./visual-contract.js";

const compact: VisualViewport = { width: 1366, height: 768 };

function inspectorCase(
  id: string,
  title: string,
  description: string,
  nodeId: string,
  componentType: string,
  stateId: string,
  label: string,
): VisualCaseDefinition {
  const target: VisualCaptureTarget = { kind: "selector", label, selector: `[data-component-type="${componentType}"]` };
  const actions: readonly VisualAction[] = [
    { kind: "waitForText", text: inspectorFixtureArtifactKey, exact: true },
    { kind: "clickButton", name: "Hierarchy", exact: true },
    { kind: "clickSelector", selector: `button[data-hierarchy-select][title="${nodeId}"]` },
    { kind: "waitForSelector", selector: `[data-component-type="${componentType}"]` },
  ];
  return {
    id,
    title,
    description,
    route: `/?artifact=${inspectorFixtureArtifactKey}`,
    viewport: compact,
    actions,
    target,
    workspace: "inspectorFixture",
    componentType,
    stateId,
  };
}

export const resourceStructureInspectorCases: readonly VisualCaseDefinition[] = [
  inspectorCase(
    "prefab-ref-default",
    "Prefab Reference / 默认状态",
    "核对 Artifact 引用。",
    "prefabRefDefault",
    "PrefabRef",
    "default",
    "Prefab Reference",
  ),
  inspectorCase(
    "prefab-ref-use-site",
    "Prefab Reference / Use-site 变更",
    "核对包含 override 与 component addition 的结构入口。",
    "prefabRefRepresentative",
    "PrefabRef",
    "use-site",
    "Prefab Reference",
  ),
  inspectorCase(
    "animation-default",
    "Animation / 默认状态",
    "核对空 Clip 与基础播放字段。",
    "animationDefault",
    "Animation",
    "default",
    "Animation",
  ),
  inspectorCase(
    "animation-representative",
    "Animation / Clip 列表",
    "核对 Default Clip、Clips 与播放模式。",
    "animationRepresentative",
    "Animation",
    "clips",
    "Animation",
  ),
  inspectorCase(
    "animator-default",
    "Animator / 默认状态",
    "核对空 Controller 与运行字段。",
    "animatorDefault",
    "Animator",
    "default",
    "Animator",
  ),
  inspectorCase(
    "animator-representative",
    "Animator / Controller",
    "核对 Controller、Update Mode 与 Keep State。",
    "animatorRepresentative",
    "Animator",
    "controller",
    "Animator",
  ),
];
