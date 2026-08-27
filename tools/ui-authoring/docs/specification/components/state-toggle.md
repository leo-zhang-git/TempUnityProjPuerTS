# StateToggle

## 使用边界

- `StateToggle` 管理数量和结构固定的单选或多选组，每个选项使用 StateRoot 表达自身表现。
- 运行时数量可变的列表、背包、商店或任务集合由动态列表 owner 管理选择，不建立固定 StateToggle。
- StateRoot 与 StateToggle 可由 TS `PageViewRoot` 组合为 PageView 的页签选择组；UI Authoring 为 tab 准备 StateRoot，不重复 author 第二个 StateToggle owner。

## Source 准备

- 每个选项先建立严格按 `unselected`、`selected` 排列的两态 StateRoot，再由 StateToggle 按稳定顺序引用。
- Source 明确单选/多选、是否允许空选和正式默认选择；索引语义跟随 StateRoot 引用顺序。
- runtime 需要程序切换或监听独立选择组时，在最近 Binder 建立 StateToggle Binding；选项表现不由 TS 绕过 StateToggle 单独改写。

## 工具验收

- 引用目标存在且持有严格有序的 `unselected`、`selected` 两态 StateRoot，同一目标不重复，选择索引在范围内。
- 单选组最多一个选中项；不允许空选时始终存在一个正式默认选择。
- 字段和值域以 `schema --component StateToggle` 为准；runtime 语义见 [`program/doc/ui-components/statetoggle.md`](../../../../../program/doc/ui-components/statetoggle.md)。
