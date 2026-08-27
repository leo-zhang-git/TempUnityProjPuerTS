# UI Authoring 质量审计（2026-08-03）

审计日期：2026-08-03。
范围：`tools/ui-authoring` 的 Source Kernel、Unity job / Publish / Reconcile / Import 交付链路、Web 编辑器。
方法：三路并行深度阅读（Kernel / Unity job / Web）+ 关键发现人工核对代码。
定位：本文只保留已经完成证据闭环且尚未处理的审计结论，不记录已修复、已排除或已证伪的内容，也不作为当前规格。

编号约定：`K-`（Kernel）、`J-`（Unity job 链路）、`W-`（Web 编辑器）、`C-`（能力差距）、`D-`（小遗漏）。复核状态取值：`CONFIRMED` / `PARTIAL`。

## 一、行为问题

### W-1 相邻吸附目标切换无滞后（低）
- 位置：`src/web/editors/artifact/canvas/alignment-guides.ts` 的 `closestAxisSnap`
- 描述：多选按整体包围盒吸附是当前一致且可成立的交互策略，现有 contract 也未要求逐成员边吸附。实际问题仅是同轴相邻目标同时落入 threshold 时始终选择绝对 correction 最小者，没有保留当前吸附目标的滞后区；指针在两目标中点附近往返时，预览位置会随目标切换产生小幅跳变。
- 复核状态：PARTIAL（范围修正，低）

## 二、设计问题

### Kernel
- **K-D1** RectTransform override 白名单在 Kernel 与 Web 重复：`src/kernel/override.ts`、`src/web/editors/artifact/inspector/use-site-editing.ts`、`use-site-overrides.ts` 各自维护同一组 7 个字段。Node/RectTransform 是结构字段，不属于 Component Module registry，原“与 Component Module 双路派生”的判断不成立；当前三份列表一致且无行为缺陷，但后续调整可覆写字段时存在漏同步风险。复核状态：PARTIAL（设计债边界修正）

### Web
- **W-D8** intrinsic 缓存缺少失效与失败重试：`rendering/intrinsic/intrinsic.ts` 的 `fonts` / `images` 以资源路径建立模块级缓存，`refreshAssets()` 只清理资产目录请求缓存，不会让已加载 metrics、FontFace 或失败 entry 失效。同路径资源更新后 Web 继续使用旧 intrinsic，首次加载失败后也无法在当前页面重试；访问过的不同路径 entry 同样不会回收。失败 promise 会进入 `Promise.allSettled()` 并触发一次 revision，原“error 不触发 rerender”的判断不成立。复核状态：CONFIRMED（范围修正）

## 三、小遗漏

- **D-7** SVN status 续行会被误作路径：`src/server/unity-job/operation-support.ts` 的 `workspaceChangePaths` 对每个长度足够的 SVN 输出行固定执行 `slice(8)`，没有先校验七列 status。普通含空格路径无需引号解析，原“引号处理不完整”不成立；实际缺口是 tree conflict、move 等附加说明行也会进入结果，进而污染 `preExistingUnrelated` 或 `mergeActualPublishTouchedPaths` 的归因。复核状态：PARTIAL（范围修正，低）
- **D-12** PrefabRef 单一 owner 内的 override target 可重复：`validation.ts:76-83` 只对 Variant 顶层 `overrides` 查重，`prefab-ref.ts` 的 `overrides` 可以保存重复 target 并通过 Catalog，后一条静默覆盖前一条。Web 写入入口已去重；跨 use-site 层的同 target 是合法优先级语义，查重应落在 PrefabRef 持久 owner 校验，不改 `applyPropertyOverrides`。复核状态：CONFIRMED（低）

## 四、复核状态汇总

复核方法：主线程逐项核对源码、调用链、直接 owner 与现有测试；对抗性验证（默认怀疑缺陷不成立，只有代码、contract 或测试能证明才保留）。本表列出全部已经完成证据闭环且仍需处理的条目。

| 编号 | 判定 | 结论 / 修正 |
| --- | --- | --- |
| **K-D1** | **PARTIAL（设计债边界修正）** | Node/RectTransform 不属于 Component Module registry，结构字段白名单与组件字段声明分开是正确边界。实际重复发生在 Kernel override 校验与两个 Web use-site 入口之间；当前 7 个 RectTransform 字段完全一致，暂无行为缺陷，但调整可覆写范围时需要同步三处。 |
| **W-1** | **PARTIAL（范围修正，低）** | 多选整体包围盒吸附是可成立的当前策略；实际缺口是 `closestAxisSnap` 不保留当前目标，相邻候选同时进入 threshold 后会在中点切换，指针往返时产生小幅位置跳变。 |
| **W-D8** | **CONFIRMED（范围修正）** | intrinsic 按路径永久缓存且不参与资产刷新；同路径资源更新继续使用旧 metrics / FontFace，失败 entry 也无法重试。失败 promise 实际会触发一次 revision，原错误渲染结论已排除。 |
| **D-7** | **PARTIAL（范围修正，低）** | SVN 普通路径不使用 Git 式引号/箭头语法；真实缺口是 parser 未过滤 tree conflict、move 等 status 附加说明行，可能把说明文本当作变更路径参与归因。 |
| **D-12** | **CONFIRMED（低）** | PrefabRef 持久 `overrides` 未校验 target 唯一，手写 Source 的重复 target 可通过 Catalog 并按数组顺序后者覆盖前者；Web 写入会去重，跨层聚合的同 target 仍是合法 override 优先级。 |

## 五、当前优先级

只对已完成复核且仍成立的条目排序。

- **设计债（进 ARCHITECTURE-ISSUES 候选）**：K-D1（RectTransform override 字段列表在 Kernel/Web 重复）
- **中优先级**：W-D8（intrinsic 缓存缺少资产刷新失效与失败重试）
- **低优先级**：W-1（相邻吸附目标切换无滞后）、D-7（SVN status 续行解析）、D-12（PrefabRef 单一 owner 内的 override target 可重复）
