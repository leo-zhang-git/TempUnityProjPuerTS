# Legma（UI Authoring）

Legma 是本模板 UI 工具的用户可见产品名；UI Authoring 是其持有的 Source Kernel、CLI、Web 编辑器、Publish、Source 回写和 TypeScript 接入能力。本文件提供目录首屏、低成本 CLI 入口和文档路由；流程与数据语义由 `docs/` 下的直接 owner 持有。

## 命名边界

- 用户可见的产品标题、窗口、入口、指南和品牌图形使用 `Legma`。
- Source、Publish、Projection、Unity bridge、CLI 以及领域文档中的能力名称继续使用 `UI Authoring`。
- `tools/ui-authoring/`、`My project/UIAuthoring/`、API product、环境变量、浏览器存储键和 Unity bridge 类型属于稳定技术 contract，本文件的品牌统一不改动这些标识。

## 固定边界

- Source Root：`My project/UIAuthoring/Sources/`。
- 正式 UI 资源根：`My project/Assets/Resources/UI/`。
- DeliveryState 根：`My project/UIAuthoring/DeliveryState/`；Legma 默认使用本地单 writer，目标 Unity Editor 已打开时通过 `PuerTsTemplate.UI.Editor.Authoring.UiAuthoringJobBridge` 接取 job。
- 正式 Prefab：`My project/UIAuthoring/Sources/<relativeDirectory>/<ArtifactKey>.ui.json` 唯一派生 `My project/Assets/Resources/UI/Prefab/<relativeDirectory>/<ArtifactKey>.prefab`。Source 相对目录是路径 identity，Artifact type 不参与目录结构。
- CLI 文件参数使用 Source Root 相对路径或仓库相对路径，不接受机器绝对路径。

命令从 `tools/ui-authoring/` 运行：

```powershell
npm.cmd run dev
npm.cmd run check
npm.cmd run cli -- check
npm.cmd run cli -- <command>
```

根目录 `frame-config.json` 持有 Legma 的稳定默认配置；`frame-config.local.json` 持有当前副本的 `workspaceId` 与 `portSlot`。首次启动前运行 `0.初始化框架配置.bat`，Legma 手动和 AI Web 端口分别按 `legmaManualBase + portSlot` 与 `legmaAiBase + portSlot` 派生；首选端口被占用时，launcher 会按 `fallbackPortCount` 扫描备用端口，只替换当前工作区的旧服务。

`npm.cmd run dev` 启动或复用当前工作区的 AI server。`npm.cmd run check` 执行 lint、typecheck、TypeScript unit、架构规则与 Python unit。目标 Source 和改动位置明确时直接使用 CLI，不为常规交付启动 Web 编辑器。

Web 首次读取统一使用 `bootstrap`。Source、Reference 与 Prototype 写入携带 baseline/precondition；当前文档保存只提交自身，跨文档语义 mutation 自动扩展到登记的影响闭包。`schema`、`catalog` 与 `projection` 是 CLI 能力，不构成同名 Web convenience API。

Web 工具迭代先通过 production bundle 和人工浏览器验收；目标模板尚未迁移 longdemo 的 browser/visual fixture，完整验证边界由 `docs/development/testing.md` 持有。

## 常见操作

| 目标 | 首跳 |
| --- | --- |
| 定点查询、字段、布局、StateRoot、Preview、结构编辑或抽取 Widget/Fragment | `docs/workflows/source-editing.md` |
| Publish、blocker、confirmation 与完成态 | `docs/workflows/publish.md` |
| Prefab observation、Source 回写与 Prefab Import | `docs/workflows/reconcile.md` |
| Source、Artifact、Binding 与 Variant 语义 | `docs/specification/source-format.md` |
| 通用 UI 能力的选型与 UI Authoring 前置 | `docs/specification/components/AGENTS.md` |
| Component 高频字段、Inspector 截图与优化台账 | `docs/development/component-inspector-ledger.md` |
| Preview、Reference、Prototype 与证据数据 | `docs/specification/preview-evidence.md` |
| Unity job 与结构化 Delivery 结果 | `docs/specification/delivery-contract.md` |

高频入口：

```powershell
npm.cmd run cli -- catalog
npm.cmd run cli -- naming-audit
npm.cmd run cli -- query <source> --id <node-id>
npm.cmd run cli -- inspect <source> --node <node-id> --depth 1 --details rect,components,bindings,refs,state
npm.cmd run cli -- schema --component <component-type>
npm.cmd run cli -- validate <authoring-document>
npm.cmd run cli -- check --full
npm.cmd run cli -- create-artifact <out.ui.json> --artifact-key <key> --artifact-type <Canvas|Widget|Fragment> [--initial-size WIDTHxHEIGHT]
npm.cmd run cli -- set <source> --node <node-id> --field <field-path> --value <json>
npm.cmd run cli -- edit <source> --ops-json <json>
npm.cmd run cli -- reference-edit <source-or-reference> --ops-json <json>
npm.cmd run cli -- reference-edit <artifact-source> --reference-key <named-key> --out <source-root-relative.ui-reference.json> --ops-json <json>
npm.cmd run cli -- layout <source> --viewport WIDTHxHEIGHT
npm.cmd run cli -- capture <source> --viewport WIDTHxHEIGHT --out <repo-relative.png>
npm.cmd run cli -- publish-live <source> [--summary] [--result-out <repo-relative-json>]
npm.cmd run cli -- publish-live --plan <repo-relative-plan-path> [--summary] [--result-out <repo-relative-json>]
npm.cmd run cli -- pull-live <source> [--summary] [--result-out <repo-relative-json>]
```

## 结果约定

- Source 写操作默认返回结构化 preview；确认 `canWrite`、issues 和 diff 后以相同参数追加 `--write`。
- `validate` 按 Artifact、Reference 或 Prototype 后缀检查目标文档及其受影响依赖闭包。
- `create-artifact`、跨文档 mutation 和回写在第一次写入前校验完整候选，并按确定顺序提交；中途失败时返回已写入、失败和未执行路径。
- `publish-live` 是正式事务，不使用 `--write`；按 job `status`、`result.kind` 和 `result.delivery` 判断结果。
- Unity delivery 命令默认保持完整 JSON stdout；`--summary` 返回不含完整 Source、observation 和 DeliveryState 的判定摘要。需要保留完整结果时同时使用 `--result-out <repo-relative-json>`；该选项只与 `--summary` 配合。`sync-live --out` 继续作为已有完整结果输出入口。
- `check` 是快速 workspace 检查；`check --full` 是包含资源、canonical、字体和全局关系诊断的完整维护检查，并以 warning 报告已交付但没有 Artifact 入向依赖或 concrete runtime owner 的 Widget。该报告只提供人工清理候选，不改变检查退出码，也不自动删除文件。
- `naming-audit` 是只读的 workspace-level Binding 命名审计，输出违规字段、Source owner、目标 Component 以及 Reference/Prototype 反向消费位置；它不写入 Source/Reference/Prototype。同一规则作为 Source error 接入 `check --full`，新增违规会使完整检查失败且不改变 warning 基线。
- Unity Publish 仅在本地 Editor 或 batchMode 中执行；当前迁移不包含热更、远程发布、AssetBundle、Addressables 热更新和远程协作服务。`StateRoot`、`StateToggle`、`ButtonEx`、`ScrollRectEx` 的引用先创建完整节点层级，再写入组件，避免跨节点引用受构建顺序影响。
- Component capability 未在目标 bridge 中实现时 fail-closed；不会把 longdemo 专用 `Long.App.*` 类型或未确认字段静默映射为目标工程组件。
- Text 默认使用 `Overflow`；`Ellipsis`/`Truncate` 的选型与 TMP 首行高度要求见 `docs/specification/components/tmp-text-overflow.md`。

工具实现、Web 体验与测试维护从本目录 `AGENTS.md` 继续路由。
