# StateRoot

## 使用边界

- `StateRoot` 把有限、稳定的 UI 表现状态集中映射到节点 active 和组件表现差异；业务状态继续由 Canvas/Widget runtime owner 持有。
- 同一语义状态涉及多个节点或属性时使用 StateRoot。单节点、无稳定状态名的临时显隐由 runtime owner 直接控制。
- 动态列表的选择集合归列表 owner，item 内仍可用 StateRoot 表达选中、禁用等单项表现。

## Source 准备

- StateRoot 节点声明稳定状态名、正式默认状态和每个状态控制的目标；同一组 active 状态覆盖一致的目标集合。
- 颜色、灰度、精灵、文字、字体、透明度、交互标记或 Transform/RectTransform 差异集中进入 StateRoot elements，并为全部已声明状态提供取值；精确类型和值域以 Component Schema 为准。
- 按钮存在不可用态时，同一 StateRoot 状态同时提交 `UGray` 与 `UInteractable`；`UGray` 只以 Image 或 RoundedRect 为目标，通过项目灰度材质切换表现。始终可用的按钮不建立 availability StateRoot。
- property element 只保存目标 node id。需要组件的 ElementType 要求目标节点上存在且只存在一个兼容组件；组件缺失或同类能力歧义时 Source 不满足交付条件。
- Sprite 状态同时保存 Sprite 资产引用和 Set Native Size；Font 与 Sprite 资产引用都允许显式清空，并参与资产收集、路径替换、Projection 和 observation normalization。
- CanvasGroup 状态同时保存 `alpha` 与 `blocksRaycasts`；`alpha` 取值为 0 到 1。`interactable` 与 `ignoreParentGroups` 由目标节点的普通 CanvasGroup baseline 持有，不随 StateRoot 状态切换。
- runtime 需要直接选择状态时，在最近的 Canvas/Widget Binder 建立 StateRoot Binding；仅由其它 Source Component 引用时不额外制造业务 Binding。
- 只调整预览选择时使用 Preview state，不改写正式默认状态。

## Authoring 行为

- 新增 property element 并首次选择目标时，从目标当前属性初始化全部已有 state。已有 element 改绑目标时保留已配置 state 值。
- 新增 state 时，每个 property element 使用自身类型的语义默认值；ElementType 换型后按新类型默认值重建各 state 值。
- Width/Height 表示 Unity RectTransform 的最终宽高；Preview 按应用顺序使用当时的 anchors 和父节点最终尺寸换算 sizeDelta。
- LocalRotation 与 ULocalScale 完整保存三轴值；2D Preview 分别使用 Z 和 X/Y。Gray、Interactable 与 Raycast Target 完成 Unity 往返，不在 Web 静态 Preview 中模拟 shader、点击禁用或射线穿透。
- CanvasGroup 的 Web Preview 应用 `alpha` 与 `blocksRaycasts`，且保留目标 CanvasGroup 的其它 baseline 字段。

## 工具验收

- 当前状态存在于状态集合，所有目标节点可达，active 状态目标集合一致，element 不重复、目标能力唯一且完整覆盖状态。
- Web Preview 按 element 顺序应用状态值；Sprite native size 缺少资产 metrics 时报告 diagnostic，不伪造尺寸。
- Preview、Reference 和 Prototype 只提交状态选择，不建立第二份状态定义。
- 字段和值域以 `schema --component StateRoot` 为准；runtime 语义见 [`program/doc/ui-components/stateroot.md`](../../../../../program/doc/ui-components/stateroot.md)。
