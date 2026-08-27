# UI Authoring 通用能力规格入口

## 范围

- 本目录持有通用、可复用 UI 能力在 UI Authoring 侧的选型、Source 前置、工具行为和验收契约。
- 纯 TypeScript 工具只要要求 Unity/UI Authoring 预先建立稳定 Artifact、组件、节点关系或 Binding，也在本目录持有对应的 authoring 规格。
- Unity 原生且可由组件名、Unity 语义与 `schema --component` 直接确定的能力不重复建文档；单个业务界面的专用结构进入对应设计或 runtime owner。

## 路由

| 设计意图或工具 | 直接 owner |
| --- | --- |
| 有限表现状态 | `state-root.md` |
| 固定单选或多选组 | `state-toggle.md` |
| 页面与页签 | `page-view.md` |
| 只读进度 | `progress.md` |
| 动态同构列表 | `scroll-rect-ex.md` |
| 点击、长按与按压反馈 | `button-ex.md` |
| 跨 Artifact 组合与 use-site 差量 | `prefab-ref.md` |
| 统一横向、纵向与网格布局 | `auto-layout-group.md` |
| 矩形、圆角矩形与圆形软遮罩 | `shape-soft-mask.md` |
| 项目复合下拉选择 | `custom-drop-down.md` |
| 可输入、可过滤的候选选择 | `autocomplete-input.md` |
| 虚拟摇杆输入 Widget | `virtual-joystick.md` |
| TMP 文本描边 | `tmp-text-outline.md` |
| TMP 文本溢出模式 | `tmp-text-overflow.md` |

每轮先读一个直接 owner。一个任务同时改变多个能力的组合关系时，再读取相邻规格；不要为取得字段全集打包读取本目录。

## Owner 边界

- Component 字段、默认值、Inspector metadata、Preview/Projection handler、Unity mapping 和自洽校验由 `../../../src/components/`、Registry 与 `schema --component` 持有。
- 本目录只记录字段列表无法表达的适用边界、必要组合、跨 owner 关系和可验收结果，不复制完整 Schema。
- TypeScript API、业务状态、事件和生命周期由 `program/` 对应 runtime owner 持有；本目录只规定其成立所需的 UI Authoring 前置。
- CLI mutation、Publish、reconcile 和结构化结果继续由 `../../workflows/` 与上级 `specification/` 文档持有。

## Component Registry 准入

- Unity Component 在正式 UI 需要 Source 持久字段、稳定 Component Binding、确定性 Projection 或 observation/roundtrip 时进入 Registry。
- 只在 runtime 创建并由 runtime 完整配置、释放的 Component 保持 runtime owner；其类型导出、通用 Binder 映射或测试 fixture 不构成 Source 前置。
- 新增 Component 按完整 Component Module 交付 Schema、默认值、Inspector、校验、Preview、Projection、roundtrip、Unity mapping 和对应验证。

## 新增规格准入

新增文档必须同时满足：

- 能力可跨业务复用；
- 缺少指引会导致稳定的漏配、错选、重复 owner 或错误跨端准备；
- 规则不能仅由 Unity 原生语义或 `schema --component` 唯一推出。
