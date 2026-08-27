# UI Authoring 架构演进清单

本文只记录尚未完成的长期结构项。已完成内容由 `ARCHITECTURE.md`、代码、测试和版本控制持有；单项规格较大时进入同级文档。

## 后续

| 主题 | 目标状态 | 验收 |
| --- | --- | --- |
| 左侧浏览器视觉基元统一 | Project 与 Hierarchy 在现有领域 selection 与导航行为稳定后，共用搜索外观、Tree/List 行状态、滚动边缘提示和主题映射；领域数据与命令继续由各 feature 持有 | selection、导航、筛选和越界命令由稳定 browser behavior contract 覆盖；dark/light、list/grid、空状态与状态组合由人工浏览器验收 |

### 左侧浏览器视觉基元统一

实施顺序：

1. 建立 Project 与 Hierarchy 的控件与状态矩阵，确认 current、primary、multi、hover、dirty、invalid、readonly 和 filtered 状态的组合优先级。
2. 在 `styles/tokens.css` 定义 selection、edge indicator、search control 和 tree depth 所需的语义 token，并完成 dark/light 对照验收。
3. 在 `shared/` 提供不理解文档和节点领域的 SearchControl、SelectionRow、ScrollEdgeIndicator 与 TreeDisclosure 视觉基元；各 feature 继续传入 label、icon、状态和命令。
4. 按 Project、Hierarchy 顺序迁移，每迁移一个面板即删除对应局部重复样式，并保持既有 keyboard、drag/drop、context menu、虚拟化和 owner 边界。
5. 在 desktop 两种主题下人工验收 list/grid、长列表、无结果、筛选、越界和多选状态；自动化只补 selection、导航、筛选和命令结果 contract。全部面板迁移完成后再收敛旧 CSS selector 与 token。

验收要求：复用层不持有 route、Catalog、SelectionAddress、Project directory 或 Source mutation；迁移前后行为测试保持通过，主题切换不产生布局位移，状态组合不存在颜色或边框覆盖丢失。
