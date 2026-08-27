# Delivery JSON 契约

代码 owner 是 `src/schema/ui-unity-job.ts`、`src/kernel/formal-sync.ts`、`src/kernel/delivery-state.ts` 和 `src/server/unity-job-service.ts`。本文记录 AI 处理结构化结果所需的稳定 discriminator。

## 路径与写权限

- 正式 UI 资源根为 `My project/Assets/Resources/UI/`。
- 正式 Prefab canonical path 由 Source Root 相对路径唯一派生：`<relativeDirectory>/<ArtifactKey>.ui.json` 对应 `Assets/Resources/UI/Prefab/<relativeDirectory>/<ArtifactKey>.prefab`。Source path 与 artifactKey 必须一致，Artifact type 不参与路径派生。
- Unity job、Projection、request、result 与日志进入 `tools/ui-authoring/.runtime/unity-jobs/`。
- 正式 Prefab、generated binding、program scaffold 和 DeliveryState 只由 Publish 提交。
- sync、observation、reconcile、Prefab Import preview、Capture 和 Verify 只读正式资源；运行态数据和证据不写入 Source 或正式资源目录。

## Job snapshot

Unity job snapshot 的稳定字段包括：

```json
{
  "id": "...",
  "kind": "import | reconcile | sync | publish",
  "artifactKey": "MainHud",
  "status": "queued | running | succeeded | failed",
  "stage": "...",
  "message": "...",
  "createdAt": 0,
  "updatedAt": 0,
  "progress": {
    "completed": 3,
    "total": 10,
    "steps": [
      {
        "id": "publish.unity-import",
        "label": "发布正式 Prefab",
        "status": "pending | running | succeeded | failed",
        "completed": 2,
        "total": 6,
        "currentItem": "MainHud"
      }
    ]
  },
  "result": {},
  "error": "...",
  "residualPaths": {}
}
```

调用方先按 `status` 判断生命周期，再按 `result.kind` 分派。不要根据 message 文本推断结果类型。`progress.steps` 按实际执行顺序提供稳定步骤 id、显示名称、工作项完成数、总数和当前 Artifact；`progress.completed/total` 是这些工作项的汇总，不表示耗时比例或剩余时间预测。无法提前量化的步骤保持不确定进度，失败任务保留失败位置，不把进度改写为 100%。Publish 未交付时，`residualPaths` 按 SVN/Git 分组给出失败时刻工作副本中的相关候选路径，供定位现场和按需执行 VCS 撤销。它不是 before/after delta、内容快照或本次 Publish 的精确归属清单，可能包含发布前已存在的目标路径改动。

## CLI 摘要

`import-prefab`、`sync-live`、`pull-live`、`publish-live` 与 `publish-all-live` 支持 `--summary`。默认 stdout 继续返回本节定义的完整 legacy JSON；摘要模式保持 job 的 `id`、`kind`、`artifactKey`、`status`、`stage`、`message`、`error` 与 result discriminator，并按 result kind 提供以下信息：

- Import：目标路径、written、patch、blocker、diagnostic、Unity-only component 与递归 import 摘要。
- Sync/Reconcile：scope、Artifact、Formal 状态、change、patch、review patch、issue、diagnostic 与 Unity-only component 计数。
- Publish：delivery、Artifact、affected Canvas、blocker、scaffold、import 摘要、inventory/DeliveryState 数量与 touched path 计数。

摘要不携带完整 Source candidate、Prefab observation、DeliveryState、generated inventory 内容和 touched/residual path 列表。需要这些细节时，`--summary` 与 `--result-out <repo-relative-json>` 同时使用，stdout 返回摘要，文件保存默认模式下的完整 JSON。`--result-out` 不单独使用。`sync-live --out` 保持已有完整结果写入语义；与 `--summary` 组合时 stdout 同时返回摘要。

## Publish result

`UiUnityPublishJobResult` 的关键字段：

- `delivery`: `blocked | delivered`。
- `artifacts`: 本次正式发布图。
- `affectedCanvases`: 闭包外受影响 Canvas。
- `blockers[]`: `code`、`message`、可选 Artifact/path/confirmation。
- `scaffoldPlan[]`: 最小 program 接入计划。
- `noOp`: 相同输入已收敛。
- `imports[]`: 每个 Artifact 的 Unity import 结果。
- `generatedInventory[]`: 本次生成 inventory。
- `touchedPaths`: 当前 VCS 查询范围内的 Git/SVN deliverables，以及该范围观察到的既有无关改动。
- `deliveryStates[]`: 提交后的 state 与 observation。

只有 `delivery: "delivered"` 构成静态交付完成。`status: "succeeded"` 但 `delivery: "blocked"` 表示 job 正常完成了阻断分析，不表示已发布。

## Projection target address

正式 Projection 中的 Binding、Variant override、PrefabRef use-site override、component addition、Variant local parent、Component node-reference value、managed component manifest 和 layout calibration 共用结构化地址：

```json
{
  "instancePath": ["contentFragment"],
  "nodeId": "title",
  "nodePath": ["contentFragment", "title"],
  "siblingPath": [2, 0]
}
```

`instancePath` 表达跨 PrefabRef 的语义 use-site 链，`nodeId` 表达目标 identity，`nodePath` 保留沿途语义节点并校验 Prefab 边界，`siblingPath` 在每层 Artifact 自有子节点中提供确定结构位置。Unity importer 以该地址解析目标；GameObject `name` 和 observation `namePath` 只用于展示与诊断。

目标为嵌套 Artifact 根时，`nodeId` 保持依赖 Artifact 的根 identity，`nodePath` 停在 `instancePath` 的最后一个 use-site 节点；该节点同时是嵌套 Prefab 的物理实例根。

## Reconcile patch

`UiUnityReconcilePatch` 包含：

```json
{
  "kind": "field | component | component-addition | binding | widget-identity | prefab-ref | node-add | node-remove | node-move | node-order | node-name | node-addition | property-override | binding-override | binding-addition",
  "risk": "safe | review",
  "change": "...",
  "nodeId": "...",
  "field": "...",
  "expected": null,
  "observed": null
}
```

`expected` 是 Source/Projection 期望，`observed` 是 Formal observation。`review` 表示 owner 或结构变化，需要明确选择；它不是低可信度 safe patch。

concrete GameObject 改名产生 `node-name` patch，并通过 Node Identity planner 应用：auto 节点同步更新 `node.name`、`node.id`、结构化引用和 DeliveryState；manual 节点只更新 `node.name`。Variant inherited GameObject 的显示名由 Base owner 持有，不形成可应用的本层 Rename patch。

Widget Projection 与 observation 使用独立的 `localWidgetType`、`effectiveWidgetType` 字段。Importer 只把 local declaration 写入当前 prefab layer；Catalog、audit、reconcile 与 program contract 按各自职责消费 effective identity。两者都不进入 DeliveryState。

批量回写的 `UiUnityReconcileJobResult` 结构为：

```json
{
  "kind": "reconcile",
  "scope": "current | dependencies | all",
  "artifacts": ["SharedFragment", "StatusWidget"],
  "entries": [
    {
      "artifactKey": "SharedFragment",
      "sourcePath": "Shared/SharedFragment.ui.json",
      "prefabPath": "Assets/Resources/UI/Prefab/Shared/SharedFragment.prefab",
      "state": {},
      "patches": [],
      "issues": [],
      "diagnostics": [],
      "unityOnlyComponents": [],
      "beforeSource": {},
      "source": {}
    }
  ]
}
```

`entries[]` 按依赖有序的选择结果排列。`all` scope 检查完整 Source catalog，只将已有正式 Prefab 的 Artifact 纳入结果；尚未首次发布的 Source 草稿不属于 Formal 到 Source 的回写范围。每项的 `beforeSource` 是 observation plan 使用的 Source，`source` 是应用 patch 后的候选；`issues[]` 非空时候选保持为 `beforeSource`。Unity-only report 与 Source patch 保持分离。Reconcile job 只生成候选，不写 Source；Web Apply 更新 workspace 草稿，CLI `pull-live --write` 在完整候选预校验后按路径顺序写入。

## Prefab Import result

Import preview 返回根结果及 `imports[]`。每项包含 Prefab path、Source path、候选 Source、observation hash、patches、blockers、diagnostics 和 Unity-only report。输入 Source path 先确定 canonical Prefab path，Artifact type 由 Unity 对 Prefab root 的 Canvas、UIBinder 与 effective widget identity observation 判定，不从目录名推断。`written` 表示本次是否写入 Source；部分失败结果另外列出已写入、失败和未执行路径。

写入阶段必须复核所有 observation hash、目标仍不存在和完整 Catalog。`written: false` 的 preview 不改变 Source 或 Formal。

## DeliveryState 与一致性状态

DeliveryState 是按 Artifact 分文件保存的最小 Unity identity sidecar。文件名确定 Artifact，持久内容只包括 Prefab GUID 和 `nodeId -> localFileId` 映射；node key 按 ASCII 大小写不敏感规则唯一，同时保留原始大小写。Source/Formal 摘要、Prefab path、use-site identity、整文件 hash、component manifest 和 Unity-only observation 属于可派生或当次计算上下文。

显式一致性检查直接比较当前 Source Projection 与 Formal observation，返回：

- `matches`
- `differs`
- `missing`

状态是单次检查结果，不写入 Source 或 DeliveryState。current、dependencies 与 all 范围在一次 observation plan 中批量检查，不构成 Publish 前置步骤。

## 执行与失败现场

Unity 在一个 Plan 内完成 Formal observation、blocker 检查、leaf-to-root import、binding generation 和 apply 后 audit；Node 继续执行 program contract 与 DeliveryState metadata 写入。请求显式启用 client typecheck 时，Node 在 Unity 前刷新 UI module path registry，并在 binding generation 后执行 client native compiler。

Program contract 将 Canvas 与可动态加载 Widget 的 runtime owner 解析到 View Artifact；owner 未声明映射时使用同名 Artifact。Canvas Artifact 发布时反向检查全部 runtime consumers 的 TS owner、staticdata 与 mask contract，generated binding 仍由 Artifact identity 唯一持有。多个 runtime owner 可以消费同一个 Artifact，不要求为每个 owner 建立同名 Source 或正式 Prefab。

局部 binding generation 复用已有完整 Prefab path index，并在合并本次受影响根前移除正式资产已不存在的旧条目；Artifact 退役后不保留可被运行时解析的幽灵路径。

Reconcile 的多文件写入在第一次写入前用完整 Catalog 校验整组替换结果。候选失效时不开始写入；I/O 或工作副本状态在写入中变化时停止后续路径并保留已完成结果，不执行自动回退。

Publish 在首次正式写入前完成可稳定判定且不依赖实际产物的必要校验。正式产物写入后，Node 继续执行依赖实际产物的 audit、program contract、DeliveryState 收尾以及请求显式启用的 client typecheck；这些阶段失败或被阻断时结束 job，保留已经写入的正式产物，并按 SVN 与 Git 返回失败时刻的相关候选路径，不自动恢复。常规处置是修复后重新 Publish；需要整体撤销时由用户核对 working copy 后使用对应 VCS。具体流程由 `../workflows/publish.md` 持有。
