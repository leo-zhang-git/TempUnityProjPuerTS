# 节点删除人工操作

本文用于在 UI Authoring Web 编辑器中删除正式 Source 节点。删除前由工具基于完整 Artifact、Reference 与 Prototype workspace 生成影响计划；删除命令把关联改动登记为同一个 semantic save group，required 引用修复完成后再保存该范围。

## 操作步骤

1. 从 `tools/ui-authoring/` 运行 `python .\start_ui_authoring.py --role manual`，打开目标 Artifact。
2. 在 Hierarchy 中选择当前 Artifact 持有的本地节点，点击删除按钮。继承节点应进入其 base Artifact 处理；Artifact root 保持不可删除。
3. 在确认框中检查影响清单：
   - `自动删除`：随节点失效的 Binder、Variant delta、PrefabRef use-site delta、Reference Values 或 Prototype interaction。
   - `自动清空`：nullable 引用清为 `null`，optional 引用删除字段。
   - `置空并待修复`：required 结构引用写入 Component Registry 定义的空值；删除可继续，正式保存前必须重新指定有效目标。
   - `重新发布`：仍保留 PrefabRef 或继承关系的反向依赖 Artifact；删除完成后需要重新 Publish。
   - `阻断`：Artifact root、继承节点或无法形成结构有效候选的错误；此类问题需要先回到对应 owner 处理。
4. 没有外部影响时点击 `Delete`。存在自动清理、待修复或重新发布项时，先点击 `继续`，复核后点击 `删除并清理`。
5. 删除成功后检查引用方 Hierarchy。待修复 required 引用显示红色错误，删除结果和全部关联文档保留在当前内存草稿与同一 save group；一次 Undo/Redo 会恢复或重放完整跨文档变化。
6. 修复所有红色结构错误后保存当前文档。保存自动扩展到该删除操作的 save group；任一候选仍有 readiness、Catalog 或 baseline 错误时在首次写入前阻断。文件系统中途失败时按结果修复并重试未保存范围。

## Publish 与程序接入

删除 Binder 会改变 generated binding contract。按以下顺序完成配套交付：

1. 保存被修改的当前文档，确认删除操作的 semantic save group 全部保存成功。
2. Publish 被修改的 Artifact，生成正式 Prefab 与 `TsProj/src/ui/generated/<type>/*-ui.ts` binding。当前仓库的 UI generated binding 是 `.ts`，不是 `.d.ts`。
3. 修改使用已删除字段的 Canvas/Widget 业务 TS；业务行为应迁移到仍存在的结构或新的 Binder，不保留无效字段访问。
4. 对确认框列出的 `重新发布` Artifact 分别执行 Publish。需要批量收敛时使用 `发布全部`；`发布当前文件及依赖`只包含当前 Artifact 的下游依赖，不替代反向依赖重发。
5. 完成本地运行验收，并在程序提交前从 `program/` 执行 client TypeScript 准入，确认 regenerated binding 与业务 owner 一起通过。
6. 检查实际改动范围后配套提交：UI Source、正式 Prefab 与 DeliveryState 进入 Unity SVN；generated binding 和业务 TS 进入根 Git。两侧属于同一交付，但仍按各自 VCS 流程提交。

## BackpackPlayerPanel 样例

目标 Source 为 `My project/UIAuthoring/Sources/BackpackGraph/BackpackPlayerPanel.ui.json`，候选节点为 `shanchu`。当前删除计划应显示：

- `自动删除`：子树中的 Binder `go_container_sections`、`go_item_grid`、`go_gun_header`、`txt_gun_summary`、`go_gun_grid`，以及依赖这些 Binder 的 Reference Preview Values、Collection、mount 与 Prototype interaction。
- `置空并待修复`：`inventoryScrollArea.ScrollRect.content -> shanchu` 是 required 结构引用，删除后 `content` 置空，`inventoryScrollArea` 在 Hierarchy 标红。
- `重新发布`：`BackpackCanvas` 通过 PrefabRef 使用 `BackpackPlayerPanel`，该引用保留并进入重发范围。
- 程序配套：Publish 后 `TsProj/src/ui/generated/widget/<artifact>-ui.ts` 不再声明已删除字段；对应 `TsProj/src/ui/widgets/` 或 `TsProj/src/ui/canvas/` owner 中的业务访问需要人工调整。

人工验收按以下顺序执行：

1. 选择 `shanchu` 并确认删除，复核五个 Binder、跨文档自动删除项、`ScrollRect.content` 待修复项和 `BackpackCanvas` 重发项。
2. 点击 `继续` 与 `删除并清理`；确认 `shanchu` 消失，`inventoryScrollArea` 在 Hierarchy 标红。
3. 可先点击当前文档 Save 验证 readiness 阻断；结果应明确本次没有文件写入磁盘，删除草稿保持可 Undo。
4. 将 `inventoryScrollArea.ScrollRect.content` 指向有效的 `inventoryContent`，确认 Hierarchy 红错消失，再保存当前文档及其 semantic save group。
5. Publish `BackpackPlayerPanel` 并重新 Publish `BackpackCanvas`；也可从 `BackpackCanvas` 使用“发布当前文件及依赖”覆盖两者。
6. 检查 regenerated `TsProj/src/ui/generated/widget/<artifact>-ui.ts`，再修改对应 `TsProj/src/ui/widgets/` 或 `TsProj/src/ui/canvas/` owner，清理已删除 Binder 的业务访问并从 `TsProj/` 完成 `npm.cmd run check`。
7. 将 UI Source、Prefab 与 DeliveryState 作为 Unity SVN 交付，将 generated binding 与业务 TS 作为根 Git 交付；两侧按同一功能边界复核后分别提交。

不要通过把节点改名为 `shanchu` 或保留空节点来绕过引用处理。UI Authoring 不自动修改手写业务 TS；generated binding 只在 Publish 时重建。
