# PrefabRef

## 使用边界

- `PrefabRef` 在 Source Artifact graph 中引用独立 Widget 或 Fragment Artifact，不复制被引用节点树。
- 需要独立数据、行为、生命周期或 Binder 边界的区域使用 Widget；纯视觉复用结构使用 Fragment。
- 同一 owner 内的一次性固定结构保持普通节点，不因层级整洁拆成无语义 Artifact。

## Source 准备

- use-site 节点只保存目标 `artifactKey`、自身 RectTransform、允许的本地 visual/layout component addition 和显式 property override。
- Widget PrefabRef 建立新的 Binder owner；父 Binder 可以绑定 Widget root，但不穿透其内部组件。Fragment binderless，父 Binder 可穿过其正式结构。
- 跨 PrefabRef Binding 使用稳定 `instancePath`；不按 Unity 节点名或物化 Prefab 路径推断引用。
- 仅供 Preview 的外部实例把整个 PrefabRef 节点标为 preview-only，不把 PrefabRef 单独标成 preview-only component。

## 工具验收

- Artifact 类型、依赖方向、identity、循环、use-site addition、override 和 Binding 路径由完整 Catalog 校验。
- Projection 按 leaf-to-root 生成独立 Prefab；reconcile 不把外部 Prefab 变化直接升级为第二个 Source owner。
- 字段和值域以 `schema --component PrefabRef` 为准，通用 graph 与 Binding 规则见 [`../source-format.md`](../source-format.md)。

