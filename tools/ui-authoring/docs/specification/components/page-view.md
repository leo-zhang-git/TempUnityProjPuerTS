# PageView

## 使用边界

- PageView 用于 Canvas/Widget owner 已创建并持有页面实例、由 TS `PageViewRoot` 统一切换显隐和页签表现的分页结构。
- 页面可无 tab、使用 PageTab Widget，或直接使用 tab StateRoot；需要自动加载、缓存或数据列表复用的场景不由 PageView 隐式承担。
- 页面是否拆成独立 Widget 由其数据、行为和生命周期边界决定，不因视觉分组自动建立 Widget。

## UI Authoring 前置

- 每个独立 Page 和 PageTab 以 Widget Artifact、generated binding 与对应 TS owner 建立稳定身份；留在父 owner 内的 tab 则提供可绑定的 StateRoot。
- 每个 tab StateRoot 持有未选中与选中表现。PageTab Widget 在自身 Binder 暴露 tab StateRoot，直接 tab StateRoot 由 PageView owner 的 Binder 暴露。
- PageView owner 必须能通过 generated binding 或 child Widget 关系取得全部 Page、PageTab 和 tab StateRoot，不按节点名或层级猜测。
- Source 不为 PageView 再建立 StateToggle；`PageViewRoot` 在运行时创建单选、不可空选的内部选择组。
- Source 正式默认表现不拥有初始页面决定；初始页由 runtime owner 显式选择。

## 工具验收

- Publish 验收 Artifact 类型、Binder 边界、Binding 和 generated type；它不推断 PageView entry 注册顺序或初始选择。
- program typecheck 证明 Page、PageTab 和 tab StateRoot 可由 owner 访问；实际注册、切换、事件与生命周期通过 runtime 验收。
- runtime 契约见 [`program/doc/ui-components/page-view.md`](../../../../../program/doc/ui-components/page-view.md)。

