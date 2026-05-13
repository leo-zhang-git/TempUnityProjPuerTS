# Unity PuerTS 模板架构

## Design Goals

- 提供一个小而可复用的 Unity 模板，用于让项目通过 TypeScript 承载游戏逻辑。
- Unity 侧代码聚焦于引擎集成、生命周期、场景对象和 PuerTS 桥接。
- TypeScript 侧代码聚焦于 ECS 管理的运行时状态、系统和生命周期逻辑。
- 基线保持足够小，以便先验证桥接和场景流，再引入更大的框架选择。

## Module Boundaries

- `Assets/` 负责 Unity 场景、Prefab、序列化资产和 C# 桥接脚本。
- `Packages/` 负责 Unity 包引用，包括 PuerTS 集成。
- `ProjectSettings/` 负责 Unity 编辑器和 Player 设置。
- 工作区根目录的 `TsProj/` 负责 TypeScript 源码、TypeScript 编译配置、Node 包元数据、生成的 JavaScript 输出和 TypeScript 侧脚本。
- `TsProj/src/` 是 TypeScript 代码的首选源码根目录。
- `TsProj/dist/` 是 Unity/PuerTS 消费 JavaScript 的首选构建输出目录。
- `TsProj/types/` 负责在引入完整 Unity/PuerTS 生成类型前所需的本地 ambient 声明。
- `TsProj/src/main.ts` 是 Unity 通过 PuerTS 加载的运行时模块入口。
- `TsProj/src/ecs/` 负责通用 ECS 原语，并保持独立于具体游戏场景行为。
- `TsProj/src/game/` 负责模板中的具体 ECS 组件、系统和运行时组合。
- `My project/Assets/Script/RuntimeBootstrap.cs` 负责 Unity 侧场景流、PuerTS 生命周期、运行时 bootstrap 对象创建和编辑器期 JavaScript 文件加载。
- `Boot.unity` 是强制启动场景目标。`Main.unity` 负责启动后的运行时场景。两个场景都不应序列化重复的 bootstrap 组件。

## Key Tradeoffs

- 将 `TsProj/` 放在 Unity 项目旁边，可以避免 Node 工具和 TypeScript 构建产物进入 Unity 资源扫描，同时保持模板工作区自包含。
- 使用聚焦的 ECS 基线，而不是复制完整的 `../program/TsProj` 布局，可以在不引入无关生产系统的情况下建立清晰运行时架构。
- `Boot.unity` 负责资源释放和环境准备。`Main.unity` 负责运行时内容。
- C# 在运行时边界仍然必要，因为 Unity 拥有场景生命周期、序列化对象引用和包初始化。
- `TsProj/dist/` 可作为编辑器期 JavaScript 加载位置；Player 构建仍需要明确的复制或打包步骤，将 JavaScript 放入 Unity 拥有的运行时资产位置。
- 桥接层使用 PuerTS 模块加载内置模块，并使用自定义文件 loader 读取 `TsProj/dist/`，因此 TypeScript 输出可以保留在 Unity `Assets/` 外。
- TypeScript ECS 负责运行时状态流转，使后续游戏逻辑可以扩展系统和组件，而不是增加直接脚本驱动流程。
- Unity `FixedUpdate`、`Update` 和 `LateUpdate` 分别驱动 TypeScript 的 `fixedUpdate`、`update` 和 `lateUpdate`。PuerTS 的 `ScriptEnv.Tick()` 只在 Unity `Update` 中调用一次，用于运行时环境维护。

## Guardrails

- 不要将 TypeScript 源码移动到 `Assets/`；`Assets/` 保留给 Unity 侧文件，`TsProj/` 保留给 TypeScript 侧文件。
- 不要将 `node_modules/` 或生成的 TypeScript 构建输出放到 Unity `Assets/` 树下。
- 在 Player 构建打包路径确定前，将 `TsProj/dist/` loader 限制在桥接代码中。
- 不要重新引入测试 UI 或样例 UI 作为运行时架构。
- 不要绕过 ECS 表达 TypeScript 侧运行时状态或生命周期行为。
- 不要让模板依赖完整的 `../program/` 生产结构。
- 除非模板范围被明确改变，不要引入服务端 TypeScript、热更打包、配置导出或生产工具链。
- 不要把 Unity 生成目录，例如 `Library/`、`Temp/` 和 `Logs/`，当作源码或文档权威事实来源。
- 在增加抽象层前，保持第一条桥接路径可调试。
