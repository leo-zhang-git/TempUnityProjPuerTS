# Canvas 布局与屏幕适配

## 范围

本文持有正式玩家 Canvas 的设计坐标、屏幕空间角色、Safe Area 分层和多宽高比验收契约。Source 字段和值域仍以 Component Registry 与 Schema 为准；业务生命周期和交互归 `program/doc/ui-framework.md`。

## 坐标契约

- Canvas 设计基准为 `1280 x 720`。
- Unity Canvas 使用 `Scale With Screen Size + Expand`。缩放因子取屏幕宽高相对设计基准比例的较小值，逻辑 Canvas 保留未被该轴占满的额外空间。
- Canvas root 只持有 Canvas 身份和顶层承载，不作为内容布局节点。
- Source Preview、Capture、layout snapshot 与 Unity Publish 使用同一 Expand 语义。

| 目标屏幕 | 逻辑 Canvas | 布局含义 |
| --- | --- | --- |
| `1280 x 960` | `1280 x 960` | 4:3 增加上下空间 |
| `1280 x 720` | `1280 x 720` | 16:9 设计基准 |
| `1680 x 720` | `1680 x 720` | 21:9 增加左右空间 |

## 空间角色

Canvas 顶层区域在 Source 定义阶段归入一个空间角色。同一画面可以组合多个角色，不以整张 Canvas 选择单一适配模式。

| 角色 | 目标行为 | 常见内容 |
| --- | --- | --- |
| `FullBleed` | 随完整逻辑 Canvas 四边拉伸 | 背景、遮罩、全屏点击层 |
| `SafeEdge` | 在 Safe Area 内贴近目标边缘 | 返回、关闭、HUD、Debug 工具 |
| `SafeCenter` | 在 Safe Area 内居中，保持内容本身尺寸约束 | 弹窗、确认框、居中提示 |
| `FixedStage` | 以 `1280 x 720` 构图为基准，在 Safe Area 内整体居中 | 队伍编成、固定槽位、强构图页面 |
| `ViewportCenter` | 相对完整 viewport 中心定位，不随 Safe Area 偏移 | 准星、镜头投射、世界坐标指示 |
| `FlexiblePane` | 在 Safe Area 内拉伸工作区，并用 min/max、layout 或滚动约束内容 | 背包、设置、商店、地图等工作页面 |

`FixedStage` 的目标设备集合应保证 safe rect 能容纳关键构图。需要覆盖更小 safe rect 时，界面在交付前明确采用可缩放舞台或 `FlexiblePane`，并单独验证最小尺寸；关键交互不依赖装饰内容越过安全边缘。

## 层级规则

背景和内容使用独立布局根。全屏 overlay 的遮罩继续覆盖完整 viewport，其面板内容进入 overlay 内的 Safe Area 根。

```text
Canvas
|-- FullBleed background
|-- SafeArea content root
|   `-- SafeEdge / SafeCenter / FixedStage / FlexiblePane
`-- FullBleed overlay
    |-- FullBleed shade
    `-- SafeArea overlay content root
        `-- SafeCenter panel
```

- `SafeArea` Component 放在父节点完整映射屏幕 viewport 的全屏布局根上；默认参考方向为横屏左转、尊重四边、不镜像 inset。
- 运行时由 `UnityEngine.UI.SafeArea` 读取 `Screen.safeArea` 并驱动该根节点的 anchors 和 offsets。
- Safe Area 子节点的中心锚点默认对应原始 safe rect 中心；需要避让不对称边缘且保持某一 viewport 轴居中时，在该轴启用 `alignment`，以较大一侧 inset 镜像约束另一侧。
- Safe Area 表达设备不可用区域；视觉留白、面板内距和可点击热区 padding 由 Safe Area 子层单独表达。
- `FullBleed` 不进入 Safe Area。`SafeEdge`、`SafeCenter`、`FixedStage` 和 `FlexiblePane` 先进入 Safe Area，再应用各自 anchors、layout 与尺寸约束。
- 业务 TS 只提交状态和数据，不按设备、分辨率或宽高比分支改写 RectTransform。

## 选型顺序

1. 背景、遮罩和全屏输入层使用 `FullBleed`。
2. 与镜头或世界投射同中心的元素使用 `ViewportCenter`。
3. 需要避让设备边缘的控件使用 `SafeEdge`。
4. 独立居中内容使用 `SafeCenter`。
5. 固定槽位和整体构图使用 `FixedStage`。
6. 信息密度高、需要利用额外空间或在较小空间滚动的页面使用 `FlexiblePane`。

## Authoring 与验收

- Canvas 编辑器提供 `4:3(Pad)`、`16:9`、`21:9` 和带非对称 inset 的 `21:9(Safe)` 预览；Safe preset 是显式模拟输入，不代表所有 21:9 设备共享同一 safe rect。
- Source mutation 前标明各顶层区域的空间角色、目标 viewport 和最小可用尺寸。布局节点沿用 anchors、layout driver 与 Component Registry，不在 Source 保存设备型号判断。
- 正式 Canvas 至少在 `1280 x 960`、`1280 x 720`、`1680 x 720` 验证：FullBleed 覆盖完整 viewport，内容无非预期裁切或重叠，固定构图与工作区符合其空间角色。
- 使用 Safe Area 的 Canvas 额外验证 `21:9(Safe)`；目标平台包含异形屏时，在 Unity 运行态以实际 `Screen.safeArea` 验证边缘交互和 overlay 内容。
- Publish 证明 Source、Projection、Prefab、binding 和 program contract 可交付；Capture/Verify 与运行验收负责目标宽高比和实际操作体验。
