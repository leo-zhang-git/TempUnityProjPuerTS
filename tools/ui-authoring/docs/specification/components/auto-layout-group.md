# AutoLayoutGroup

## 使用边界

- `AutoLayoutGroup` 是项目统一的横向、纵向和网格布局 driver；需要同一 Source 工具表达三种模式或使用自动网格容量求值时使用。
- Unity 原生 Layout Group 已能唯一表达且不需要 Auto 模式时可继续使用原生组件，不机械替换。
- 同一节点只保留一个 layout driver，AutoLayoutGroup 不与 Horizontal、Vertical 或 Grid Layout Group 并存。

## Source 准备

- mode 决定当前有效字段集合；横向/纵向使用线性 spacing 与 child sizing，网格使用 cell、grid spacing、start axis 和自动或固定行列。
- 自动网格根据容器求值尺寸、padding、cell 和 spacing 计算容量；固定模式由明确行数或列数决定，不从样例 child 数量反推长期配置。
- child 的 preferred/min/flexible 尺寸只有在当前 layout driver 控制对应轴时才影响求值；其它情况保留为非阻断 advisory。
- Preview 与正式 Projection 消费同一 mode 和布局参数，不回写 layout-driven 轴的求值结果。

## 工具验收

- Registry 阻止同节点多个 layout driver；Inspector 和 mutation 保持 mode 相关字段一致。
- layout/capture 在目标 viewport 验证 child 顺序、尺寸、行列和边界；advisory 不伪装成 readiness blocker。
- 字段和值域以 `schema --component AutoLayoutGroup` 为准。

