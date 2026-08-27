# Progress

## 使用边界

- Progress 表达生命、加载、资源或倒计时等只读进度；玩家可拖拽或提交数值时使用交互控件。
- 可复用、带独立刷新或跟随表现的进度区域建立 Widget；一次性静态组合可留在当前 Canvas/Widget owner。

## Source 准备

- 正式结构提供稳定 track 与 fill；fill 使用 Image 的 filled 能力表达，不通过 RectTransform 缩放或临时 Slider 模拟。
- head、glow、label 等固定表现由同一 Artifact 持有。需要 runtime 更新的节点在该 Widget/owner 的最近 Binder 建立 Binding。
- 父级组合可复用进度 Widget 时只持有 Widget 入口，不穿透绑定其内部 fill 和样式节点。
- Preview 使用代表性进度和文本，不把样例值提升为业务默认状态。

## 工具验收

- fill Image、必要资源和 Binding 进入正式 Projection；非交互进度不携带 Slider 或输入 listener 契约。
- UI Authoring 只验证结构与静态表现，规范化数值、刷新频率和跟随逻辑由 runtime owner 验收。
- runtime 契约见 [`program/doc/ui-components/progress.md`](../../../../../program/doc/ui-components/progress.md)。

