# TMP 文本溢出模式

本文规定 `Text.overflow` 的选型、有限溢出模式的布局前置和全量检查行为。

## 模式选择

`Overflow` 是默认模式，canonical Source 省略默认字段。固定符号、按钮命令、关键数值，以及内容不得被整体抑制的文本使用 `Overflow`，并由容器、字号或布局保证可见。

`Ellipsis` 只用于允许省略的动态文本，并在截断处向玩家显示省略标记。`Truncate` 只用于允许无标记裁切的动态文本。有限长度不构成使用有限溢出模式的理由；固定的 `<`、`>`、`+`、`-`、勾选标记等控件字符不使用 `Ellipsis` 或 `Truncate`。

单行动态文本通常关闭 `wordWrapping`。多行文本只有在产品语义明确允许截断时使用有限溢出模式；首行高度检查只保证 TMP 能生成首行，不证明目标行数、横向宽度或最终本地化内容可完整显示。

## 布局前置

使用 `Ellipsis` 或 `Truncate` 的 Text Rect 在目标 Artifact 初始尺寸下必须容纳 TMP 首行高度。首行高度由字体 `ascentLine - descentLine` 按字号、字体 point size 和 scale 换算，并计入正的上下 margin。

`check --full` 对实际 Rect 高度小于首行高度的节点报告 `text.finiteOverflowInsufficientHeight` warning。检查不读取 Text 内容或 glyph，因此空的 Binding baseline 也进入检查；warning 不阻断全量检查，修复方式是增加高度、降低字号，或在内容不得被抑制时改用 `Overflow`。

## Preview 与验收

Web Preview 使用浏览器文本布局，不能完整模拟 Unity TMP 在有限溢出模式下的垂直首行抑制。Web 中能看到字符不代表 Unity 中一定能生成首行；Source 与 Preview 保持同一模式选择，差异由 `check --full` 的 TMP 字体 metrics 检查提前暴露。

Publish 继续负责 Source 到 Unity 的字段映射，不重复运行完整 workspace 检查。涉及固定符号、关键数值或真实本地化内容时，在 Publish 后按正式入口补 Unity 运行态可见性验收。
