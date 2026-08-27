# VirtualJoystick

## 使用边界

- `VirtualJoystick` 用于需要拖拽方向与幅度输入的触屏 Widget；固定点击方向键、普通拖拽控件和桌面输入不使用该结构。
- 输入映射、采样和业务动作由 `VirtualJoystickWidgetBase` 及其具体 Widget owner 持有，UI Authoring 只准备可采样的摇杆结构与正式 Widget 身份。

## UI Authoring 前置

- VirtualJoystick Widget 建立独立 Widget Artifact、generated binding 与对应 TS owner。
- `VirtualJoystick` Component 位于 Widget root；`VirtualJoystickWidgetBase` 从自身根 GameObject 取得该组件，不通过子节点查找或额外 Binding 访问。
- area 与 background 引用持有 Image 的正式节点，knob 引用稳定的正式节点；三者均属于当前 Widget，不使用 Preview-only 目标。
- 触摸区域、背景和 knob 的 RectTransform 明确可拖拽范围与视觉中心，`maxOffsetScale` 只配置输入组件的位移比例，不替代布局约束。

## 工具验收

- Publish 验收 Widget root Component、三项节点引用、正式 Projection、generated binding 与 Widget 接入契约。
- `schema --component VirtualJoystick` 持有字段、值域与引用类型；实际输入采样、桌面输入并行关系和业务动作由对应 program runtime owner 验收。
