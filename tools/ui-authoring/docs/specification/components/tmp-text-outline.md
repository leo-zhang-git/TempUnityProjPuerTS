# TMP 文本描边

## 目标与边界

- TMP 文本通过稳定材质枚举驱动 Web Preview、Unity Projection、Publish 和 Prefab 回写。首期枚举为 `normal` 与 `outline`。
- Source 只保存材质枚举，不保存 Unity 资产路径或 Shader 参数。枚举到共享 Material Preset 的映射由 Unity UI Authoring 集中持有。
- Web UI Authoring 负责切换和近似预览材质枚举；描边资产的创建与参数编辑继续由 Unity TMP Material Preset 工作流持有。
- 本能力只表达围绕字形均匀扩张的描边。Image 材质、方向性投影、Glow、Bevel 和其他 TMP Shader 效果由各自能力持有。
- runtime 继续通过 `TextMeshProUGUI` Binding 修改文本内容和颜色，不生成或修改材质实例。

## Source 与资产契约

- `Text.material` 使用 `normal | outline` 枚举，并作为 override field 支持 Concrete、Variant、PrefabRef use-site override 和 component addition。
- `normal` 是默认值并在 canonical Source 中省略；Unity 使用当前 Font Asset 的默认 shared material。
- `outline` 使用项目登记的共享描边预设。首期描边预设只支持默认 `alipuhui SDF`，其他字体组合在 readiness 阶段阻断。
- Inspector 以“普通 / 描边”两态控件编辑枚举。Unity 资产移动或替换只更新集中映射，不改写 Source。

可用描边预设满足以下语义：

- 使用项目支持的 TMP SDF Shader，并引用所选 Font Asset 的 atlas texture。
- 通过 `OUTLINE_ON` 的有效 Outline 形成可见轮廓。
- 轮廓颜色具有可见 alpha，轮廓强度大于零。
- 不携带方向性 Underlay，也不启用 Glow、Bevel 等本能力之外的可见效果。

文件名中的 `outline` 不参与资格判断；Unity Publish 从材质实际引用、keyword 与参数判断预设语义。

## Web Preview

- Web renderer 根据 `Text.material` 和字号把描边换算为稳定的 CSS 像素尺度，并使用多方向 `text-shadow` 近似 TMP SDF 轮廓。预览保持字形填充色、透明度、换行、截断和对齐语义。
- Preview 以轮廓颜色、粗细层级和软硬关系相似为目标，不建立与 Unity 的逐像素一致性契约。
- Artifact Canvas、嵌套 Artifact、Reference、Prototype、Capture 和内联文本编辑使用同一 Preview 描述，避免同一 Source 在不同 Web 视图出现不同描边。
- 描边资产缺失或与字体不兼容时，编辑器仍按枚举显示近似 Preview；正式 Publish 保持阻断并报告资源问题。

## Unity Projection

- Publish 先设置 `TextMeshProUGUI.font`，再把 `Text.material` 映射的共享材质设置为 `fontSharedMaterial`，保证字体切换不会覆盖显式描边。
- `normal` 显式恢复 Font Asset 的默认 shared material，避免增量发布保留旧描边。
- Publish 始终复用项目中的 Material Preset，不读取 `fontMaterial`，不为节点创建 Material 实例，也不把 Material 作为 Prefab sub-asset 复制。
- Unity 写入前后均校验 Material、Shader、atlas texture 和描边语义；Prefab 中的最终引用必须与 Source 指向同一正式资产。

## Observation 与回写

- Prefab observation 读取 `fontSharedMaterial`。引用 Font Asset 内置默认材质时回写 `normal`；引用登记的描边预设时回写 `outline`。
- `pull-live`、`sync-live`、Prefab Import 和 Variant observation 使用同一枚举映射，材质变化形成双向字段 patch。
- Prefab 使用缺失、越界、不兼容或包含额外效果的材质时，observation 保留差异并报告问题，不把它降级为无描边，也不把未知材质写入 Source。
- Source 发布后再次 observation 必须收敛为无 patch；重复 Publish 不改变 Prefab bytes、资源 GUID 或材质引用。

## 初始表现基准

- 当前项目至少提供一个与默认 `alipuhui SDF` 兼容的深色中等描边预设，用于建立端到端验收基线。
- 初始预设以旧项目 `AnimalPetColorPreviewCanvas` 的文本轮廓观感为参考，通过当前字体在 Unity 中重新确认；旧项目资产只提供视觉和参数组织参考，不直接成为当前项目资源 owner。
- 后续新增材质通过扩展同一枚举与集中映射进入 Inspector 和 Web Preview，不需要迁移已有 Source 字段或 runtime API。

## 验收标准

- Inspector 能为 TMP Text 切换“普通 / 描边”。
- Source 保存、重新打开、复制粘贴、多选编辑和 Variant override 保留同一 `material` 枚举。
- Web 各 Preview 表面可见相似轮廓；无描边文本的既有布局和视觉不发生变化。
- Publish 生成的 Prefab 使用指定 shared material；清除预设后旧材质引用同步清除。
- 正式 Prefab 的 observation、reconcile 和 Prefab Import 能恢复合格预设并在再次发布后收敛。
- 缺失资源、错误 Shader、字体 atlas 不匹配、方向性 Underlay 和额外效果都在正式写入前阻断。
- 端到端测试覆盖 Schema/canonical、Inspector、Web renderer、Projection、Variant、observation、Unity roundtrip 和重复发布稳定性。
