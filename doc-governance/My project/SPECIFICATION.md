# Unity PuerTS 模板规格

## Scope

本文档记录 Unity PuerTS 模板项目的当前稳定状态。

本文档覆盖 Unity 项目根目录、包状态、运行时接口和项目中已经存在的可观察行为。阶段计划归 [ROADMAP.md](ROADMAP.md) 管理，设计理由归 [ARCHITECTURE.md](ARCHITECTURE.md) 管理。

## Current Behavior

- Unity 项目根目录是 `My project/`。
- 项目记录的 Unity 编辑器版本是 `2022.3.45f1`。
- Unity 资源面包含 `Assets/Scenes/Boot.unity` 和 `Assets/Scenes/Main.unity`。
- Unity 包通过 `Packages/manifest.json` 和 `Packages/packages-lock.json` 管理。
- `com.unity.ugui` 已存在于包清单中，因此项目具备 Unity UI 包支持。
- PuerTS 包源码位于 `My project/Assets/Package/core/` 和 `My project/Assets/Package/v8/`。
- Unity 包依赖通过 `My project/Packages/manifest.json` 中的本地 `file:../Assets/Package/...` 条目引用 PuerTS。
- C# 桥接脚本位于 `My project/Assets/Script/RuntimeBootstrap.cs`，负责 Unity 侧 PuerTS 运行时生命周期。
- `RuntimeBootstrap.cs` 会在第一个场景加载前创建自身宿主对象，并先通过 `Boot` 场景启动，再加载 TypeScript 运行时代码或进入 `Main`。
- `Boot` 和 `Main` 场景中不序列化保存 bootstrap 组件。
- `RuntimeBootstrap.cs` 会卸载未使用资源、执行托管垃圾回收、初始化 PuerTS、调用 TypeScript 的 boot 初始化导出，然后加载 `Main` 场景。
- `RuntimeBootstrap.cs` 通过默认 Resources loader 加载 PuerTS 内置模块，并从 `TsProj/dist/` 加载模板运行时 JavaScript。
- `RuntimeBootstrap.cs` 会先执行 `puerts/module.mjs`，再加载 CommonJS 的 `main.js` 模块。
- `RuntimeBootstrap.cs` 保存 TypeScript 导出的 `dispose`、`initializeBoot`、`enterMain`、`fixedUpdate`、`update` 和 `lateUpdate` 委托。
- TypeScript 项目根目录是工作区根目录下的 `TsProj/`，与 `My project/` 并列。
- `TsProj/` 包含 TypeScript 运行时基线：`package.json`、`tsconfig.json`、`src/` 和 `types/`。
- `TsProj/src/main.ts` 导出 `initializeBoot`、`enterMain`、`fixedUpdate`、`update`、`lateUpdate` 和 `dispose`，作为 Unity 桥接层的稳定运行时接口。
- `TsProj/src/ecs/` 负责最小 ECS 原语：实体、组件定义、世界存储、系统和系统执行。
- `TsProj/src/game/` 负责游戏层 ECS 组合、运行时状态组件，以及 boot/main 生命周期系统。
- `TsProj/dist/` 是生成的 JavaScript 输出目录，并被 Git 忽略。
- `SampleScene.unity` 和先前的运行时测试 UI 行为不再属于正式项目结构。

## Fixed Rules

- 项目将 TypeScript 侧源码和工具保留在工作区根目录的 `TsProj/` 下，放在 Unity 项目目录外。
- Unity C# 代码只作为引擎桥接和 PuerTS 生命周期宿主；游戏运行时逻辑归 TypeScript 侧负责。
- TypeScript 运行时代码必须通过 ECS 结构表达游戏状态和生命周期行为。
- TypeScript 运行时每帧逻辑分为 `fixedUpdate`、`update` 和 `lateUpdate` 三个 ECS 调度阶段，并与 Unity 对应生命周期入口对齐。
- 运行时启动必须先进入 `Boot`，再进入 `Main`。
- 生成的 JavaScript 输出必须与 TypeScript 源码在 `TsProj/` 内部分离。
- 开发构建将 JavaScript 输出到 `TsProj/dist/`。
- Player 包尚未定义 Unity 侧 JavaScript 资产同步路径。
- `../program/` 中的参考材料可以指导目录形态，但本模板拥有自己的最小结构。

## Validation and Maintenance

- Unity 包或场景发生变化时，使用 Unity 编辑器或 batchmode 检查验证。
- TypeScript 编译验证使用 `TsProj/` 下的 `npm run check`。
- JavaScript 生成使用 `TsProj/` 下的 `npm run build`，输出到 `TsProj/dist/`。
- Play Mode 或手动 Unity 场景检查需要验证：运行后先进入 `Boot`，初始化 TypeScript ECS 运行时，然后切换到 `Main`。
- 当前行为、包状态、运行时入口或可观察行为变化时，更新本文档。
