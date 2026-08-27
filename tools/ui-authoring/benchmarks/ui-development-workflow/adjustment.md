# 禁区影像周固定二次调整

| 项目 | 固定值 |
| --- | --- |
| Benchmark ID | `ui-development-workflow/photo-week-v1` |
| 调整版本 | `1.2.0` |
| 前置条件 | `task.md` 首版已完成 |

本文件只在首版执行 session 已经完成后下发。继续使用同一个实现 session，以便从会话时间线区分首版和调整，同时保留首版上下文。

## 执行约束

- 直接实施并完成必要的 Source、Reference、Publish、program 和运行验证，不为可自行判断的设计或实现细节回问用户。
- Source 与 Reference 修改继续通过 UI Authoring CLI 完成；批量改动使用 `edit/reference-edit --ops`。临时 operation JSON、Publish plan 和 Capture 写入 `tools/ui-authoring/.runtime/`，不使用通用文件工具或脚本直接改 authoring 文档。
- CLI 文件参数使用仓库相对路径；Windows PowerShell 调用 npm 使用 `npm.cmd`，Bash 使用 `npm`；保留 Publish 完整结构化输出，只根据明确的 confirmation、瞬时错误或 Editor claim blocker 重试 Publish。
- 不修改 `task.md`、本文件、`README.md` 或历史结果，不自行计时、估算 token 或填写 benchmark 记录。
- 不提交版本控制、不清理实验产物、不覆盖无关改动。只有无法自行消除的外部 blocker 才提前停止，并在最终摘要中准确说明。

## 调整需求

在“纪念冲印”页的委托列表上方增加 `全部 / 可领取` 二段筛选，默认选择“全部”。

- 切到“可领取”时，只显示当前为 `claimable` 的委托。
- 复用现有 `ScrollRectEx` 和 `PrintCommissionItemWidget`，不复制第二套列表。
- 领取当前筛选结果中的奖励后，该条先显示领取反馈，再从筛选结果中移除。
- 列表保留最接近原位置的有效滚动偏移；只有内容尺寸不足时才夹取到合法范围，不能无条件回到顶部。
- 切回“全部”后，该条保持 `claimed`。
- 两个筛选项具有明确的选中与未选中表现，并提供基础点击反馈。
- 同步更新 `PrintCommissionPageWidget` 默认 Reference，并按需增加命名 Reference，使“全部”和“可领取”两种筛选效果、领取前后的条目变化都能在基础预览中核对。

## 调整验收

- 默认进入 Page 2 时显示全部 8 条委托，筛选状态为“全部”。
- “可领取”只显示当前可领取条目；切换筛选不会创建第二套列表或丢失业务状态。
- 在“可领取”中领取一项后，反馈、移除、滚动偏移和回到“全部”后的 `claimed` 状态均正确。
- 调整涉及的 Source/Reference validation、Reference Preview/Capture、Publish、program typecheck 和运行交互验证通过。
- 完成后只输出常规交付摘要和未解决 blocker，不输出 benchmark 评价或测量数据。
