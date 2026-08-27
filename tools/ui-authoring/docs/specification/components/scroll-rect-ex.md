# ScrollRectEx

## 使用边界

- 重复区域按实例 contract 分型：容量、位置、空槽和交互地址固定且整组常驻时属于固定结构，每个槽位使用显式 Widget PrefabRef；实例数量随业务 model 变化时属于动态集合。
- `ScrollRectEx` 用于需要滚动、复用或集合选择的动态同构集合，并与 TS custom scroll view 共同承担 template、复用、布局和选择集合。
- 内容结构固定、只因视口不足需要滚动时使用 Unity `ScrollRect`；少量且永不滚动的动态项由所属 owner 创建 Widget 并使用普通布局。

## Source 准备

- ScrollRectEx 节点提供 viewport、content、启用轴和必要 scrollbar，并在同节点持有 `LayoutSettings`。
- `templates` 以稳定 template key 映射到 PrefabRef 节点；目标 Artifact 是持有单项数据与表现的 Widget。
- runtime content baseline 不保存代表性 item 实例；每个 template key 只保留一个 inactive PrefabRef。item Widget 的数据字段使用 Binding，baseline 使用空值或中性默认值。
- 动态 content 的设计期布局组件只参与 Preview，不进入正式 content runtime baseline；正式布局参数由 LayoutSettings 提供。
- 空集合表现使用明确目标或 StateRoot。Preview collection 提供代表性 item，并在非空时按 runtime 语义切换空态，不把样例 item 固化为 runtime 子节点。
- 数量不定的 collection 默认在 Reference 中提供“一屏完整容量 + 1”个 item，用首个超屏 item 验证 content 扩展、换行和 viewport 裁剪。
- runtime owner 绑定 ScrollRectEx，并通过项目既有 custom scroll view 根据业务 model 创建和复用 item Widget；item 内部 Binding 继续归 item Widget。Reference collection 只提供 Legma 评审数据，不替代 runtime 数据接入。

## 工具验收

- viewport、content、scrollbar、empty state、template PrefabRef 和 LayoutSettings 引用完整，且只启用符合列表方向的滚动轴。
- Preview collection 的 template key、item 状态和目标 Widget 可由 Catalog 解析。
- Legma Preview 验收首屏布局、content 尺寸、换行、裁剪和空态切换；Unity runtime 验收拖动与滚轮输入、末项可达性、边界行为、惯性和 item 复用。
- runtime 列表、复用和选择契约见 [`program/doc/ui-components/scrollrectex.md`](../../../../../program/doc/ui-components/scrollrectex.md)。
