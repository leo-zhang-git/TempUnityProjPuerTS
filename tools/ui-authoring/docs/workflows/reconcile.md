# Reconcile 与 Prefab Import 流程

本流程只处理正式 Prefab 到 Source 的受控 observation/patch。正式 Prefab 写入仍由 Publish 持有。

## 已有 Source

```powershell
npm.cmd run cli -- pull-live <source-relative-path>
npm.cmd run cli -- pull-live <source-relative-path> --with-dependencies
npm.cmd run cli -- pull-live <source-relative-path> --all
npm.cmd run cli -- pull-live <source-relative-path> [--with-dependencies | --all] --write

npm.cmd run cli -- sync-live <source-relative-path> [--with-dependencies | --all]
npm.cmd run cli -- sync-status <source-relative-path> --formal-observation <repo-relative-path>
npm.cmd run cli -- sync-pull <source-relative-path> --formal-observation <repo-relative-path>
```

`pull-live` 是 workspace 回写入口。默认只预览当前 Artifact；`--with-dependencies` 选择当前 Artifact 与传递依赖；`--all` 检查完整 Source workspace，并选择已有正式 Prefab 的 Artifact，尚未首次发布的 Source 草稿不进入回写结果。批量范围在一次 Unity `observe-plan` 中读取正式 Prefab，并按 Artifact 聚合候选 Source。默认不写文件；追加 `--write` 后先校验全部候选与 baseline，再按确定顺序写入。中途失败保留已完成文件并返回失败与未执行路径。Web 菜单、进度弹窗和 Apply 交互由 `../development/web-experience.md` 持有。

`sync-live`、`sync-status`、`sync-pull` 是显式 observation 和离线 patch 入口。`sync-live` 通过当前 Unity Editor 或 batchMode 只读生成 observation；dependencies/all 范围复用单次 observation plan。`sync-status` 直接比较指定 Source/Projection 与 Formal observation；`sync-pull` 消费指定 observation。

Patch JSON 按风险分为：

| kind | 语义 |
| --- | --- |
| `safe` | active、RectTransform、Registry 双向字段和可确定映射的本地引用 |
| `review` | 节点结构、Binding、Widget identity、PrefabRef identity 和 component addition 等 owner 变化 |

应用 review patch 前必须明确目标 Source owner。Unity-only 组件只进入独立报告，不伪装为 Source patch。Preview inputs、Reference fixture 和 Prototype session 数据保持 Source owner，不从 Prefab observation 推断。

Widget/Fragment 根节点 observation 对固定、正尺寸且未由 `ContentSizeFitter` 或 `AspectRatioFitter` 控制的轴生成 `initialSize` safe patch，使本地初始尺寸跟随 Prefab Width/Height。Concrete 写入完整本地值；Variant 与 immediate base 的 effective 值不同则保存本层 `artifact-size`，相同则删除本层字段并恢复继承。Stretch 轴以及自布局控制轴保留现有 effective `initialSize`，由 Artifact 本地初始尺寸控件显式编辑；`sizeDelta` 不作为 stretch 轴的实际尺寸使用。Fresh Import 在同一规则下以可确定的根轴校正候选 `initialSize`，无法推导完整正尺寸时仍要求显式输入。

Widget observation 分别携带当前 prefab layer 的 local identity 与沿 binder chain 解析出的 effective identity。Reconcile 读取当前层 serialized declaration：Concrete Widget 的 local/effective identity 必须一致且非空；Widget Variant 的空 local 值表示继承，等于上游 effective identity 的冗余值归一为空。Identity 变化形成 `widget-identity` review patch，不从 effective snapshot 反推本层声明。

一致性状态只表达当前比较结果：`matches` 表示 Projection 与 Prefab 一致，`differs` 表示存在 patch、issue 或 Unity-only 内容，`missing` 表示正式 Prefab 不存在。检查结果不持久化，也不影响后续 Publish；需要保留 Prefab 修改时，根据 patch 明确回写 Source 后再发布。

## 无 Source 的正式 Prefab

```powershell
npm.cmd run cli -- import-prefab Assets/Resources/UI/Prefab/<relativeDirectory>/<ArtifactKey>.prefab --out <source-relative-path>
```

默认结果是 JSON preview，包含 `imports[]`、候选 Source、patch、瞬时 Prefab hash 和 blocker。核对整条缺源链后追加 `--write`。

- Nested prefab 按当前 Catalog 折叠为 PrefabRef。
- Variant 沿 `basePrefabPath` 递归观察，按 base-to-child 生成 Source。
- `--out` 指定的 Source 相对路径必须与 Prefab canonical path 对应；Canvas/Widget/Fragment 类型来自 Prefab root observation，不从路径目录推断。
- Widget/Fragment 无法推导初始尺寸时追加 `--initial-size WIDTHxHEIGHT`。
- 写互斥内复核每个瞬时 Prefab hash、目标不存在和完整 Catalog；任一条件变化时不写入任何 Source。

Import 不修改正式 Prefab、generated binding 或 program。新 Source 后续通过首次 Publish 建立正式交付和 DeliveryState；在此之前原 Formal Prefab 仍是 legacy owner。已有 Source 的 Artifact 使用 reconcile，不重复 Import。
