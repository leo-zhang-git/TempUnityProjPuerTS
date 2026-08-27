# Delivery 实现架构

本文持有 Node server、CLI、Unity job、资产和 Publish 执行的实现 owner。

## CLI 与 Workspace 写入

- `src/cli/command-registry.ts` 持有公开 command、usage 与 boolean/value/repeatable option contract。
- `src/cli/arguments.ts` 持有无进程依赖的 argv 解析，并在 dispatch 前拒绝当前 command 未声明、缺值或非法重复的 option。
- `src/cli/command-context.ts` 持有单次调用的 invocation、output、路径操作、exit code 与可注入 workspace/Unity/server 服务契约。
- `src/cli/workspace-operations.ts` 持有跨 command 复用的 Catalog、workspace 校验、mutation 提交与 layout 数据准备。
- `src/cli/handlers/` 按 workspace、delivery、Source mutation、inspection 和 evidence/projection 领域持有 command 业务；`src/cli/handler-registry.ts` 以完整类型映射覆盖全部公开 command。
- `src/cli/application.ts` 只组合默认服务、解析 invocation、dispatch handler 并统一转换未处理错误。
- `src/cli/main.ts` 只连接 `process.argv`、进程输出和退出码。

语义写操作使用默认预览和显式 `--write`；`template`、`extract-widget`、`extract-fragment`、asset mutation 和 Prefab Import 调用 Kernel/server owner，不复制 Web 语义。两种 extract command 共用跨文档 workspace 校验和写入入口，并分别由 Kernel 保持 Widget Binder 迁移与 Fragment `instancePath` 改写语义。测试入口和 CLI contract 覆盖规则由 `testing.md` 持有。
`rename`、`align-node-ids` 与 `refactor-node-id` 通过 `cli/node-identity-command.ts` 加载完整 workspace，并调用 `kernel/node-identity-refactor.ts` 形成统一 preview。`rename` 可以沿用 mode、用 `--node-id` 切换 manual 或用 `--auto-id` 清除覆写；三个命令都以 `--write` 执行 Source、Reference、Prototype 与 DeliveryState 顺序写入。
`check` 是 fast workspace check，覆盖 Source parse/schema、partial Catalog、Reference/Prototype 关系和目录元数据，作为启动器与显式 workspace 健康入口；`check --full` 是唯一公开的完整 workspace 检查，覆盖资源、canonical、默认字体、资产语义和依赖 TMP 字体 metrics 的有限文本溢出诊断。内部 `doctorWorkspace` 只作为完整检查的实现模块名。

`kernel/prefab-ref-layout-impact.ts` 持有 Source 写入前的 Catalog 差量检查：基础节点 anchor 变化时反向解析 PrefabRef 坐标 override，并由 CLI、`workspace.save` 与 `artifact.transaction` 共用同一门禁。

`server/artifact-transaction.ts` 持有 server 进程内写队列、完整 baseline 预检、单路径临时文件替换和确定顺序写入。`WorkspaceFileWriteError` 返回已写入、失败和未执行路径；后续路径停止，已写入文件不回退。现有 transaction 函数名是 API/实现命名，不表示跨文件全有或全无。工作约定为同一时刻只有一个进程写 workspace，不建立跨进程互斥。

Artifact、Reference、Prototype 与 workspace 文档操作共用该写队列。Web 编辑会话的读取到保存跨越用户操作，各类 Source write 接受 saved canonical content 作为精确 precondition，在队列内从最新 repository snapshot 复核候选后执行单文件 replace；precondition 失配返回 `409`，不覆盖该路径。CLI 进程生命周期短且以磁盘 Source 为当前输入，不携带 Web baseline。

`kernel/workspace-documents.ts` 持有 Artifact、Reference 与 Prototype 的 identity 重写、依赖维护、复制、Variant/Reference 派生和删除校验。`server/workspace-document-service.ts` 持有目录文件操作、完整 workspace plan、目录代表文档更新与跨类型顺序写入；它复用 workspace 写队列、精确 baseline 和部分失败报告。

## Workspace 与 API

- `server/server.ts` 通过 `createUiAuthoringRuntime(paths, dependencies)` 装配 API、Repository、AssetIndex、健康检查和可注入服务，并由 runtime 自身统一关闭 watcher 与服务。production `startUiAuthoringServer` 在该 runtime 外组合 HTTP、静态 Web 或 Vite/HMR；显式 `WorkspacePaths` 允许测试 host 为多个隔离 workspace 建立独立 runtime，不改变 production 请求语义。
- `server/workspace-repository.ts` 持有 immutable raw document snapshot、revision、并发构建合并和外部 fingerprint 失效。repository 从同一 snapshot 派生 partial、repair、scoped 与 strict 视图：Web bootstrap 逐文档隔离解析失败；repair 保存与 CLI mutation 合并待写候选并校验受影响依赖；局部 Publish 使用 scoped Catalog，只隔离可证明与声明 Artifact 及其依赖闭包无关的不可用文档；完整 workspace 检查继续使用 strict Catalog。
- `server/workspace-catalog.ts` 从 partial view 生成可用 Catalog、不可用文档 identity 与结构化诊断。
- `server/workspace-service.ts` 持有 workspace identity、实例发现和固定 Source/正式资产路径。
- `server/source-svn-service.ts` 持有当前 Artifact Source 的 SVN 状态查询与单文件 BASE 还原。还原复用 workspace 写互斥，以 saved canonical content 作为精确 precondition，只接受已纳管文件的普通内容或属性修改；新增、未纳管、移动/删除、替换、缺失和冲突状态不进入自动还原。
- `schema/api/*`、`server/api/body-schemas/*`、`server/api/handlers/*` 与 `web/shared/api/*` 按 workspace、documents、delivery、assets、diagnostics domain 对齐 contract、body schema、server handler 和 Web client。聚合文件只组合 domain owner、共享写入/error support 与 transport。Web 读取使用 `bootstrap`；单文档写入与 `workspace.save` 携带 baseline/precondition，后者返回已写 document id 和可选失败现场。CLI 的 `schema`、`catalog` 与 `projection` 保持 CLI owner。
- `server/runtime-diagnostics.ts` 持有有界运行记录和限长日志尾部。

`GET /api/bootstrap` 从同一 repository revision 返回 config、Catalog 和全部可用文档。server-owned Source/Reference/Prototype 成功写入后显式 invalidate repository；外部文件变化由 fingerprint 触发新 revision。Assets Catalog 不属于 bootstrap 响应，由 Web 在首屏 Canvas 建立后调度；Formal sync 只由用户显式触发。

Artifact SVN 还原通过独立 status/revert API 执行，不复用异步拉起 TortoiseSVN 的 workspace commit/update contract。revert 成功后显式 invalidate repository，Web 从新 bootstrap 重建 target Artifact baseline，并在内存中保留其他 dirty 文档；SVN clean 作为 BASE reset 的成功 no-op，命令失败或 precondition 失配不推进 Web baseline。

`server/collaboration-service.ts` 是 Web 与局域网 coordination server 之间的 fail-open adapter。它复用 `~/.token-bubble/user.json` 的昵称，按 canonical JSON 计算内容 hash，并以 `svn cat --revision BASE` 计算当前文档的本地 SVN BASE hash。完整 status 用于当前编辑上下文的一致性提示；工作区 activity 只读取中心服务的活动编辑 lease，不读取 SVN BASE，并允许 Web 分批查询全部 Catalog 文档。客户端默认不连接中心服务，默认 project identity 为 `puerts-template`；`LEGMA_COLLAB_SERVER` 显式启用服务地址，`LEGMA_COLLAB_PROJECT` 覆盖 project identity，`LEGMA_USER_CONFIG` 覆盖用户配置路径，`TOKEN_BUBBLE_USER` 直接提供只读昵称。中心未配置或不可达时只返回 unavailable 状态，不改变本地保存结果。

Artifact、Reference、Prototype 和 workspace 文档操作只对实际完成的路径异步上报保存结果。重命名、复制、删除和目录移动按操作后的完整文档 identity/hash 上报；被删除或被改名替换的旧 identity 上报空 hash。协作上报不加入 Source 写入，也不改变 API 成功与失败语义。中心服务实现和部署入口位于 `collaboration-server/`，只持有文档 identity、hash、昵称、时间与短期编辑 lease，不接收 Source 内容。
Mutable API route 在读取 typed body 或进入应用服务前使用 `server/api/body-schemas.ts` 的严格 schema 校验，request envelope 的额外字段和不完整 discriminated request 返回 `400`。Source、Reference 与 Prototype 保存候选的 shape、语义、依赖和 baseline 阻断返回结构化 diagnostic，携带文档 identity、相对路径、字段位置、领域错误码和处理建议；Schema 额外字段按具体字段定位。
`GET /api/health` 返回 server fast workspace check 状态。server 启动后立即后台预热 repository snapshot、partial Catalog 和目录元数据；启动器等待该状态完成并输出摘要。Source JSON watch 只负责 invalidate repository，fingerprint 继续作为正确性兜底；Assets/Resources/UI watch 只负责清理 AssetIndex 缓存。

HTTP/Vite/HMR 生命周期由 `server/server.ts` 统一关闭；`server/main.ts` 只把退出信号转为 `UiAuthoringServer.close()`。

## Unity job

`kernel/prefab-path.ts` 从 Catalog entry 的 Source 相对路径与 artifactKey 派生唯一 canonical Prefab path，不从 Artifact type 或 Prefab 目录反解 Source 语义。`kernel/formal-sync.ts` 持有 Source Projection 与当前 Formal observation 的一致性状态和结构化差异；`kernel/delivery-state.ts` 只持有 Prefab/node 引用稳定所需的 identity contract。三者保持纯 TypeScript。

`server/artifact-selection.ts` 持有声明项、依赖闭包和 exclude 规则；Publish 与 Reconcile 共用选择算法，`server/publish-selection.ts` 保留 Publish 语义入口。`server/svn-local-changes.ts` 从 SVN working copy 状态选择新增、替换、修改或未纳管的 Source，并阻断异常工作副本状态。`server/unity-job-service.ts` 持有 job API、FIFO queue、snapshot、close/cancellation 和共享 Projection 准备；`server/unity-job/` 中的 Reconcile、Import、Publish operation 分别持有对应执行流程，result parsing、executor、program gate、retention 和 process lifecycle 各有独立 owner。Web 的 current/dependencies/changes/all 与 CLI 的 current/dependencies/all 范围共用同一 job 编排，changes 固定包含传递依赖闭包。

Reference backdrop 通过独立只读资源入口提供给 Web 与 Capture，不进入正式 UI asset index、资源 mutation 或 Publish。

Publish All 只选择已有 DeliveryState 的 Artifact；Source 创建后保持草稿，直到显式 Publish 完成首次交付。已交付 Artifact 的未交付依赖继续形成 blocker，不由全量发布隐式创建正式 Prefab。

Unity strict job 在启动前 invalidate repository，并在单个 job 内复用同一 strict snapshot，避免 job 步骤间观察到不同 workspace revision。

单个 `UnityJobService` 实例按 FIFO 串行执行 Sync、Reconcile、Import 与 Publish，Web 自动检查和手工交付按顺序操作同一 Unity 工程。队列并发边界为当前 server 进程；AI、CLI 与 Web 的互斥归调用方工作约定。

服务关闭时先拒绝新任务并中止当前 Unity executor/program gate 子进程，再等待运行任务、排队任务和后台清理链收敛。排队任务进入明确 failed 终态，关闭不遗留继续写入当前 workspace 的子进程。Editor 尚未领取的 request 写入 cancelled 并停止执行；已经建立 claim 的 request 由关闭流程继续等待 bridge result，不以 closed 状态提前伪造失败。Editor bridge 在建立 claim 后复检 cancelled，claim/cancel 并发时不进入正式执行。

job snapshot 和 `.runtime/unity-jobs/` 使用可配置的有界 retention。默认内存保留 200 个 snapshot；磁盘保留最多 100 个普通历史目录或 30 天，并为新目录保留一小时清理宽限。queued/running job 目录不参与清理；清理在 service 初始化和 job 进入终态后串行调度。

`UiAuthoringJobBridge` 持有 Unity 侧 job executor。Editor watcher 串行领取 request，并在建立 claim 前同步刷新 AssetDatabase；外部脚本改动触发编译或资源仍在更新时保持 request 未领取，刷新与 domain reload 完成后由当前程序集执行。Editor claim 默认等待 60 秒，超出后返回明确的 Edit Mode、编译与资源刷新重试错误。Editor 不可用时 batchMode `RunFromCommandLine` 在一次启动内执行完整 Plan。server 不维护 batchMode worker，也不通过 UnityMCP 转发 job。

`WorkspaceUnityJobExecutor.execute` 只在 Unity 已完成执行且 server 已读取 bridge result 后收敛。Unity bridge 在 request 同目录原子更新 `progress.json`，executor 同步观察并把逐 Artifact 的校验、Publish、observation 和 audit 工作项合并到 job snapshot；该文件只承载运行进度，不参与正式结果或恢复语义。已打开 Editor 在 60 秒窗口内 claim request；claim 建立后不再设置 server 内部执行时限，并保持当前 FIFO job 占用直到 result 返回，避免 Node 先进入失败终态而 Unity 继续写入。batchMode 的时限覆盖完整子进程生命周期，按执行规模有界调整，超时或中止时终止进程树并取消尚未领取的 request。

`server/unity-job-wait.ts` 持有调用方等待 job 收敛的轮询与时限。时限按 Import、observation 与 Publish 三种等待语义，从 Unity 执行侧上限加排队、Projection 与 program gate 阶段预算派生；CLI 的 `import-prefab`、`sync-live`、`pull-live`、`publish-live` 与 `publish-all-live` 共用该等待入口。调用方停止等待只结束本次调用，不改写 Unity job 的真实运行状态。

job 路由以当前 workspace 的 Unity 进程快照作为唯一状态输入。已打开 Editor 在 Edit Mode 接取 request；脚本编译或资源刷新可以占用 claim 等待窗口，超出 60 秒时返回明确错误。batchMode 具有覆盖完整子进程生命周期、按 Publish 规模有界调整的时限；未领取或超时的 request 进入 cancelled 终态，Editor watcher 跳过该终态。

Projection 携带 Component Module 派生的 component manifest。`UiComponentExecutor` 通用执行 type/select/create、SerializedProperty codec、reference、override、observation 和 audit；SerializedProperty 无法稳定表达的复合语义由 manifest 指定 capability adapter。

Projection 的正式目标统一为 `ProjectionTargetAddress`：`instancePath + nodeId` 持有语义 identity，`nodePath + siblingPath` 持有可验证的结构位置。Unity importer 通过 `CurrentArtifactChildren` 沿 `siblingPath` 解析对象，并在 `nodePath` 命中 `instancePath` 时切换 dependency Artifact owner。Binding、override、component addition、Variant local parent、node-reference value、managed component manifest 和 layout calibration 复用该 resolver；managed component manifest 使用 Base64 编码的结构化地址 key，旧 name-path key 只作为读取迁移 fallback。

## Observation、Import 与 Variant

Formal observation 枚举本地 owner 层级、受支持字段、节点引用、Binding、nested Prefab、Variant base、use-site component addition 和 Unity-only component。identity 优先使用 Prefab GUID、持久 local fileID 和 use-site identity；当前 Import 新建对象使用 Projection 结构地址恢复 id。结构 fallback 只领取尚未被 DeliveryState 占用的 Projection id，Unity 手工新增或复制对象按显示名通过统一分配规则生成新 id。`namePath` 只保留为诊断信息，不参与正式 identity 判断。

批量 Reconcile 将所选 Artifact 和观察所需上下文 Projection 写入一个 job，通过 Unity `observe-plan` 一次返回 `observations[]`。Node 对 concrete 与 Variant 分别 reconcile，按 Artifact 聚合当前一致性、patch、blocker 和候选 Source，并用完整 Catalog 校验整组替换结果。

Kernel reconcile 将确定性字段/引用变化映射为 safe patch，将结构、Binding、PrefabRef 和 component addition 映射为 review patch；无法确定 owner 的关系形成 blocking issue。

`kernel/prefab-import.ts` 组合最小 bootstrap Projection 与 observation/reconcile，把无 Source canonical Prefab 还原为候选 Source。目标 Source path 决定 canonical Prefab path，Unity observation 从 Prefab root 判断 Artifact type；Node 沿 `basePrefabPath` 递归观察 Variant 缺源链，按 base-to-child 扩展临时 Catalog；第一次写入前复核每个瞬时 hash、目标不存在和完整 Catalog，随后按路径顺序写入。

Variant importer 只物化当前层 `nodeAdditions`、`componentAdditions`、`overrides` 与 Binding overlay。继承结构、组件和 Binder 继续由 immediate base 持有。

## Publish 执行

`server/program-ui-contract.ts` 从依赖闭包和正式反向依赖派生验收范围，检查 Canvas staticdata/owner/ctor、Widget owner、可直接构造 Widget 的 name/ctor、generated binding、Fragment binderless 与 Canvas mask contract。具有唯一抽象 owner 的基础 Widget 只生成 binding，不进入运行时 registry。

`server/program-ui-scaffold.ts` 通过 TypeScript AST 和 JSON parser 生成显式确认的最小 owner/registry/staticdata 变更。它不生成业务事件、数据刷新或生命周期逻辑。

`UiFormalPublishExecutor` 在一个 Plan 内：

1. 验证 Projection 与发布能力。
2. leaf-to-root import 正式 Prefab 并生成发布图 binding。
3. 执行 apply 后 capability audit。

Unity 侧不为生产 Publish 建立 before-state；导出遇阻的常规流程是修复报错后重新导出。需要回退时由用户在对应 VCS 手工执行。

Node 随后验证写入后 observation/Projection 收敛、program contract，并提交最小 identity metadata。确认程序脚手架后，Publish 在进入 Unity binding 生成前刷新 UI module path registry，使新增 Widget owner 立即进入 `noInit` 等模块分类；显式设置 `runClientTypecheck=true` 时同样先刷新 registry，并在 generated binding 就绪后执行 client native compiler。默认 Publish 不执行 client typecheck。该定点 gate 不运行 server compiler、server/client contract、protocol、staticdata target 或 scene placement 生成。program preparation 与 client typecheck 的每个子进程持有独立时限，超时进入失败终态，不长期占用 job 队列。

Unity binding generator 的全量入口枚举完整 Formal Prefab 集合，同时生成逐 Prefab binding 与 `TsProj/src/ui/generated/prefab-paths.json`。该 JSON 只保存 Canvas 和可独立创建具体 Widget 的完整 Unity asset path，不定义 runtime identity 类型；Fragment 和抽象 Widget 只生成所需 binding，不进入 runtime root map。局部 generate 只在已有完整且可解析索引上更新受影响 binding，索引缺失或损坏时要求先执行全量 generate。

失败时不自动恢复已写入的产物；job 按预测交付路径收窄 SVN 与 Git 状态查询，并列出失败时刻工作副本中的相关候选路径，由用户核对后在对应 VCS 处置。大范围聚合发布可使用完整 working copy 状态。该清单不是严格的 before/after delta 或本次 Publish 精确归属，可能包含发布前已存在的目标路径改动。

## Asset owner

- Component Module `assetFields` 声明资产字段和类型。
- `kernel/asset-references.ts` 枚举/重写 Concrete、Variant、PrefabRef、Preview、Reference 与 Prototype 引用。
- `server/asset-index.ts` 只读解析 Unity `.meta`、Sprite importer、TMP Font、Animation Clip、Animator Controller 和 metrics。
- `server/asset-audit.ts` 区分持久引用、Prototype session 引用、inventory issue 与未引用资源。
- `reference-edit` 的写入门禁校验目标 Reference、反向依赖 Reference 闭包及消费该闭包的 Prototype；其余 workspace 问题由完整检查报告。
- `server/asset-move.ts` 在 workspace 写互斥内移动资源/`.meta` 并更新持久引用；SVN 文件使用 `svn move --parents`。搬运门禁校验被改写的 Source、Reference 及消费这些 Reference 的 Prototype 闭包，无关 workspace 问题继续由完整检查报告。
- 固定 UI Texture 的路径由 UISource identity 持有：Common Source 进入 `Textures/Common/<分类>/<ArtifactKey>/`，其它 Source 进入 `Textures/Feature/<Source 一级目录>/<ArtifactKey 或同目录稳定共享语义>/`；Feature 一级目录严格镜像 Source 一级目录。跨 Source 一级目录复用只有稳定公共语义才能进入 Common，普通复用仍由最强业务语义 owner 持有唯一 GUID。
- 数据选图资源归 `Textures/Dynamic/<domain>/`；同一资产同时存在固定引用和数据选图消费时由 Dynamic domain 持有唯一 GUID。Publish 只消费 Source 中已成立的持久资源路径，不创建、移动或自动分类 Texture。

未引用项只构成报告，不提供自动删除授权。
