# 测试与验证

本文持有当前模板内 Legma/UI Authoring 的验证入口与目标工程联调边界。

## 完整工具准入

从 `tools/ui-authoring/` 运行 `npm.cmd run check`。该入口依次覆盖：

- Biome lint；
- TypeScript typecheck；
- Source Kernel、CLI、server 和 Web 纯逻辑 unit；
- Python bootstrap、workflow benchmark runner 与 coordination server 测试；
- Knip deadcode 检查。

`check` 不重复执行需要浏览器或 Unity Editor 的套件。按影响追加以下独立入口：

| 入口 | 验证范围 |
| --- | --- |
| `npm.cmd run test:unit` | TypeScript/React/Node unit |
| `npm.cmd run test:python` | bootstrap、benchmark runner 与 coordination server Python 测试 |
| `npm.cmd run test:browser` | production Web build 与 Playwright 浏览器交互 |
| `npm.cmd run visual:capture` | 构建并采集视觉基线候选 |
| `npm.cmd run visual:compare` | 当前 capture 与既有视觉基线比较 |
| `npm.cmd run test:performance` | Web 性能采样 |
| `npm.cmd run test:performance:budget` | Web 性能预算门禁 |
| `npm.cmd run test:benchmark` | workflow benchmark runner 定点测试 |
| `npm.cmd run test:unity` | component parity、Projection/Publish、roundtrip、DeliveryState、Variant 与正式发布往返 |
| `npm.cmd run build:web` | Vite production bundle |
| `npm.cmd run cli -- check` | 当前 workspace fast check |

`python ../../tools/bootstrap_ui_authoring.py` 单独验证依赖指纹、lockfile 和 `npm ci` 准备链。`TsProj/` 的 `npm.cmd run check` 与 `npm.cmd run build` 验证 generated binding 和当前程序接入；程序 owner 固定为 `TsProj/src/ui/`，测试和 Publish 不依赖 longdemo 的 `program/client` 或 `program/staticdata`。

## Fixture 边界

- 已迁移测试只保留 Legma 通用行为，使用 `My project/`、`TsProj/` 和当前模板命名/capability contract，不复制 longdemo 的业务 Source 或产品资源预期。
- Unity 套件优先复用已打开的目标 Editor；Editor 不可用时才使用 batchMode fallback。
- Unity 测试产生的资源必须位于正式资源根 `My project/Assets/Resources/UI/` 下的 `_UnityTests` 隔离目录，或由任务在运行期动态构造并在 `finally` 中清理；不得覆盖正式 Source 和 Prefab。
- Concrete Source Publish smoke 验证 Editor bridge、Prefab、`UIBinder`、`StateRoot`、`ScrollRectEx`、generated binding、DeliveryState 和 observation 回读。

## Unity 验收

- Publish 前确认目标 Editor 处于 Edit Mode，脚本编译和 AssetDatabase 刷新已完成。
- Publish 结果必须为 `status: succeeded` 且 `delivery: delivered`；`blocked` 或 `failed` 不构成交付。
- 检查 `My project/Assets/Resources/UI/` 下正式 Prefab 的节点层级、组件引用、Binder 双引用、generated binding 和 observation 是否一致。
- 包含 TMP Text 的 Source 需要目标工程存在可解析的 TMP Settings 和默认 Font Asset；资源缺失时保持 fail-closed。
- 影响运行时 UI、输入或生命周期时，从 Boot 进入 Main 执行 Play Mode，并确认退出后 callback、对象和 PuerTS 环境完整释放。
