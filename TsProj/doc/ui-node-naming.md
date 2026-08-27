# UI 节点与 Binder 命名

## 适用范围

本规范是 UI 节点名称与 Binder 字段名称的唯一 owner，适用于未来 Legma Source、Legma 导出的 Unity Prefab、手工维护的 Unity UI Prefab，以及 `UIBinder.UINode.name`。同一节点在各阶段保持同一语义名称，导出和生成工具不得静默改名。

## 普通节点

未被任何有效 Binder 声明引用的 GameObject 使用大写字母开头的 `PascalCase`，只包含英文字母和数字。

```text
Playfield
PausePanel
TrackLineLeft
```

普通节点不得使用空格、连字符、下划线或小写字母开头的名称。

## Binder 节点

除嵌套 Widget 外，被 Binder 引用的 GameObject 使用小写字母开头的 `snake_case`。Binder 字段名同样使用 `snake_case`，并按绑定值的类型使用固定前缀；前缀后必须存在非空语义名称。

| Binder 引用类型 | 固定前缀 | 示例 |
| --- | --- | --- |
| `TMP_Text`、`TextMeshProUGUI` | `txt_` | `txt_score` |
| `Image`、`RawImage` | `img_` | `img_player` |
| `GameObject` | `go_` | `go_pause_panel` |
| `RectTransform` | `rect_` | `rect_content` |
| `StateRoot` | `sr_` | `sr_phase` |
| `ScrollRect`、`ScrollRectEx` | `sv_` | `sv_history` |
| `Button`、`ButtonEx` | `btn_` | `btn_close` |

嵌套 Widget 的 Binder 值类型为 `UIBinder`，不使用固定前缀。通常保留 Widget Prefab 根节点原有的 `PascalCase` 名称，Canvas 内的实例节点和 Binder 字段使用同一个名称，例如 `LaneDodgeHudWidget`。

同一 Canvas 内嵌套多个相同 Widget 且都需要 Binder 引用时，实例节点根据实际语义改为 `snake_case`，Binder 字段与实例节点严格同名，例如 `left_item`、`right_item`。工具不自动添加 `wdg_` 或其它 Widget 前缀。

Binder 字段名通常与其引用的 GameObject 名称完全相同。每个被引用节点必须至少有一个同名的主引用。

同一 GameObject 上的多个组件需要同时暴露时，节点名称和主引用保持相同，其它引用使用“组件前缀 + 完整节点名”。例如节点 `btn_close` 的按钮主引用为 `btn_close`，同节点 GameObject 的附加引用为 `go_btn_close`；如果还需引用 RectTransform，则使用 `rect_btn_close`。

## Variant 与嵌套节点

Prefab Variant 覆盖已有 Binder 字段时保持字段名、类型前缀和节点语义不变。新增字段继续按本规范命名。

独立 Widget Prefab 的根节点使用 `PascalCase` runtime identity。该 Widget 作为嵌套 Prefab 放入 Canvas 后通常保持原名；只有同类多实例需要区分时才覆盖实例节点名称，并使用与 Binder 字段相同的语义化 `snake_case`。实例名称不改变 Widget Prefab 自身的 runtime identity 或 effective `widgetType`。

## 未登记类型

Binder runtime 可以支持尚未登记命名前缀的组件类型，但 authoring、Inspector 校验和 binding 生成不得为该类型推断或自动分配前缀。出现新类型时必须先确认固定前缀，再在本规范和 Binder 校验表中同一批更新；确认前不得生成该字段。

未来 Legma 的节点创建、重命名、导出前校验和 Unity Projection 必须消费同一前缀表与节点规则。Legma 不建立第二份独立命名解释。

## 校验边界

- Binder 声明校验字段格式、类型前缀，以及字段名与目标 GameObject 名称的对应关系；嵌套 Widget 单独允许同名 `PascalCase` 或 `snake_case`。
- Prefab 校验被引用节点至少存在一个同名主引用，并校验未引用节点使用 `PascalCase`。
- TypeScript binding generator 只消费校验通过的声明，不修正名称。
- 命名错误必须回到 Source 或 Prefab owner 修复，不能在 generated 文件中手工绕过。
