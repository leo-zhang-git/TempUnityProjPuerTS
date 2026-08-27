# Web 体验与人工操作

本文持有 UI Authoring Web 编辑器的人工作业入口、交互模式、视觉反馈和菜单行为。常规 AI Source 编辑与 Publish 不读取本文；数据语义分别以 `../specification/` 和 `../workflows/` 下的直接 owner 为准。

## 启动与工作区

从 `tools/ui-authoring/` 运行：

```powershell
python .\start_ui_authoring.py --role manual
```

manual 角色复用当前工作区的人工编辑 server，并在可用时打开浏览器。URL 表示当前 workspace location；主题、Auto Save、最近位置、目录排序、Project 目录展开和面板布局属于浏览器本地偏好，不进入 Source。

Chrome 中，`Ctrl + 鼠标滚轮` 沿用浏览器页面缩放，Toolbar、菜单、面板和表单随页面缩放；共享 Canvas viewport 的最外层 stage 保持当前 Canvas 缩放对应的物理尺寸。不按 `Ctrl` 的滚轮继续以指针为中心缩放 Canvas；页面放大后空间不足时使用 Canvas 滚动、显式 Canvas 缩放或“适合画布”，不自动改变 Canvas 缩放。首次打开以当时的 Chrome 页面缩放为尺寸基线，后续缩放校准在同一显示器上跨刷新保留。

应用菜单提供工作区总览。总览以 Source Catalog 展示全部 Artifact、Reference、Prototype 和不可用文档，汇总 Artifact 类型、Reference/Prototype、近七日保存、在线编辑与 Problems 状态；清单支持名称、路径、编辑者、类型、在线状态和排序筛选，并可直接进入可用文档。最近保存时间使用 Source 文件修改时间，不作为历史编辑次数或版本记录。

总览的在线编辑包含当前页面未落盘草稿与局域网 coordination server 返回的活动编辑 lease。只读打开不形成编辑状态；中心服务不可用时保留 Catalog、保存时间、当前页面草稿和 Problems 展示，在线协作状态显示为不可用。

目录 Gallery 的比例控件对 Artifact、Reference 与 Prototype 使用统一显示比例。Reference 和 Prototype 的自动 viewport 按 Resolver 求值后的实际宽高展开，使同宽 Widget 保持同宽，内容高度差异直接反映为预览高度差异。

Project 是 Artifact、Reference、Prototype 和目录页唯一的文件与资源浏览器。Source 根提供目录/最近访问、名称/修改时间排序、递归搜索、文档类型筛选和 list/grid；Assets 根提供 `Assets/Resources/UI` 目录与资源操作。`UIAuthoring/Sources` 根目录和任意 Source 子目录的右键菜单提供“新建目录”，提交 display name 与 description 后创建目录及其 `.ui-directory.json` 元数据，并进入新目录。目录创建只作用于 Source workspace，不在 `Assets/Resources/UI` 中创建资源目录；存在未保存草稿时保持阻断，避免 server 文件操作越过统一保存边界。

Project 的 Source 搜索按本地精确或 substring、中文拼音、语义候选的顺序组合结果。目录 display name、英文名、简介和路径作为一等本地结果即时显示，不把目录命中扩散为其全部文档；文档本地结果保持在语义补充之前。直接与拼音命中高亮原文区间，语义请求期间显示旋转状态，语义补充项以弱化颜色和“相近”标识区分；语义服务不可用时继续提供 key、中文名、简介、路径、类型和拼音搜索。Reference 使用 subject Artifact、Prototype 使用起始 Reference 的 subject Artifact 作为中文检索上下文。list 中有中文名的 Artifact 以中文名为主标题、英文 key 为次标题并显示简介；grid 保持中文主标题与英文次标题的紧凑结构。

Project 提供单栏 UIAuthoring、目录树与内容区左右排布、目录树与内容区上下排布三种状态。单栏只展示 Source：list 递归展示 UIAuthoring 目录与文档，grid 递归展示文档，并继续使用统一的目录/最近访问、搜索、筛选、排序、拖拽、文件命令和当前项定位。左右与上下排布继续提供 UIAuthoring 和 `Assets/Resources/UI` 两个根，分隔比例按 dock 和排布方向分别保存在浏览器；左侧默认上下排布，底部默认左右排布。排布切换不改写当前浏览位置；左侧与底部实例复用同一组件、命令和状态语义，并分别持有排布、浏览目录、展开和滚动状态。

目录 Gallery 复用文档 Workbench 的左侧 Project 与 Hierarchy；Hierarchy 可按统一页签规则显示或关闭，目录没有当前文档时显示空态。Workspace Overview 作为全局 Catalog 使用独立的全屏结构。

顶栏协作入口以弱状态展示当前文档的局域网协作信息：绿色表示没有观察到他人编辑且中心保存 hash 与本地 SVN BASE 一致，黄色表示他人正在编辑或他人保存的新 hash 尚未进入本地 SVN BASE，灰色表示协作服务不可用。提示不阻断编辑、保存、导航或交付。自己的 actor 或规范化昵称产生的编辑与保存不形成警告。

昵称复用 Token Bubble 的本机用户配置；环境变量管理的昵称只读。没有昵称时允许继续使用编辑器，顶栏显示红点，用户可从协作面板或应用菜单稍后设置。

Artifact、Reference 与 Prototype 各自保存当前页面文档。跨文档语义操作会登记 save group；保存组内任一文档时，保存范围自动扩展到该操作影响的 Artifact、Reference、Prototype 与 Node identity metadata，无关 dirty 文档不加入。导航保留当前 tab 的未落盘草稿。server 在第一次写入前校验完整候选与全部 baseline；baseline 使用文档 canonical 语义 revision，JSON 缩进、换行和属性顺序变化不构成外部修改。领域或 baseline 错误使该范围零写入，文件系统中途失败则保留已写路径并停止后续路径。结果弹窗按实际 diagnostic identity 区分成功、失败与未执行文档，并提供对应建议操作。

真实外部修改发生时，“重新读取并重试”强制读取最新磁盘版本，并以 saved baseline、本页草稿和磁盘版本执行内存三方合并。对象中互不重叠的字段修改自动合并；数组或同一字段的双向修改保持阻断并列出冲突位置。合并只推进目标 save group 的 baseline，其他 dirty 文档及其 baseline 保持不变；未解决时当前 tab 草稿继续保留。

Changes 按文档提供 Save 与 Discard。保存进行中不可 Discard；Discard 只把该文档恢复到当前页面持有的 saved baseline，不回滚磁盘文件或 SVN 工作副本。

Artifact 顶栏在保存、撤销和重做之后常驻当前 Source 的 SVN 还原入口。当前 Source 有未落盘草稿或已纳管 `.ui.json` 存在普通 SVN 本地修改时，确认后丢弃当前 Source 草稿并还原到本地 SVN BASE，其他文档草稿保持不变；保存过程、transient edit、未纳管或新增文件、移动/删除和冲突状态保持阻断并显示具体原因。成功后编辑器重新读取 workspace baseline，SVN 还原不进入浏览器 undo/redo。

Auto Save 消费与当前页面手动 Save 相同的文档范围、semantic save group、校验和 baseline；Unity job 只在当前页面前置保存成功后继续。Auto Save 默认关闭，失败时保留未保存草稿和 dirty 状态，同一失败只提示一次且不自动循环重试，新的编辑或显式重试开始下一次保存。

未保存草稿、Undo/Redo 和导航保留只属于当前浏览器 tab 的内存会话；关闭页面或重启 server 后不恢复。局域网 coordination 只展示 presence 与最近保存提示，不合并其他页面草稿，也不参与保存前置条件。

## 编辑上下文

Web Editor 提供三个显示与编辑上下文：

- `预览`：Artifact 页在 Reference Resolver 结果中编辑正式 Source。Artifact 使用同目录同 basename 的默认 Reference；没有默认 Reference 时以 Artifact Unity Baseline 构造临时 Reference。当前 subject 可在组合画布中选择、移动和缩放，Hierarchy、Inspector、Source 命令与 undo/redo 写入真实 `.ui.json`。独立命名 Reference 页属于明确的评审文档，预览保持证据只读并提供 owner Artifact 入口。
- `编辑预览`：直接编辑当前 `.ui-reference.json` 的 Binder values、context、collection、mount 和其他 Reference 数据。Artifact 页编辑其同名 sidecar；缺少 sidecar 时提示当前未配置默认 Reference。
- `Unity 基线`：查看和编辑正式 Source baseline，不应用 Reference evidence。

Fragment 自动使用 `Unity 基线`，其 Preview 与编辑预览模式不可用。`预览`与`Unity 基线`都使用 Source mutation；`编辑预览`只修改 Reference。Reference 覆盖字段在 Preview Inspector 标明覆盖来源，Inspector 继续编辑 Unity baseline，画面保持当前 Reference 最终值。

Canvas 与 Widget 在 `预览`和`Unity 基线`提供 StateRoot 状态总览，`编辑预览`保持 Reference 表单编辑。总览按 Source 顺序逐个展开本地 StateRoot 的全部状态，不生成多层状态的笛卡尔积。`预览`中的每张卡先解析完整默认 Reference，使 values、collections 与 mounts 参与画面；`Unity 基线`只解析 Source。两种模式随后应用使目标节点可见的上游状态和当前卡片状态，卡片状态具有最高优先级。上游状态默认从 StateRoot Active 控制关系推导，同名默认 Reference 可通过 `statePreviewContexts` 显式覆盖。总览标题显示实际采用的上游状态，无效配置进入 Reference/workspace 诊断。

三个编辑上下文共用同一画布视口和缩放状态。画布工具栏提供缩小、缩放比例、放大和适合画布；滚轮以指针位置为中心缩放，中键拖动或 `Space + 左键`拖动画布。切换上下文时保留当前缩放比例，并使用相同的视口操作语义。

共享画布视口在内容宽高小于可视区域时沿两个轴居中显示；缩放后任一方向超出可视区域时从对应边缘提供完整滚动范围。

Artifact 画布提供独立的网格显示与吸附开关；没有已保存偏好时网格关闭、吸附开启，人工切换后的值保存在当前浏览器的 Artifact 布局中，不写入 Source。网格以 8 个画布单位为固定间距；启用吸附时，节点边缘与中心线候选和网格候选统一比较距离，距离相同时优先节点对齐并显示临时 alignment guide。移动手势按住 `Alt` 临时绕过全部吸附。

目录 Gallery、关系图、Prototype 和画布视口使用纯色 workspace 背景；authoring 网格只由 Artifact 画布的显式开关绘制。

Artifact、Reference、Prototype 与目录 Gallery 共用三栏 Workbench 的布局和操作语义：左侧组织文档结构与关系，中间提供画布和统一 viewport controls，右侧承载当前选择与文档级信息。左右面板支持指针拖拽、键盘调整、折叠和浏览器本地尺寸记忆；面板变化只影响工作区布局，不修改 Source、Reference 或 Prototype。左侧 Project、Hierarchy、Relations 与 Prototype Flow 均可手动显示或关闭；普通点击只显示目标面板，`Ctrl/Cmd + 点击`添加或移除第二面板，两个面板上下排列、比例可调，页签与面板焦点分别显示。可见面板、焦点与分隔比例由共享 Workbench 偏好持有，切换 Artifact、Reference、Prototype 或目录时保留目标页面支持的已打开面板；页面不支持的面板只在当前页面隐藏，不因导航改写偏好。Resolver 尚未提供节点或目录没有当前文档时，已打开的 Hierarchy 显示空态。

Artifact 左侧 Relations 将 Variant 继承链单独分为基础 Artifact 与派生 Variant，并将其余关系按 Uses Artifacts、Used by Artifacts、Used by References 与 Used by Prototypes 分组；各分组按对应关系边的最短路径区分 Direct 与 Indirect。关系行展示文档类型、直接关系原因和 use-site，间接关系展示层级与首个途经文档。全屏关系图以 Incoming Indirect、Incoming Direct、Focus、Outgoing Direct 与 Outgoing Indirect 五列展示当前关系上下文，复用 Artifact 与 Reference 的真实预览，只绘制实际直接边，并提供深度、方向和文档类型筛选。全屏关系图是只读 workspace location，可返回当前 Artifact。

Reference 左侧提供 Project、Hierarchy 与 Relations。Hierarchy 展示 Resolver 求值后的 subject、context、Artifact instance、collection 与 mount 层级，并允许选择有效节点；Relations 汇总当前 Reference 的依赖与使用位置。右侧提供 Node、Reference 与 Changes：Node 对照 effective state、Source baseline、Reference provenance 与 owner Artifact，并只为 Reference-owned Binder value 提供编辑入口；Reference 编辑文档自身数据；Changes 汇总 values、context、instance values、collections、mounts、viewport、backdrop、description 与 Resolver 生成来源，支持人工定位和编辑对应 Reference 数据。Source-owned 字段和 Resolver 生成分支保持只读，并提供实际 owner 入口。

Prototype 复用同一 Hierarchy、Relations、Node、Changes、画布 viewport 与面板操作，同时保留 Prototype 领域的 Flow、Interaction 和 Present。Flow 选择 Reference 流程节点，Interaction 编辑交互动作；Present 进入独立全屏运行态，退出后恢复原 Workbench 状态。

画布普通点击选择当前点最上层节点。双击从当前选择沿命中分支进入直接子节点；当前分支在该点结束时，继续选择同一点下方的下一条重叠分支，并跳过当前分支的祖先节点。已选中的本地 Text 在该点仍被命中时，双击进入画布内文本编辑，位于其上方的透明布局节点不阻断该操作。

Project 使用统一拖拽协议。Widget/Fragment 可拖入 Hierarchy 或 Canvas 创建 PrefabRef；Canvas 空白处以 Artifact 根节点为父级，节点落点以该节点为父级并按指针位置设置本地 anchored position。落点命中 PrefabRef 本地视觉范围时，上溯到该 PrefabRef 之外最近的本地父节点；Hierarchy 的显式节点落点保持精确目标语义。Project 中的 Source 文档同时保留目录移动能力，拖入编辑界面时按复制创建处理。图片与字体继续通过同一协议按目标能力执行创建、替换或字段更新。

配置父级 context 的 Widget 在缩放控件左侧提供父级 Canvas 显示开关，默认开启并由浏览器保存偏好。关闭后，`预览`与`编辑预览`只显示 subject Widget，继续应用属于 subject 及其 mount 链的 values、collections 与 mounts，不解析 context-owned 证据，不显示父级 Canvas、父级 placement 或 backdrop；视口使用 Widget `initialSize`。该开关不修改 Source 或 Reference，`Unity 基线`不显示此开关。

默认 sidecar 不作为独立文件显示在 Project 和目录 Gallery；Artifact 的打开、移动、重命名、复制和删除同步处理该 sidecar。命名 Reference 继续作为独立文档显示和操作。

Reference selection 按 resolved subject、context、既有 Artifact instance、collection item 与 mount 保留 placement 与 owner。Source-owned subject、context 和正式嵌套节点按真实 owner 写回；正式 use-site 继续生成所属 root Artifact 的 override。Collection、mount 及其后代属于 Reference 生成分支，只读并在用户尝试修改时说明具体 owner 与可编辑入口。Hierarchy 可见性只影响当前浏览器会话，不修改 Source 或 Reference，也不进入 Publish。

Hierarchy 节点选择遵循树形编辑器语义：普通点击替换选择，`Shift` 点击选择 primary 与目标之间当前可见的连续范围，`Ctrl`/`Cmd` 点击逐个增减节点。Artifact root 独占选择；root 成为 primary 时清除其他节点，普通节点加入选择时移除已选 root。非 root 的祖先与后代仍可共同选择。所有已选行持续显示清晰的 selection 背景与侧边标记，primary 额外显示完整边界和加粗名称；Inactive、Reference 与 hover 状态保留自身语义，但不削弱或覆盖选中反馈。合并展示引用根的蓝色 PrefabRef 行在普通点击时选择引用根，在 `Shift`、`Ctrl` 或 `Cmd` 多选时以本地 use-site 参与选择。本地节点可在当前 Source 内多选；引用节点可在同一 PrefabRef 实例、同一 owner scope 内多选，跨本地与引用或跨实例的组合保持原选区并说明范围约束。同一引用 scope 的 Batch Inspector 将字段修改与允许新增的 Component 写入当前 use-site overrides 和 component additions，并以一次 workspace history mutation 完成批量更新。右键已选节点保留当前多选，右键未选节点改为单选该节点；PrefabRef 行的右键命令以 use-site 为目标。多选 Inspector 可向全部选中节点添加 Component；已有该 Component 的节点保留当前配置，只为缺失节点创建默认配置，任一待添加节点不满足 Component 前置条件时显示阻断原因。

Hierarchy 拖动已选本地节点时，将当前选区收敛为最外层节点并按原 Hierarchy 顺序整体移动；拖入目标内部或放在目标前后均以一次 workspace history mutation 完成，移动后保留原选区。拖动未选节点时只移动该节点。拖放目标位于任一待移动子树中时拒绝操作。

Hierarchy 对被 StateRoot `states` 管理 Active 的节点显示 `SR:A`，悬停提示列出控制 Root；节点行的 Active/Inactive 视觉状态使用当前显示上下文完成 StateRoot、Reference 与预览状态覆盖后的最终求值。单选和多选 Inspector 在 Active 开关附近持续显示受控提示；用户修改 Active 时先展示控制 Root、当前 state 与求值结果，可定位 Root 编辑当前状态，也可确认只修改 Unity baseline。定位 Root 时显示 Hierarchy、展开目标路径、将目标滚动到可见范围并高亮选择。确认 baseline 后 StateRoot 仍按当前状态覆盖最终预览，不把 baseline 修改误表示为当前可见结果。

Hierarchy 中可重命名的本地普通节点支持双击名称进入行内编辑，实时展示 workspace identity planner 计算的最终 Node ID；`Enter` 提交，`Escape` 取消，非法名称保持编辑并显示校验状态。行内入口保留节点当前 auto/manual ID mode；`F2` 与菜单继续打开完整 Rename 对话框。

复制与剪切消费当前本地选区并收敛到最外层节点，保持 Hierarchy 顺序；同组选区内部的节点引用与 Binding 一起复制并在粘贴时统一重映射，选区外部引用阻断操作。剪切从源 owner 同时移除对应节点和 Binding，并把选择收敛到 Hierarchy 顺序中第一个最外层节点的仍存父节点。粘贴始终以一个已选本地父节点为目标，一次插入全部 clipboard roots 并选中这些新节点。

Artifact 更多菜单为当前本地普通节点分别提供“抽取 Widget”和“抽取 Fragment”。两个入口共用 Artifact identity 与 Source path 对话框，按目标类型生成默认名称，并在一个 workspace history mutation 中登记父 Source 与新 Artifact；一次 Undo/Redo 和 semantic save group 覆盖两份文档。Fragment owner 只提供“抽取 Fragment”；Fragment 抽取保持父 Binder 字段并通过新 use-site 改写 `instancePath`，Widget 抽取建立新的 Binder owner。

Project 与 Hierarchy 持续显示各自的当前选择。Project 只将真实浏览目录显示为目录选择，当前打开文档在内容区使用独立 current 状态；单栏 Project 打开文档时只突出当前文档，进入目录页后才突出当前目录。进入 Project 时默认展示当前文档所在目录，浏览其他目录不改变当前文档。搜索或类型筛选清除后，当前选择重新进入滚动可见范围。当前选择位于滚动区上方或下方时，边缘箭头标明方向并可点击定位；`F` 只由当前聚焦的左侧面板处理，必要时回到目录视图并清除阻挡定位的筛选。文本输入、select 和 contenteditable 获得焦点时，`F` 保持输入语义。多选 Hierarchy 以 primary selection 作为定位目标。

Binder 改名时，编辑器列出受影响的 Reference/Prototype 路径。用户可显式批量更新这些文档，或只提交 Source 改名并让相关 Preview 保留可修复诊断。删除 Reference 时，确认流程先展示 Collection、mount 和 Prototype 的反向引用位置；仍被使用的 Reference 保持不变。

删除本地 Source 节点时，编辑器以完整 Artifact、Reference 与 Prototype workspace 生成影响计划。无关联影响的节点使用一次确认；存在 Binder、Variant delta、PrefabRef use-site delta、Reference Values、Collection、mount 或 Prototype interaction 时，确认框展示对应文档与字段位置，并通过“继续”和“删除并清理”完成二次确认。可确定失效的数据自动删除；nullable 引用清为 `null`，optional 引用删除字段，required 结构引用写入该 Component 的空值表示并标记为“置空并待修复”。外部 PrefabRef 和继承关系保持不变，其 Artifact 进入重新 Publish 提示。

确认删除在一个 workspace history mutation 中更新受影响的 Artifact、Reference 与 Prototype 草稿，一次 Undo/Redo 恢复或重放全部关联文档。required 引用待修复时允许保留内存草稿，引用方 Hierarchy 显示红色错误；该 save group、Reconcile 与 Publish 保持阻断，直到 readiness 恢复。只有 Artifact root、继承节点或无法形成结构有效候选的错误阻断删除命令。人工修复、Publish、generated binding 更新、业务 TS 修改和 Git/SVN 交付步骤由 `../workflows/node-deletion.md` 持有。

默认 sidecar 的删除等同于移除 Artifact 默认 Preview；当它同时被命名场景、Collection、mount 或 Prototype 显式使用时，按 Reference 反向引用规则处理。命名 Reference 保持独立文件操作入口。

## Inspector 与反馈

用户可见文案的语言、保留英文范围、术语与状态用词由 [`terminology.md`](terminology.md) 持有；本文只规定这些文案的呈现位置和反馈行为。

有限候选字段使用共享主题 Select 或 menu 展示完整候选；Select 的收起态与弹层统一使用当前主题 token，支持选中、悬停、禁用、长列表滚动、视口上下翻转和键盘导航。文本输入只用于开放文本、identifier 或明确的搜索。用户触发的命令因 owner、readonly、前置条件或校验约束无法完成时，使用阻断 modal 说明原因；成功、进度和不阻断后续操作的信息进入 status notice。保存失败和部分成功使用统一 `alertdialog`，Problems 保留路径、字段位置和领域错误码。Diagnostics 统一持有 Problems、Runtime errors、复制、重新加载和诊断下载。

Runtime errors 的通知状态按最新未读错误计时：五分钟内为红色，五至十分钟为黄色，十分钟后使用中性弱提示。进入 Runtime errors 页签即确认当前已有记录，后续新错误重新进入红色提示。Runtime errors 提供清理入口；清理立即移除当前页面历史，并在 server 可用时清理同一时间边界内的 server 错误记录，不删除运行日志。Problems 持续反映当前 workspace 状态，保持阻断颜色且不参与 Runtime errors 的确认、计时和清理。

输入型操作的主命令以可解释校验结果驱动。当前输入不满足创建、移动、导入或拆分条件时，操作区持续显示具体、可定位、可修正的原因，并通过 `aria-describedby`、`aria-invalid` 或等价语义关联输入与反馈；disabled 状态和 tooltip 作为辅助状态表达。输入变化实时刷新前置校验，提交后才产生的领域错误保留在当前 dialog 或操作区，供用户修正后继续提交。

Inspector 数值输入接受数字以及包含 `+`、`-`、`*`、`/`、括号和空格的算式；`Enter` 或离开输入框时按标准运算优先级求值并填入结果。空值保留为未填写状态，非法、非有限或超出领域字段真实取值范围的结果保持待修正且不写入。RectTransform `sizeDelta` 创建允许 `0`，Artifact 初始设计尺寸保持为正整数；输入解析、按钮状态与实际 mutation 使用同一校验规则。

颜色字段以无 `#` 的 `RRGGBB` 和 `0-1` Alpha 两个输入显示，Source 继续保存 canonical `#RRGGBBAA`。颜色弹窗以 `0-1` 分别编辑 R、G、B、A；Alpha 滑轨和输入只修改 Alpha 通道并保持 RGB 字节不变，滑轨渐变使用当前完整 RGB。

画布移动节点时按住 `Shift` 将位移约束到指针累计位移的主轴；单选和多选使用相同规则。多选移动先收敛到最外层变换参与者，并只使用所有参与者共同可移动的轴；任一轴被布局或 Artifact root 驱动时，该轴上的所有节点都保持不变，没有共同可移动轴时整体阻止移动并显示驱动来源。点击选择和移动资格独立处理，不可移动节点仍可正常选择或取消选择。多选整体 bounds 提供八个缩放手柄，只变换最外层参与节点，并按整体 bounds 的仿射变化更新各节点位置与尺寸；任一参与节点的 position 或 size 在某轴被驱动时，禁用依赖该轴的手柄并显示驱动来源。拖动单选或多选 Rect Transform 缩放手柄时，`Shift` 保持初始宽高比，`Alt` 围绕当前视觉中心缩放，两个修饰键可组合使用；Unity 基线和组合预览使用同一缩放语义。直接修改 Rect Transform Pivot 时同步补偿 anchored position，使节点的画布矩形保持不变。

PrefabRef 实例根或任意内部继承节点的引用上下文头部提供 `Overrides (n)` 下拉入口。下拉框按 Unity 节点层级展示包含差量的对象及其祖先，每条 property override 和 component addition 使用单行摘要；颜色属性在字段名后显示目标色块和 Hex 值，新增组件只显示组件名。对象分支、单项和全局复选框支持批量选择，并提供逐项、所选及全部还原/应用；全局复选框同步表达全选、半选和未选状态。同一实例内切换选择继续使用该实例的统一差量总览。打开、浏览、折叠和勾选 Overrides 只读取当前差量，不执行 workspace 候选校验。嵌套 `instancePath` 写入最终拥有目标节点的 Artifact。跨 Artifact Apply 在一个 workspace 事务中更新目标 Source 与 use-site 差量，完整 workspace 校验通过后提交，失败时保持原状态并显示原因，并可用一次 undo 整体撤销。Apply/Revert 的差量范围由 `PrefabRef.overrides` 与 `PrefabRef.componentAdditions` 构成。

Variant 选中本地根节点时，Inspector 上下文头部提供基础 Artifact 入口；跳转后选中基础 Artifact 自己的 root identity。普通继承节点继续由当前 Variant Inspector 编辑差量，不重复显示该入口。

Artifact 选中本地根节点时，Inspector 提供当前文档的中文名与描述。离开输入框或确认输入后写入 workspace history，空白值移除对应字段；Undo、Redo、dirty 与 Auto Save 使用普通 Source mutation 语义。Variant 编辑自己的 metadata，不修改或继承 base metadata。

新建 PrefabRef 使用可搜索 Artifact 选择器。候选只包含当前 Source 可引用的 Widget/Fragment；用户输入名称关键字后显示匹配结果，选择前保持创建阻断，并支持方向键与 Enter 完成选择。

Widget 与 Fragment 根节点在独立 Artifact 区显示和编辑“本地初始尺寸”，该控件写入 `initialSize`；Variant 显示 immediate base 的 effective 继承值，本层修改后标记为覆写，并可还原为继承。Rect Transform 区按 anchors 拓扑显示并编辑根节点 authored Unity baseline，固定轴使用 Pos/Width 或 Pos/Height，stretch 轴使用 Left/Right 或 Top/Bottom。画布根边界与缩放手柄编辑 `initialSize`，拖拽期间根节点边界、固定尺寸子节点、Inspector 和 Local viewport 使用同一个临时值，取消拖拽时共同回滚；该操作不缩放子节点，也不创建 `RectTransform.sizeDelta` 覆写。根 RectTransform baseline 不参与独立本地 viewport 求值。

Inspector 保持高密度工具界面：常规控件高 `18px`、字段行高 `19px`、组件标题高 `22px`，垂直 padding 为 `1-3px`。字段名、值、来源和行内命令优先单行扫描，超长内容截断并提供 tooltip；multiline、集合、State/Map 和诊断按内容展开。这些数值用于实现取向与人工浏览器验收，不建立自动像素门禁。

## Publish 与回写

Web Publish 范围：

| 操作 | 保存与选择范围 |
| --- | --- |
| 发布当前文件 | 先保存当前页面文档及其 semantic save group，再只声明当前 Artifact |
| 发布当前文件及依赖 | 先保存当前页面文档及其 semantic save group，再包含传递依赖闭包 |
| 发布改动及依赖 | 先保存当前页面文档及其 semantic save group，再聚合 SVN 中新增、替换、修改或未纳管的 Source 与依赖；删除项不发布 |
| 发布全部 | 先保存当前页面文档及其 semantic save group，再发布已有 DeliveryState 的 Artifact |

“发布改动及依赖”遇到 conflict、missing 或 obstructed Source 时阻断；没有目标时返回成功 no-op。Web Publish 不执行全量 client typecheck；程序 TypeScript 准入由提交流程持有。“自动应用程序脚手架”默认关闭，每次新 Publish 后恢复默认，同一次 blocker 确认和失败重试沿用发起时的选择。该确认不绕过 Prefab Stage、identity、未知 Component、Projection、Binding 或 program contract blocker。

顶栏回写入口处理当前文件；Publish 下拉菜单提供当前文件、当前文件及依赖和全部范围。回写全部检查完整 Source workspace，并只读取已有正式 Prefab 的 Artifact；尚未首次发布的 Source 草稿不阻断整批回写。Publish、回写和 Prefab 导入弹窗使用统一任务进度：列出当前任务的检查/执行步骤、每步完成数与总数，并在批量 Unity 阶段持续显示当前 Artifact。总进度按已完成工作项汇总；不能量化的等待阶段使用不确定状态，失败时停在实际失败步骤。回写结果继续按 Artifact 展示一致性、patch、blocker 和 Unity-only Component。

Apply 将全部候选一次应用到 workspace 草稿。`review` patch 需要明确确认；任一 Artifact 有 blocker 时不部分应用；执行期间目标 Source 变化时拒绝覆盖。应用后的持久化仍使用统一保存入口。
