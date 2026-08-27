# Preview 与证据数据契约

Preview、Reference、Prototype 和 Capture 提供创作输入与验证证据，不进入正式 Artifact Projection。Web 模式、人工操作和视觉反馈由 `../development/web-experience.md` 持有。

Reference 与 Prototype 只表达唯一当前结构，不保存 `schemaVersion`、格式 `version` 或 `v1`/`v2`/`v3` 标记，也不保留历史格式 reader。optional/default 只表达当前格式中的真实可选语义。

破坏性 Schema 演进按 `AGENTS.md` 作为独立迁移交付：同一批次更新 Git 工具、Schema、测试和文档，并一次性转换全部受影响的 SVN 受管 `.ui-reference.json` 与 `.ui-prototype.json`。迁移后旧结构直接校验失败，新旧格式不得并存。

## Artifact 与默认 Reference

`.ui.json` 只保存正式 Artifact graph、Component、Binder 与 Variant 差量。Preview 值、上下文、动态实例和用例组合保存于 `.ui-reference.json`。

正式 Artifact baseline 保存固定外壳、布局、静态标签、空态、StateRoot 和动态字段 Binding。运行时数量可变的同构集合只保留 collection owner 与 inactive template PrefabRef；代表性 item 实例和业务文案由 Reference collection 提供，正式实例由 runtime owner 根据业务数据创建。

固定容量、固定位置且整组常驻的槽位属于正式 Artifact 结构；父 Artifact 的默认 Reference 使用 `instanceValues` 为这些嵌套 Widget 提供一组完整、相互一致的代表状态。嵌套 Widget 的同名默认 Reference 只负责该 Widget 的独立预览，父级组合预览由父 Reference 显式提供证据。Reference collection 只对应由 collection owner 生成的动态实例。

Artifact 的默认 Reference 按文件配对确定：Reference 与 Artifact 位于同一目录、basename 相同，且 `referenceKey`、`subjectArtifactKey` 均等于 `artifactKey`。Artifact 不保存反向引用。命名 Reference 使用独立 `referenceKey`，可作为评审场景、物品用例或 Prototype 页面。

默认 Reference 承担 Artifact 的正常代表画面，画面内的计数、状态和可见实例彼此一致，并可直接作为 Prototype 的常规流程页。命名 Reference 只在相对默认画面存在独特、可见、可验收状态时建立：流程页从 Prototype 引用，preset 从 Collection 或 mount 引用；不参与依赖图的独立评审 Reference 必须用 `description` 说明验收场景。命名 Reference 与默认 Reference 的 Preview evidence 等价时，调用方直接使用默认 key，不建立语义 alias。Reference 只保存当前场景需要的可见 evidence，不携带隐藏页面或无关 sibling 的复制数据。

`check --full` 对命名 Reference 与默认 Reference evidence 等价、以及无入边且无 `description` 的命名 Reference 报 warning。视觉上因遮挡、inactive 状态或布局导致的等价仍由 Capture/Prototype 验证负责。

Fragment 只使用 Unity Baseline。Canvas 和 Widget 可以作为 Reference subject；Fragment 可作为正式 graph 中的 binderless 子图参与求值。

## Reference JSON

`.ui-reference.json` 的代码 owner 是 `UiReferenceSchema`。最小结构为：

```json
{
  "referenceKey": "WarehouseRightPanelWidget",
  "subjectArtifactKey": "WarehouseRightPanelWidget"
}
```

Reference 可组合以下证据：

- `values`：subject Binder field 到 capability/value 的映射。
- `instanceValues`：按 subject、context、Artifact instance 或 mount owner 定位现有实例；嵌套 Artifact 与 mount owner 可引用 subject 匹配的命名 Reference 作为 preset，并可叠加 Binder values。
- `statePreviewContexts`：按本地 StateRoot node ID 声明状态总览所需的上游 StateRoot 状态；工具默认从 Active 控制关系推导，显式配置用于选择或补足上游状态。
- `context`：声明父 Artifact，以及现有 `instancePath` 或用于生成 subject 实例的 `targetBinding`。
- `collections`：通过 owner 与 `targetBinding` 定位 Grid/Scroll Binder；group/item 可引用与模板 Artifact 匹配的命名 Reference 作为 preset，也可叠加 Binder values。
- `mounts`：通过 owner 与 `targetBinding` 挂载 Widget，并可引用 subject 匹配的命名 Reference、叠加 values、offset 和 size。
- `viewport`、`description` 与 `backdrop`：提供评审视口、场景说明和截图底图。

`instanceValues` 只定位已解析 graph，不直接创建实例。每个条目至少声明 `referenceKey` 或 `values`；preset 先应用其 subject values 和内部 instance、collection、mount evidence，条目 values 最后覆盖同一实例。Collection 和 mount 生成的实例只存在于 Preview session，不进入 Source hierarchy、Unity Baseline、Projection 或 Publish。

`instanceValues.owner` 定位 subject 下的既有嵌套实例时使用 `{ "kind": "artifact", "root": "subject", "instancePath": ["useSite"] }`。`root: "context"` 和 `{ "kind": "context" }` 只在 Reference 已声明有效 `context` 时使用；mount 生成分支使用 mount owner。`referenceKey` 只用于具有明确嵌套 identity 的 Artifact 或 mount owner，不作为 subject/context 根 Reference 的继承语法。

状态总览逐个展开当前 Artifact 的全部本地 StateRoot。`预览`模式先解析完整默认 Reference，再以最高优先级应用 `statePreviewContexts` 中属于该 StateRoot 的上游状态和卡片自身状态，因此 values、collections 与 mounts 保持可见。`Unity 基线`模式只解析 Source graph，并应用同一组临时状态选择，不应用其他 Reference evidence。未配置 context 时选择能够使目标 StateRoot 所在层级可见的上游状态，当前状态满足条件时优先沿用。该配置不生成状态组合，不修改 Source `currentState`，无效的 node ID 或 state name 作为 Reference 诊断处理。

Collection 按 group 和 item 的声明顺序生成稳定实例。group 使用 `items` 声明逐项 identity，或使用正整数 `count` 批量生成同类实例；空 item 使用当前 group preset/values 或 Unity Baseline。group 与 item 都可选择 subject 匹配的命名 Reference，item preset 替换 group preset，item values 再覆盖 preset 与 group values。异构 Widget 列表使用不同 group，各 group 的 `templateKey` 决定实际 Widget 类型。

数量随业务 model 变化且需要滚动的 collection，默认 Reference 提供当前 viewport 按布局参数可完整显示的 item 数量再加 1 个。该样例用于评审首个超屏 item、content 扩展、换行与 viewport 裁剪；特定空态、极小集合或大数据量场景使用独立命名 Reference 表达。

`ScrollRectEx` collection 生成至少一个 item 时，Preview 按运行时非空语义关闭 `emptyDefaultTarget`，并把 `emptyDefaultStateRoot` 切到第 0 个状态。Unity Baseline 不展开 collection，保留 Source 中的空态默认值。

Reference preset 复用其 subject values、内部 instanceValues、collection 和 mount；preset 自身的 context、viewport、description 与 backdrop 保持调用方外部的评审外壳。Collection item、mount 与已有实例 preset 使用同一依赖图、subject 匹配、循环检查和 Resolver 预算。

显式 `mount.size` 同时定义 mounted Widget 的绘制尺寸和 AutoLayout 占位的固定最小评审 extent；extent 包含 mount offset。父布局空间不足时不得压缩占位后继续按完整尺寸绘制，超出的内容由上层 fitted content 或滚动边界承接。未声明 `size` 的 mount 继续使用 mounted Artifact 求值尺寸作为 preferred extent。

`backdrop.images` 按 viewport 选择底图：完全匹配优先，否则按宽高比和面积选择。底图资产属于 UI Authoring Reference 资产，Web 与 Capture 将其置于组合图下方；`check --full` 检查资源存在性。

## Binder Values

Reference 只通过 Binder field 修改 Artifact。capability 由目标 Component Module 的 Preview 声明提供；`active` 由 `GameObject` 语义提供。Text、Image、StateRoot 及其他支持 Preview capability 的 Component 使用同一 values 结构。

调用方通过 `schema --component <component-type>` 的 `contract.previewCapabilities` 查询可用 capability。只有 `active` 的 Component 不接受其运行时字段作为 Reference capability；运行态交互状态由正式 Source 状态、业务 mock 和运行验收持有。

Artifact Preview 以 effective `StateRoot.currentState` 求值状态；PrefabRef use-site 对状态选择的 override 参与该求值，对实际 Node、RectTransform 或 Component 字段的 property override 在状态求值后保持为实例最终值。

Reference values、collection group/item values、mount values 与 Prototype session values 按 Resolver 层级叠加。后应用的层覆盖相同 field/capability，未覆盖字段保持前一层或 Unity Baseline。

Binder identity 属于正式 Artifact contract。普通 Artifact 编辑允许 Reference 暂时保留 stale Binder 诊断；Binder 改名先列出 Reference/Prototype 字段位置，并由用户选择批量更新或保留待修复项。Reference 删除先列出 Collection、mount 和 Prototype 反向引用并阻断删除。

## Prototype JSON

`.ui-prototype.json` 的代码 owner 是 `UiPrototypeSchema`：

```json
{
  "prototypeKey": "WarehouseFlow",
  "startReferenceKey": "WarehouseRightPanelWidget",
  "interactions": []
}
```

interaction 由 Reference、Tap `GraphTarget` 和有序 actions 构成。action kind 为 `Navigate`、`Back` 或 owner-scoped `SetValue`。Prototype session values 只改变当前演示会话，不回写 Reference、Artifact Source 或 runtime 行为。

Tap target 按 interaction 所属 Reference 的 resolved Preview tree 校验，因此既可指向正式 Artifact / PrefabRef 节点，也可指向该 Reference 生成的 collection item 或 mount。动态实例 target 由 Preview 选择结果产生并保留其 resolved `instancePath`，Prototype 不按 Source hierarchy 猜测动态实例地址。

## Capture 与 Verify

- `capture` 基于 Artifact/Reference、完整 Reference Catalog、context root viewport 和 Resolver 结果生成视觉证据；Reference backdrop 进入最终截图。
- `verify` 编排 validate、inspect、render、capture 和 projection 等离线阶段。
- `check --full` 聚合完整 workspace、Catalog、Reference 依赖和资源问题。

普通 Web Preview 展示 Resolver 诊断，并允许 Source-owned 节点按实际 Artifact/use-site owner 写回正式 Source；Reference value 继续覆盖画面最终值，Collection 与 mount 生成分支不接受 Source mutation。定向 Reference Capture、Prototype 校验和证据生成使用严格 Resolver，missing Binder、失效 preset、依赖循环、subject/template 不匹配或预算超限都会使证据失败。

这些命令的结果是诊断或证据，不替代 Publish 静态 gate。输出进入 runtime/证据位置，不回写 Source、DeliveryState 或正式资源。可解析 Artifact 的 `verify` 证据按 `artifactKey` 隔离；未通过 Source 解析的文档使用由 Source 相对路径派生的稳定 fallback key。

## 资产边界

`.ui.json` 和 Reference Binder values 使用 `Assets/Resources/UI` 下的 Source-relative 正式资源路径；`Prefab/` 是 Publish 输出目录，Source 资源位于 `Textures/`、`Font/`、`Animation/` 等 authoring 目录。资产移动保留 Unity `.meta` 与 GUID，并同步改写 Source/Reference 中的正式资源引用。

Reference backdrop 位于 `UIAuthoring/ReferenceAssets`，只由 Reference Preview、Capture 和 `check --full` 消费，不进入正式资源索引、Projection 或 Publish。
