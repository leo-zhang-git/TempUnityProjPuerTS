# Component Inspector 审计台账

## 目标

本台账记录 UI Authoring Component 的实际使用频率、Inspector 覆盖情况和优化判断。Unity Inspector 用于校验字段语义、顺序和条件分支；当前项目 prefab 与 Source 决定优先级，旧项目 prefab 只提供补充信号。UI Authoring 保持高密度工具界面，不以像素级复刻 Unity Inspector 为目标。

Component 字段、默认值和 Inspector metadata 的权威来源仍是 `src/components/`、Component Registry 与 `npm.cmd run cli -- schema --component <type>`。本文件中的字段和数量均为带日期的审计快照，不替代 Schema。

## 判断规则

- 当前项目证据包括 `My project/UIAuthoring/Sources/` 的显式字段与 use-site override，以及 `My project/Assets/Resources/UI/Prefab/` 的 Unity 序列化结果。
- 旧项目证据来自 `.agent-link/program` 对应工作区的 `UnityProject/Assets/UI/Prefab/`，只用于识别成熟项目中可能再次出现的能力。
- 高频字段通常满足当前 Source 显式配置或 prefab 非默认实例不少于 10%，或在不少于 20 个实例中出现。中低频但承载关键条件分支的字段单独保留。
- 每项结论使用 `保持现状`、`局部优化`、`需要重构`、`有意区别于 Unity` 或 `Unity 不适用`。尚未完成证据核对的项目保持 `待分析`。
- 每项至少检查默认、代表配置、条件分支和 use-site override；不存在对应状态时在详细记录中说明。

## 总账

| # | Component | 分类 | 高频或关键字段 | Inspector 状态 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 1 | Text | 渲染与裁剪 | text、fontSize、color、alignment、overflow、wordWrapping、bold | 已分析并实施，4 个 After 状态 | 局部优化已实施 |
| 2 | Image | 渲染与裁剪 | sprite、color、raycastTarget、imageType；Filled 条件字段 | 已分析，5 个截图状态 | 保持现状 |
| 3 | RoundedRect | 渲染与裁剪 | color、cornerRadii、raycastTarget | 已分析，3 个截图状态 | 保持现状 |
| 4 | Mask | 渲染与裁剪 | showMaskGraphic | 已分析，2 个截图状态 | 保持现状 |
| 5 | RectMask2D | 渲染与裁剪 | 组件本身；padding、softness 为成熟项目关键字段 | 已分析，3 个截图状态 | 保持现状 |
| 6 | ShapeSoftMask | 渲染与裁剪 | shape、radialSoftness | 已分析，4 个截图状态 | 保持现状 |
| 7 | ButtonEx | 交互 | targetGraphic、interactable、transition；Press Feedback 条件字段 | 已分析，3 个截图状态 | 保持现状 |
| 8 | Toggle | 交互 | targetGraphic、graphic、isOn、interactable、transition | 已分析，2 个截图状态 | 保持现状 |
| 9 | Slider | 交互 | 引用、direction、数值范围、wholeNumbers、value | 已分析，2 个截图状态 | 保持现状 |
| 10 | Scrollbar | 交互 | 引用、direction、value、size、numberOfSteps | 已分析，2 个截图状态 | 保持现状 |
| 11 | ScrollRect | 交互 | content、viewport、滚动轴、movementType、scrollbar | 已分析，3 个截图状态 | 保持现状 |
| 12 | TMPInputField | 交互 | 结构引用、contentType、lineType、characterLimit | 已分析，3 个截图状态 | 保持现状 |
| 13 | TMPDropdown | 交互 | 结构引用、value、optionsText、interactable、transition | 已分析，2 个截图状态 | 保持现状 |
| 14 | HorizontalLayoutGroup | 布局 | padding、spacing、子节点尺寸控制与扩展 | 已分析，2 个截图状态 | 保持现状 |
| 15 | VerticalLayoutGroup | 布局 | padding、spacing、子节点尺寸控制与扩展 | 已分析，2 个截图状态 | 保持现状 |
| 16 | GridLayoutGroup | 布局 | cellSize、spacing、constraint、constraintCount | 已分析，2 个截图状态 | 保持现状 |
| 17 | AutoLayoutGroup | 布局 | mode；线性与网格条件字段 | 已分析并实施，3 个 After 状态 | 局部优化已实施 |
| 18 | ContentSizeFitter | 布局 | horizontalFit、verticalFit | 已分析，2 个截图状态 | 保持现状 |
| 19 | LayoutElement | 布局 | ignoreLayout、preferred size、flexible size | 已分析，3 个截图状态 | 保持现状 |
| 20 | AspectRatioFitter | 布局 | aspectMode、aspectRatio | 已分析，2 个截图状态 | 有意区别于 Unity |
| 21 | LayoutSettings | 布局 | spacing、padding | 已分析，2 个截图状态 | 保持现状 |
| 22 | Crosshair | 项目自定义 | scatterScale、edges、punch | 已分析，2 个截图状态 | 保持现状 |
| 23 | VirtualJoystick | 项目自定义 | area、background、knob、active、staticBackground、keepKnobVisibleWhenIdle、offset | 已分析并实施，2 个 After 状态 | 局部优化已实施 |
| 24 | StateRoot | 项目自定义 | currentState、states、elements、interactable | 已分析并实施，3 个截图状态 | 局部优化已实施 |
| 25 | StateToggle | 项目自定义 | stateRoots、multipleSelect、allowSwitchOff、selectedIndices | 已分析，2 个截图状态 | 保持现状 |
| 26 | CustomDropDown | 项目自定义 | Current、Content Artifact、View、Size、Template | 已分析并迁移，2 个截图状态 | 当前 Prefab 合同 |
| 27 | CustomDropDownOption | 项目自定义 | Button、Content Host、Selected Visual | 已分析并迁移，1 个截图状态 | 当前 Prefab 合同 |
| 28 | ScrollRectEx | 项目自定义 | ScrollRect 字段、autoClamped、empty state、templates | 已分析，2 个截图状态 | 保持现状 |
| 29 | PrefabRef | 资源与结构 | artifactKey；override 与 component addition 由目标 Component 呈现 | 已分析，2 个截图状态 | Unity 不适用 |
| 30 | Animation | 资源与结构 | clips、defaultClip、播放与更新模式 | 已分析，2 个截图状态 | 保持现状 |
| 31 | Animator | 资源与结构 | controller、updateMode、cullingMode、状态保持 | 已分析，2 个截图状态 | 有意区别于 Unity |

## Text

审计日期：2026-07-31。

当前项目 149 个 UI prefab 中包含 429 个 `TextMeshProUGUI`。旧项目 1713 个 UI prefab 中包含 6890 个 TMP 文本，用于补充成熟项目中的低频能力信号。

| 字段或字段组 | 当前项目证据 | 旧项目信号 | Inspector 判断 |
| --- | --- | --- | --- |
| Text、Font Size、Color、Alignment | 常规文本的核心差量字段 | 持续高频 | 保持常驻，现有控件完整 |
| Overflow、Auto Wrap | 46 个非 Overflow；39 个启用 wrapping | 持续使用 | 保持现有条件与枚举 |
| Material | 1 个独立 outline material | 多 material，但来源复杂 | 当前 `normal / outline` 受限枚举准确覆盖项目能力 |
| Line Spacing、Character Spacing、Margin | 当前均为默认值 | 分别有 514、245、216 个非默认实例 | 保留字段，不因当前低频删除 |
| Font Style、Font Weight | `HitNumberWidget` 1 个 Bold/700；Source 无法表达 | 99 个非默认 Font Style | 补受限 `Bold` 语义，避免完整开放 TMP Style/Weight |
| Auto Size | 0 | 439 | 当前不加入 Inspector |
| Raycast Target、Maskable | 429 个均为 Raycast 关闭、Maskable 开启 | 存在其他组合 | Publish 固定项目默认，不在 Text Inspector 常驻 |
| Vertex Gradient、Rich Text | 当前无表现差量；Rich Text 全部开启 | 旧项目存在使用 | 当前不加入 Inspector |

结论：`局部优化已实施`。Inspector 在 Font Size 后提供受限 `Bold` 字段，不开放完整 TMP Style/Weight；Source、Preview、Projection、observation、roundtrip 与 visual fixture 使用同一 Boolean 语义。当前 outline material 已由 `material: "outline"` 准确表达，不属于缺口。

截图矩阵：`default`、`representative`、`long-content`、`use-site-override`。Before 为 `inspector-text-final-20260731`，After 为 `inspector-text-after-mainline-20260731`，对比报告为 `inspector-text-final-20260731--inspector-text-after-mainline-20260731`。

## Image

审计日期：2026-07-31。

当前 164 个 Source 文件包含 583 个直接 Image；当前 149 个 UI prefab 中包含 564 个本地 Image 组件。旧项目包含 14335 个 Image，用于判断当前未使用字段是否仍具有成熟项目价值。

| 字段或字段组 | 当前 Source / prefab 证据 | 旧项目信号 | Inspector 判断 |
| --- | --- | --- | --- |
| Source Image | Source 显式 357；prefab 354 个已赋值 | 9831 个已赋值 | 高频，保持首项资产控件 |
| Color | Source 显式 219，另有 8 个 use-site override；prefab 209 个非白色 | 6798 个非白色 | 高频，保持常驻 |
| Raycast Target | Source 87 个开启；prefab 105 个开启 | 4860 个开启 | 高频且影响交互，保持常驻 |
| Image Type | Source 为 562 Simple、14 Sliced、7 Filled；prefab 另有 1 个 Tiled | Sliced 3944、Tiled 165、Filled 66 | 四态枚举完整，按 Sprite 是否存在显示合理 |
| Filled 分支 | 5 个 fillAmount use-site override、3 个 Clockwise 差量、6 个 Origin 差量 | 66 个 Filled，多个 Method/Origin | 保持条件字段；不提升为常驻 |
| Preserve Aspect | Source 与 prefab 各 5 个开启 | 110 个开启 | 低频但属于 Simple/Filled 必要分支，保留 |
| Raycast Padding | 当前 0 | 752 个非零 | 保留常驻候选；后续统一评估 Graphic 高级字段分组 |
| Maskable | 当前 0 个关闭 | 207 个关闭 | 保留常驻候选；与 Mask 批次一起复核分组 |
| Fill Center、Pixels Per Unit Multiplier | 当前均无差量 | 分别 190、237 个非默认 | 保留在 Sliced/Tiled 条件分支 |
| Use Sprite Mesh | 当前与旧项目均为 0 | 0 | 暂不删除；待确认 Unity 版本与导入资产约束后再判断 |

结论：`保持现状`。当前高频字段、四种 Image Type 及对应条件字段均已体现，没有 Source 完整性缺口。后续只需要在渲染批次收尾时决定 `Raycast Padding`、`Maskable` 是否进入统一高级区，不在 Image 单项中先行重排。

截图矩阵：`default`、`simple`、`sliced`、`filled`、`use-site-override`。运行 `npm.cmd run visual:capture -- <batch> --component Image` 获取只包含 Image Component Section 的截图。

## RoundedRect

审计日期：2026-07-31。

当前 Source 包含 311 个 RoundedRect，正式 prefab 包含 261 个本地组件。该组件是当前项目新增能力，旧项目没有对应组件。

| 字段或字段组 | 当前 Source / prefab 证据 | Inspector 判断 |
| --- | --- | --- |
| Color | Source 显式 310；prefab 260 个非白色 | 高频，保持常驻 |
| Corner Radii | Source 显式 283；prefab 239 个非零 | 高频，四角向量完整 |
| Raycast Target | Source 97 个开启；prefab 93 个开启 | 高频且影响交互，保持常驻 |
| Fill Amount | 当前没有非默认实例 | 保留组件自身的横向填充能力，不提升优先级 |
| Corner Segments | prefab 261 个全部为 8 | 固定为实现质量参数，不进入 Source/Inspector |
| Raycast Padding、Maskable | prefab 全部使用默认值 | 当前 RoundedRect Source 不开放，保持项目约束 |

结论：`保持现状`。高频字段已经完整；UI Authoring 有意不暴露 Unity 的内部细分质量参数和当前固定 Graphic 默认值。

截图矩阵：`default`、`representative`、`use-site-override`。

## Mask

审计日期：2026-07-31。

当前 Source 与正式 prefab 均未使用 Mask。旧项目有 159 个 Mask，其中 121 个关闭 Show Mask Graphic，说明该字段在成熟项目中具有明确用途。

结论：`保持现状`。Inspector 只提供 `Show Mask Graphic`，与组件实际可编辑字段一致；添加条件要求同节点存在 Graphic。当前没有 use-site addition 能力，截图只覆盖 `default` 与 `hidden-graphic`。

## RectMask2D

审计日期：2026-07-31。

当前 Source 有 95 个 RectMask2D，正式 prefab 有 93 个，全部使用默认 Padding 与 Softness。旧项目 479 个实例中，143 个使用非零 Padding，73 个使用非零 Softness。

结论：`保持现状`。组件本身高频，两个 Inspector 字段当前低频但被旧项目实际使用验证，均应保留。截图矩阵为 `default`、`representative`、`use-site-override`。

## ShapeSoftMask

审计日期：2026-07-31。

当前 Source 与 prefab 各有 1 个实例：`MiniMapWidget` 使用 Circle 与 8px Radial Softness。旧项目没有该项目扩展能力。

结论：`保持现状`。Inspector 已按 Rect、Rounded Rect、Circle 切换 Rect Softness、Corner Radius 与 Radial Softness，并保留 Falloff 和 Effective Mask Layers。截图矩阵为 `rect`、`rounded-rect`、`circle`、`use-site-override`。

## ButtonEx

审计日期：2026-07-31。

当前 Source 有 151 个 ButtonEx，正式 prefab 有 142 个本地组件。其中 33 个启用 Press Feedback；Click Interval、Double Click 与 Long Press 当前均未启用。

| 字段或字段组 | 当前项目证据 | Inspector 判断 |
| --- | --- | --- |
| Target Graphic、Interactable、Transition | 所有按钮的基础结构与 Selectable 状态 | 保持常驻 |
| Press Feedback | 33 个实例启用，包含 Scale 与两个可选 Target | 高频项目扩展，保持完整条件字段 |
| Click Interval、Double Click、Long Press | 当前没有启用实例 | 保留 ButtonEx 行为能力；阈值与间隔按开关条件显示 |

结论：`保持现状`。当前高频 Press Feedback 与全部输入扩展均可表达；低频行为通过条件字段收起，没有形成常驻噪声。截图矩阵为 `default`、`press-feedback`、`advanced-input`。

## Toggle

审计日期：2026-07-31。

当前 Source 与正式 prefab 各有 5 个 Toggle，其中 3 个关闭 Is On。旧项目有 27 个 Toggle，其中 4 个设置 ToggleGroup。

结论：`保持现状`。当前使用所需的 Target Graphic、Checkmark Graphic、Is On、Interactable 与 Transition 已完整。ToggleGroup 只在旧项目出现，当前项目没有 Source 完整性缺口，暂不据此新增字段；后续当前 prefab 首次出现互斥组时再升级为候选。截图矩阵为 `default`、`off`。

## Slider

审计日期：2026-07-31。

当前 Source 与正式 prefab 各有 5 个 Slider；3 个使用非默认 Max Value 或 Whole Numbers，4 个使用非零 Value。旧项目有 15 个 Slider。

结论：`保持现状`。Target Graphic、Fill Rect、Handle Rect、Direction、Min/Max、Whole Numbers、Value 及 Selectable 字段已覆盖当前差量，数值编辑约束也与字段语义一致。截图矩阵为 `default`、`representative`。

## Scrollbar

审计日期：2026-07-31。

当前 Source 与正式 prefab 各有 6 个 Scrollbar，全部使用 Bottom To Top；Value、Size、Number Of Steps 与 Selectable 字段均保持默认。旧项目有 129 个 Scrollbar。

结论：`保持现状`。当前项目主要把 Scrollbar 作为垂直 ScrollRect 的结构组件，Inspector 已覆盖完整 Unity Scrollbar 可编辑面；没有需要新增或重排的字段。截图矩阵为 `default`、`representative`。

## ScrollRect

审计日期：2026-07-31。

当前 Source 与正式 prefab 各有 6 个 ScrollRect；4 个引用 Vertical Scrollbar，1 个引用 Horizontal Scrollbar，1 个使用 Clamped。旧项目有 216 个 ScrollRect。

| 字段或字段组 | 当前项目证据 | Inspector 判断 |
| --- | --- | --- |
| Content、Viewport、Horizontal、Vertical | 6 个实例的基础结构；横向与纵向均有实际使用 | 高频，保持常驻 |
| Movement Type、Elasticity | 1 个 Clamped，其余使用 Elastic | 保持条件字段 |
| Inertia、Deceleration Rate、Scroll Sensitivity | 当前使用默认值 | 保留滚动手感字段，Deceleration 按 Inertia 显示 |
| Horizontal / Vertical Scrollbar | 1 个横向、4 个纵向引用 | 关键结构字段；Visibility 与 Spacing 按引用和模式显示 |

结论：`保持现状`。滚动方向、手感、裁剪结构与两轴 Scrollbar 条件分支已完整；当前项目不存在 Unity 字段无法回写的问题。截图矩阵为 `default`、`clamped`、`horizontal`。

## TMPInputField

审计日期：2026-07-31。

当前 Source 与正式 prefab 各有 5 个 TMPInputField；3 个设置 Placeholder，2 个使用 Integer Number，1 个设置 Character Limit。旧项目有 54 个 TMP_InputField。

结论：`保持现状`。Target Graphic、Text Viewport、Text Component、Placeholder、Content Type、Line Type、Character Limit、Read Only、Rich Text、Caret Width 与 Scroll Sensitivity 已覆盖当前项目配置。Inspector 不展开 Unity 的整套文字选择、光标配色和事件面板，符合 Source 只表达生成与运行接入所需字段的边界。截图矩阵为 `default`、`integer`、`multiline`。

## TMPDropdown

审计日期：2026-07-31。

当前 Source 与正式 prefab 均未使用 TMPDropdown。旧项目有 16 个 TMP_Dropdown，其中 3 个使用非默认 Alpha Fade Speed。

结论：`保持现状`。现有 Inspector 已覆盖 Template、Caption、Item、Value、Options 与 Selectable 结构；Alpha Fade Speed 只有旧项目低频信号，不足以单独扩大当前 Source contract。首次在当前项目引入 TMPDropdown 时，应以实际 prefab 核对 Image 选项与 Fade 行为，再决定是否补字段。截图矩阵为 `default`、`representative`。

## HorizontalLayoutGroup

审计日期：2026-07-31。

当前 Source 有 45 个 HorizontalLayoutGroup，正式 prefab 有 44 个本地组件；45 个 Source 实例全部关闭 Force Expand Width，44 个关闭 Force Expand Height，Spacing 与 Padding 均有多组实际值。旧项目有 1550 个实例，验证 Alignment、Control Child Size、Use Child Scale、Force Expand 与 Reverse Arrangement 均有成熟使用场景。

结论：`保持现状`。Inspector 已完整覆盖 Unity 线性布局字段；当前高频值常驻，低频开关不需要增加额外分组。截图矩阵为 `default`、`representative`。

## VerticalLayoutGroup

审计日期：2026-07-31。

当前 Source 与正式 prefab 各有 41 个 VerticalLayoutGroup；41 个 Source 实例全部关闭 Force Expand Height，38 个关闭 Force Expand Width，Spacing 高频且 Padding、Alignment 有实际差量。旧项目有 950 个实例。

结论：`保持现状`。Horizontal 与 Vertical 共用同一字段定义，语义、顺序和默认值保持对称，当前没有只覆盖一侧的缺口。截图矩阵为 `default`、`representative`。

## GridLayoutGroup

审计日期：2026-07-31。

当前 Source 与正式 prefab 各有 15 个 GridLayoutGroup；14 个使用 Fixed Column Count，Cell Size 与 Spacing 全部有显式配置。旧项目有 197 个实例，Start Axis、Alignment 与约束模式均有实际差量。

结论：`保持现状`。Cell Size、Spacing、起始方向、Alignment 与 Constraint 分支完整，Constraint Count 只在固定行列模式显示。截图矩阵为 `default`、`fixed-columns`。

## AutoLayoutGroup

审计日期：2026-07-31。

当前 Source、正式 prefab 与旧项目均未使用 AutoLayoutGroup。该组件是当前项目提供的统一线性/网格布局扩展，Inspector 已按 Horizontal、Vertical 与 Grid 切换主要字段。

结论：`局部优化已实施`。Auto Grid 隐藏 Rows 与 Columns；Manual Grid 在 Horizontal Start Axis 下只显示 Columns，在 Vertical Start Axis 下只显示 Rows。Rows 与 Columns 的 Inspector 默认值均为 1。截图矩阵为 `horizontal`、`grid-auto`、`grid-manual`。Before 为 `inspector-auto-layout-audit-20260731`，After 为 `inspector-auto-layout-after-mainline-20260731`，对比报告为 `inspector-auto-layout-audit-20260731--inspector-auto-layout-after-mainline-20260731`。

## ContentSizeFitter

审计日期：2026-07-31。

当前 Source 有 90 个 ContentSizeFitter，正式 prefab 有 88 个本地组件；33 个 Source 实例使用 Horizontal Preferred Size，42 个使用 Vertical Preferred Size。旧项目有 5041 个实例，Preferred Size 同样为主流配置。

结论：`保持现状`。两轴 Fit Mode 即 Unity 的完整可编辑字段，当前 Inspector 没有缺口。截图矩阵为 `default`、`preferred-size`。

## LayoutElement

审计日期：2026-07-31。

当前 Source 有 133 个 LayoutElement，正式 prefab 有 132 个本地组件；Preferred Width、Preferred Height 使用最广，31 个设置 Flexible Width，8 个设置 Flexible Height，3 个启用 Ignore Layout。旧项目有 4184 个实例，其中 Ignore Layout 与六项尺寸约束均有大量使用。

结论：`保持现状`。Inspector 使用 Optional Number 明确区分 Unity 的未启用值与数值 0，并在 Ignore Layout 开启时收起尺寸字段；Layout Priority 保持可编辑。截图矩阵为 `default`、`representative`、`ignore-layout`。

## AspectRatioFitter

审计日期：2026-07-31。

当前 Source 与正式 prefab 各有 1 个 AspectRatioFitter，使用 Envelope Parent 与 16:9；旧项目有 199 个实例，其中 186 个使用 Envelope Parent，7 个为 None。

结论：`有意区别于 Unity`。UI Authoring 只提供四种有效 Aspect Mode，不提供 Unity 的 None；Source 中无比例约束通过移除 Component 表达。当前项目没有无法表达的 prefab，Aspect Ratio 也已完整呈现。截图矩阵为 `source-default`、`envelope-parent`。

## LayoutSettings

审计日期：2026-07-31。

当前 Source 有 14 个 LayoutSettings，正式 prefab 有 12 个本地组件，均与 ScrollRectEx 配套；13 个 Source 实例显式设置 Spacing，1 个设置非零 Padding。旧项目没有该扩展组件。

结论：`保持现状`。Spacing 与 Padding 是完整字段面，Inspector fixture 也使用真实 ScrollRectEx、Viewport 与 Content 结构验证依赖。截图矩阵为 `default`、`representative`。

## Crosshair

审计日期：2026-07-31。

当前 Source 与正式 prefab 各有 4 个 Crosshair；3 个使用四向或双向 Edge，3 个将 Scatter Scale 设置为 30，Punch 的 Rotation、Scale 与 Random Rotation 均有实际差量。旧项目没有该项目扩展组件。

结论：`保持现状`。Inspector 已用结构化控件覆盖 Edge Target/Direction 与全部 Punch 参数，节点引用也参与删除、重映射和 readiness 校验。截图矩阵为 `default`、`four-edges`。

## VirtualJoystick

审计日期：2026-07-31。

当前 Source 与正式 prefab 各有 5 个 VirtualJoystick；5 个均启用 Active Joystick，1 个使用 Max Offset Scale 3。prefab 另有 2 个启用 `staticBackground`，1 个启用 `keepKnobVisibleWhenIdle`，对应 `AimJoystickWidget`、`FireJoystickWidget` 与 `ViewJoystickWidget`。

结论：`局部优化已实施`。Inspector 已补充 `staticBackground` 与 `keepKnobVisibleWhenIdle` 两个 Boolean，并同步 Projection、observation、roundtrip 与 visual fixture；`staticBackground` 只在 Active Joystick 开启时显示。Area 与 Background 保持必填，Knob 可为空以支持只读取方向输入、不移动任何视觉节点的 joystick；非空 Knob 仍按节点引用参与 Projection、audit 和 roundtrip。Active Joystick 与 Max Offset Scale 保持原有语义。截图矩阵为 `default`、`representative`。Before 为 `inspector-virtual-joystick-audit-20260731`，After 为 `inspector-virtual-joystick-after-mainline-20260731`，对比报告为 `inspector-virtual-joystick-audit-20260731--inspector-virtual-joystick-after-mainline-20260731`。

## StateRoot

审计日期：2026-08-05。

当前 Source 有 94 个 StateRoot，正式 prefab 有 92 个本地组件；Source 包含 71 条状态属性，其中 58 条为 UColor，其余覆盖 ULocalPos、UTMP_Text、UWidth、UHeight、Anchors、Pivot 与 LocalPosY。实施前复检确认正式 Source 没有旧形状 USprite，也没有本批次新增的五种类型，因此没有触发 Source 迁移。旧项目有 1921 个 StateRoot。

结论：`局部优化已实施`。Inspector 的 property element 菜单与 StateRoot descriptor 统一为 18 种类型，补齐 Anchors/Pivot 的 Vector2、Transform 的 Vector3、Boolean、Font asset 与 Sprite/SNS 复合控件。新增 element 从目标当前值初始化已有 state，新增 state 使用类型级语义默认值；目标 capability 与兼容组件唯一性在候选和 validation 两侧一致。UnityEvent 与运行时派生标记继续由程序接入持有。截图矩阵为 `default`、`state-elements`、`sprite-vector3-font`；当前 After 批次为 `state-root-element-alignment-20260805-v5`。

2026-08-21 follow-up：当前菜单、descriptor 与 C# runtime 收敛为 20 种 property element。新增 CanvasGroup 的 Alpha / Blocks Raycasts 复合状态值，并覆盖 Schema、Inspector、Preview、Projection、audit、observation 与 roundtrip；Interactable / Ignore Parent Groups 继续属于普通 CanvasGroup baseline。当前 Source、Prefab 与 Scene 未使用 Rotation、LocalPosition、Behaviour、TimelineActive、旧 UGUI Text / Font、TMP preset、SpriteRenderer 或嵌套 StateRoot element，因此从 C# factory 与 agent 删除这些旧能力，不触发 Source 或正式资产迁移。

## StateToggle

审计日期：2026-07-31。

当前 Source 与正式 prefab 各有 2 个 StateToggle，覆盖必选单选与 Allow Switch Off；旧项目有 139 个实例。

结论：`保持现状`。Inspector 通过 StateRoot 引用列表直接承载选择状态，并按 Multiple Select 与 Allow Switch Off 归一化 selectedIndices；配对校验要求目标 StateRoot 至少具备未选中和选中两态。截图矩阵为 `single`、`multiple`。

## CustomDropDown

审计日期：2026-07-31。

当前合同覆盖 current Button、展开箭头、current content host、option view、标准 ScrollRect、尺寸范围、option template，以及两个可选 Content Widget Artifact 引用。

结论：`当前 Prefab 合同`。Content Prefab 在 Source 保存 Artifact identity，由 Catalog、Projection、audit 与 reconcile 统一往返；基体允许为空，Variant 可覆写。截图矩阵为 `default`、`sized`。

## CustomDropDownOption

审计日期：2026-07-31。

当前 Source 与正式 prefab 各有 1 个 CustomDropDownOption，旧项目有 7 个实例。

结论：`当前 Prefab 合同`。Button、Content Host 与 Selected Visual 是运行组件的完整 authoring 字段；fixture 与 CustomDropDown 共用一套合法配对结构。截图矩阵为 `representative`。

## ScrollRectEx

审计日期：2026-07-31。

当前 Source 有 17 个 ScrollRectEx，正式 prefab 有 15 个本地组件；14 个 Source 实例配置非空 Templates，7 个使用 Clamped，5 个启用 Auto Clamped。旧项目有 315 个实例，其中 40 个启用 Auto Align Center，107 个启用 Auto Clamped。

结论：`保持现状`。基础 ScrollRect 字段、Auto Align/Clamped、Empty Default Target/StateRoot 与 Template Map 均已覆盖；Template 目标要求为 PrefabRef，LayoutSettings 继续作为同节点配对组件。截图矩阵为 `default`、`representative`。

## PrefabRef

审计日期：2026-07-31。

当前 Source 有 127 个 PrefabRef，正式 prefab 有 112 个本地 PrefabInstance；7 个 Source 实例包含 48 条 property override，1 个包含 2 条 component addition。旧项目 UI prefab 有 2798 个 PrefabInstance。

结论：`Unity 不适用`。PrefabRef 是 UI Authoring 的 Source 结构，不是 Unity Component。Prefab Reference Section 只显示 Artifact；property override 显示在对应继承 Component Section，component addition 显示为目标节点的本地 Component，避免在 PrefabRef 内复制第二套字段编辑器。截图矩阵为 `default`、`use-site`，并由 Text、Image、RoundedRect、RectMask2D、ShapeSoftMask 等 use-site 截图共同验证。

## Animation

审计日期：2026-07-31。

当前 Source 有 1 个 Animation，配置 5 个 Clip 并关闭 Play Automatically；正式 prefab 有 2 个本地 Animation，其中另一个空组件不在当前 Source authoring 集。旧项目有 95 个 Animation，Play Automatically、Wrap Mode 与 Clip 列表均有实际差量。

结论：`保持现状`。Default Clip、Clips、Wrap Mode、Play Automatically、Animate Physics、Update Mode 与 Culling Type 已覆盖 Unity Animation 的项目可编辑面。截图矩阵为 `default`、`clips`。

## Animator

审计日期：2026-07-31。

当前 Source 与正式 prefab 各有 1 个 Animator，仅设置 Controller；旧项目有 189 个实例，其中只有 1 个使用非默认 Update Mode、1 个启用 Apply Root Motion，其余相关运行字段基本保持默认。

结论：`有意区别于 Unity`。Inspector 保留 Controller、Update Mode、Culling Mode、Apply Root Motion 与 Keep State On Disable；Avatar、Stabilize Feet 和引擎内部采样字段不属于当前 UI authoring 面。截图矩阵为 `default`、`controller`。

## 优化实施记录

Inspector 优化使用固定两阶段流程：分析阶段提供当前截图、数据依据和拟修改规则，状态保持 `待用户确认`；获得逐项确认后才修改 Component Module 或共享 Inspector。实施后使用相同 case 生成 After 截图，并保留 Before/After comparison batch。

| 优先级 | Component | Before | After | Comparison | 状态 |
| --- | --- | --- | --- | --- | --- |
| P1 | VirtualJoystick | `inspector-virtual-joystick-audit-20260731` | `inspector-virtual-joystick-after-mainline-20260731` | `inspector-virtual-joystick-audit-20260731--inspector-virtual-joystick-after-mainline-20260731` | 已实施并复核截图 |
| P2 | Text | `inspector-text-final-20260731` | `inspector-text-after-mainline-20260731` | `inspector-text-final-20260731--inspector-text-after-mainline-20260731` | 已实施并复核截图 |
| P3 | AutoLayoutGroup | `inspector-auto-layout-audit-20260731` | `inspector-auto-layout-after-mainline-20260731` | `inspector-auto-layout-audit-20260731--inspector-auto-layout-after-mainline-20260731` | 已实施并复核截图 |

AspectRatioFitter、Animator 的 Unity 差异已判断为 authoring 边界，不进入优化队列。

## 更新要求

- 完成一个 Component 后，同步总账状态、详细证据、结论和截图矩阵。
- 结论触发实现时，另行修改对应 Component Module 和必要的 Web/Unity/test owner；台账不承担字段 contract。
- 未经用户确认，不实施 `待确认优化`；实施批次必须补相同 case 的 After 截图和 Before/After 对比结果。
- 当前或旧项目 prefab 基线变化后，只更新受影响的审计记录和日期，不把数量写入长期规格。
