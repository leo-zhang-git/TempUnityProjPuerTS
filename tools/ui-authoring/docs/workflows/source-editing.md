# 常见 Source 编辑操作

本文件持有常规 AI UI authoring 的场景入口。目标 Artifact 分型、runtime owner、玩家行为或跨 Artifact 边界尚未定义时，由 `ui-development-workflow` 升级到 full-flow。

需要从设计意图选择通用能力，或能力要求多个 Source Component、Artifact、Binding 与纯 TS 工具协同时，先从 [`../specification/components/AGENTS.md`](../specification/components/AGENTS.md) 定位直接 owner。

所有 Source 写操作先返回 JSON preview；确认 `canWrite`、issues、affected documents 和 diff 后，以相同参数追加 `--write`。候选校验读取完整 workspace 解析关系，只让本次 mutation 及其受影响依赖闭包中的 Source、反向引用和 Preview evidence 问题成为 blocker。

修改节点 anchor 时，mutation preview 会反向枚举仍以 `anchoredPosition` 或 `sizeDelta` 覆盖该节点、但未同步覆盖变化 anchor 的 PrefabRef use-site，并把消费者加入 `affectedDocuments`。候选事务同步补齐 anchor override 或移除坐标 override 后恢复 `canWrite`。

新建或重构界面在首次 Source 写入前完成区域分型：固定结构与静态标签进入 Artifact；容量、位置、空槽和交互地址固定且整组常驻的重复区域由显式 Widget PrefabRef 构成固定结构；玩家状态进入 StateRoot；运行时数据字段进入 Widget Binding；实例数量随业务 model 变化的同构集合进入 collection owner、item Widget 与 runtime owner；代表性数据进入默认或命名 Reference。分型、Widget 边界或 runtime owner 未定义时使用 full-flow。

具有物品身份语义的区域使用已登记的正式物品 Widget/PrefabRef。只读图标与品质展示使用 `ItemDisplayWidget`，容器槽位与拖拽交互使用 `ItemStorageSlot`；`ItemSlotQualityBase` 作为品质表现依赖，由完整物品控件连同真实图标和数据共同使用。Reference 使用真实物品图标、品质和代表数量提供 evidence；文本只承担名称、分类和说明等文字信息，不代替物品图标、品质框或槽位表现。

`check --full` 持有完整 workspace 健康结论，适用于 workspace 维护、全局 Preview evidence 治理和显式全量检查。常规目标 Publish 由 mutation 的受影响闭包校验与 Publish preflight 直接衔接。

## 定点查询

已知 node identity 时使用 `query`，需要局部结构或字段时使用定点 `inspect`：

```powershell
npm.cmd run cli -- query <source> --id <node-id>
npm.cmd run cli -- query <source> --component <component-type>
npm.cmd run cli -- inspect <source> --node <node-id> --depth 1 --details rect,components,bindings,refs,state
```

`inspect` 默认 depth 为 `1`，默认只返回 identity、父子关系、active 和 component type。`--details` 按需选择 `rect`、`components`、`bindings`、`refs`、`state`；它不提供 readiness 结论。

字段约束未知时只查询目标 Component：

```powershell
npm.cmd run cli -- schema --component <component-type>
```

结果中的 `contract.previewCapabilities` 是该 Component 可用于 Reference Binder values 的 capability；列表始终包含通用 `active`，其余项由 Component Module 的 Preview contract 派生。

Artifact、Reference 与 Prototype 的独立准入结论使用：

```powershell
npm.cmd run cli -- validate <authoring-document>
```

`validate` 按文件后缀选择对应 Schema，并校验该文档的受影响依赖闭包；Artifact 结果同时包含 Source readiness。

不要为一个已知 node 加载完整 Source workspace 或整份 Source Schema。

## 新建 Artifact

Canvas 使用固定 `1280x720` 设计尺寸；Widget/Fragment 必须声明独立求值尺寸：

```powershell
npm.cmd run cli -- create-artifact Screens/Inventory.ui.json --artifact-key InventoryCanvas --artifact-type Canvas
npm.cmd run cli -- create-artifact Widgets/ItemRow.ui.json --artifact-key ItemRowWidget --artifact-type Widget --initial-size 320x64
```

preview 返回候选 `source`，不创建文件。确认 path、Artifact identity、类型、尺寸和受影响闭包 issues 后追加 `--write`。目标 path 已存在、Artifact key 冲突或 Catalog 无法收敛时不写入。

新 Artifact 只建立最小合法 Source，不推断 runtime owner、Binding、业务行为或 program 接入。

## 字段与布局

字段 mutation 使用 JSON literal：

```powershell
npm.cmd run cli -- set <source> --node <node-id> --field <field-path> --value <json>
npm.cmd run cli -- set Hud/Main.ui.json --node title --field components.Text.text --value '"Ready"'
npm.cmd run cli -- set Hud/Main.ui.json --node panel --field rect.anchoredPosition --value '[12,24]'
```

`name`、`id` 与 `idMode` 不属于通用字段 mutation。显示名或 Node ID 变化必须使用下节 `rename` / `refactor-node-id`，由 workspace planner 同步处理 mode、引用与 DeliveryState。

布局修改前读取目标 node 的 `rect` 和相关 layout component；修改后按目标 viewport 查询求值结果：

```powershell
npm.cmd run cli -- inspect <source> --node <node-id> --depth 1 --details rect,components
npm.cmd run cli -- layout <source> --viewport 1280x720
```

需要视觉证据时再执行：

```powershell
npm.cmd run cli -- capture <source> --viewport 1280x720 --out tools/ui-authoring/.runtime/capture.png
```

layout-driven 轴的求值值不回写 Source baseline。字段和 default 以 `schema --component`、Registry validation 与 mutation preview 为准。

Text 的 `overflow` 默认值是 `overflow`，canonical Source 省略该字段。只有允许截断的动态文本使用 `ellipsis` 或 `truncate`；固定符号、按钮命令和关键数值使用默认模式。有限溢出模式的 TMP 首行高度要求见 [`../specification/components/tmp-text-overflow.md`](../specification/components/tmp-text-overflow.md)。

## 结构操作

常见结构命令：

```powershell
npm.cmd run cli -- template <source> --parent <node-id> --template <template-id> --position <x,y>
npm.cmd run cli -- insert <source> --parent <node-id> --node-json <json>
npm.cmd run cli -- move <source> --node <node-id> --parent <node-id> [--index <n>]
npm.cmd run cli -- rename <source> --node <node-id> --to <unity-display-name>
npm.cmd run cli -- component <source> --node <node-id> --add <component-type> [--value <json>]
```

Authoring template 由 typed registry 持有，并按 `generated` 或 `artifactReference` 分别物化。`generated` 直接生成 Source node subtree；`artifactReference` 从完整 workspace catalog 解析目标 Artifact，创建 `PrefabRef`，并使用目标 Artifact 的 `initialSize` 作为节点尺寸：

```powershell
npm.cmd run cli -- template Screens/Main.ui.json --parent content --template button-action-primary-neutral --position 0,0
```

Web 只提供当前 catalog 已解析且与 owner 类型兼容的 Artifact reference template。CLI 在 preview 前执行同一目标与 owner 校验；目标缺失或不兼容时返回具体原因。

新建节点默认 auto，`insert` 中缺少 `idMode` 的每个节点都必须让 id 与显示名规则一致。需要保留与显示名独立的业务 ID 时，输入节点显式使用 `idMode: "manual"`。内置 generated Template 同时规定显示名与全局语义 ID；两者刻意不一致的节点由 Template 显式物化为 manual。

多个相关操作使用一个 `edit` transaction，避免中间状态和重复 workspace 校验：

```powershell
npm.cmd run cli -- edit <source> --ops-json '{"preconditions":[],"operations":[...]}'
npm.cmd run cli -- edit <source> --ops <repo-relative-json-file>
```

transaction 支持 insert、duplicate、remove、move、set、unset、componentAdd、componentRemove、bindingSet 和 bindingRemove。`bindingSet` 按 field name 新增或重定向 Binding，`bindingRemove` 删除现有 field；最终 target 由完整 Catalog 校验。`setNodeName`、`rename` 以及通过 `set/unset` 修改 `name`、`id`、`idMode` 都会被拒绝，并提示使用顶层 `rename`。Duplicate 始终从原 id 自动分配下一个数字后缀，不接受自定义 `nextNodeId`。precondition 与任一 operation 失败时不返回或写入部分结果。

Node Rename、对齐与重构共用 workspace planner：

```powershell
npm.cmd run cli -- rename <source> --node <node-id> --to <display-name>
npm.cmd run cli -- rename <source> --node <node-id> --to <display-name> --node-id <manual-id>
npm.cmd run cli -- rename <source> --node <node-id> --to <display-name> --auto-id
npm.cmd run cli -- align-node-ids <source>
npm.cmd run cli -- refactor-node-id <source> --node <node-id> --to <next-node-id>
```

这些命令默认只返回 preview，枚举 Source、Reference、Prototype 与 DeliveryState 影响；确认 `writeAvailable: true` 后以相同参数追加 `--write`。Rename 沿用当前 mode，`--node-id` 切换 manual，`--auto-id` 清除 manual 覆写。Align 只处理 auto 节点，并且不会由 Save、Publish 或 Reconcile 隐式执行。

## Preview evidence

临时查看不修改 Source：

```powershell
npm.cmd run cli -- capture <source> --state <state-root-id>=<state-name> --input <input-name>=<json>
```

持久 Preview evidence 使用 `reference-edit`。输入 Artifact Source 时命令创建或更新同目录同 basename 的默认 Reference；输入 `.ui-reference.json` 时更新该 Reference。命令默认只返回 preview，确认 `canWrite`、issues、affected documents 和 diff 后追加 `--write`：

```powershell
npm.cmd run cli -- reference-edit <source-or-reference> --ops-json <json>
npm.cmd run cli -- reference-edit <source-or-reference> --ops <repo-relative-json-file>
npm.cmd run cli -- reference-edit <artifact-source> --reference-key <named-key> --out <source-root-relative.ui-reference.json> --ops-json <json>
```

transaction 使用唯一当前 Reference 结构：

```json
{
  "operations": [
    {
      "kind": "valueSet",
      "fieldName": "title",
      "capability": "text",
      "value": "Preview title"
    },
    {
      "kind": "statePreviewContextSet",
      "targetStateRoot": "detailState",
      "upstreamStateRoot": "viewState",
      "stateName": "expanded"
    },
    {
      "kind": "collectionSet",
      "collection": {
        "key": "items",
        "targetBinding": "items",
        "groups": [
          {
            "templateKey": "Item",
            "items": [{ "key": "first", "values": { "title": { "text": "Preview item" } } }]
          }
        ]
      }
    },
    {
      "kind": "instanceValuesSet",
      "owner": { "kind": "artifact", "root": "subject", "instancePath": ["itemDisplay"] },
      "referenceKey": "ItemDisplayAmmoReference",
      "values": { "countText": { "text": "x60" } }
    }
  ]
}
```

支持的语义操作为 `valueSet/valueRemove`、`statePreviewContextSet/statePreviewContextRemove`、`collectionSet/collectionRemove`、`instanceValuesSet/instanceValuesRemove`、`mountSet/mountRemove` 和 `contextSet/contextRemove`。`valueSet` 默认写 subject values，`target: "context"` 写 context values；`instanceValuesSet` 接收 `owner`，并至少提供 `referenceKey` 或 `values`。命名 Reference 创建同时提供 `--reference-key` 与 `--out`，输出路径相对 Source root。默认 Reference 缺失时以 Artifact identity 建立最小 sidecar；完整 workspace Catalog 负责校验 Binder、template、owner、preset 与依赖关系。

数据语义不明确时只读 `../specification/preview-evidence.md` 的目标章节。

## StateRoot

先定点读取 StateRoot 当前值和字段契约：

```powershell
npm.cmd run cli -- query <source> --component StateRoot
npm.cmd run cli -- inspect <source> --node <state-root-id> --depth 0 --details components,state
npm.cmd run cli -- schema --component StateRoot
```

修改正式 `currentState`、`states` 或 `elements` 使用 node field mutation；多个字段联动时使用一个 `edit` transaction。调整普通 Reference 的预览状态时，对 StateRoot Binder field 使用 `valueSet` 的 `state` capability；固定状态总览的上游条件时使用 `statePreviewContextSet`。两者都不修改正式 `currentState`。

StateRoot、StateToggle 的依赖、Binding 或 runtime owner 未定义时升级 full-flow。

## 抽取 Widget / Fragment

```powershell
npm.cmd run cli -- extract-widget <source> --node <node-id> --artifact-key <artifact-key> --out <source-relative-path>
npm.cmd run cli -- extract-fragment <source> --node <node-id> --artifact-key <artifact-key> --out <source-relative-path>
```

两个命令都在一次受影响闭包校验中生成父 Source 与目标 Source。CLI 默认返回 preview；确认 `canWrite`、`affectedDocuments`、`parentDiff` 与 `createdArtifact` 后追加 `--write`，两份 Source 在同一个跨文档写入计划中提交。Web 消费同一 Kernel mutation，并把两份草稿登记为同一 semantic save group。

`extract-widget` 适用于 Canvas 或 Widget 的本地普通节点。子树 Binding 进入新 Widget，父 Binder 新增 Widget PrefabRef Binding；新 Widget 建立独立 `widgetType` 与 Binder owner。

`extract-fragment` 适用于 Canvas、Widget 或 Fragment 的本地普通节点。新 Fragment 保持 binderless，父 Binder 的原字段留在父级，并把命中子树的 target 改写为经过新 Fragment use-site 的 `instancePath`；目标为抽取根时使用新 Fragment 根 `artifactKey`。抽取子树中的 PrefabRef 依赖均须为 Fragment。

抽取节点必须是 concrete Artifact 的非根、非 PrefabRef 节点，子树内 Component node reference 必须自包含。父级 `StateRoot.states` 可以继续控制保留原 node ID 的 Fragment/Widget use-site 根；父节点对抽取子树内部节点的 Component node reference 需要先收敛到同一 owner。受影响闭包校验统一处理 Artifact identity、目标路径、Reference/Prototype、依赖类型、Binding 地址与 Catalog 问题；任一 blocker 都阻止首次写入。

## Publish

Source 写入并确认 mutation 受影响闭包后执行：

```powershell
npm.cmd run cli -- publish-live <source>
npm.cmd run cli -- publish-live --plan <repo-relative-plan-path>
```

单个正式 Artifact 使用 Source 参数；本次 mutation 涉及多个独立正式 Artifact 时，用一个 selection plan 精确声明本次已确认的改动集合。Reference 与 Prototype 只进入 authoring 闭包校验，不进入正式 Publish selection。

AI 常规检查使用 `--summary` 获取 job、delivery、Artifact、blocker、scaffold 和计数结果。需要保留完整 observation、候选 Source、DeliveryState 或失败现场时追加 `--result-out tools/ui-authoring/.runtime/<name>.json`，并只在摘要表明需要细查时读取该文件。批量 Formal sync 只需要状态与问题计数时不生成输出文件：

```powershell
npm.cmd run cli -- sync-live <source> --all --summary
npm.cmd run cli -- publish-live --plan <repo-relative-plan-path> --summary --result-out tools/ui-authoring/.runtime/<name>.publish.json
```

同一次调用持续等待其 job 进入终态，再按 `status`、`result.kind` 和 `result.delivery` 判断；只有 blocker、failed 或 confirmation 出现时读取 `publish.md`。正式 Prefab、generated binding、program contract 和 DeliveryState 由 Publish 持有。
