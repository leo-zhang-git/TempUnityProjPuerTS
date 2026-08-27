# ShapeSoftMask

## 使用边界

- `ShapeSoftMask` 按所在节点的 RectTransform 建立矩形、圆角矩形或圆形软遮罩，作用于同节点及当前 sorting domain 内的后代 Graphic。
- 需要圆角、圆形、分边软化或衰减曲线控制时使用 ShapeSoftMask；只需常规矩形裁剪时使用 `RectMask2D`。
- ShapeSoftMask 不依赖同节点 Graphic 提供遮罩轮廓。嵌套 ShapeSoftMask 按层级相交；子级 `Canvas.overrideSorting` 开启新的 sorting domain，不继承外层遮罩。

## Source 准备

- 把 ShapeSoftMask 放在遮罩边界节点，并由该节点的 RectTransform、旋转和缩放确定形状位置与范围。圆形以短边为直径；圆角半径超过短边一半时按可用上限求值。
- 矩形和圆角矩形使用分边 softness，圆形使用 radial softness；softness 按 Canvas 单位求值，falloff 控制软边覆盖率曲线。嵌套前先确认每一层都承载独立裁剪意图。
- 受遮罩影响的 Image、RoundedRect、Text 或自定义 Graphic 的最终 Shader 必须声明 ShapeSoftMask contract。自定义材质在交付前接入该 contract，或改用已支持的 UI Shader。
- 当前模板的默认 Image、UGray 与主 TMP Text Shader 已实现该 contract；`sRGBUI` 资源名沿用迁移技术 contract，但 Shader 已适配当前内置渲染链，不依赖 longdemo 的 URP 颜色转换 Renderer Feature。

## 工具验收

- Canvas Preview 与 capture 验证形状、软边、变换和嵌套相交结果；Inspector 的 `Effective Mask Layers` 显示当前有效层数，并提示被尺寸上限截断的圆角半径。
- Publish 在写入前后审计当前 sorting domain 内所有受影响 Graphic；不支持的最终 Shader 返回 `publish.shapeSoftMaskShaderUnsupported` blocker。处理规则见 [`../../workflows/publish.md`](../../workflows/publish.md)。
- 字段、默认值和值域以 `schema --component ShapeSoftMask` 为准。
