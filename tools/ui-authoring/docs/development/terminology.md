# 用户文案与术语

本文持有 Legma（UI Authoring）Web、`/guide` 和工具自有用户提示的语言与术语口径。界面文案按用户当前要完成的操作表达，代码结构、CLI contract 和领域实现继续使用各自的稳定英文标识。

## 通用规则

- 用户可见的命令、状态、空态、帮助、输入校验和工具自有进度提示使用简体中文。
- 同一英文词在不同职责中表达不同含义时，按使用位置写出具体对象或动作，不强制逐词对应。
- 已有稳定对象名优先于泛化译词；例如分别使用 `Node ID`、`Artifact Key` 和 `Widget Type`，不额外创造统一的 identity 字段名。
- 界面中的 `ID` 使用大写。schema 字段、代码标识、CLI 参数和结构化结果字段保持原始大小写。
- 原始 log、stack、diagnostic code/category/message、结构化 job message 及外部工具返回文本按来源保持英文。Unity Inspector 原生 Component 名、字段名和枚举值保持英文。
- Unity Inspector 以外由 UI Authoring 定义的说明和错误提示仍遵循本文的中文口径。

## 保留英文

| 类别 | 显示口径 |
| --- | --- |
| 领域对象 | `Canvas`、`Widget`、`Fragment`、`Reference`、`Source`、`Artifact`、`Prototype`、`Prefab`、`PrefabRef`、`Component`、`Binder`、`Binding`、`Variant`、`GameObject`、`StateRoot`、`Layer` |
| 工作界面 | `Project`、`Hierarchy`、`Inspector` |
| 稳定字段 | `Node ID`、`Artifact Key`、`Reference Key`、`Prototype Key`、`Widget Type` |
| 实现专名 | `Projection`、`DeliveryState`、`patch`、`Diff` |
| Unity 与程序类型 | 精确指代类型时保留 `RectTransform`、`Image`、`Text`、`TMP Text`、`Sprite`、`TMP Font`、`Animation Clip`、`Animator`、`Graphic`、`ButtonEx` 等原名 |

`DeliveryState` 首次需要解释时写作“DeliveryState（发布 ID 映射）”。`Resolver` 作为引擎名时保留英文。

## 固定显示

| 原词 | 显示口径 | 示例 |
| --- | --- | --- |
| Preview | 预览 | 编辑预览、预览不可用 |
| Diagnostics | 诊断 | 打开诊断、下载诊断 |
| Collection | 集合 | Reference 集合 |
| Mount | 挂载 | 挂载位置 |
| Subject | 主体 | Reference 主体 |
| Context | 上下文 | 父级上下文 |
| Flow | 流程 | Prototype 流程 |
| Interaction | 交互 | 编辑交互 |
| Relations | 关系 | 查看关系、Reference 依赖关系 |
| Present | 演示 | 开始演示、退出演示、全屏演示 |
| Auto Save | 自动保存 | 开启自动保存 |
| Values | 值 | 主体值、上下文值、实例值 |
| State Preview Context | 状态预览上下文 | 查看状态预览上下文、2 项上游状态覆写 |
| preset | 预设 | 集合预设、挂载预设 |
| Gallery | 目录预览 | 在目录预览中查看 Reference |
| Direct / Indirect | 直接 / 间接 | 直接依赖、间接关系 |
| Incoming / Outgoing | 传入 / 传出 | 传入关系、传出关系 |
| Navigate / Back / SetValue / Tap | 跳转 / 返回 / 设置值 / 点击 | 添加跳转操作、点击 ButtonEx |
| use-site | 使用位置 | PrefabRef 使用位置 |
| baseline | 基线 | Source 基线、Unity 基线 |
| provenance | 求值轨迹 | 查看 Reference 求值轨迹 |
| layer / Layer | `Layer` | 当前差量的 Layer、生效 Mask Layer 数量 |
| blocker | 阻断项 | 处理 3 个阻断项 |
| blocked | 已阻断、被阻断 | 发布被阻断 |
| readiness | Source 就绪 | 检查 Source 就绪状态 |
| Reconcile | 回写 | 回写当前文件、回写全部 |
| observation | Prefab 观测结果 | 过程写“Prefab 观测”，进度写“读取 Prefab” |
| Prefab Import | Prefab 导入 | 菜单和标题写“导入现有 Prefab”，预览操作写“预览导入”，最终落盘操作写“写入 Source” |
| Capture | 截图 | 名称写“截图”，命令写“截取 PNG”，过程写“正在截图”，产物写“PNG 截图” |
| Verify | 离线验证 | 执行离线验证、生成离线验证证据 |
| Publish | 发布 | 发布当前文件、正在发布 |
| Problems | 问题 | 工作区暂无问题、问题文档 |
| Runtime errors | 运行时错误 | 暂无运行时错误、清理运行时错误 |
| scaffold | 补齐程序接入 | 发布时自动补齐程序接入、补齐程序接入并发布 |
| scaffold plan | 程序接入清单 | 核对程序接入清单 |

`Reconcile`、`Import`、`Capture`、`Verify`、`Validate`、`Inspect`、`Render`、`Sync`、`Refresh` 和 `Reload` 的代码标识、API、CLI、结构化字段与 log 保留原值。`patch` 与 `Projection` 在用户文案中也保留英文。

## 按使用位置表达

| 原词 | 使用规则 | 示例 |
| --- | --- | --- |
| owner | 界面按句意写“所属”或“定义该内容的”；架构与代码使用 `owner` | “返回所属 Artifact”“由定义该内容的 Source 修改” |
| sidecar | 界面写具体对象“默认 Reference”；技术说明描述同目录同名的配套关系 | “当前未配置默认 Reference” |
| override | 名词写“覆写”，结果动词写“覆盖”；覆写与新增 Component 的合集写“实例差量” | “字段覆写”“该值覆盖 Source 基线”“还原实例差量” |
| effective | 写“生效”并补充对象 | “生效 Widget Type”“生效值” |
| Resolver / resolved | Reference 使用“求值 / 求值结果”；Source 继承使用“合并后的 Source”；路径与依赖使用“解析” | “Reference 求值结果”“合并后的 Source”“无法解析路径” |
| evidence | 构造预览画面的内容写“Reference 数据”；Capture/Verify 产物写“验证证据” | “Reference 数据不进入 Prefab”“生成验证证据” |
| program contract | 发布阶段写“程序接入检查”；接口语义写“程序接口约定” | “正在执行 Client UI 类型检查”“字段名属于程序接口约定” |
| audit | 按检查对象写具体检查 | “Prefab 检查”“能力支持检查”“写入后检查” |
| identity | 优先使用真实字段名；泛指时使用 `ID` | “Node ID 映射”“ID 不一致”“ID 无法确定” |
| Catalog | 按对象写“Source 索引”或“资源索引”；描述流程时直接写依赖关系或资源检查 | “Source 索引中找不到 Artifact”“检查 Source、依赖关系和资源” |
| gate | 直接写具体检查 | “类型检查”“静态发布检查”“工作区快速检查”“自动像素检查” |
| metadata | 直接写具体数据 | “Node ID 映射已保存”“移除目录信息”“写入 DeliveryState”“Component 字段定义” |
| Formal / Formal Prefab | 用户文案直接使用 `Prefab`；无 Source 的既有对象写“无 Source 的现有 Prefab” | “Prefab 一致性”“从 Prefab 回写当前 Source”“写入 Prefab” |
| workspace | 使用“工作区”，范围明确时直接写具体集合 | “工作区总览”“工作区基线”“读取全部 Source” |
| authoring | 产品品牌使用 `Legma`；能力、Source、流程和技术语义使用 `UI Authoring`；制作行为写“编辑”或“制作”；仅参与工具流程的文档写“仅供制作” | “打开 Legma 使用指引”“UI Authoring Source”“完成一次编辑”“仅供制作，不参与 Unity Projection” |
| local | 当前 Artifact 直接持有的节点写“本地节点”，Artifact 自身求值尺寸写“本地尺寸”，浏览器保存的偏好写“浏览器本地”，版本控制差异写“本地改动” | “添加本地节点”“Widget 本地尺寸”“保存在浏览器本地”“SVN 本地改动” |
| base / inherited | Variant 的继承来源写“基础 Artifact”；继承得到的结构和值写“继承结构”“继承值”；`baseline` 仍按“基线”表达 | “打开基础 Artifact”“继承字段只读”“恢复 Source 基线” |
| read-only / readonly | 使用“只读”并尽量说明由谁修改或为什么不可修改 | “继承结构只读，请前往所属 Widget 修改” |
| disabled | 控件当前不能操作时直接说明原因或写“不可用”；只有开关型功能状态才写“已禁用” | “请先处理阻断项”“当前没有可用目标”“自动保存已禁用” |
| locked | 结构约束写“结构已锁定”；输入或文件被其他流程占用时直接说明占用原因 | “Variant 结构已锁定”“Source 正在写入” |
| driven | 按控制来源写“由……控制”，不单独显示泛化的“驱动”状态 | “X 位置由 Horizontal Layout Group 控制”“Canvas 根节点尺寸由预览尺寸控制” |
| Active / Inactive | Unity 与 StateRoot 的精确字段保留 `Active`；普通状态说明写“已激活”或“未激活” | “设置 Active”“Node 当前未激活” |
| draft | 浏览器内状态写“未保存改动”；已保存但未首次发布的对象写“未发布 Source”；输入状态直接写具体对象 | “存在未保存改动”“将 patch 应用为未保存改动”“没有 DeliveryState 的 Source 保持未发布状态” |
| dirty | 浏览器文档状态写“未保存”；Git/SVN 状态使用“本地改动” | “有未保存改动的文档”“未保存状态”“未保存标记” |
| working copy / working tree | 按 VCS 写“SVN 工作区”或“Git 工作区”；同时涉及两侧时写“Git/SVN 工作区”；上下文已明确为版本控制时可写“本地工作区” | “发布 SVN 工作区中的本地改动”“核对 Git/SVN 工作区状态” |
| preflight | 按实际动作写“发布前检查”“准备 Client 数据”“基线检查”或“写入前检查” | “正在准备 Client 生成数据”“执行写入前检查” |
| transaction | 按实际行为写“一次编辑”“批量修改”“一组跨文档改动”“多文件写入”或“一次发布流程” | “撤销最近一次编辑”“按依赖顺序执行一次全量发布” |
| mutation | 按对象写“修改 Source”“修改字段”“修改结构”或“一次工作区编辑记录”；结果写“改动” | “输入校验与实际修改使用同一规则”“两份文档登记为同一次编辑记录” |
| commit | 界面输入写“确认”，连续手势写“完成编辑”，未保存状态写“应用修改”或“记录修改”，文件写入写“保存”，Publish 写“发布”；“提交”只用于 Git/SVN | “Enter 确认”“两份 Source 按顺序保存”“提交 Git/SVN 改动” |
| Apply | 回写 patch 写“应用改动”，结果写“应用为未保存改动”，实例差量写“应用到被引用 Artifact”，值层级写“叠加”，设置写“生效”，发布计划写“写入 Prefab” | “应用 3 项改动”“将所选覆写应用到被引用 Artifact” |
| Revert | PrefabRef 实例差量中的属性写“还原”，新增 Component 写“移除”，批量操作写“还原所选”或“全部还原”；SVN 操作写“还原 SVN 本地改动”或“还原到 SVN BASE”；未保存改动写“放弃”；默认值和基线写“恢复” | “还原此属性”“移除此新增 Component”“放弃未保存改动”“恢复 Unity 基线” |
| Validate / Validation | 主口径使用“校验”并补充对象；输入位置直接说明具体问题 | “Source 就绪校验”“结构校验”“工作区校验”“宽度必须是整数” |
| Inspect / Inspection | 操作按目标写“查看局部结构”或“查看节点字段”；普通结果写“结构详情”，离线验证产物写“结构快照” | “查看当前 Node 的局部结构”“生成结构快照” |
| Render / Rendering | 呈现画面的过程写“渲染”；CLI 与离线验证生成的结构、布局数据写“布局快照” | “渲染完整场景”“生成布局快照” |
| Project（动词） | 生成 `Projection` | “生成当前 Artifact 的 Projection” |
| Sync | 不建立用户概念；Unity `sync` 生成 `Prefab Diff`，协作状态直接说明保存是否已进入本地 `SVN BASE` | “检查当前 Projection 与 Prefab 的 Diff”“无差异”“有差异”“尚未进入本地 SVN BASE” |
| Refresh / Reload | 重新获取局部数据写“刷新”；重新执行规则写“重新校验”；整页或 bootstrap 重载写“重新加载工作区” | “刷新资源”“刷新协作状态”“重新校验输入”“重新加载工作区” |
| Changes | 使用“改动”并按状态补充对象；不使用“更改”作为同义显示 | “查看改动”“未保存改动”“Reference 改动”“SVN 本地改动” |
| Diff | 保留英文，只用于两个明确状态之间计算出的对比结果 | “查看 Diff”“Source Diff”“Prefab Diff” |
| Scope | 按对象写“发布范围”“回写范围”“保存范围”或“取值范围”；Reference 直接说明主体值、上下文值或 Reference 数据 | “选择发布范围”“编辑主体值”“编辑完整的 Reference 数据” |
| Status / State | 按对象使用“状态”；完整专名 `StateRoot` 与 `DeliveryState` 保留英文 | “状态栏”“当前状态”“协作状态”“StateRoot 状态总览” |
| Mode / View | `Mode` 仅用于会改变求值或编辑行为的互斥“模式”；`View` 仅用于呈现方式的“视图”；选项含义已明确时直接显示选项名 | “预览模式”“切换求值模式”“目录视图”“在编辑视图中显示”“列表 / 网格”“目录 / 最近访问” |
| Viewport | Reference 与 Canvas 的求值画面尺寸写“预览尺寸”；承载缩放和平移画面的编辑器区域写“Canvas 可视区域”；Unity Inspector 原生字段保留 `Viewport` 与 `Text Viewport` | “选择 Canvas 预览尺寸”“预览尺寸：自动”“Canvas 可视区域”“Widget/Fragment 使用本地尺寸” |
| Error / Warning | 独立的严重级别标签保留英文；完整界面名称和中文句子按语法使用“错误” | “Error”“Warning”“运行时错误”“查看错误详情” |
| Failure / failed | 失败 | “保存失败”“发布失败”“回写失败” |
| Conflict / Stale | 互斥或需要合并时写“冲突”；保存基线已变化时直接说明文件已被其他程序或协作者修改；重复标识或路径写“已存在” | “SVN 冲突”“字段冲突”“文件已被其他程序或协作者修改”“文档 Key 已存在” |
| Missing / Not found / Unavailable / Unsupported | 必需依赖不存在写“缺少”或“缺失”；查找失败写“找不到”；对象存在但当前不能使用写“不可用”；能力边界写“不支持”；可选值为空写“未配置”或“未设置” | “Prefab 缺失”“找不到请求打开的文档”“协作服务不可用”“Variant 不支持结构修改”“未配置默认 Reference” |
| queued / running | job 等待执行时写“等待执行”；执行中按对象写具体动作 | “正在发布”“正在读取 Prefab”“正在保存 Source” |
| succeeded | 不直接显示“成功”，按业务结果显示 | “已发布”“无需发布”“发布被阻断”“回写预览已就绪” |
| passed / failed / skipped | 校验通过写“校验通过”；失败补充具体对象；前置阶段失败导致的 `skipped` 写“未执行” | “Source 就绪校验通过”“发布失败”“后续阶段未执行” |

UI Authoring 管理的 Prefab 由 Source 相对路径唯一派生：`<relativeDirectory>/<ArtifactKey>.ui.json` 对应 `Assets/Resources/UI/Prefab/<relativeDirectory>/<ArtifactKey>.prefab`，只由发布写入。Artifact type 不参与目录结构；Preview 与 Projection 不产生另一类 Prefab，因此用户文案不建立 `Formal Prefab` 概念。内部 `formal` 标识可继续区分 Projection 期望与 Prefab 实际观测结果。

`Undo / Redo` 固定显示为“撤销 / 重做”。代码标识、API、CLI 和 log 中的 `revert` 保留英文。

## 发布结果

| 结构化结果 | 用户显示 | 说明文案 |
| --- | --- | --- |
| `delivery: "delivered"` 且 `noOp` 不为 `true` | 已发布 | 可补充已发布的 Artifact 或 Prefab 数量 |
| `delivery: "delivered"` 且 `noOp: true` | 无需发布 | 按原因说明“没有检测到需要发布的 Source”或“Source 与 Prefab 已一致” |
| `delivery: "blocked"` | 发布被阻断 | 展示具体阻断项 |
| job `status: "failed"` | 发布失败 | 展示原始错误或可执行的修复提示 |
| 发布尚在执行 | 正在发布 | 展示当前具体阶段 |

## 维护规则

- 新增领域词进入用户文案前，先核对实际对象、操作边界和当前使用位置，再确认显示口径。
- 术语确认时提供当前真实文案例子；确认后的文档只保留目标口径和示例。
- 新口径涉及状态对偶、阶段名称或配对结果时，同步覆盖完整状态集合。
- 本文记录用户显示口径；schema、代码、CLI 和 log 的稳定标识不随显示翻译改名。
