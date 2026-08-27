import { inspectorFixtureArtifactKey } from "./inspector-fixture.js";
import type { VisualAction, VisualCaptureTarget, VisualCaseDefinition, VisualViewport } from "./visual-contract.js";

const compact: VisualViewport = { width: 1366, height: 768 };

function ready(): VisualAction {
  return { kind: "waitForText", text: inspectorFixtureArtifactKey, exact: true };
}

function componentTarget(componentType: string, label: string): VisualCaptureTarget {
  return { kind: "selector", label, selector: `[data-component-type="${componentType}"]` };
}

function actions(nodeId: string, componentType: string): readonly VisualAction[] {
  return [
    ready(),
    { kind: "clickButton", name: "Hierarchy", exact: true },
    { kind: "clickSelector", selector: `button[data-hierarchy-select][title="${nodeId}"]` },
    { kind: "waitForSelector", selector: `[data-component-type="${componentType}"]` },
  ];
}

function inspectorCase(
  id: string,
  title: string,
  description: string,
  nodeId: string,
  componentType: string,
  stateId: string,
  label = componentType,
): VisualCaseDefinition {
  return {
    id,
    title,
    description,
    route: `/?artifact=${inspectorFixtureArtifactKey}`,
    viewport: compact,
    actions: actions(nodeId, componentType),
    target: componentTarget(componentType, label),
    workspace: "inspectorFixture",
    componentType,
    stateId,
  };
}

export const interactionInspectorCases: readonly VisualCaseDefinition[] = [
  inspectorCase(
    "button-ex-default",
    "Button Ex / 默认状态",
    "核对目标 Graphic、Interactable 与 Transition。",
    "buttonExDefault",
    "ButtonEx",
    "default",
    "Button Ex",
  ),
  inspectorCase(
    "button-ex-press-feedback",
    "Button Ex / Press Feedback",
    "核对当前高频 Press Feedback 条件字段。",
    "buttonExPress",
    "ButtonEx",
    "press-feedback",
    "Button Ex",
  ),
  inspectorCase(
    "button-ex-advanced-input",
    "Button Ex / 输入扩展",
    "核对 Click Interval、Double Click 与 Long Press 条件字段。",
    "buttonExAdvanced",
    "ButtonEx",
    "advanced-input",
    "Button Ex",
  ),
  inspectorCase(
    "toggle-default",
    "Toggle / 默认状态",
    "核对 Toggle 引用、Is On 与 Selectable 字段。",
    "toggleDefault",
    "Toggle",
    "default",
  ),
  inspectorCase("toggle-off", "Toggle / Off", "核对当前项目实际使用的 Is On 关闭状态。", "toggleOff", "Toggle", "off"),
  inspectorCase("slider-default", "Slider / 默认状态", "核对 Slider 引用与默认数值范围。", "sliderDefault", "Slider", "default"),
  inspectorCase(
    "slider-representative",
    "Slider / 代表配置",
    "核对 Direction、Max Value、Whole Numbers 与 Value。",
    "sliderRepresentative",
    "Slider",
    "representative",
  ),
  inspectorCase("scrollbar-default", "Scrollbar / 默认状态", "核对 Scrollbar 引用与默认数值。", "scrollbarDefault", "Scrollbar", "default"),
  inspectorCase(
    "scrollbar-representative",
    "Scrollbar / 代表配置",
    "核对当前垂直方向及 Value、Size。",
    "scrollbarRepresentative",
    "Scrollbar",
    "representative",
  ),
  inspectorCase(
    "scroll-rect-default",
    "Scroll Rect / 默认状态",
    "核对 Content、Viewport 与滚动基础字段。",
    "scrollRectDefault",
    "ScrollRect",
    "default",
    "Scroll Rect",
  ),
  inspectorCase(
    "scroll-rect-clamped",
    "Scroll Rect / Clamped",
    "核对 Clamped 与 Vertical Scrollbar 条件字段。",
    "scrollRectClamped",
    "ScrollRect",
    "clamped",
    "Scroll Rect",
  ),
  inspectorCase(
    "scroll-rect-horizontal",
    "Scroll Rect / Horizontal",
    "核对仅横向滚动状态。",
    "scrollRectHorizontal",
    "ScrollRect",
    "horizontal",
    "Scroll Rect",
  ),
  inspectorCase(
    "tmp-input-default",
    "TMP Input Field / 默认状态",
    "核对文本、Viewport 与 Placeholder 引用。",
    "tmpInputDefault",
    "TMPInputField",
    "default",
    "TMP Input Field",
  ),
  inspectorCase(
    "tmp-input-integer",
    "TMP Input Field / Integer",
    "核对 Integer Number 与 Character Limit。",
    "tmpInputInteger",
    "TMPInputField",
    "integer",
    "TMP Input Field",
  ),
  inspectorCase(
    "tmp-input-multiline",
    "TMP Input Field / Multiline",
    "核对多行、Rich Text 与 Scroll Sensitivity。",
    "tmpInputMultiline",
    "TMPInputField",
    "multiline",
    "TMP Input Field",
  ),
  inspectorCase(
    "tmp-dropdown-default",
    "TMP Dropdown / 默认状态",
    "核对 Dropdown 结构引用与默认选项。",
    "tmpDropdownDefault",
    "TMPDropdown",
    "default",
    "TMP Dropdown",
  ),
  inspectorCase(
    "tmp-dropdown-representative",
    "TMP Dropdown / 代表配置",
    "核对 Value、Options 与 Transition。",
    "tmpDropdownRepresentative",
    "TMPDropdown",
    "representative",
    "TMP Dropdown",
  ),
];
