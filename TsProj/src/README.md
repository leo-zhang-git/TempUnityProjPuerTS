# src 目录说明

`src/` 是 TypeScript 源码根目录。`tsconfig.json` 的 `rootDir` 指向这里，编译后的 JavaScript 会输出到项目根目录下的 `dist/`。

## 当前结构

| 路径 | 作用 |
| --- | --- |
| `main.ts` | Unity/PuerTS 调用 TypeScript 的组合根，负责组装运行时与 Unity 表现层并转发生命周期。 |
| `core/` | 不依赖 ECS、游戏和 Unity 的通用基础能力，例如 GUID 生成。 |
| `ecs/` | 通用 ECS 基础设施。 |
| `game/` | 游戏运行时、示例玩法逻辑、命令和只读快照契约。 |
| `save/` | 通用字符串存储、版本化 JSON 槽和 Unity PlayerPrefs 适配。 |
| `ui/` | TypeScript UI 表现层；按 `common/`、`canvas/`、`widgets/` 分隔通用 runtime 与具体表现 owner。 |

## 入口职责

`main.ts` 是外部调用边界。它不直接承载复杂业务逻辑，只负责：

- 延迟创建 `GameRuntime`。
- 在进入 Main 时创建 `UIManager` 并打开示例 Canvas。
- 暴露 Boot、Main、Update、Dispose 等生命周期函数。
- 在 `dispose()` 时释放表现层和 runtime，确保下一次启动可以重新创建完整运行环境。

`main.ts` 只暴露通用生命周期。具体玩法命令由 TypeScript 表现层直接调用游戏运行时，不向 C# 增加玩法专用委托或快照桥接。

## 进一步阅读

- 模块依赖、运行阶段和 Unity/PuerTS 边界见 [runtime-architecture.md](../doc/runtime-architecture.md)。
- ECS 局部结构见 [ecs/README.md](ecs/README.md)，三轨闪避规则见 [game/lane-dodge/README.md](game/lane-dodge/README.md)。
- UI 目录、生命周期、Canvas 层级和布局标准见 [ui/README.md](ui/README.md)。
