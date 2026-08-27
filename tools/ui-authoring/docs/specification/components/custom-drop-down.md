# CustomDropDown

## 使用边界

- `CustomDropDown` 用于需要项目统一 option 展开、模板表现、固定选择组和动态预览集合的复合下拉控件。
- Unity `TMPDropdown` 已能直接满足的静态选项使用原生组件，不为统一外观之外的理由引入 CustomDropDown 结构。

## Source 准备

- 优先从 UI Authoring 的 `custom-dropdown` template 建立完整结构，不手工拼接不完整引用。
- CustomDropDown 引用 current ButtonEx、展开箭头、current content host、option view、标准 ScrollRect 和 CustomDropDownOption template。
- Current Content Prefab 与 Option Content Prefab 使用 Widget Artifact identity；字段为空时基体只提供交互外壳，具体 Variant 可分别覆写两个内容 Artifact。
- option template 提供 ButtonEx、content host 与 selected visual；selected visual 直接承载当前选择对比。
- Preview collection 提供代表性 option；runtime 需要读写选择时绑定 CustomDropDown，template 内部表现不穿透到父 Binder。

## 工具验收

- 所有必需节点引用存在且持有正确组件；Content Artifact 引用存在时必须解析为 Widget，并由 Projection 写入正式 Prefab Object 引用。
- Variant 的 Content Artifact override、Unity audit 与 reconcile 都以 Artifact identity 往返，不把物理 Prefab path 保存进 Source。
- Preview collection 只改变证据数据，不把样例 option 固化为正式 runtime 集合。
- 字段和值域以 `schema --component CustomDropDown` 与 `schema --component CustomDropDownOption` 为准。
