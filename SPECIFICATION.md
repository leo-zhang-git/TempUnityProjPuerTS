# Unity PuerTS TypeScript 模板当前规格

## 模板定位

- 本模板用于建立 Unity、PuerTS 与 TypeScript 之间可运行、可调试、可扩展的游戏运行时基线。
- Unity 负责引擎对象和场景生命周期，TypeScript 负责主要运行时逻辑和 ECS 状态。
- 三轨闪避模块用于验证命令、系统调度、存档和 Unity 表现链，不规定使用模板创建的产品方向。

## 默认技术前提

- Unity 工程位于 `My project/`，当前编辑器版本为 Unity `6000.6.0b2`。
- TypeScript 工程位于 `TsProj/`，通过 PuerTS 由 Unity 加载；源码和 Unity 工程保持为工作区内的兄弟目录。
- TypeScript 编译目标为 ES2020 CommonJS，源码位于 `TsProj/src/`，生成 JavaScript 位于被 Git 忽略的 `TsProj/dist/`。
- Unity 拥有 Scene、GameObject、物理、渲染和 PuerTS 环境生命周期；游戏规则和 ECS 状态由 TypeScript 承载。
- 当前运行时和代码边界由 [TsProj/doc/runtime-architecture.md](TsProj/doc/runtime-architecture.md) 持有。

## 当前实现

- Unity 使用 `Boot` 和 `Main` 两个场景；`RuntimeBootstrap.cs` 创建 PuerTS 环境并转发 Boot、Main、FixedUpdate、Update、LateUpdate 和 Dispose。
- Unity/PuerTS 从 `TsProj/dist/main.js` 加载 TypeScript 运行时。
- TypeScript 侧已有轻量 ECS、显式运行时阶段、本地存储抽象、版本化 JSON 存档、PlayerPrefs 适配，以及由 `UIManager`、`CanvasBase`、`WidgetBase` 组成的 uGUI runtime。
- `TsProj/src/main.ts` 是组合根，对 Unity 暴露 `initializeBoot`、`enterMain`、`fixedUpdate`、`update`、`lateUpdate` 和 `dispose`。
- `TsProj/src/game/lane-dodge/` 提供可运行的三轨闪避示例，用于验证命令队列、固定帧系统顺序、快照表现和存档链。
- `TsProj/dist/` 是生成输出，Unity 编辑器期 loader 从该目录读取 JavaScript。

## 当前阶段

- 模板已具备 Unity/PuerTS/TypeScript/ECS 的基础实现和示例玩法链。
- 仍需通过完整 Play Mode 流程持续验证 Boot-to-Main、示例交互、重复启动和 Dispose 行为。
- 正式 Player 构建中的 JavaScript 打包路径尚未确定，当前编辑器期 loader 不代表最终发布方案。
- 后续扩展应优先验证真实使用方需求，不提前复制完整生产框架。

## 模板非目标

- 模板不规定正式游戏品类、角色、战斗、关卡或产品内容。
- 模板不包含服务端 TypeScript、多人协议、热更打包、配置导出或完整生产工具链。
- 模板不要求保留三轨闪避作为最终产品功能。
- 模板不为尚未出现的多个消费者提前建立复杂通用层。

## 维护规则

- 模板范围、当前实现、技术前提或当前阶段变化时更新本文档。
- 跨范围设计理由和长期约束只进入 `ARCHITECTURE.md`，不在本文档复制。
- 具体 TypeScript 行为与验证规则进入 `TsProj/doc/` 对应 owner；Unity 工程规则进入 `My project/AGENTS.md`。
