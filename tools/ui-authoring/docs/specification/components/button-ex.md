# ButtonEx

## 使用边界

- `ButtonEx` 为已经确认的正规按钮准备点击、按下、抬起、点击间隔、双击、长按和按压反馈能力；纯视觉 Graphic 不承担命令输入。
- 固定选择组的选择 owner 仍由 StateToggle/PageView 决定，ButtonEx 只提供对应点击入口，不保存业务选择事实。

## Source 准备

- ButtonEx 引用正式 Image 或 RoundedRect Graphic 作为 target，并由可射线命中的 Graphic 提供点击区域。
- ButtonEx 固定保持可交互并使用 `None` transition；SpriteState 保持为空。每种按钮视觉样式由独立 Prefab 或 Variant 持有。
- 有不可用态的按钮按需建立 StateRoot，由同一状态同时以 `UGray` 控制 target Graphic、以 `UInteractable` 控制 ButtonEx；始终可用的按钮不额外建立该状态。
- 按压缩放或显隐反馈由 ButtonEx 引用稳定目标；不在 TS 同时实现第二套同语义反馈。
- 需要业务响应时，在当前 Canvas/Widget Binder 建立 ButtonEx Binding；静态 Prototype 交互同样以 ButtonEx 作为 tap trigger。
- Source 不保存 ButtonEx 的 runtime UnityEvent listener；点击、按下和抬起由当前 Canvas/Widget owner 通过运行时 listener registry 绑定和释放。
- 双击、长按和重复触发参数只在产品行为明确时启用，不从按钮视觉样式推断。

## 工具验收

- target Graphic 和可选反馈目标存在且进入正式 Projection；Preview-only 目标不能成为正式 ButtonEx 依赖。
- Projection 固定提交可交互、`None` transition 和空 SpriteState，并清理 prefab 中同字段的旧值。
- UI Authoring 验证结构和字段，实际命令、监听释放与输入互斥由 runtime owner 验收。
- runtime listener 注册见 [`program/doc/ui-listener-registration.md`](../../../../../program/doc/ui-listener-registration.md)。
