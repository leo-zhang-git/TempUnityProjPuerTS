# UI 开发流程基准

这套基准使用同一个临时活动界面，反复执行“首版 UI、初版功能、固定调整、人工验收、事后分析”，用于观察 `ui-development-workflow`、UI Authoring、项目文档和运行接入的实际开销。

实现 AI 只负责把功能做完，不承担计时、token 统计或 benchmark 评价。耗时、token、工具调用、文档读取、失败重试和人工等待，统一由另一个分析 AI 在实施结束后从会话与进程日志中提取。

## 文件分工

| 文件 | 使用时机 |
| --- | --- |
| [`task.md`](task.md) | 首版执行时下发，包含完整产品题面和实现约束 |
| [`adjustment.md`](adjustment.md) | 首版完成后，在同一实现 session 中下发 |
| [`analysis.md`](analysis.md) | 人工验收结束后交给独立分析 AI，驱动日志与消耗分析 |
| [`cohort.json`](cohort.json) | runner 使用的固定输入 hash 与 cohort 版本 |
| [`benchmark_runner.py`](benchmark_runner.py) | CLI 前置探针、阶段执行、续跑、最终产物归档/切换和不可变性 gate |
| [`assets/page-1-reference.png`](assets/page-1-reference.png) | Page 1 固定参考图 |
| `runs/<run-id>.md`、`runs/<run-id>/` | 单轮报告及其少量版本化游戏运行代表截图 |
| `archives/<run-id>/` | 本地长期保留的调整后最终 Source、Prefab、代码 overlay；不进入 Git |
| `My project/Assets/Resources/UI/Textures/UIWorkflowBenchmarkPhotoWeek` | 两页共用的固定 Unity 基线图片及 `.meta` |
| 本文件 | 操作人、主持 AI 和分析 AI 使用；不提供给首版实现 AI |

参考图 SHA-256 固定为 `61B2ACA9B98CFD9B4115B410202123D09830DA8765C29E07BBF4933047742572`。Unity 基线目录包含 7 张列表影像、1 张详情图、1 张 Page 2 完整背景和 1 张原始生成图；目录 `.meta`、图片和图片 `.meta` 共 21 个 SVN 基线文件，manifest SHA-256 固定为 `F3C1DF1E113DDDDD204CDCD46AFD4699B98AD510C8C0D328ACB5CFCF65F3D1BD`。该基线已完成 Unity 6000 正式导入规范化，包含稳定的 `nPOTScale` 与 `spriteID`。manifest 以 `Assets/Resources/UI/Textures` 为根，先按相对路径的 ASCII 小写值排序、再以原路径打破平局，写成 `<path>\t<SHA-256>\n` 后对 UTF-8 内容计算；权威值由 `cohort.json` 持有并由 runner 自动复核。9 张运行图片均为 PNG 并按 Unity `Sprite/Single` 导入；`ark-gen.jpeg` 只保留为原始生成图。Page 2 不再生成图片，直接使用固定背景资源。

## 角色边界

| 角色 | 责任 |
| --- | --- |
| 实现 AI | 实施 `task.md` 和 `adjustment.md`，完成必要检查，输出常规交付摘要 |
| 操作人 | 选择工作区、runner、模型和权限配置，完成人工验收并给出结论 |
| 主持 AI（可选） | 通过 Codex、Claude Code 或 Grok Build CLI 启动实现 session、保存原始日志，并在人工验收点暂停 |
| 分析 AI | 读取指定 session、CLI 日志和人工结论，生成单轮报告并更新结果索引 |

实现 AI 不修改 benchmark 文档，不填写阶段时间，不报告 token，不根据主观感受估算“花了多久”。它对题面未固定的设计和实现细节自行判断，不发起澄清；只有外部服务、权限、工作区冲突或额外破坏性授权等真实 blocker 才提前停止。

主持、分析和实现使用独立 session。主持与分析自身的 token 可以另行记录，但不能混入实现 AI 的核心数据。

## 可比较边界

每轮建立 Run ID，格式为 `YYYY-MM-DD-NN`。以下变量相同的轮次才进入同一 cohort：

- `task.md`、`adjustment.md`、runner 首版/调整 prompt 和参考图的 hash。
- 根 Git HEAD、Unity SVN revision，以及起始 dirty 状态。
- runner 与模型固定为：Codex `gpt-5.6-sol / xhigh`、Claude Code `deepseek-v4-pro[1M] / xhigh`、Grok Build `grok-4.6 / max`、Claude Code `glm-5-2-260617 / high`。
- 实际模型、effort、CLI 版本、provider/profile 和权限模式。
- 是否允许子 agent，以及子 agent 的模型和权限。
- Unity 基线资源 manifest hash，以及基线资源是否在首版前保持未修改。
- Unity Editor、UnityMCP、game-mcp 和外部服务的起始可用状态。

不同 runner 或模型可以比较完成率、墙钟、返工和人工介入，但 token 只在相同计量口径内直接比较。Claude 与 Codex 的 tokenizer、缓存字段和日志结构不同，不能把两个 runner 的 `total tokens` 当成同一物理量。

标准起点只保留固定参考图和已提交、已完成 Unity 导入规范化的 Unity 基线图片，不存在本 benchmark 的 Source、Reference、Prefab、generated binding、program owner 和调试入口。基线必须包含 Publish 所需的 `Assets/Shaders/Resources/sRGBUI-Gray` material、shader 及其 `.meta`；`prepare` 在模型调用前缺一即停止。四轮共用同一个已提交 harness 分支、Git HEAD 和 SVN revision，Git 与 SVN 工作副本必须 clean；runner 默认拒绝在 `main` 上 `prepare`，并在首版、每次 continuation、调整和阶段结束检查 Git HEAD、SVN revision、题面/prompt hash 与素材 manifest。已有实验产物或无法归属的工作区改动不得被实现 AI覆盖或自动清理。

## 样本有效性门禁

以下条件在人工 review 前由主持 AI根据 sidecar、CLI JSONL 与工作区结果核对；任一项不满足时停止后续人工 review，把本轮标记为 `invalid` 并保留准确证据：

1. `prepare` 来自专用 benchmark 分支，Git/SVN 起点 clean，阶段结束没有题面、prompt、HEAD、SVN revision、固定素材或模型/effort 漂移。
2. `.ui.json`、`.ui-reference.json`、`.ui-prototype.json` 与 `.ui-directory.json` 的创建和修改全部经过 UI Authoring CLI 语义写入口。复杂批量修改先把 operation JSON 写到 `tools/ui-authoring/.runtime/`，再执行 `edit --ops` 或 `reference-edit --ops` 的 preview 与 `--write`；通用 `Write/Edit` 或 shell 脚本直接写 authoring 文档属于样本违规。
3. CLI 的 Source、`--ops`、`--plan` 与 `--out` 参数使用仓库相对路径。临时 operation、Publish plan、Capture 和解析日志统一进入 `tools/ui-authoring/.runtime/`，不写入仓库根 `.runtime/`，也不混入版本化 Run 证据。Windows PowerShell 调用 npm 使用 `npm.cmd`，Bash 使用 `npm`。
4. Publish 保留完整结构化输出并按 `status`、`stage`、`result.kind` 与 blocker 判断结果。每次 `publish-live` 都视为一个独立 job；只因 confirmation、明确瞬时错误或 Editor claim blocker 才允许重试，不能为了 `tail`、`grep` 或重新解析输出重复调用。
5. 后台 lifecycle 调用返回 PID 或日志路径只证明“已触发”。client bundle 等构建必须取得进程终态、退出码和可读日志；后台进程持续无输出且无法判断进度时记录为 `tool-observability` blocker，不无限等待，也不把启动回执计作构建成功。

## 固定实施顺序

一轮使用同一个实现 session 完成两个独立 turn：

1. 下发 `task.md`，实现 AI完成首版 Source、Reference、初版功能和可自动完成的运行验收，然后结束该 turn。
2. 下发 `adjustment.md`，实现 AI完成固定调整和回归验证，然后结束该 turn。
3. 操作人按固定清单进行人工验收。
4. 人工给出结论后，才允许主持或分析 AI评价本轮并写入结果。

首版和调整之间不做人工设计评审，不补充新需求。这样首版时间和调整时间可以由两个 turn 或两段 CLI 日志自然切分，不需要实现 AI 手工计时。

## 方式一：人工直接执行

操作人新建一个 Codex、Claude Code 或 Grok Build session，把下面的首版执行提示连同 `task.md` 路径交给实现 AI：

```text
这是一次 UI 开发 benchmark。读取并实施
tools/ui-authoring/benchmarks/ui-development-workflow/task.md，参考图按文档中的稳定路径读取。

直接持续实施到首版 Source、Reference、Publish、program 接入和可自动完成的运行验收结束。题面未固定的视觉与实现细节由你自行判断，不要向我提澄清问题。当前调用授权你在本工作区修改本 benchmark 所需的 UI Authoring Source、Reference、正式生成产物和 program 文件，并按项目流程使用 Unity Editor、UnityMCP 与 game-mcp；不授权修改固定基线图片、提交版本控制、清理实验产物或覆盖无关改动。

开始实施前读取仓库 ui-development-workflow skill 及其路由文档。Source 和 Reference 的语义创建、修改使用 UI Authoring CLI：先运行默认 preview，确认候选后以同一命令追加 --write；复杂批量修改把 operation JSON 写入 tools/ui-authoring/.runtime/，再使用 edit 或 reference-edit 的 --ops 入口。通用文件写入工具只能写临时 ops/plan、program 文件和日志，不能直接创建或修改 .ui.json、.ui-reference.json、.ui-prototype.json 或 .ui-directory.json；绕过语义写入口会使本轮样本无效。CLI 的 source、--ops、--plan 和 --out 路径均按仓库相对路径传入，不随 shell cwd 改变；Capture 输出写到 tools/ui-authoring/.runtime/。Windows PowerShell 中调用 npm 使用 npm.cmd，Bash 中继续使用 npm。保留 Publish 的完整结构化输出，只在明确的 confirmation、瞬时错误或 Editor claim blocker 下重试，不为重新解析输出重复创建 Publish job。Unity 操作前从仓库根运行 python tools/unity_workspace_status.py；正式 Publish 只在当前工程处于 Edit Mode 且脚本编译、资源刷新已完成时执行。Editor claim 超时时按错误提示再次检查状态、等待编译或刷新完成后重试同一 Publish，不进入 Play Mode 接取任务。

不要读取同目录 README.md、adjustment.md、cohort.json、benchmark_runner.py 或历史结果。不要计时、估算 token、填写 benchmark 记录或修改 benchmark 文档。只有无法自行消除的外部 blocker 才提前停止并准确报告。
```

首版 AI结束后，在同一 session 发送：

```text
继续本轮 benchmark。读取并实施
tools/ui-authoring/benchmarks/ui-development-workflow/adjustment.md。

直接完成调整、必要 Publish、program 回归和可自动完成的运行验收，不要回问，不要记录耗时或 token，不要修改 benchmark 文档。沿用首版已授权的操作范围。Source 和 Reference 的语义修改继续使用 UI Authoring CLI 默认 preview，再以同一命令追加 --write；批量修改使用 tools/ui-authoring/.runtime/ 下的 operation JSON 和 edit/reference-edit --ops，不能用通用文件写入工具直接修改 authoring 文档。CLI 文件参数保持仓库相对路径，Capture 输出写到 tools/ui-authoring/.runtime/；Windows PowerShell 使用 npm.cmd，Bash 使用 npm。保留 Publish 完整结构化输出，只在明确的 confirmation、瞬时错误或 Editor claim blocker 下重试。继续前从仓库根运行 python tools/unity_workspace_status.py，复核 Unity 当前模式与未完成 job；正式 Publish 前确保 Editor 处于 Edit Mode，并等待脚本编译和资源刷新完成。Editor claim 超时时按错误提示等待并重试同一 Publish，不进入 Play Mode 接取任务。
```

调整结束后，操作人完成人工验收。随后把实现 session ID、runner、人工结论和可用日志交给另一个 AI分析。分析前不要求实现 AI补写任何测量信息。

## 方式二：AI 主持 CLI 执行

主持 AI在项目根目录通过 `benchmark_runner.py` 启动独立实现进程，保存机器可读 stdout/stderr、每段 sidecar 和可恢复 session。原始日志放在：

`tools/ui-authoring/.runtime/workflow-benchmark/<run-id>/`

主持流程如下：

1. `prepare` 要求位于专用 benchmark 分支且起点 clean，先检查固定 Publish 依赖，再核对 `cohort.json`，执行 runner、Node `os.userInfo()`、UI Authoring `check` 和 Unity workspace 探针并创建持久 session。全局 `check` 的结果作为基线诊断证据保留，既存的无关文档诊断不阻断局部 benchmark；Publish 依赖、runner/version、Node、认证与二级进程 probe 仍是硬门禁。
2. `stage --stage initial` 执行首版；进程因 429/502/503、连接重置、provider memory pressure 或 Node `ENOMEM` 退出时，runner 在同一 session 自动建立 continuation。
3. `stage --stage adjustment` 使用同一 session 下发固定调整。主持进程没有两小时硬截断；若外部 host 中断，重复同一 stage 命令会从 sidecar 恢复。
4. `snapshot` 保存阶段末 Git/SVN、固定输入和素材 manifest；任何不可变输入漂移都会停止下一段并标记 contaminated。
5. 调整完成后执行 `archive-final`，只归档最终 Source、Reference、Prefab、`.meta`、generated binding 和程序 overlay；不归档首版中间态。
6. 本轮检查与截图完成后执行 `reset` 回到同一 clean baseline，再开始下一模型。需要重看某轮时执行 `activate`；切换到另一轮前先用当前 Run ID `reset`。
7. 汇总实现 AI的交付摘要但不评价质量和效率，向操作人提供人工验收入口与固定清单，然后暂停主持流程。
8. 收到人工结论后，再启动独立分析 session 或由主持 AI进入只读分析阶段。

每个执行段写 `<runner>-<stage>.segment-NN.jsonl`、stderr 与 `.segment.json`；sidecar 包含 start/end、exit、reason、session、模型事件和段前/段后 workspace checkpoint。主持 AI不得把自己的推理时间当成实现时间，也不得在等待人工时保持实现 CLI 进程悬挂。人工等待通过主持会话消息时间线单列，不并入实现 AI的两个执行 turn。

### 标准 runner 命令

从已同步的 `main` 创建并提交一条四轮共用的 harness 分支，再执行 runner。每轮使用不同 Run ID，但不切换 Git HEAD：

```powershell
git switch -c benchmark/ui-development-workflow-four-model main
```

四模型的 `prepare` 命令如下，阶段和最终归档命令共用：

```powershell
$runner = "tools/ui-authoring/benchmarks/ui-development-workflow/benchmark_runner.py"
python $runner prepare --run-id <deepseek-run-id> --runner claude `
  --model 'deepseek-v4-pro[1M]' --effort xhigh --settings <deepseek-provider-settings.json>
python $runner prepare --run-id <glm-run-id> --runner claude `
  --model glm-5-2-260617 --effort high --settings <glm-provider-settings.json>
python $runner prepare --run-id <grok-run-id> --runner grok `
  --model grok-4.6 --effort max
python $runner prepare --run-id <sol-run-id> --runner codex `
  --model gpt-5.6-sol --effort xhigh

python $runner stage --run-id <run-id> --stage initial
python $runner stage --run-id <run-id> --stage adjustment
python $runner snapshot --run-id <run-id> --label implementation-end
python $runner archive-final --run-id <run-id>
# 完成本轮运行截图后：
python $runner reset --run-id <run-id>
# 后续切回该模型最终态：
python $runner activate --run-id <run-id>
```

### 持久 stage 进程与恢复

`stage` 必须由能持续到实现 turn 结束的本地进程持有。直接在人工终端同步执行即可；主持 AI的 shell/tool 调用存在执行时限时，使用隐藏的独立进程启动 runner，并把 host stdout/stderr 重定向到本轮 runtime 目录：

```powershell
$runDirectory = "tools/ui-authoring/.runtime/workflow-benchmark/<run-id>"
$stageProcess = Start-Process -FilePath python -ArgumentList @(
  $runner, "stage", "--run-id", "<run-id>", "--stage", "initial"
) -WorkingDirectory (git rev-parse --show-toplevel) -WindowStyle Hidden `
  -RedirectStandardOutput "$runDirectory/host-initial.stdout.log" `
  -RedirectStandardError "$runDirectory/host-initial.stderr.log" -PassThru
$stageProcess.Id
python $runner status --run-id <run-id>
```

`status` 会返回最近 segment 的状态、host runner PID、CLI runner PID、`hostAlive`、`runnerAlive`、合并后的 `processAlive`、reason 和日志路径。Windows 使用 process handle 判断存活，不使用不受支持的 `os.kill(pid, 0)`；host 与 CLI 任一仍存活时 `processAlive=true`。此时只监控，不再次执行同一 stage；两者均已退出时重复同一 `stage` 命令，让 runner 封口旧 sidecar 并恢复原 session。`Session ID ... is already in use` 表示原 session 仍被占用，先等待并复查 PID/日志，不创建第二个 session，也不并行启动另一条 stage。provider `429/502/503` 等已归类瞬时错误由 runner 在原 session 自动 continuation。

`prepare` 不记录 settings 内容，只在本地 baseline 保存源 settings hash、不含凭据的模型/effort identity 和通过 PATH 解析的实际 runner executable。Claude run 在本轮 `.runtime` 生成 effective settings，只覆盖主模型、subagent 模型和 effort，provider endpoint 与凭据继续来自安全 settings。Windows 的 npm CLI shim 必须解析到可由 Python `subprocess` 直接执行的 `.cmd` 或 `.exe`。默认禁止在 `main` 上启动，`--allow-main` 只用于另有隔离边界并明确登记的非标准环境。`stage` 从持久 transcript 复核实际 model/effort，发生静默漂移时标记 contaminated 并停止。非零退出且没有被归类为瞬时 runner/provider 故障时停止，不把实现错误伪装成自动续跑。恢复现场时先运行 `status`，再重复对应 `stage` 命令，不建立新 session。

### Codex CLI

runner 使用持久 session 和 JSONL 输出，不使用 `--ephemeral`。标准 Codex cohort 固定使用 `danger-full-access + approval=never`。Windows 原生 Codex 在该模式下不经过 restricted-token sandbox；`prepare` 先在同一宿主环境执行无模型二级进程 probe，确认 Node 能启动 UI Authoring executor 依赖的子进程：

```powershell
$repoRoot = git rev-parse --show-toplevel
node -e "const {spawnSync}=require('node:child_process'); const r=spawnSync('python',['tools/unity_workspace_status.py','--format','json','--processes-only'],{stdio:'ignore'}); console.log(JSON.stringify({error:r.error&&r.error.code,status:r.status}))"
```

标准输出必须为 `{"status":0}`。Windows restricted-token sandbox 会使 Vite/Node 二级 `spawn` 返回 `EPERM`，导致 Preview、Capture 或 Publish 在进入目标流程前失败；该限制会把 runner 环境故障混入模型效果，因此不再作为标准 Codex cohort。Full access 会移除文件系统和网络边界，标准执行必须使用专用 benchmark worktree、固定题面授权、clean Git/SVN 起点和不可变性 gate，不使用 `--yolo` 或其他 bypass 简写。

直接排障时的等价命令形态如下；`--ask-for-approval` 是顶层 option，必须位于 `exec` 前，prompt 固定从 stdin 的 `-` 读取，避免 `--image` 消费位置参数：

```powershell
$initialPrompt | codex --ask-for-approval never --sandbox danger-full-access `
  -c 'model_reasoning_effort="<effort>"' `
  exec --json -C $repoRoot --model <model> `
  --image tools/ui-authoring/benchmarks/ui-development-workflow/assets/page-1-reference.png -
```

从首段 JSONL 取得 session ID，再恢复同一 session：

```powershell
$adjustmentPrompt | codex --ask-for-approval never --sandbox danger-full-access `
  -c 'model_reasoning_effort="<effort>"' `
  exec resume --json --model <model> <session-id> -
```

`approval=never` 表示执行过程不弹出授权问题，`danger-full-access` 表示不施加 Codex 文件系统和网络 sandbox；所需写入范围和 Unity 操作仍由启动提示明确授权。二级进程 probe 未通过时不得开始正式 run；应先修复宿主环境，并把权限变化视为不同 cohort，不由主持 AI在实现过程中临时切换权限。

### Claude Code CLI

Claude Code 使用固定 UUID、持久 session 和 `stream-json`。runner 接收 provider 安全 settings 模板，并在 run-local `.runtime` effective settings 中把主模型、subagent 模型和 effort 锁定为矩阵目标；实际 provider/model/effort 仍以持久 transcript 为准。直接排障时的等价命令为：

```powershell
$benchmarkSessionId = [guid]::NewGuid().ToString()

$initialPrompt | claude --print `
  --session-id $benchmarkSessionId `
  --model 'deepseek-v4-pro[1M]' `
  --effort xhigh `
  --permission-mode dontAsk `
  --output-format stream-json `
  --verbose `
  --setting-sources project,local `
  --settings <secure-settings.json>
```

调整阶段恢复同一 session：

```powershell
$adjustmentPrompt | claude --print `
  --resume $benchmarkSessionId `
  --model 'deepseek-v4-pro[1M]' `
  --effort xhigh `
  --permission-mode dontAsk `
  --output-format stream-json `
  --verbose `
  --setting-sources project,local `
  --settings <secure-settings.json>
```

Claude Code 的 provider、API endpoint 和凭据必须在运行前由环境安全配置，不能写入 benchmark 文档或日志。DeepSeek 与 GLM 各自使用匹配 provider 模板；effective settings 不进入版本化结果。分析时以 session 中实际返回的 model 和 effort 字段为准，缺失时分别标记 `model-unverified` 或 `effort-unverified`。

`dontAsk` 需要配套的项目权限配置允许本轮必要工具。不要使用 `--no-session-persistence`，否则事后无法从 Claude transcript 复核完整用量和工具过程。只有在外部隔离环境已经提供安全边界时，才可由操作人明确选择更宽权限；主持 AI不得自行启用 `--dangerously-skip-permissions`。

### Grok Build CLI

Grok Build 使用固定 UUID、持久 session 和 `streaming-messages-json`，标准样本固定为 `grok-4.6 / max`。runner 在 `prepare` 中核对当前账号模型列表，首版以 `--session-id` 创建会话，调整和 continuation 以 `--resume` 复用同一会话。`--always-approve` 与题面授权共同构成本 cohort 的执行权限。

Grok stream 和本地 session 可回写实际模型，模型漂移会使样本无效。当前 Grok Build 1.0.3 不在 stream 或 session summary 回写实际 reasoning effort；`max` 只记录为 CLI 接受并成功执行，证据字段为 `effortVerification=cli-accepted`，不能写成服务端回写确认。

## 主持截图审查与人工验收点

首版和调整都完成后，主持 AI先完成“样本有效性门禁”、`implementation-end` snapshot 和 `archive-final`。通过后再完成典型游戏运行界面截图审查，最后才向操作人发出人工验收清单：

1. 在当前 workspace 的 Unity Game View 或实际 Player 中复现并截取 Page 1 默认态、Page 2 全部委托、可领取筛选、筛选内领取后、回到全部后的状态，以及投入胶片弹窗的 editable 与一个不可提交状态。截图必须是玩家实际看到的完整游戏画面，不包含 Unity Editor chrome。
2. 全量原始截图统一留在 `tools/ui-authoring/.runtime/workflow-benchmark/<run-id>/visual-review/`，并保存 `index.md` 或 `manifest.json`，逐项记录截图路径、界面/状态、viewport、Game View 或 Player 来源、workspace client 归属和观察结论。原始截图与索引是 run-local 证据，不进入 Git 提交。
3. UI Authoring Reference Capture、Preview、Prefab 预览和设计工具截图只作为本地 authoring 诊断证据，可以与明确的证据类型一起留在 `.runtime`，不满足游戏运行截图门禁，也不进入 `runs/<run-id>/`。
4. 主持 AI必须实际打开并查看每张游戏运行截图，检查遮挡、越界、文字截断、错误层级、资源缺失、状态辨识和关键操作后的视觉结果；只确认文件存在不算完成截图审查。
5. 完成全量审查后，主持 AI从游戏运行截图中选择 `3-6` 张复制到 `tools/ui-authoring/benchmarks/ui-development-workflow/runs/<run-id>/`。选择应覆盖主要默认界面、关键前后状态、重要不可提交状态，以及足以说明发现的缺陷或 blocker 的画面；不能只保留通过项。
6. `runs/<run-id>.md` 必须以相对路径直接引用每张代表截图，并逐张写明界面/状态、Game View 或 Player 来源、workspace client 归属和简短观察。代表截图使用稳定的 ASCII 文件名和 PNG/JPEG 格式，不包含 prompt、凭据、机器绝对路径、日志或敏感 metadata；它们是可提交的运行评审证据，不属于 Source、Prefab、generated binding 或程序交付产物。
7. 游戏运行截图或对应状态因外部条件无法获得时，在原始索引和 Run 记录中写明准确 blocker 与缺失范围，不归档其他证据类型作为替代，人工 review 门禁保持未满足。
8. 游戏运行截图审查和代表图归档完成后，主持 AI提供原始证据目录、Run 记录、主持审查结论、可用的 Unity/调试入口和下面的清单，然后等待操作人回复 `pass`、`fail` 或逐项备注。

人工验收清单：

1. 主 Canvas、两个 Page、条目 Widget 和投入弹窗均可在游戏运行态打开，基础内容、列表组合和关键状态正确显示。
2. `1280 x 720` 下 Page 1、Page 2 和投入弹窗没有遮挡、越界或错误层级。
3. 两个 Page 反复切换正常，返回后保留本轮选择和列表状态。
4. Page 1 列表可滚动；影像选择、锁定提示、收集奖励和反馈正确。
5. Page 2 列表可滚动；奖励物品框复用 `ItemSlotQualityBase`，领取后状态更新且滚动位置不回顶部。
6. `Slider`、整数输入、加减按钮同步；取消、遮罩和确认不关闭父 Canvas。
7. `editable`、`noMaterial`、`complete` 三种弹窗状态可以稳定复现。
8. `全部 / 可领取` 筛选、筛选内领取、条目移除和回到全部后的 `claimed` 状态正确。
9. 视觉完成度、文字可读性、点击反馈和整体主题达到可评审首版。

人工基于主持截图档案和实际运行结果记录结论、现象及必要补充截图，不手工统计 token 或翻查工具调用。人工验收耗时不计入实现时间；需要时由主持会话的检查点与回复时间单独推导。

## 事后分析

分析 AI只读取实现产物、指定 session 和日志，不修复实现。它在分析开始时固定 cutoff，避免把自己的 session 算入被测样本。

### 输入

- Run ID、runner 和实现 session ID。
- 首版与调整的 CLI JSONL；人工直跑没有 CLI JSONL 时，使用 runner 的持久 transcript。
- Git/SVN 起始与结束状态、Unity workspace 诊断。
- 主持截图档案、主持审查结论、人工验收结论和补充截图路径。
- 本轮 task、adjustment、参考图 hash、Unity 基线资源 manifest hash 及 cohort 配置。

### Codex 数据源

- 原始 rollout：`$CODEX_HOME/sessions`，未配置时使用用户目录下 `.codex/sessions`。
- `tools/token-bubble/analyze-codex-sessions/scripts/analyze.mjs` 提供 session token、active turn、elapsed、tool/MCP、Markdown 重读、轮询和 subagent fork 去重结果。
- 分析脚本按 cwd 与 cutoff 扫描后，从 `sessions.csv`、`tool-calls.csv`、`mcp-calls.csv` 和 `md-references.csv` 中按实现 session ID 选取本轮，不把完整原始输出批量载入模型上下文。

### Claude Code 数据源

- 持久 transcript：用户目录下 `.claude/projects/**/*.jsonl`，按固定 session ID 定位。
- 首版与调整的 `stream-json` 分别提供自然阶段边界、事件时间、工具调用和退出结果。
- `tools/token-bubble/token_usage_core.py` 按单 session 的 `(message.id, requestId)` 去重 Claude usage；token-bubble 的 session 明细可用于核对模型维度、cache create/read、输出和费用。
- DeepSeek Pro、GLM 和 Grok 的价格只有在分析 revision 的本地价格表存在匹配项时才估算；否则费用写 `unavailable`，不沿用其他模型价格，也不按字符数估算 token。

Claude Code 当前没有与 Codex `analyze.mjs` 完全同构的专用报告脚本。分析 AI应流式解析指定 transcript 和两段 `stream-json`，只提取本轮需要的事件；缺失字段标记为 `unavailable`，不能用 Codex 字段或主观估计补齐。

### 时间口径

- `首版 elapsed`：首版 user event 到该 turn 最后一个完成事件。
- `调整 elapsed`：调整 user event 到该 turn 最后一个完成事件。
- `实现 elapsed`：前两项之和，不包含两个 turn 之间的操作人间隔。
- `active time`：runner 日志能够可靠提供时单列，不拿它替换 elapsed。
- `外部等待`：Unity job、MCP、网络或子进程在实现 turn 内的等待，由工具事件推导。
- `人工等待`：主持检查点到人工回复，单列且不进入实现 elapsed。
- `主持开销` 与 `分析开销`：按各自 session 单列，可用于评价整套实验成本，但不并入实现 AI。

所有时间来自事件 timestamp、CLI 进程日志或 session 完成记录。日志不足时写 `unavailable`，不接受实现 AI在最终回复中自报的分钟数。

### Token 口径

Codex 使用 cumulative token delta，记录 `input`、其中的 `cached input`、`output`、`total` 和模型调用数。`cached input` 是 input 子集，不能重复相加。

Claude 使用去重后的 assistant usage sum，记录 `input`、`cache creation input`、`cache read input`、`output`、`total` 和模型调用数。Claude 与 Codex 分别保留各自原始字段，再由 token-bubble 计算 runner 内部一致的缓存率和费用估算。

逐阶段、逐工具和逐 Markdown 的 token 都不是日志直接账单。分析 AI可以报告文档读取次数、返回体字节数和下一次模型调用 input delta，但必须标记为相关性归因，不能写成“该文档消耗了 N token”的精确结论。

### 事件分类

| 分类 | 主要证据 |
| --- | --- |
| `requirement` | 因题面理解导致的停顿、错误实现或额外用户消息 |
| `routing-doc` | owner 首跳、Markdown 读取与重复读取 |
| `source-schema` | Component、Binding、Reference 和 validation 错误 |
| `mutation` | preview、write、extract 和 affected closure |
| `asset` | 图片生成、导入、GUID、字体和 Sprite |
| `publish-unity` | preflight、Unity job、Prefab 和 generated binding |
| `program` | TypeScript owner、类型、mock 数据和生命周期 |
| `runtime` | 调试入口、交互、列表、视觉和 MCP 验收 |
| `environment` | CLI、Editor、MCP、provider、网络和工作区状态 |

只有发生撤销、重做、重复 Publish、重复验证或人工介入才算返工。单次只读诊断不算返工。

## 分析 AI 提示

完整分析题面由 [`analysis.md`](analysis.md) 持有。启动分析 session 时提供 Run ID、runner、实现 session ID、日志目录和人工结论，不再复制一份不同口径的分析规则。

```text
读取 tools/ui-authoring/benchmarks/ui-development-workflow/analysis.md，分析 Run <run-id>。
runner=<codex|claude|grok>
实现 session=<id>
原始日志目录=<path>
人工验收=<result-or-note>
```

## 结果总表

当前没有保留的有效 Run。废弃、受污染或未通过样本有效性门禁的执行不进入总表。

| Run | Runner / 实际模型 | Cohort | 首版 elapsed | 调整 elapsed | 实现 elapsed | Token / 费用 | Publish | Blocker / 返工 | 人工验收 | 结果报告 |
| --- | --- | --- | ---: | ---: | ---: | --- | ---: | --- | --- | --- |

### 2026-08-13 本地人工评审

`2026-08-13-01`（`gpt-5.6-sol / xhigh`）、`2026-08-13-02`（`deepseek-v4-pro[1M] / xhigh`）和 `2026-08-13-03`（`grok-4.6 / max`）均完成首版、固定调整、最终归档和 workspace reset。`2026-08-13-04`（`glm-5-2-260617 / high`）在读取固定参考图后被 provider 以仅支持文本输入拒绝，未产生实现产物，不进入比较。

本地 Game View 人工评审的定性结论是：Grok 4.6 与 GPT-5.6 Sol 的视觉完成度和整体呈现明显优于 DeepSeek Pro；现有证据不足以进一步确定 Grok 与 Sol 之间的严格排序。DeepSeek 与 Grok 的保留截图未使用统一的 `1280 x 720` viewport，三轮也未完成正式事后分析，因此该结论不外推到耗时、token、费用或完整 benchmark 排名，三轮仍不进入上方有效 Run 总表。

人工评审完成后清理 run-local 原始日志、全量截图和最终 overlay；固定题面、参考图、runner、版本化 Unity 图片基线及其 manifest 继续保留，供后续同 cohort 复测。

单轮详细报告写入 `runs/<run-id>.md`，精选的 `3-6` 张游戏运行代表截图写入 `runs/<run-id>/` 并由报告直接引用。原始 session、CLI JSONL、全量截图、Reference/Preview 诊断图和索引留在各自本地日志或 `.runtime`，不提交可能含 prompt、机器路径、凭据或大段工具输出的原始内容。

## 结束与清理

`archive-final` 完成后，本轮最终 overlay 长期保存在 ignored 的 `archives/<run-id>/`。完成运行截图后使用 `reset` 回到同一 clean baseline，随后才能开始下一模型；查看历史效果时使用 `activate`，查看完再用同一 Run ID `reset`。命令会校验 Git HEAD、SVN revision、工作区 clean 状态、清单和文件 hash，不允许跨基线应用。

报告把最终状态标记为：

- `clean`：已回到起始状态，可开始下一轮。
- `active`：某轮归档已应用到工作区，可运行查看，但不能开始另一轮。
- `incomplete`：仍有未归属或未处理产物，不能在同一工作区开始下一轮。

## 版本记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| `2.0.0` | 2026-08-13 | 固定 Sol、DeepSeek Pro、Grok 4.6、GLM 5.2 四模型矩阵，增加 Grok 持久 runner、Claude run-local effective settings，以及调整后最终 Source/Prefab/代码 overlay 的归档、reset 和 activate；清空旧诊断结果。 |
| `1.7.1` | 2026-08-08 | 在模型调用前硬检查 `sRGBUI-Gray` Publish 依赖，并让 Unity workspace 归属同时识别 worktree junction 的逻辑路径与解析路径。 |
| `1.7.0` | 2026-08-08 | 将标准 Codex cohort 固定为 `danger-full-access + approval=never`，以宿主 Node 二级进程 probe 替代 restricted-token sandbox probe，把权限模式纳入不可变 cohort 输入，将全局 UI Authoring `check` 调整为非阻断基线证据，并固定 Windows runner shim 解析。 |
| `1.6.0` | 2026-08-07 | 增加 authoring 语义写入、仓库相对临时路径、Windows npm 入口、Publish 单 job、后台构建完成证据和持久 stage/PID 恢复门禁；清空旧的无效 Run 记录。 |
| `1.5.0` | 2026-08-07 | 规定 `runs/<run-id>/` 只归档当前 workspace 的 Game View 或 Player 截图；Reference、Preview 和设计工具截图仅作本地诊断，缺少运行截图时阻止人工 review。 |
| `1.4.1` | 2026-08-07 | 将全量截图保留在 `.runtime`，并要求人工 review 前把每轮 `3-6` 张代表截图及逐图观察归档到 `runs/<run-id>/`。 |
| `1.4.0` | 2026-08-07 | 固定标准 runner 身份为 Claude Code `deepseek-v4-flash / max` 与 Codex `gpt-5.6-sol / xhigh`；补齐中断 session 恢复、忽略 Claude `<synthetic>` metadata，并增加人工 review 前的主持截图审查门禁。 |
| `1.3.0` | 2026-08-06 | 固定 runner prompt hash，要求专用 benchmark 分支，并明确 Source/Reference 写入与 Editor claim 恢复协议。 |
| `1.2.0` | 2026-08-06 | 增加可恢复 runner、阶段 sidecar、瞬时故障 continuation、不可变性 gate，并冻结 Unity 正规化后的素材 manifest。 |
| `1.1.0` | 2026-08-06 | 固化 Unity 图片基线，要求默认 Reference 与 `ItemSlotQualityBase` 复用，并增加 Windows elevated sandbox 前置探针。 |
| `1.0.0` | 2026-08-06 | 建立固定题面、双 runner 执行、人工验收与事后会话分析协议。 |
