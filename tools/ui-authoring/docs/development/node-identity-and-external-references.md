# Node Identity、Rename 与外部引用

本文持有 UI Authoring 节点显示名、Source identity、跨文档引用和保存范围的稳定行为。Source 字段契约由 `../specification/source-format.md` 持有，Delivery 与 Reconcile 结果由 `../specification/delivery-contract.md` 持有。

## Identity 模型

| 标识 | 职责 | 修改规则 |
| --- | --- | --- |
| `node.name` | Unity GameObject 显示名，不要求唯一 | 由 Rename 修改 |
| `node.id` | Source、Binding、Variant、Reference、Prototype 与 DeliveryState 使用的节点地址 | auto Rename 自动计算；manual Rename 只有显式覆写时修改 |
| `node.idMode` | 记录 Node ID 已由作者固定 | 只允许可选的 `"manual"`；缺省表示 auto |
| `binding.name` | generated TypeScript field 和 `UIBinder.UINode.name` | 独立维护，不随 `name` 或 `node.id` 自动变化 |

`node.id` 始终保存最终、可直接寻址的字符串。Artifact root 的 `id` 固定为 `artifactKey`，不持有 `idMode`，也不参加 Node Rename 或 Align。Variant inherited node 的 mode 与 identity 由 Base owner 持有；Variant 只维护本层 `nodeAdditions`。

## 稀疏 mode

- 新建 child node 默认处于 auto mode，不写 `idMode`。
- Concrete child node 与 Variant local node 只有经过人工确认需要固定 Node ID 时才写 `idMode: "manual"`。
- `idMode: "auto"` 不是合法 Source 数据。运行时可以使用 auto/manual 两种计算状态，但序列化只记录偏离默认行为的 manual 信息。
- 用户清除手动 Node ID 覆写时删除 `idMode`，并立即按当前显示名计算 auto 候选。
- 缺少 `idMode` 的现有节点直接按 auto 处理。加载、canonical format、普通保存和 Publish 不补写 mode，也不因既有 `name`/`id` 不一致而自动修改 identity。
- 工具不根据当前 id 的可读性、外部引用数量或历史形态猜测 manual。需要固定的存量语义 id 由作者在实际校验时显式设置。

因此，现有 `.ui.json` 可以直接使用，无需格式版本升级或批量改写。普通保存不会给全文件补默认字段，也不会制造只包含 mode 的 churn。

## Align 的语义边界

显示名和 Node ID 可能承担不同粒度的语义：

| 字段 | 常见内容 | 作用范围 |
| --- | --- | --- |
| `node.name` | `Label`、`Icon`、`Background` | Unity Hierarchy 中便于阅读的局部名称，可以重复 |
| `node.id` | `successExtractionPointLabel`、`runValueAmountGroupIcon` | Artifact 全局唯一地址，可能包含父级或业务上下文 |

仅从显示名生成 id 时，多个 `Label` 只能得到 `label`、`label_1`、`label_2`。这些结果满足合法性和唯一性，却不能保留“提取点”“地图名”等业务上下文。语义退化来自输入信息不足，不是字符串归一化错误。

auto/manual mode 明确谁拥有 Node ID 语义：auto 节点允许显示名成为 id 来源；manual 节点保留作者确认过的独立语义。通用重复显示名、Artifact 全局唯一地址和所有 id 都由叶节点显示名完整推导不能同时无条件成立；auto 节点使用确定性数字后缀，需要额外业务语义的节点使用 manual。

## ID 分配

`displayNameToNodeIdBase(displayName)` 生成确定性合法 base，`allocateNodeId` 按 ASCII 大小写不敏感规则检查当前 concrete/resolved Artifact。

- auto Rename 排除当前节点自身后分配候选；base 被占用时依次尝试 `_1`、`_2`。
- auto 节点已有 id 只要等于当前显示名 base 或其 `_<number>` 形式，就视为 aligned；不要求占用最小数字。
- 删除节点或释放 id 后不主动压缩已有后缀。
- 自动后缀不改变 mode，Source 继续不写 `idMode`。
- 用户或 AI 提交的 manual id 是精确要求。非法字符、非法首字符或大小写不敏感冲突在写入前阻断，不自动换成其他 id。

是否存在外部引用不决定 mode，只决定 Rename 需要重写多少文档。节点后来新增引用不会改变其 Rename 语义。

## Rename

### Web

Rename 界面同时显示 GameObject name、最终 Node ID 和当前 auto/manual 状态。

- auto 节点修改显示名时实时计算最终 id。
- manual 节点修改显示名时默认保留当前 id。
- 用户输入精确 Node ID 会把节点切换为 manual。
- 用户启用 Auto Node ID 会删除手动覆写，并显示按当前名称分配的最终候选。
- id 格式、大小写不敏感冲突、readonly owner 和无法重写的受影响文档在提交前显示 blocker。
- 命令完成后 selection 映射到新 id；无法安全延续的临时命令失效。

### CLI 与 AI

```powershell
npm.cmd run cli -- rename <source> --node <node-id> --to <display-name>
npm.cmd run cli -- rename <source> --node <node-id> --to <display-name> --node-id <manual-id>
npm.cmd run cli -- rename <source> --node <node-id> --to <display-name> --auto-id
```

- 不提供 mode option 时沿用节点当前 mode。
- `--node-id` 提交精确 id，并切换为 manual。
- `--auto-id` 删除手动覆写，并按显示名分配 id。
- 三种路径都默认只生成 preview；`--write` 执行经完整候选校验的写入。

直接编辑 JSON 中的 `node.id` 不携带 `oldId -> newId` 意图，不自动重写引用或 DeliveryState。需要保留对象和引用时使用 Rename 或 `refactor-node-id`。

### Unity Reconcile

Concrete Base GameObject 的 `node-name` patch 复用同一 Rename planner：auto 节点同步更新 id，manual 节点只更新显示名。Variant inherited GameObject 路由到 Base owner，不在 Variant 层建立另一套 Rename 行为。

Web Apply 与 CLI `reconcile`、`sync-pull`、`pull-live` 都先应用非名称 patch，再把 Concrete `node-name` patch 作为同一 workspace Rename 候选处理；批量 pull 对所有候选完成校验后再进入顺序写入。

Artifact key、Prefab canonical path 和 Variant base identity 由 Artifact workspace operation 持有，不进入 Node Rename。

## Copy 与 Duplicate

Copy/Duplicate 保留原 Unity 显示名，Node ID 从被复制节点的当前 id 派生。

- `item` 的第一个可用副本从 `item_1` 开始。
- id 以 `_<number>` 结尾时从下一个数字继续，例如 `item_3` 从 `item_4` 开始。
- 候选被占用时继续递增，比较保持大小写不敏感。
- 子树按稳定树顺序分别分配 id，子树内部 local node reference 重定向到副本。
- auto 节点副本仍不写 mode；manual 节点副本保留 `idMode: "manual"`。
- Binding field 使用独立分配规则。

Copy/Duplicate 是工具生成 identity 的场景，因此允许自动寻找后缀；用户或 AI 输入精确 manual id 时仍采用“冲突即阻断”。

## 创建与通用 mutation

- 新建 auto 节点的 id 必须符合其显示名 base 或数字后缀形式；新建入口不制造 stale auto identity。
- `insert` 需要独立业务 ID 时显式提交 `idMode: "manual"`。内置 generated Template 同时规定显示名与全局语义 ID，两者刻意不一致的节点由 Template 物化为 manual。
- 通用 `edit` transaction 不接受 `setNodeName`、identity 字段的 `set/unset` 或 Duplicate 自定义 ID。显示名与 ID 变化统一使用顶层 Rename/Refactor planner。
- Kernel 结构 mutation 不对外暴露独立的 child ID 直改能力；Artifact 文档操作只在修改 `artifactKey` 时配对更新 root identity。
- 直接编辑 JSON 仍可能产生 stale auto 节点；加载和保存保持原值，由显式 Align 负责维护。

## Align 与 Refactor

Align 是显式、可重复执行的存量维护命令，不是 Save、Publish、Capture、Verify 或 Reconcile 的隐式步骤。

```powershell
npm.cmd run cli -- align-node-ids <source>
npm.cmd run cli -- align-node-ids <source> --write
npm.cmd run cli -- refactor-node-id <source> --node <node-id> --to <manual-id>
npm.cmd run cli -- refactor-node-id <source> --node <node-id> --to <manual-id> --write
```

- Align 只处理 auto 节点，跳过 manual 节点。
- 已符合当前显示名的 auto id 先保留；只为 stale auto 节点分配候选，树重排不会重编号正常节点。
- 重复 Align 在 name/mode 未变化时为 no-op。
- `refactor-node-id` 把目标节点改为精确 manual id。
- preview 返回 before/after mode 与 id、受影响文档、DeliveryState 动作、warning 和 blocker；`--write` 才执行写入。

对于 `Label`、`Icon`、`Background` 等通用名称，作者应在 preview 中检查数字后缀是否仍有足够语义。需要保留独立业务语义时，先保持或设置 manual，或把显示名改为完整语义名称后再切回 auto。

## 引用重写

Rename、manual Node ID 覆写、Align 和 Refactor 共用 `src/kernel/node-identity-refactor.ts` 的 workspace planner。planner 读取完整 workspace 发现反向依赖，并形成一次完整候选。

| 位置 | id 变化时的动作 |
| --- | --- |
| owner concrete tree | 修改节点 `id`，重写 Component local node reference |
| owner 与传递 Variant | 重写 Binding、override、component addition、`nodeAdditions.parentId` 和 instance path |
| 反向 PrefabRef consumer | 重写 use-site override、component addition 和嵌套 instance path |
| Reference | 重写 context placement、artifact/mount owner scope 中的 instance path |
| Prototype | 重写 interaction target 和结构化 owner 地址 |
| DeliveryState | 当前 Artifact 与已交付下游 Variant 执行 `oldId -> newId` re-key，保留 `prefabGuid` 和 `localFileID` |
| Web session | 重映射 selection，并把受影响文档加入同一 save group |

Asset reference、Sprite、Font、Animation 和 `binding.name` 不随 Node ID 改写。

完整 workspace 读取只用于解析关系。默认只让目标及其受影响依赖闭包中的不可用文档、无法重写地址或候选冲突成为 blocker；无关文档问题由 `check --full` 报告，不阻断局部 Rename。

## 保存与失败

- planner 在第一次文件写入前校验 id、owner、候选 Source、Reference、Prototype 和已知 DeliveryState 动作。
- 候选重写必须保持 Source 的稀疏表示：缺省的 optional/default 字段继续缺省，不得因为 identity remap 物化默认值；无关 Artifact 在候选前后必须保持语义等价，不得被列入 `affectedDocuments` 或写入。
- Web 保存当前文档；语义操作自动扩展到该操作登记的受影响文档闭包，不包含无关 dirty 文档。
- CLI 和 server 在同一进程内串行写入，并按确定路径顺序提交。每个文件可以使用 baseline/precondition 和临时文件替换。
- 中途写入失败时停止后续步骤，返回已写入、失败和未执行路径；已完成文件保持不变。
- 用户修复原因后重新执行。需要整体撤销时使用对应 Git/SVN working copy。
- Undo/Redo 和同一浏览器会话中的导航草稿属于内存编辑能力，不建立进程重启后的 recovery contract。

Workspace `Save All`、跨文件 staging/rollback、恢复 journal、持久 recovery draft 和 Publish 自动回退不属于当前模型。

## Source 兼容与维护

- `.ui.json` 继续使用当前无版本结构，不增加 schema/format version。
- 现有缺少 `idMode` 的文件可直接加载、保存和 Publish；普通流程不补字段、不自动 Align。
- 新建及普通 auto 节点继续省略 mode，只有人工确认的 manual 节点增加一个有信息密度的字段。
- 本功能不批量修改 `.ui.json`、`.ui-reference.json`、`.ui-prototype.json` 或 `.ui-directory.json`。
- 存量语义 id 的集中审查属于独立数据维护任务；先生成只读候选清单，再对确认需要固定的节点写 manual。

## 验收标准

- 缺少 `idMode` 的节点按 auto 处理，canonical format 与普通保存不输出默认 mode。
- auto Rename 同时更新 `name`、`node.id`、全部可解析引用和 DeliveryState；manual Rename 默认保持 id。
- 精确 id 非法或冲突时，在任何文件写入前失败。
- 清除手动覆写后 Source 删除 `idMode`，界面和 CLI preview 展示最终 auto 候选。
- Copy/Duplicate 从原 id 分配下一个合法数字后缀，并保持显示名、mode 和子树内部引用。
- 新建 auto 节点保持 name/id 对齐；模板中明确分离的语义 ID 保存 manual。
- 通用 `edit` 无法绕过 workspace planner 修改 name、id 或 mode，也不能为 Duplicate 指定任意 ID。
- Align 只处理 auto 节点，并且只由显式命令运行。
- 多文档写入失败返回已写入、失败和未执行路径，不执行自动 rollback。

## 非目标

- 新增永久 node GUID，或把 `UIAuthoringNodeIdentity` Component 保存进正式 Prefab。
- 让 `binding.name` 跟随 GameObject name 或 Node ID 自动变化。
- 根据引用数量、当前 id 形态或启发式自动切换 manual。
- 每次导出时 Align、回收空闲后缀或批量统一历史 name/id。
- 为断电、进程崩溃或跨进程并发建立持久 transaction recovery。
