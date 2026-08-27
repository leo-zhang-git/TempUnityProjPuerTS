# Source JSON 契约

当前结构的代码 owner 是 `src/schema/ui-source-schema.ts`、`src/components/`、`src/kernel/canonical.ts` 和对应测试。本文记录 AI 编辑所需的稳定语义，不复制组件字段全集。

## Root 与校验

- Source Root 为 `My project/UIAuthoring/Sources/`；Source 文件不保存正式 Prefab 物化路径。
- Canvas 使用 `1280 x 720` 设计分辨率，其 Expand、空间角色与 Safe Area 契约由 [`canvas-layout.md`](canvas-layout.md) 持有；Widget 与 Fragment 通过 effective `initialSize` 提供独立求值上下文。Concrete 必须声明该尺寸，Variant 可声明本层尺寸或继承 immediate base 的 effective 值。
- Concrete Widget 必须声明非空 local `widgetType`；Canvas 与 Fragment 不声明。Widget Variant 可以省略该字段并继承上游 effective identity。
- Source、Component metadata 和内部 contract 只表达唯一当前结构，不保存格式版本，也不按历史格式分派。optional/default/canonical 只表达当前格式语义，不用于把字段缺失解释为旧版本行为；canonical JSON 省略默认值，只保存偏离默认且具有信息密度的内容。
- 破坏性 Schema 演进按 `AGENTS.md` 作为独立迁移交付：同一批次更新 Git 中的工具、Schema、测试和文档，并一次性转换 Source Root 中目标格式覆盖的全部 SVN 受管文档。迁移完成后 loader、formatter、Save 与 Publish 只接受新结构，旧结构直接校验失败。
- Git 与 SVN 两侧都完成迁移验证和提交后，格式升级才算完成；转换前必须具备完整影响清单、确定性转换规则和可执行恢复方案。

校验按以下顺序收敛：

| 层级 | 判定 |
| --- | --- |
| shape | TypeBox/Ajv、当前 JSON contract、additionalProperties |
| canonical | Registry default 恢复、稳定排序、默认字段省略 |
| Catalog | identity、依赖类型、循环、引用、完整 workspace |
| readiness | Projection、reconcile 与 Publish 必填条件 |

Source 可保存 Registry 声明的空必填 Artifact/node reference；readiness 失败会阻止 Projection、reconcile 和 Publish。Source 持久内容限定为生成 UI 所需的声明数据。

Artifact 文档根可声明 `displayName` 与 `description`，分别承载作者维护的中文名和简介。两个字段属于当前 Artifact 自身的 authoring metadata；Concrete 与 Variant 各自持有，不从 base 继承。空值不写入 Source。metadata 可用于 Web Catalog、Project 展示与检索，不进入 Prefab、Binding、generated code 或 runtime contract。

## 文档类型

`.ui.json` 是 `UiConcreteSourceSchema | UiVariantSourceSchema`。

Concrete Source 根字段按 canonical 顺序表达：

```json
{
  "sourceKind": "artifact",
  "artifactKey": "MainHud",
  "artifactType": "Canvas",
  "displayName": "主界面",
  "description": "玩家常驻操作界面",
  "root": {
    "id": "MainHud",
    "rect": {
      "anchorMin": [0, 0],
      "anchorMax": [1, 1],
      "pivot": [0.5, 0.5],
      "anchoredPosition": [0, 0],
      "sizeDelta": [0, 0]
    }
  }
}
```

Concrete Widget 在 `artifactType` 后保存本层 identity：

```json
{
  "sourceKind": "artifact",
  "artifactKey": "StatusWidget",
  "artifactType": "Widget",
  "widgetType": "StatusWidget",
  "initialSize": [320, 180],
  "root": {
    "id": "StatusWidget",
    "rect": {
      "anchorMin": [0.5, 0.5],
      "anchorMax": [0.5, 0.5],
      "pivot": [0.5, 0.5],
      "anchoredPosition": [0, 0],
      "sizeDelta": [320, 180]
    }
  }
}
```

Variant Source 使用差量：

```json
{
  "sourceKind": "variant",
  "artifactKey": "MainHudSeason",
  "artifactType": "Canvas",
  "variantOf": "MainHud",
  "nodeAdditions": [],
  "componentAdditions": [],
  "overrides": [],
  "bindings": []
}
```

示例是可通过 shape 校验的最小结构，不代表 readiness 或业务契约完整。生成或修改组件、Binding 和 Variant 差量时仍以 CLI/schema 输出为准。

`artifactKey` 使用大写开头的 identifier；`root.id` 必须等于 `artifactKey`；child node id 使用小写开头的 Source identity（首字符为小写字母、`_` 或 `$`，后续只含字母、数字、`_`、`$`）。每个 concrete/resolved Artifact 的 node id 按 ASCII 大小写不敏感规则唯一，序列化保留原始大小写。Canvas 不保存 `initialSize`；Widget/Fragment 必须提供 `[width, height]`。`widgetType` 是 TS Widget export/registry identity，不要求与 `artifactKey` 相同。

Unity 节点显示名与 Binding `name` 遵循仓库 `TsProj/doc/ui-node-naming.md`。未绑定节点使用 `PascalCase`；普通绑定节点使用 lower `snake_case`，并按类型固定使用 `txt_`、`img_`、`go_`、`rect_`、`sr_`、`sv_` 或 `btn_`。嵌套 Widget 默认保持同名 `PascalCase`，同类多实例需要区分时使用同名语义化 `snake_case`，不增加 `wdg_` 前缀。

Binding 字段通常与目标节点显示名相同；同一节点额外暴露其它组件时使用“额外组件前缀 + 完整节点名”，且每个被引用节点至少保留一个同名主引用。未登记前缀的组件不得生成 Binding。Binding rename 作为完整 contract 迁移，同步 Concrete、Variant、Reference、Prototype、generated binding、TypeScript owner 与全部消费者；迁移完成后不保留旧字段别名。

## Node 与组件

Concrete child node 的结构字段为 `id`、可选 `idMode: "manual"`、可选 `name`、可选 `active`、`rect`、可选 `components` 和可选 `children`；Variant local node 使用相同字段。`id` 是 Source、Binding、Reference、Prototype 和 DeliveryState 使用的稳定 identity；`name` 是可选 Unity 显示名，不要求唯一。`name` 未保存时 Projection 用 `id` 派生 Unity GameObject 名，如 `line` 派生为 `Line`。

缺少 `idMode` 表示 auto，Source 不接受或保存 `idMode: "auto"`。新建节点默认 auto；只有作者明确覆写 Node ID 时才写 `idMode: "manual"`。普通加载、format、保存和 Publish 不补默认 mode，也不自动处理既有 `name`/`id` 不一致。auto 节点 Rename 会根据新显示名分配 id 并重写关联地址；manual 节点 Rename 默认只修改显示名。Artifact root 的 `id` 固定为 `artifactKey`，不持有 mode。完整行为由 `../development/node-identity-and-external-references.md` 持有。`rect` 持有 Unity baseline：

```json
{
  "anchorMin": [0.5, 0.5],
  "anchorMax": [0.5, 0.5],
  "pivot": [0.5, 0.5],
  "anchoredPosition": [0, 0],
  "sizeDelta": [100, 40]
}
```

组件 key 和字段来自 `src/components/component-list.ts` 聚合的 Component Module。Source 只保存偏离 Registry default 的可选字段；Preview、layout、Projection 和 roundtrip 在消费前恢复完整默认语义。不要依据某份 Markdown 手写未知组件或字段。

通用 UI 能力的适用边界、必要组合、纯 TS 工具所需的 authoring 前置和工具验收从 [`components/AGENTS.md`](components/AGENTS.md) 进入；字段和值域仍以 `schema --component` 和 Registry 为准。

`GameObject` 与 `RectTransform` 是固有 Binding target，不进入 `components`。其他 Binding component type 必须由目标节点或合法 PrefabRef 目标实际持有。

## Artifact graph

- Artifact 类型为 Canvas、Widget、Fragment。
- Canvas 可依赖 Widget/Fragment；Widget 可依赖 Widget/Fragment；Fragment 只依赖 Fragment。
- `PrefabRef.artifactKey` 引用独立 Artifact，不复制依赖节点树。
- graph 必须 identity 唯一、依赖类型合法且无循环。
- Projection 按 leaf-to-root 生成独立 Prefab，父级保存正式 Prefab instance。

Canvas 和 Widget 是 Binder owner；Fragment binderless。父 Binder 可以穿过 Fragment，但不能穿透 direct child Widget Binder。

`Unpack Prefab` 单次物化一层 Fragment，嵌套 Fragment 通过逐层操作物化。Widget 保持独立 Binder 与程序生命周期边界。

## Binding JSON

Concrete Canvas/Widget 在顶层 `bindings` 数组按 UIBinder 声明顺序持有完整声明；`name` 是最终 generated field name，`target` 是该字段的目标：

```json
{
  "bindings": [
    {
      "name": "txt_title",
      "target": {
        "instancePath": [],
        "nodeId": "txt_title",
        "componentType": "Text"
      }
    }
  ]
}
```

`instancePath` 定位跨 PrefabRef use-site，省略时语义为空数组。字段名在当前 Binder 层内唯一。Fragment 不声明 Binding。首次声明的 target 临时派生稳定 binding contract；Source 不保存 contract 类型副本。Variant 以同名声明重定向继承 Binding，目标必须可赋值给首次声明 contract，字段名、contract 与 effective position 保持不变；新名称追加为本层 Binding。

Binding candidate 只包含 UIBinder 支持的目标类型。当前跨类型可赋值关系为 `ScrollRectEx -> ScrollRect`；同类型目标直接可赋值。Nested Widget contract 使用首次声明 identity，并沿用 Unity/TS 的行为类替代约定，不在 Source 增加替代关系登记。

Binding mutation 由 Kernel `binder.ts` 和完整 Catalog 校验持有。Binder candidate 只包含正式 Projection 中存在的节点和 Component；Binding 目标不得位于 Preview-only 节点子树，也不得指向 Preview-only Component。同一 GameObject 的不同 Component 可以分别进入同一 effective Binder；多个同名 GameObject 可以通过不同 Binding field 独立绑定。不要把 Binding 嵌入 component，也不要按节点名推断字段。

## Variant 差量

Variant 相对 immediate base 保存：

- `nodeAdditions`：挂到继承父节点或本层新增根的本地子树。
- `componentAdditions`：给继承节点增加 Registry `useSiteAddable` 组件。
- `overrides`：修改 Registry `overrideFields` 声明的字段。
- `initialSize`：Widget/Fragment Variant 的可选本层初始尺寸；缺省继承 immediate base 的 effective 值，authoring mutation 写入与父级相同的值时归一为缺省。该字段只控制 Artifact 本地求值上下文，不表示 RectTransform 差量，也不缩放子节点。
- `widgetType`：Widget Variant 的可选本层 identity；空值继承上游，等于上游 effective identity 的冗余值在 authoring mutation 时归一为空。
- `displayName`、`description`：Variant 自身的可选 authoring metadata，不继承 immediate base。
- `bindings`：按本层声明顺序保存 Binding；名称命中继承字段时重定向其 target，否则增加本层字段。

继承 identity 的 Widget Variant 可编辑并保存重定向声明和 local-new raw declaration。local-new 存在时，`widgetType` 进入 readiness error，Projection、Publish 与 generation 保持阻止；声明区别于上游的新 local identity，或移除全部 local-new 后恢复可交付。只有声明新 local identity 的 Variant 才拥有本层 generated/program owner。Catalog、Preview 和依赖消费使用 effective identity，Projection 同时携带 local/effective identity。继承节点的删除、移动、重命名、继承组件删除和继承 Binder 删除由 base owner 持有。Variant 可覆写 immediate base 新增的结构，但不复制 resolved tree。

PrefabRef use-site 差量只影响父 Artifact 中的单个实例。实例根 active、RectTransform 和本地新增组件由本地 PrefabRef node 持有；内部继承节点使用 property override/component addition。Binding 和 nested PrefabRef 仍遵守 owner 边界。

基础 Artifact 的节点 `RectTransform.anchorMin` 或 `anchorMax` 变化时，所有仍覆盖该节点 `anchoredPosition` 或 `sizeDelta` 的 PrefabRef use-site 必须在同一候选事务中显式覆盖发生变化的 anchor 字段，或移除对应坐标 override。完整候选 Catalog 负责反向解析直接和嵌套 `instancePath`；未闭合的 use-site 影响阻止 Source 写入。

## Canonical 与 mutation

Canonical 根字段顺序由 `src/kernel/canonical.ts` 持有。format 会：

- 恢复 Registry default 后判断字段是否可省略。
- 删除空 map/array 和与 optional default 相等的字段。
- 只保留显式 `idMode: "manual"`；auto mode 继续由字段缺省表达。
- 保留 Binding 声明顺序，并稳定排序其余结构化字段。
- 拒绝 `$schema`、`schemaVersion`、`formatVersion`、`sourceVersion`、格式 `version`、`v1`/`v2`/`v3` 标记与 additionalProperties。

结构 mutation 使用 Kernel transaction。跨文档操作按调用方携带 baseline：字符串 baseline 要求内容精确匹配，`null` baseline 要求目标仍不存在。任何 Source upsert/delete 在第一次写入前校验完整候选与 Catalog；文件按确定顺序写入，中途失败保留已完成路径并返回失败与未执行路径。

节点创建、Template、asset drop、Unpack 和 Unity 新增节点反导共用 `displayNameToNodeIdBase` 与 `allocateNodeId`。分配按大小写不敏感保留集合尝试原 base、`_1`、`_2`。新建 auto 节点必须保持显示名与 id 规则一致；generated Template 中由模板同时明确且刻意分离的显示名/全局语义 ID 保存 manual。Copy/Duplicate 保留原 Unity 显示名，并从原 id 的下一个数字后缀开始分配；auto 副本不写 mode，manual 副本保留 manual。

`rename`、`align-node-ids` 与 `refactor-node-id` 默认生成影响 preview，并枚举 Source、Reference、Prototype 和 DeliveryState 动作；追加 `--write` 后执行已校验候选。Align 只处理 auto 节点，Refactor 产生精确 manual id。Save、Publish 和 Reconcile 不隐式执行 Align。

## 资源引用

Source 保存 `Assets/Resources/UI/` 相对路径；Projection 物化为 `Assets/Resources/UI/...`。资源类型与可选范围由 Component Module `assetFields` 和 Asset Catalog 持有。当前正式类型包括 PNG Sprite/Single、TMP Font Asset、Animation Clip 与 Animator Controller。

资源枚举覆盖 Concrete、Variant、PrefabRef override、Preview、Reference 和 Prototype session。资源移动使用 `asset-move`，由同一事务更新资源、`.meta` 与持久引用；不要对 JSON 做无边界字符串替换。
