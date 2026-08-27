# UI Authoring 开发架构

本文件持有模块边界、依赖方向和实现 owner 索引。具体 server/Unity/Web 实现只在对应子文档中读取。

## 模块边界

```text
schema + components + registry
              ↓
          Source Kernel
       ↙        ↓        ↘
     CLI      server      Web
                ↓
          Unity job bridge
```

Kernel consumer 直接导入所属领域文件；Kernel 不提供聚合 barrel。生产可达性从 CLI、server、Web 与 Vite 的真实入口计算，测试入口不使生产模块天然可达。

- `schema/`：跨进程 JSON contract 与 TypeBox 类型。
- `components/`：每个 Source component 的 Schema、默认值、Inspector metadata、validation、Preview、Projection、roundtrip 和 Unity mapping。
- `registry/`：稳定聚合 Component Module，并派生 Registry、`UiComponentsSchema`、Binding/override/use-site 类型和 component manifest。
- `kernel/`：纯 TypeScript 领域核心，持有 canonical、Catalog、Artifact graph、Binding、结构 mutation、layout、Projection、observation/reconcile 和 DeliveryState 语义。
- `cli/`：参数解析、command dispatch 和 stdout/stderr/exit contract。
- `server/`：Workspace I/O、API、资产索引、Unity job、Publish 执行与 program contract。
- `web/`：Application、Editor、workspace、rendering、capture 和 guide。

Kernel、Component Module 与 Registry 不依赖 React、Node 文件系统或 Unity Editor。CLI、server、Web 和测试共同消费 Kernel，不建立语义分支。

Preview Reference resolution 由 `preview-reference-resolver.ts` 作为 facade，`preview-reference-resolver-contract.ts` 持有共享输入与预算 contract，`preview-reference-resolver-preflight.ts` 持有依赖图和预算前置，`preview-reference-resolver-instance.ts` 持有 resolved instance，`preview-reference-resolver-dynamic.ts` 持有已有实例 preset、Collection 与 mount 的 evidence 展开。各 phase 通过 contract 协作，不反向依赖 Web 或 server。

## 写入与失败边界

UI Authoring 面向受版本控制保护的本地工作区，并以 single-writer 作为使用前提：同一时刻只有一个人工 Web server 或一次 AI 写入流程修改 workspace。常规正确性由写入前校验、明确 owner、单文件防覆盖和可定位的结果保证，不由跨进程仲裁或跨文件持久 transaction 保证。

| 边界 | 目标行为 |
| --- | --- |
| 候选计算 | mutation 先在内存中形成完整候选，校验目标、依赖、引用、Schema 和领域约束；可预见 blocker 在第一次写入前返回 |
| 校验范围 | 可以读取完整 workspace 解析关系，但默认只阻断目标及其受影响依赖闭包；全局健康问题由显式 `check --full` 汇总 |
| 单文件写入 | 可以使用 baseline/precondition、进程内写串行和临时文件替换，避免普通并发编辑覆盖与半个 JSON 文件 |
| 多文件写入 | 按确定顺序提交；中途失败时停止并返回已完成、失败和未执行路径，不恢复已经写入的文件 |
| 错误反馈 | 保留原始错误并立即返回部分结果，不等待自动 cleanup 或 rollback；诊断给出可修复原因和重新执行入口 |
| Export/Publish | 首次正式写入前完成不依赖实际产物的必要校验，通过后直接写入；写入后只执行依赖实际产物的检查与收尾。失败时保留已经生成或修改的产物，用户修复问题后重新执行，以重新导出收敛结果 |
| 整体撤销 | 由用户使用对应 Git/SVN working copy 处理，不在工具内复制一套版本恢复机制 |

跨进程强互斥、跨文件全有或全无、自动 rollback、before-state、恢复 journal 和断电/崩溃恢复不是默认架构能力。单文件 replace、Kernel 候选 mutation、Undo/Redo 和同一进程内写串行不属于该非目标。只有使用模型升级为多写入者，或出现无法通过前置校验、重试和 VCS 处置的常见故障时，才重新评估更强保护。

新增持久事务能力必须由明确、常见且无法通过预校验、重试或 VCS 处理的故障模型驱动，并在实现前获得单独确认。

## 依赖方向

Web 生产依赖为：

```text
application
    -> editors / workspace / capture
    -> rendering / shared
    -> kernel / registry / schema

main
    -> guide / application / capture
guide
    -> shared
```

三个 Editor 不互相深层引用。至少两个 Editor 共用的编辑器语义进入 `editors/shared`；跨 Editor 与非 Editor 的预览能力进入 `rendering`；不理解领域概念的 transport 和基础 UI 进入 `shared`。

生产依赖约束和验证入口由 [`testing.md`](testing.md) 持有。

## Component Module

`src/components/component-module.ts` 提供纯 TypeScript builder。每个模块声明：

- TypeBox Schema 和 Source/Inspector default。
- override、asset/reference、node reference collect/remap、availability、contextual initialization 与 validation hook。
- Inspector field/action metadata 和 mutation hook。
- Preview/Projection/roundtrip identity。
- Unity type、field、codec 与 capability mapping。

组件自身的添加前置条件、字段语义和自洽校验由 Component Module 持有。跨组件互斥、Catalog-backed 候选、节点 identity、Binding、Artifact graph、PrefabRef use-site 求值和全局唯一性由 Registry、Kernel 或应用层协调 owner 持有。

Registry default 是省略 Source 字段的语义 owner。`kernel/canonical.ts` 删除 Schema optional 且等于 Registry default 的字段；Projection、Preview、layout 和 roundtrip 消费前恢复默认。component manifest 描述当前默认值、mapping、codec 和 capability，仅在当前 Projection、observation 与 audit 中使用，不写入 DeliveryState。

## API Owner

- `schema/api/contract.ts` 与 `routes.ts`：共享 request/error 基础 contract 和 route registry；`workspace-api.ts`、`documents-api.ts`、`delivery-api.ts`、`assets-api.ts`、`diagnostics-api.ts` 持有各 domain 的 query、body 与 success contract。`schema/ui-api.ts` 只保留兼容 re-export。
- `schema/ui-unity-job.ts`：Unity job snapshot、Import、reconcile、sync 与 Publish result。
- `schema/ui-source-schema.ts`：Artifact Source、node、Binding 与 Variant。
- `schema/ui-prototype-schema.ts`：Reference、Collection、mount、Prototype 和 interaction。
- `server/api/router.ts`：method/path 与 JSON body。
- `server/api/body-schemas/<domain>.ts`：各 domain mutable body schema；`body-schemas.ts` 只聚合 route map。
- `server/api/handlers/<domain>-handlers.ts`：各 domain 应用服务；`services.ts` 只组合 handler factory 与共享写入/error support。
- `server/api/http.ts`：文件/JSON response 和错误映射。
- `web/shared/api/<domain>-client.ts`：各 domain Web client；`transport.ts` 持有 HTTP transport，`client.ts` 只保留兼容 re-export。

Mutable request 使用实际 Source/Reference/Prototype validator 或 `server/api/body-schemas.ts` 的 route schema；应用服务在类型断言和业务调用前执行消费端校验。已知 client error 映射为 `400`、`404`、`409` 或 `422`；未预期异常返回不泄漏内部信息的 `500`。

Web 文档读取以 `bootstrap` 为唯一聚合入口。单文档 route 与 `workspace.save` 都携带 baseline/precondition；`workspace.save` 预校验候选后顺序写入并返回部分失败结果。CLI 的 `schema`、`catalog` 与 `projection` 不映射为同名 Web route。

## 实现路由

| 改动面 | 直接 owner |
| --- | --- |
| server、CLI、Workspace write、Unity job、资产、Publish | [`delivery-architecture.md`](delivery-architecture.md) |
| Web Application、状态、Editor、Inspector、rendering 与样式 | [`web-architecture.md`](web-architecture.md) |
| Web 模式、菜单、保存反馈与人工操作 | [`web-experience.md`](web-experience.md) |
| unit、CLI、browser、Unity 与 performance 测试 | [`testing.md`](testing.md) |
| Source、Preview 与 Delivery JSON contract | [`../specification/source-format.md`](../specification/source-format.md)、[`../specification/preview-evidence.md`](../specification/preview-evidence.md)、[`../specification/delivery-contract.md`](../specification/delivery-contract.md) |
| 通用 UI 能力的选型、Source 前置与工具验收 | [`../specification/components/AGENTS.md`](../specification/components/AGENTS.md) |
| 未完成长期结构项 | [`ARCHITECTURE-ISSUES.md`](ARCHITECTURE-ISSUES.md) |
