# Web 实现架构

本文持有 Web Application、Editor、状态、Inspector、rendering 和样式的代码 owner。人工体验与菜单行为由 `web-experience.md` 持有；常规 AI Source 交付不读取本文。

## 目录 owner

- `application/`：启动、workspace 加载、Catalog、保存编排和 route composition。
- `editors/shared/`：至少两个 Editor 共用的 shell、navigation、status、preview mode、Reference document mutation 和 selection 语义。
- `editors/artifact/`：Artifact session、结构 command、Canvas、Hierarchy、Inspector 和 Dialog。
- `editors/reference/`：Reference draft、Binder values、collection、mount 和 resolved hierarchy。
- `editors/prototype/`：Prototype interaction 与 present session。
- `workspace/`：Project 的单栏 Source Explorer 与双区浏览器、目录视图、最近位置、排序、dependency view、文档命令和 Problems bridge。
- `workspace/overview/`：工作区总览的 Catalog 统计、文档清单筛选和 activity 展示模型。
- `workspace/relations/`：Artifact、Reference 与 Prototype 的统一有向关系图、最短路径上下文和只读全屏关系视图。
- `rendering/`：Editor、Reference、Capture 共用的确定性 Artifact renderer。
- `capture/`：Capture dialog 与专用页面。
- `guide/`：独立教学应用，只依赖 `shared`。
- `shared/`：API transport、基础 UI 与不理解文档领域的 Web 类型。

workspace 文档命令只连接统一 workspace API，不持有 identity、依赖重写或文件系统语义。Problems bridge 只把 partial Catalog diagnostic 注册到 Diagnostics 并提供聚焦；预期 `4xx` 业务阻断不登记为 Runtime error。目录和 Editor 不直接访问文件系统，也不持有启动健康检查、扫描或缓存失效语义。

Project 搜索模型由 `workspace/explorer/artifact-explorer-model.ts` 统一派生目录、Artifact、Reference 与 Prototype 的展示上下文、本地评分、原文命中区间和文档语义候选文本。Web 立即计算目录与文档的 key、metadata、路径、类型及 `pinyin-match` 结果；debounce 后通过同源 `workspace.semanticSearch` API 请求文档语义补充，并忽略过期响应。Node server 持有 `embedding-cache` collection token、候选指纹与原文到文档 identity 的聚合映射；collection 过期时按当前候选重建，网络或 provider 失败返回空语义结果，不改变本地检索。

`workspace/relations/workspace-relation-model.ts` 从 Artifact 正式 PrefabRef/Variant 依赖和 Kernel Preview dependency graph 派生统一有向图，边方向固定为使用者指向被使用者。Artifact 只通过正式依赖连接 Artifact；Reference 通过 subject、context、collection 与 mount 连接 Artifact 或 Reference；Prototype 连接其使用的 Reference。Direct 与 Indirect 由根节点的最短路径距离派生；视图只绘制图中的实际直接边，不生成传递边。

Source 目录创建与文档移动、复制和删除使用同一 workspace document operation 边界。Web 只提交 Source 相对路径与 `.ui-directory.json` 元数据；server 在 `WorkspacePaths.sourceRoot` 下验证目标、拒绝覆盖已有目录并通过 workspace write service 写入。Project 复用 command context，但不把 `Assets/Resources/UI` 资产目录纳入该 operation。

## Application 与状态

- URL route 是当前 workspace location 的权威表示。
- Application 持有文档草稿、saved baseline、Catalog、资源、保存编排和跨 Artifact clipboard。
- Application 持有当前协作文档状态与本 tab 的 presence session。进入 Artifact、Reference 或 Prototype 时查询对应文档；只有 dirty 文档进入编辑 lease，Prototype 同时包含当前 Reference。协作状态是 advisory 信息，不参与 mutation、导航或保存前置条件。
- 工作区总览使用独立 URL location，并按需轮询全部 Catalog 文档的轻量 activity；本 tab dirty 文档继续通过统一 presence session 上报。总览模型从 Catalog、Problems、文件修改时间、dirty identities 和 activity 纯派生，不持有第二份 workspace 数据。
- 全屏关系图使用独立只读 URL location，不建立协作文档 lease，也不进入最近编辑列表；返回 Artifact 时替换当前 history entry。
- Artifact workspace mutation 使用 immutable document/source 与浅复制 Map；canonical format 按 Source identity 缓存。
- Reference/Prototype 持有各自 session undo/redo，并持续同步草稿回 Application。
- dirty documents 由各类当前草稿与 saved baseline 统一派生。

`application/workspace-document-session.ts` 持有文档集合、草稿与 baseline，`workspace-navigation.ts` 持有 URL 导航与 guard，`workspace-save-session.ts` 持有保存编排，`collaboration-session.ts` 持有 presence effect 生命周期。`workspace-routes.tsx` 按 location 组合 Workspace、Artifact、Relations、Reference 与 Prototype 页面；`app.tsx` 只连接这些 session、应用级 dialog 和 route props。

`application/workspace-save-coordinator.ts` 持有 debounce、single-flight、flush waiter 和保存状态，不持有文档副本。每次写入由 Application 从最新草稿建立 immutable submitted snapshot；保存期间产生的新编辑在当前请求结束后继续保存，旧响应不覆盖新草稿。连续输入合并保存，transient drag/scrub 只在事务结束后提交；失败保留草稿和 dirty 状态，同一 Auto Save 失败只等待新编辑或显式重试。

Application 从用户请求的当前页面文档出发，扩展该文档所属的 pending semantic save group；Node identity mapping 与受影响 Artifact、Reference、Prototype 和 DeliveryState 保持同一保存范围，无关 dirty 文档不加入。bootstrap 为可用文档提供 server 生成的 opaque semantic revision，Web workspace Save 以该 revision 建立 precondition；CLI 与独立 Artifact transaction 继续使用精确文本 baseline。server 在第一次写入前校验完整候选与全部 baseline，随后按确定顺序写入。部分成功只推进成功文档的 saved baseline，diagnostic identity 归属实际失败文档，其余待处理范围标记为未执行。保存 `4xx` diagnostic 进入 Problems；失败或部分成功使用统一结果弹窗展示文档、原因和建议操作。

`application/source-write-session.ts` 在外部修改重试时强制刷新 repository snapshot，并通过 `workspace-external-change-recovery.ts` 对目标 save group 执行三方 rebase。rebase 以对象字段为合并单位、以数组为原子值；安全合并推进目标文档的磁盘 revision，重叠修改返回字段位置并保持原草稿。目标组之外的 dirty 草稿和 saved baseline 不随刷新推进。

Changes 按文档提供 Save 与 Discard。Discard 取消该文档待执行的自动保存并恢复到当前 saved baseline，不修改已落盘 Source、不执行 SVN revert，也不撤销已经完成的保存。

当前 Artifact 的 SVN 还原由 `application/source-write-session.ts` 编排：Editor 展示 SVN 状态并区分当前 Artifact 草稿与其他文档草稿；Application 在没有 Source 写入和 transient edit 时，以当前 saved semantic revision 执行 server mutation。成功后强制重新加载 bootstrap，以 SVN BASE 替换目标 Artifact，并把其他 dirty 文档从当前内存草稿合并回新 baseline。按钮状态随当前 Source 路径及 saved revision 重新查询，SVN clean 时当前 Artifact 草稿仍可 reset 到 BASE。

workspace 文件命令只在全部草稿已保存后执行，成功后按 server 返回的逻辑位置重新加载 workspace。Artifact Editor controller 只装配 selection、canvas、dialog、Inspector 和 command session；各 session 持有自身 state/effect/mutation orchestration，结构和属性最终通过 Artifact workspace history mutation 写入内存草稿。

Artifact shell 跨文档复用。selection 按 `rootArtifactKey` 变化收敛，Reference resolved selection 在 Artifact identity 变化时重置。readiness diagnostics 以 immutable Source identity 为键使用 `WeakMap` 缓存。Unity job busy、sync status 和 reconcile result 由 Unity delivery session 持有并通过 Artifact command session 暴露；reconcile Apply 只更新草稿，持久保存仍由 Application 编排。

Artifact、Reference、Prototype 与目录 Gallery 组合共享 Workbench primitives。`editors/shared/workbench-panel-resize.ts` 持有三栏面板尺寸、折叠、键盘调整和浏览器本地持久化；`editors/shared/workbench-sidebar.tsx` 持有跨浏览内容共享的最多两个左侧面板选择、焦点、上下分隔与浏览器本地持久化，各页面只过滤自身支持的视图；`editors/shared/canvas-viewport.tsx` 持有 zoom、fit、pointer-centered wheel zoom 与 pan。Artifact 通过自身 canvas adapter 和 zoom policy 接入；Reference 与 Prototype 直接消费 resolved preview。共享层只持有布局、viewport 和只读 resolver 展示，不持有 Artifact、Reference 或 Prototype 的领域 mutation。

Artifact、Reference 与 Prototype 的 Hierarchy 共用 `editors/shared/editor-hierarchy.tsx` 的节点 renderer、折叠、选择、搜索、定位、图标和状态样式。Artifact adapter 提供结构编辑、多选、拖拽与可见性命令；`editors/shared/resolved-preview-hierarchy.tsx` 只把 resolved root、selection 与只读 capability 接入共享 renderer。Resolved PrefabRef 和 context binding 与 use-site 合并，collection 与 mount 按 placement 节点进入同一树。

Reference 与 Prototype 共用 Project、resolved hierarchy adapter、relations、effective node/provenance 和 semantic changes 展示。Reference Editor 组合 Project/Hierarchy/Relations 与 Node/Reference/Changes，并把 Reference-owned Binder value mutation 交给 Reference session；Source-owned 状态只路由到 owner Artifact。Prototype Editor 在同一组合上增加 Flow、Interaction 与 Present，interaction mutation 和 present session 继续由 `editors/prototype/` 持有。

Artifact command session 组合 `commands/unity-delivery-session.ts`、`commands/structure-commands.ts` 与 `commands/artifact-identity-commands.ts`。Binder、use-site override、selection location、panel resize 与 batch/RectTransform Inspector 由各自 feature 文件持有；Artifact Editor 和 Inspector entry 只组合这些 owner 与共享 session 输入。

## Selection 与 Canvas

`rendering/selection.ts` 持有 SelectionAddress、选择集合和命中解析。`canvas/node-authoring.ts` 持有绘制范围到父节点局部 RectTransform 的纯计算；alignment/arrangement 模块持有吸附、对齐和分布。共享 `canvas-viewport.tsx` 提供 Editor 间一致的视口控制 contract；`canvas/artifact-canvas-viewport.tsx` 只保留 Artifact adapter 和领域 zoom policy。

Canvas 只持有 transient drag/resize/select/text preview。结构创建、文字 commit 和属性 mutation 交回 command session/transaction；Reference 文字通过 Binder values 写入 Reference，baseline 文字写入正式字段。一次连续手势只生成一条 undo 记录，取消恢复开始快照。`canvas/artifact-canvas-viewport.tsx` 把 Artifact 三个编辑上下文的 Source 与 zoom policy 适配到共享 viewport controller；renderer 只提供统一的 stage 与 zoom root。

`shared/pointer-transform-gesture.ts` 持有节点 move/resize 共用的 pointer capture、启动阈值、帧合并、修饰键约束和 commit/cancel 生命周期，不理解 Source、Reference 或选择 owner。Unity Baseline 与 Preview 为同一 gesture session 提供各自的坐标、吸附、selection resolution 和 mutation adapter；编辑预览仅在 Reference 存在明确几何字段映射时注册 transform adapter。

Canvas scene 使用稳定 entry 与节点级 memo，selection/hover 通过独立 overlay 更新。Kernel 节点 mutation 保留未变化兄弟节点的对象 identity；Hierarchy 在根部一次建立节点状态索引，并按相关子树 memo，保持稳定 selection address。普通固定锚点叶节点 resize 使用 imperative preview，root、嵌套、stretch 和 layout-driven 节点回退到完整 Preview。Reference 画布以 resolved selection address 映射 Source owner；当前 subject 的 authoring overlay 使用同一 RectTransform capability 和 transient workspace transaction，context 与正式嵌套节点按 owner/use-site mutation，Collection 与 mount 生成分支保持只读。

## Inspector

Concrete、Variant 与 PrefabRef use-site 使用同一 Artifact Inspector renderer。Inspector session 根据 owner 选择 direct write、property override、component addition、reset 或 readonly。

`artifact-inspector.tsx` 只装配 selection owner、RectTransform/layout、Batch 与页面结构。`component-section.tsx` 持有 Component section 和字段状态；`inspector-field-editor.tsx` 持有通用 field dispatch，通过 `customInspectorFieldRenderers` 组合 StateRoot、StateToggle、TemplateMap 与 Crosshair 等领域 renderer。引用、资产、field primitive 和领域复合编辑器使用同目录独立模块。

Binding 由 Kernel `binder.ts` 生成 read/write model；Component Inspector 不持有 Binding shadow state。Batch Inspector 只处理共有且允许 multi-edit 的 Component/field；mixed mutation 在一次多节点 transaction 中提交。

Component definition 的 `mutateInspectorField` hook 负责联动字段并返回完整 component value。hook 或 validation 失败不降级为部分字段写入。Add Component 菜单通过 Registry `componentAvailabilityReason` 和 `initialComponent` 消费 Component Module 的 `canAdd` 与 `initialize`；组件依赖、上下文初值和 PrefabRef use-site 白名单由模块声明，Inspector 只组合全局 owner 限制。

RectTransform Inspector 展示 Kernel layout result；layout-driven 轴的求值值不回写 Source baseline。固定竖向锚点且高度不受 Layout 驱动的 TMP Text 在文字、字号或字体变化后重新测量，必要时扩展到 `preferredHeight + 1px`；新字体先完成 Web intrinsic 加载，再与字体字段更新一起提交。

## Rendering 与样式

`rendering/` 消费 resolved Reference tree、Binder values 和 layout result。Artifact graph、Mask、StateRoot 和 Component Preview 语义由 Kernel/Registry 提供，Canvas 不维护平行实现。Capture 使用同一 renderer 与显式 viewport；Reference/Prototype session 只改变求值输入。

- `styles/tokens.css` 只定义设计 token 和 theme override。
- `styles/base.css` 只定义字体、reset 和 document root。
- Feature 使用就近 CSS Modules。
- `createWebClasses` 只组合显式传入的 CSS Module。
- renderer 样式由 `rendering` 持有，交互 overlay 由 Artifact Editor 持有。

Editor 与 Workspace 的 CSS Module owner 如下：

- `editors/artifact/artifact-editor-shell.module.css` 持有 Artifact shell、toolbar、selection chrome 与 relations 布局。
- `editors/artifact/canvas/artifact-canvas.module.css` 持有 Canvas viewport、stage、authoring overlay 与节点交互样式。
- `editors/artifact/inspector/artifact-inspector.module.css` 持有 Inspector page、section、field 与领域 Inspector 样式。
- `editors/artifact/dialogs/artifact-dialogs.module.css` 持有 Artifact Import、Reconcile、Publish 与资产选择弹层的领域样式。
- `workspace/project/project-panel.module.css` 持有共享 Project panel、单栏/双区文件树与 Asset Browser 样式。
- `editors/shared/editor-shell.module.css` 持有多个 Editor、Application 与 Workspace 共用的 shell、navigation、status 和基础 control 样式。
- `editors/shared/dialog.module.css` 持有跨领域 dialog frame、action、message 与表单布局。
- `workspace/explorer/artifact-explorer.module.css` 持有目录 Gallery 与 dependency view 样式。
- `workspace/relations/workspace-relations.module.css` 持有全屏关系图、筛选工具栏、关系卡片、预览与连线样式。
- `workspace/directory/directory-shell.module.css` 持有目录视图的局部 shell 布局。

不新增全局 feature selector、无 owner 的 `common.ts/common.css` 或 `!important` 补丁。验证入口由 `testing.md` 持有。
