# UI runtime

`src/ui/` 是 TypeScript UI 表现层。通用 runtime 与具体 Canvas/Widget 分目录持有，具体表现可以消费游戏命令和只读视图，但不持有游戏规则或 ECS 权威状态。

## 模块职责

| 路径 | 作用 |
| --- | --- |
| `common/ui-node-base.ts` | 持有 UI 节点加载状态、可见意图、父子显隐传播、逐帧转发和对称销毁。 |
| `common/ui-config.ts` | 定义 Canvas 层级名称和稳定的低到高排序。 |
| `common/ui-manager.ts` | 持有 UI root、EventSystem、Canvas registry、层级排序和整体生命周期。 |
| `common/unity-ui.ts` | 提供直接创建和操作 Unity uGUI 节点的基础函数。 |
| `canvas/canvas-base.ts` | 定义由 `UIManager` 初始化和排序的顶层 Canvas。 |
| `canvas/*-canvas.ts` | 持有具体顶层 UI 表现和对应命令/只读视图接入。 |
| `widgets/widget-base.ts` | 定义附着在 Canvas 或其它 Widget 下的运行时 UI 子树。 |
| `widgets/*-widget.ts` | 持有具体、可独立管理生命周期的 UI 子树表现。 |

## 生命周期

节点加载状态为 `created -> loading -> loaded -> destroyed`。加载状态与可见意图分别持有：Widget 可以在父节点隐藏时保留自己的显示意图，父节点恢复显示后再进入实际 show 状态。

`UIManager.openCanvas()` 完成 Canvas 初始化、registry 登记和首次 show。普通关闭使用 `UIManager.closeCanvas()`；manager 销毁时按逆序销毁全部 Canvas，随后释放其创建的 EventSystem 和 UI root。节点销毁入口立即进入 `destroyed`，然后继续清理子节点、disposer、业务表现引用和 Unity 对象；重复销毁不重复执行清理。

## Canvas 层级标准

Canvas 层级由 `common/ui-config.ts` 的 `CanvasSortingLayer` 统一定义，数值只表达从低到高的稳定顺序。业务代码通过 `UIManager.openCanvas(canvas, layer)` 选择语义层，不直接写 Unity `sortingOrder`。

| 层级 | 用途 | 约束 |
| --- | --- | --- |
| `Scene` | 场景内 HUD、游戏表现和跟随场景生命周期的基础 UI。 | 最低层；不放跨场景弹窗。 |
| `General` | 普通全屏页面和主要功能界面。 | 默认业务页面层。 |
| `Overlay` | 在普通页面上叠加的菜单、弹窗、提示和非阻塞遮罩。 | 不承担加载流程。 |
| `UnderLoading` | 需要高于普通弹窗、但必须被 Loading 遮盖的过渡内容。 | 只用于明确的加载前置表现。 |
| `Loading` | 加载遮罩、进度和场景切换阻断层。 | 加载期间负责遮挡下层交互。 |
| `OverLoading` | 必须显示在加载层之上的断线、致命错误或恢复入口。 | 不作为普通系统弹窗层。 |
| `Debug` | 仅开发环境使用的诊断、性能和调试 UI。 | 最高层；不得承载正式业务流程。 |

`UIManager` 按层级从低到高统一重排所有已打开 Canvas；同一层内保持打开顺序，后打开的 Canvas 位于先打开者之上。实际 `sortingOrder` 使用全局顺序生成并预留间隔，Canvas 关闭或异常销毁后立即重排，因此层级不会因长期重复打开而越界。Widget 不选择全局层级，始终随所属 Canvas 的层级、显隐和销毁生命周期；需要独立跨层时应建模为新的 Canvas，而不是在 Widget 内添加覆盖排序。

## 布局基线

当前 CanvasScaler 参考分辨率为 `1080 x 1920`，但运行时必须兼容横屏和不同宽高比。贴边控件使用对应屏幕边缘锚点；需要保持在短边内的游戏对象使用底部或其它语义锚点，不使用可能超出横屏半高的中心绝对坐标；全屏背景和赛道边界使用拉伸锚点。`LaneDodgeCanvas` 的玩家、障碍物和金币以底部中心为坐标原点，玩家在横竖屏下保持相同底部距离。

## 当前边界

- Canvas 与 Widget 可以持有 Unity 对象和 callback，但必须在 `onDestroying()` 或注册的 disposer 中对称释放。
- UI callback 只提交游戏命令或意图，不直接改写 ECS 权威状态。
- 当前示例使用 TypeScript 直接创建 uGUI 节点；Prefab loader、UIBinder、generated binding 和 Legma 不属于当前实现。
- 游戏规则和 ECS 权威状态留在 `src/game/`；具体 Canvas/Widget 只保存表现状态和 Unity 引用。
