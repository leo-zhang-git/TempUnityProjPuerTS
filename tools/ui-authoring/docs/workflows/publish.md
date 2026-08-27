# Publish 流程

Publish 是 Source 到正式 Prefab、generated binding、program contract 和最小 identity metadata 的统一静态交付门。当前项目按 single-writer 使用：同一时刻只运行一个人工 Web server 或一次 AI 写入流程，不并行执行其他 CLI、server 或 Publish 写操作。

正式 Prefab 的唯一写入口是 Publish。Prefab path 由当前 Source 相对路径确定，Publish 不迁移 Prefab 以外的 Animation、Texture 或其他离线资源；这些资源通过保留 GUID 的 asset move 与语义路径更新单独完成。Publish 在启动 Unity 前完成 Source readiness、Catalog/依赖、工作区归属、Binding 和 program contract 等不依赖实际产物的必要检查；通过后以当前 Source 为权威，在单次 Unity Plan 中直接应用并执行写入后 capability audit。Publish 默认不执行 client typecheck；程序 TypeScript 准入由提交流程持有。CLI 的 `--full-client-typecheck` 用于需要在单次 Publish 内显式刷新 UI module path registry 并运行 client native compiler 的诊断场景；该兼容参数不触发 server、protocol、staticdata、scene placement 或自定义 contract 检查。写入后检查或收尾失败时保留正式产物，不建立自动 rollback。Web 的菜单范围与人工选项由 `../development/web-experience.md` 持有。

CLI 调用持有一个 Publish job，并等待其进入结构化终态。外部执行器为该调用保留完整等待预算；job 仍为 queued/running 时沿用同一调用继续等待。

## 1. 选择范围

```powershell
npm.cmd run cli -- publish-live <source-relative-path>
npm.cmd run cli -- publish-live <source-relative-path> --with-dependencies
npm.cmd run cli -- publish-live --plan <repo-relative-plan-path>
npm.cmd run cli -- publish-all-live
npm.cmd run cli -- publish-live <source-relative-path> --full-client-typecheck
npm.cmd run cli -- publish-live <source-relative-path> --summary --result-out tools/ui-authoring/.runtime/<name>.publish.json
```

- 默认只声明目标 Artifact。
- `--with-dependencies` 包含传递依赖闭包。
- plan 路径以仓库根为基准；JSON 使用 `{ "artifacts": ["ArtifactKey"], "dependencies": true, "exclude": ["DependencyArtifactKey"] }`。`artifacts` 与 `exclude` 填 Artifact key，不填 Source 路径；显式声明项不可排除。
- `publish-all-live` 将已有 DeliveryState 的 Artifact 聚合为单个依赖有序发布；没有 DeliveryState 的 Source 保持开发期草稿，不创建正式 Prefab。首次交付使用显式 `publish-live`，交付后的 Artifact 自动进入后续全量发布。

仅发布声明项时，依赖必须已有 identity metadata 和正式 Prefab。返回 dependency blocker 时改用依赖闭包，不手工逐个猜测发布顺序。

迭代 Authoring 保持当前工程 Editor 打开，并在 Publish 前通过工作区诊断确认处于 Edit Mode、脚本编译和资源刷新已经完成。无人值守任务使用 batchMode，并承担完整 Editor 启停成本。Editor bridge 在 claim 前会刷新 AssetDatabase，默认最多等待 60 秒覆盖由此触发的 domain reload。claim 超时时按错误提示复核 Editor 状态、等待刷新完成并重试同一 Publish；Play Mode 不接取 Publish request。

发布目标已包含未提交的工作区改动时不阻断，结果按 SVN 与 Git 列出相关候选路径。该清单是失败时刻的 working copy 现场，不承诺精确区分发布前改动与本次写入。既有正式 Prefab 是否带 identity metadata 不构成确认项：上一次发布在写入正式 Prefab 后失败时，直接修复报错并重新发布。

## 2. 处理结构化 blocker

| 结果/确认项 | 处理 |
| --- | --- |
| scaffold plan | 核对 owner 与类型计划后追加 `--confirm-scaffold`；registry 由 program codegen 派生 |
| Prefab Stage、身份歧义、未知组件、业务 owner 不明 | 停止并解决 blocker，不使用确认项绕过 |

确认项只解除对应显式门禁，不跳过 Source readiness、Catalog、Prefab audit、Binding 或 program contract；显式启用 `--full-client-typecheck` 时也不跳过该检查。scaffold 只创建最小 Canvas/Widget owner；Canvas/Widget registry 由 program 的 module-path codegen 从 owner 派生，不生成业务事件、数据刷新或生命周期逻辑。

正式 Prefab 中存在有效 `ShapeSoftMask` 时，Publish 在写入前检查已有目标，并在写入后再次检查最终目标中受同节点或祖先遮罩影响的 Graphic。Graphic 的最终 Shader 必须声明 ShapeSoftMask contract；违约返回 `publish.shapeSoftMaskShaderUnsupported` blocker，携带 Artifact、Prefab 节点路径、Shader 名称和可读原因。`overrideSorting` Canvas 截断外层遮罩继承，与运行时 sorting domain 一致。

## 3. 解释结果

`publish-live` stdout 是 `UiUnityJobSnapshot`；从 `status` 和 `result.kind` 分派，再读取 `result.delivery`。`publish-all-live` stdout 外层为 `{ "kind": "publish-all", "sourceCount": number, "job": UiUnityJobSnapshot }`，其中 `sourceCount` 是 workspace Source 总数，实际发布范围以 `job.result.artifacts` 为准，Publish result 位于 `job.result`。

传入 `--summary` 时，stdout 保持相同的 job discriminator 和 Publish 判定字段，但 `job.result` 使用精简结构：保留 Artifact、blocker、scaffold、import 摘要和路径计数，省略完整 Source、observation、DeliveryState 与 generated inventory 内容。需要完整 legacy JSON 时同时传入 `--result-out <repo-relative-json>`；先按 stdout 摘要判断，只在需要具体 patch、observation 或失败现场时读取结果文件。

- `delivered`：上述静态 gate 全部通过；记录 Artifact、依赖范围、Formal Prefab、binding、program contract 和 DeliveryState。
- `noOp=true`：输入与现有正式交付已收敛，或“发布改动及依赖”没有找到目标 Source。
- blocker/failed：本次执行不构成交付结果；按返回的 stage、issue 和已改动路径清单定位 owner。

可在写入前稳定判定的 blocker 在 mutation 前拒绝，工作副本保持发布前状态。正式产物写入后，依赖实际产物的 audit、metadata 收尾以及显式启用的 client typecheck 仍可能失败或被阻断；job 保留现场，并按 SVN 与 Git 列出失败时刻的相关候选路径。常规处置是修 Source 或 program owner 后重新发布；确需整体撤销时，先核对 working copy，再使用对应 Git/SVN 恢复。不要把失败结果当作部分交付使用，也不要把缺少自动 rollback 单独判定为 Publish 缺陷。

`delivered` 后只补 Publish 无法覆盖的运行行为、生命周期、真实输入、目标宽高比或视觉证据；程序提交前由提交者执行所属 program TypeScript 准入。Prefab 一致性按需使用显式 current/dependencies/all 检查，或由 CI/外部定时任务批量执行，不进入人工或 AI 的常规 Publish 时延。`check --full` 用于全 workspace 维护，`verify` 用于按需生成离线证据，两者不是固定复检阶段。
