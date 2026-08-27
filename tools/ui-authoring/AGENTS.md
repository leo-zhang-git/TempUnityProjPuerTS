# UI Authoring 工具开发约定

## 范围

- 本入口服务 `tools/ui-authoring/` 自身的产品、代码、测试和文档开发。
- 正式玩家 UI 的 Source 编辑、Publish、TypeScript 接入和运行验收使用仓库 skill `ui-development-workflow`；常规 UI 交付不以前置阅读本目录开发架构为条件。
- 本工具持有 `.ui.json` Schema、Component Registry、Source Kernel、CLI、本地服务、Web 编辑器、Unity Projection/Publish bridge 和 Source 回写能力。

## 命名边界

- `Legma` 是本工具的用户可见产品名，用于窗口标题、Launcher 入口、指南、Logo 和用户提示。
- `UI Authoring` 是能力与领域名，用于 Source、Publish、Projection、Unity bridge、CLI 以及技术文档。
- `tools/ui-authoring/`、`My project/UIAuthoring/`、API product、环境变量、浏览器存储键和 Unity bridge 类型是稳定技术 contract；品牌调整不迁移这些路径或标识。

## 文档路由

| 问题 | 直接 owner |
| --- | --- |
| 工具概览、CLI 快速入口与文档首跳 | `README.md` |
| 常见 AI Source 编辑操作与定点查询 | `docs/workflows/source-editing.md` |
| Web 节点删除、引用清理与人工交付 | `docs/workflows/node-deletion.md` |
| Publish 结果与 blocker 处理 | `docs/workflows/publish.md` |
| observation、reconcile 与 Prefab Import | `docs/workflows/reconcile.md` |
| Source、Artifact、Binding、Variant 与资产语义 | `docs/specification/source-format.md` |
| Canvas 设计坐标、空间角色、Safe Area 与多宽高比验收 | `docs/specification/canvas-layout.md` |
| 通用 UI 能力的选型、Source 前置与工具验收 | `docs/specification/components/AGENTS.md` |
| Preview、Reference、Prototype 与证据数据 | `docs/specification/preview-evidence.md` |
| Unity job、Publish result、reconcile patch 与失败现场 | `docs/specification/delivery-contract.md` |
| 模块边界、依赖方向和实现 owner 索引 | `docs/development/ARCHITECTURE.md` |
| server、CLI、Unity job、资产与 Publish 实现 | `docs/development/delivery-architecture.md` |
| Web 代码边界 | `docs/development/web-architecture.md` |
| Web 体验与人工操作契约 | `docs/development/web-experience.md` |
| 用户文案、中文提示与术语口径 | `docs/development/terminology.md` |
| Node Rename、Node ID mode、Align 与保存模型重规划 | `docs/development/node-identity-and-external-references.md` |
| unit、CLI、browser、Unity 与 performance 测试 | `docs/development/testing.md` |
| Component 高频字段、Inspector 证据与优化判断 | `docs/development/component-inspector-ledger.md` |
| 未完成的长期结构项 | `docs/development/ARCHITECTURE-ISSUES.md` |
| 已完成复核但尚未闭合的专项质量审计 | `docs/development/quality-audit-2026-08-03.md`（不作为当前规格） |

每轮先读一个直接 owner。只有改动跨越其边界或 owner 明确引用其他文档时才继续展开。

## 核心边界

- Source Kernel 是纯 TypeScript 领域核心，不依赖 React、Node 文件系统或 Unity Editor。
- Source component 的 Schema、默认值、Inspector、校验、Preview、Projection、roundtrip 和 Unity mapping 由 Component Module 持有并通过 Registry 派生。
- CLI 与 Web 消费同一 Kernel mutation；语义写操作默认 preview 并以 `--write` 明确提交。
- 正式 Prefab 只由 Publish 写入。observation/reconcile 生成 Source 候选或 patch，不建立第二写 owner。
- Source、正式资源、运行态任务和证据目录保持各自 owner。
- 当前项目以 single-writer 作为使用前提：同一时刻只允许一个人工 Web server，或一次 AI 写入流程（含该流程使用的 server、CLI 与 Publish）修改 workspace。调用方负责避免人工、AI、CLI 或直接 server 并行写入；违反该前提的跨进程竞争不属于常规故障模型。
- Source 保存、跨文档 mutation 与 Publish 默认采用“写入前完成可稳定判定的必要校验 + 按文件顺序写入 + 部分失败报告”。Publish 通过前置校验后直接写入正式产物；依赖实际生成结果的 audit、typecheck 或 metadata 收尾失败时保留现场。工具不为突然断电、进程崩溃或跨进程并发建立跨文件原子提交、自动 rollback、before-state、恢复 journal 或 crash recovery；需要整体撤销时由用户通过 Git/SVN 处理。
- 预校验读取完整 workspace 只用于解析关系，默认只让当前目标及其受影响依赖闭包中的问题成为 blocker；无关文档错误由显式 `check --full` 报告，不阻断局部 Save、mutation 或 Publish。
- 单文件 baseline/precondition、进程内写串行和临时文件替换属于常规防覆盖措施，可以保留；Kernel 中用于一次候选计算、Undo/Redo 或批量 mutation 的 transaction 不表示文件系统全有或全无。
- 新功能不得为了复用现有 `Save All`、staging/rollback 或 recovery draft 而扩大这些机制。确有超出上述边界的持久一致性需求时，先在直接 owner 中说明具体故障模型、收益与维护成本，并获得用户明确确认。
- `.ui.json`、`.ui-reference.json`、`.ui-prototype.json` 与 `.ui-directory.json` 始终只接受唯一当前无版本结构。loader、formatter、Save 与 Publish 只消费当前 Schema，不保留旧格式 reader、按版本分派或缺省字段兼容态；optional/default 只表达当前格式中的真实可选语义，canonical JSON 省略默认值，只持久化偏离默认且具有信息密度的内容。
- 破坏性格式演进作为独立迁移交付：写入前完成全部受影响 SVN 受管文档的只读清单、确定性转换规则、验证与恢复方案，并获得用户对该批次的额外明确授权。迁移批次同时更新 Git 中的工具、Schema、测试和文档，一次性转换目标格式覆盖的全部 SVN 文档；迁移后旧结构直接校验失败，新旧格式不得在工作区并存。
- Git 与 SVN 无法形成原子提交，格式迁移以同一交付批次管理；两侧均完成验证和提交前不视为升级完成。`.runtime`、浏览器 localStorage、测试报告等可丢弃数据不属于正式 authoring 格式 contract，其内部版本不得成为正式文件多版本兼容的先例。

## 完成要求

- Windows 人工入口 `启动UI编辑器.bat` 在构建和启动前调用仓库 `bootstrap_ui_authoring.py`；依赖与 lock 不一致时自动执行 clean `npm ci`，准备失败则停止启动。
- unit、browser、visual、performance、benchmark、coordination server 和 Unity roundtrip fixture 已随通用工具能力迁移；fixture 使用当前模板路径、命名和 capability contract，不复制 longdemo 的业务 Source、产品资源或服务部署事实。
- `npm.cmd run check` 是工具完整准入，覆盖 Biome、typecheck、unit、Python 与 coordination server 测试和 deadcode；Web、CLI、Unity 与性能类入口按 `docs/development/testing.md` 追加。
- 当前程序 owner 是 `TsProj/src/ui/`。不得恢复 longdemo 的 `program/client`、`program/staticdata` 或其它产品目录作为生成、typecheck、Publish 或测试前提。
- 稳定边界、文档路由、命令入口或结构化结果变化时同步直接 owner，避免在入口和实现文档复制完整规则。
