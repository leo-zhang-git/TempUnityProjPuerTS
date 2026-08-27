# UI 开发基准事后分析题面

| 项目 | 固定值 |
| --- | --- |
| Benchmark ID | `ui-development-workflow/photo-week-v1` |
| 分析版本 | `2.0.0` |
| 分析时机 | 首版、固定调整和人工验收全部结束后 |

本文件驱动独立分析 AI 从 Codex、Claude Code 或 Grok Build 的持久会话、CLI JSONL、工作区事实和人工结论生成单轮报告。分析者不修复实现、不重新运行实现题面，也不采用实现 AI 自报的耗时或 token。

## 调用输入

调用方必须给出：

- Run ID。
- runner：`codex`、`claude` 或 `grok`。
- 实现 session ID。
- 首版与调整的全部 segment JSONL、stderr 与 sidecar 路径；人工直接运行且没有 CLI 日志时明确写 `transcript-only`。
- runner `baseline.json`、`state.json`、Unity 起始诊断、阶段末 snapshot 和 `archives/<run-id>/manifest.json`。
- 主持游戏运行截图原始档案路径、`runs/<run-id>/` 代表截图、Game View 或 Player 来源、workspace client 归属和逐图审查结论。
- 人工验收结果：`pass`、`fail`、逐项备注，或因样本有效性门禁提前停止时的 `not-run: <gate>`。
- 主持 session ID（如有），只用于分离主持开销。

缺少的输入先从指定日志和工作区只读发现。无法可靠恢复时写 `unavailable`，不向实现 AI 追问，不编造默认值。

## 分析边界

- 分析开始时固定 UTC cutoff，并记录当前分析 session ID；扫描时排除分析 session。
- 原始 transcript、CLI JSONL、全量截图、Reference/Preview 诊断图和索引保持本地，不复制 prompt、机器绝对路径、凭据或大段工具输出到报告。报告只引用主持 AI已按 `README.md` 归档到 `runs/<run-id>/` 的游戏运行代表截图，不新增、替换或编辑图片证据。
- 使用流式脚本、定点 `rg`、CSV/JSON 聚合读取；不把完整 transcript 一次性加载到模型上下文。
- 只允许新增或更新 `runs/<run-id>.md` 和 `README.md` 结果总表；`runs/<run-id>/` 代表截图是只读输入，不修改 Source、Prefab、generated binding、program 实现或人工证据。
- 实现、主持、人工等待和分析四类开销分别报告，不合并为一个含义不清的总数。
- 分析必须核对样本有效性门禁。通用 `Write/Edit` 或 shell 脚本直接创建、覆盖、追加或转换 authoring 文档时，结果固定为 `invalid`；后续 validation、Publish 或运行成功不能把该样本恢复为有效。临时 operation/plan 文件经 `edit`、`reference-edit` 或 Publish 消费不属于违规。

## 固定步骤

### 1. 核对样本身份

核对 task、adjustment、参考图 hash、Unity 基线资源 manifest hash，根 Git HEAD/dirty、Unity SVN revision/dirty、runner/CLI、实际模型、effort、provider/profile、权限模式、宿主 Node 二级进程 probe、子 agent 策略和基线资源是否被修改。

命令参数只证明调用意图；模型和 effort 优先以持久 session 或响应事件中的实际字段为准。Grok Build 未回写 effort 时按 state 中的 `effortVerification=cli-accepted` 记录为“CLI 接受”，不提升为服务端回写确认。第三方 provider 无法回写实际模型时标记 `model-unverified`。

### 2. 确定阶段边界

- 首版开始：包含 `task.md` 执行提示的 user event。
- 首版结束：调整提示之前最后一个 turn/task complete 事件。
- 调整开始：包含 `adjustment.md` 执行提示的 user event。
- 调整结束：该 turn 最后一个完成事件。
- 人工等待：主持 AI 给出人工验收检查点，到操作人回复验收结果。

首版与调整之间的操作人间隔不进入实现 elapsed。每个阶段可以包含任意数量 segment：调整 user event 之前的初始 turn 与 continuation 均归首版，调整 user event 及其 continuation 均归调整。持久 transcript 用于核对缺失事件、失败 turn token 和所有 segment 是否属于同一 session。

同阶段发生 continuation 时同时保留两种时间：

- `阶段 wall span`：该阶段首个 user event 到最后一个完成事件，包含 segment 之间的主持恢复间隔。
- `segment elapsed sum`：各 sidecar `start/end` 的进程段耗时之和，不包含恢复间隔。

报告以阶段 wall span 作为首版/调整 elapsed，并单列 segment elapsed sum、恢复间隔、各段退出原因和失败段。外部 host 截断但没有 end sidecar 时，使用持久 transcript 的最后事件与下一 continuation 起点恢复边界，并把精度标记为 `derived`；不能恢复时写 `unavailable`。

### 3. 提取时间

记录：

- 首版 wall span、segment elapsed sum、active time、恢复间隔和外部等待。
- 调整 wall span、segment elapsed sum、active time、恢复间隔和外部等待。
- 实现 elapsed，为首版与调整 elapsed 之和。
- 主持 elapsed、人工等待、分析 elapsed，均独立列出。

时间只来自事件 timestamp、runner 的 task completion、CLI 进程事件或主持消息时间线。active time 或等待无法可靠计算时标记 `unavailable`。

### 4. 提取 token 与费用

Codex 使用 cumulative token delta，记录 input、cached input、output、total、模型调用数和 compaction。cached input 是 input 子集，不能重复相加；同 session 的失败 turn 与所有 continuation 都进入其所属阶段。

Claude 使用按单 session `(message.id, requestId)` 去重后的 assistant usage sum，记录 input、cache creation input、cache read input、output、total 和模型调用数。全部 segment 只用于确定阶段边界，usage 仍按持久 session 去重，避免 continuation 重复计费。优先复用 `tools/token-bubble/token_usage_core.py` 与 session 明细口径。

Grok 使用指定 session `updates.jsonl` 中 `turn_completed.usage` 的阶段增量，记录 input、cached read、output、reasoning、total、模型调用数和模型拆分；CLI stream 用于确定阶段边界，不与 session usage 重复相加。

DeepSeek Pro、GLM 和 Grok 的费用只有在分析 revision 的价格表存在准确匹配项时才估算，并记录币种和价格表 revision。runner 未提供 usage 或准确价格时写 `unavailable`，不按字符数估算，也不沿用其他模型价格。

实现、主持和分析 session 分别统计。子 agent 使用各 runner 已有去重口径，并列出 agent 数量与模型。

### 5. 分析工具与文档开销

至少提取：

- 模型调用数、tool/MCP 调用数和累计可见 duration。
- 首次读取的 Markdown 路径、重复读取次数、读取返回字节数。
- UI Authoring 的 query/inspect/schema/create/edit/extract/validate/publish 调用次数和失败次数。
- 默认 Reference 的创建、编辑、关系校验、Preview/Capture 和失败次数。
- Unity workspace 诊断、UnityMCP/game-mcp 调用、Play Mode 与运行验收事件。
- 固定基线图片的使用与改动情况；图片生成属于偏离标准输入，仍记录次数、失败/重试和耗时。
- Publish 尝试、结果种类、blocker、重试和人工介入。
- typecheck、build、测试与视觉捕获的调用和最终结果。
- 通用文件工具和 shell 命令对 `.ui.json`、`.ui-reference.json`、`.ui-prototype.json`、`.ui-directory.json` 的直接写入次数、目标与阶段；UI Authoring `edit/reference-edit --ops` 的 preview/write 配对情况。
- CLI 文件参数与 Capture/plan/ops 实际落点；仓库根 `.runtime/` 误用、绝对路径拒绝和因截断/解析失败造成的重复 Publish。
- 后台 client 构建等 lifecycle 调用的启动回执、PID、日志增长、进程终态与退出码；只有启动回执而没有完成证据时标记 `tool-observability` blocker。

逐工具或逐 Markdown token 不是日志直接账单。只允许把 output bytes、下一模型调用 input delta 等写成 `approximate` 相关性，不写成精确 token 成本。

### 6. 判断交付结果

结合实现 diff、Source/Publish/typecheck/运行结果和人工验收，给出：

- `invalid`：违反 cohort、不变输入、模型/effort 或 authoring 语义写入门禁，不进入跨 Run 比较。
- `pass`：固定题面与调整均完成，人工验收通过。
- `partial`：有可运行结果，但存在明确未完成项或人工验收问题。
- `fail`：没有形成可验收结果，或关键交付链路失败。

列出正式 Source、默认 Reference、Preview/Capture、Prefab、generated binding、program owner、调试入口和证据路径，并核对奖励物品框是否复用 `ItemSlotQualityBase`。用 `archives/<run-id>/manifest.json` 核对最终 Source、Prefab、`.meta` 和代码 overlay 的分类、hash 与数量。逐张核对代表截图来自当前 workspace 的 Game View 或 Player，并核对主持观察；Reference Capture、Preview、Prefab 预览、设计工具截图或文件存在性都不能进入运行截图统计，也不能提升为运行态通过。最终工作区状态标记为 `clean`、`active` 或 `incomplete`。

## 证据等级

| 等级 | 含义 |
| --- | --- |
| `exact` | runner usage、事件 timestamp、exit status、结构化工具结果 |
| `derived` | 由明确首尾事件计算的阶段 elapsed、缓存率、成功率 |
| `approximate` | 文档/工具返回与后续 input 的相关性归因 |
| `human` | 操作人的视觉与交互验收结论 |
| `unavailable` | 当前日志无法可靠提供 |

每个核心数字在报告中标注证据等级和来源文件，不写原始敏感内容。

## 输出

有效样本新增 `runs/<run-id>.md`，并更新 `README.md` 结果总表。`invalid` 样本只把分析结果写入 `tools/ui-authoring/.runtime/workflow-benchmark/<run-id>/analysis.md`，不新增版本化 Run 报告、不进入结果总表。详细报告使用以下结构：

1. 一句话结果。
2. 样本身份与 cohort。
3. Reference 基础预览、游戏运行代表截图、主持视觉审查与人工验收。
4. 首版、调整、主持、人工、分析时间。
5. runner 原始 token 字段与费用。
6. 工具、MCP、文档读取和图片生成统计。
7. Publish、验证、blocker、返工与人工介入时间线。
8. Git/SVN 产物与最终状态。
9. 三条最高优先级流程结论，每条都引用证据，不从一次样本推出长期结论。

报告末尾记录分析 session ID、UTC cutoff、分析 revision，以及哪些字段为 `approximate` 或 `unavailable`。
