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
- 根 `frame-config.json` 持有框架工具的稳定默认配置（包括端口槽位数量和备用端口扫描数量）；每个副本通过被 Git 忽略的 `frame-config.local.json` 保存 `workspaceId` 和 `portSlot`。Legma、静态配表 Web 和可选 coordination server 从同一端口槽位派生本地监听端口，首选端口被占用时由各自 launcher 自动扫描备用端口。
- 根 `启动工具.bat` 启动 Python 可视化工具，可编辑 `frame-config.json`、初始化副本槽位、启动 Unity 编辑器、Legma UI 工具和 Staticdata 导表工具；Unity 编辑器路径与项目路径由 `frame-config.json` 的 `unity` 节配置。
- TypeScript 侧已有轻量 ECS、显式运行时阶段、本地存储抽象、版本化 JSON 存档、PlayerPrefs 适配、schema 驱动静态配表工具链，以及由 `UIManager`、`CanvasBase`、`WidgetBase` 组成的 Prefab 驱动 uGUI runtime。
- Unity 侧已有 `UIBinder`、Prefab Variant effective declaration、Binder Inspector/Overlay、命名与 ownership 校验、TypeScript binding 生成、本地 Resources Prefab 索引与加载，以及 `StateRoot`、`StateToggle`、`ButtonEx`、`ScrollRectEx` 等配套组件。
- `tools/ui-authoring/` 已迁入 Legma UI Authoring 能力，包含 Source Kernel、CLI、Web 编辑器、Unity Projection/Publish bridge、Binder 命名审计、generated binding 接入和可选 coordination server；Source、DeliveryState 与正式 Prefab 分别位于 `My project/UIAuthoring/`、`My project/UIAuthoring/DeliveryState/` 和 `My project/Assets/Resources/UI/Prefab/`。
- 当前三轨闪避示例使用真实 Canvas/Widget Prefab、generated binding、嵌套 Widget 和四状态 `StateRoot` 验证 UI 链；节点与 Binder 字段遵循 `TsProj/doc/ui-node-naming.md`。
- `TsProj/src/main.ts` 是组合根，对 Unity 暴露 `initializeBoot`、`enterMain`、`fixedUpdate`、`update`、`lateUpdate` 和 `dispose`。
- `TsProj/src/game/lane-dodge/` 提供可运行的三轨闪避示例，用于验证命令队列、固定帧系统顺序、快照表现和存档链。
- `TsProj/staticdata/` 提供 schema、CLI/Web/MCP、校验、codegen 和 client/server target 生成；当前 `lane-dodge-rules` 表由 client target 发布到 `TsProj/src/staticdata/generated/` 并驱动示例参数。
- `TsProj/dist/` 是生成输出，Unity 编辑器期 loader 从该目录读取 JavaScript。

## 当前阶段

- 模板已具备 Unity/PuerTS/TypeScript/ECS、Binder UI runtime 和本地 Prefab 示例链。
- 仍需通过完整 Play Mode 流程持续验证 Boot-to-Main、示例交互、重复启动和 Dispose 行为。
- Legma 本地 authoring、Source 编辑、Projection、Publish、Prefab observation、Binder/generator 链和 fail-open coordination server 已迁入。coordination 默认关闭，通过 `LEGMA_COLLAB_SERVER` 和 `LEGMA_COLLAB_PROJECT` 显式配置，只交换文档 identity、hash、昵称、时间和短期编辑 lease；它不参与 Source 写入或远程发布事务。
- 当前迁移仍不包含远程 UI 发布、热更、AssetBundle 或 Addressables 热更新。
- 目标 Unity Editor 已接入 `PuerTsTemplate.UI.Editor.UiAuthoringJobBridge`；Editor 可用时优先复用已打开工程，Editor 不可用时由 `start_unity6000.bat` 提供 batchMode fallback。未登记或无法安全序列化的 Unity component capability 必须 fail-closed，不静默写入。
- 正式 Player 构建中的 JavaScript 打包路径尚未确定，当前编辑器期 loader 不代表最终发布方案。
- 后续扩展应优先验证真实使用方需求，不提前复制完整生产框架。

## 模板非目标

- 模板不规定正式游戏品类、角色、战斗、关卡或产品内容。
- 模板不包含服务端 TypeScript、多人协议、热更打包或完整生产发布工具链；当前静态配表只覆盖本地 authoring、校验和 TypeScript runtime target。
- 模板不要求保留三轨闪避作为最终产品功能。
- 模板不为尚未出现的多个消费者提前建立复杂通用层。

## 维护规则

- 模板范围、当前实现、技术前提或当前阶段变化时更新本文档。
- 跨范围设计理由和长期约束只进入 `ARCHITECTURE.md`，不在本文档复制。
- 具体 TypeScript 行为与验证规则进入 `TsProj/doc/` 对应 owner；Unity 工程规则进入 `My project/AGENTS.md`。
