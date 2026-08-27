# AutocompleteInput

## 目标

`AutocompleteInput` 是可复用的输入与候选选择 Widget。它提供一个稳定的输入框、一个组件内部的候选滚动区和统一的选项行模板；调用方只提供当前值、候选查询和提交回调，不负责创建候选节点、计算浮层坐标或维护候选列表生命周期。

## Source 前置

Artifact 使用 `Widget` 类型并声明独立尺寸。根节点至少包含：

- `TMPInputField`：输入框及其文本视口；
- 候选容器：带 `ScrollRectEx`、viewport、content 与 `AutocompleteOptionRowWidget` PrefabRef；
- `Text` placeholder Binding：为 Reference 预览提供输入中间态的静态占位控制。

候选容器默认收起，候选行通过 `ScrollRectEx.templates` 绑定到 `AutocompleteOptionRowWidget`。候选行只承载展示与点击，不把业务参数或候选查询逻辑写入 Artifact。

## Runtime contract

Runtime Widget 持有输入监听、候选查询、动态行集合、展开/关闭、滚动复位和延迟失焦关闭。消费者通过配置对象提供：

- 当前值、placeholder 和输入类型；
- `getOptions(query)` 候选查询；
- 值变更、提交、焦点变化和可选的选项选中回调。

消费者不访问候选行 Widget、`RectTransform` bounds 或候选容器的坐标。参数行等业务 Widget 只负责把业务候选转换为通用 `AutocompleteOption`。

## 浮层与边界

候选容器保留在 Artifact 内的固定 use-site，运行时在打开时提升为独立 sorting Canvas，并为其安装 `GraphicRaycaster`。候选位置以 Source 记录的 preferred position 为基准，再由公共 popup 边界 helper 限制在 root Canvas 或 Safe Area 内。该边界处理属于通用组件，不由任何业务 Canvas 重复实现。

候选列表高度由候选数量、行高和 Source 间距求得，并受组件最大高度限制；超过可视区域的内容使用 `ScrollRectEx` 滚动。输入失焦先保留本次指针点击机会，再关闭候选，不通过业务层延迟重排或坐标补偿实现。

## Reference 与验收

至少保留默认收起态和命名展开态 Reference。展开态应包含代表性候选 collection、长文本/说明文本和可滚动边界；输入框 placeholder 在有静态值的 Reference 中置空，避免把运行时 TMP 的隐藏行为误判为视觉重叠。

验收覆盖：

- 空候选、单候选、多候选和超过最大高度的候选；
- 输入过滤、选项点击、提交、失焦和 Widget hide/destroy 后候选关闭；
- Safe Area 边缘打开时的边界收敛；
- 动态列表行回收后监听与数据不串行；
- Artifact、Reference、Prefab、generated binding 与 runtime Widget identity 对齐。

