# Unity PuerTS TypeScript 模板架构说明

## 设计目标

- 提供一个小而可复用的 Unity 模板，让主要游戏运行时逻辑由 TypeScript 承载。
- 保持 Unity 引擎对象、C# 桥接与 TypeScript 游戏规则之间的清晰边界。
- 保持第一条 Boot-to-Main、PuerTS 加载、ECS 更新和 Dispose 链可调试。
- 通过可运行示例验证边界，再根据真实项目需求扩展通用能力。

## 模块边界

- `TsProj/` 持有 TypeScript 运行时、ECS、示例规则、状态、存档、静态配表 authoring/target 和明确命名的 Unity 表现适配。
- `My project/` 持有 Unity 场景、GameObject、Prefab、序列化资源、物理、UI 和 C# 引擎桥接。
- 根 `frame-config.json` 持有跨工具的框架默认配置；本地 `frame-config.local.json` 持有副本身份和端口槽位。工具 launcher 只能从该配置派生监听端口或生成工具本地配置，不将工作区端口写入业务数据、Unity 序列化资产或 TypeScript runtime target。首选端口被占用时，launcher 按配置的备用端口数量顺序探测可用端口，只替换同一工作区的旧服务。
- MCP 工具链属于编辑器开发基础设施，不进入 TypeScript runtime 依赖方向：Unity 工程通过 `com.coplaydev.unity-mcp` 暴露 Editor HTTP endpoint，外部 `.codex/config.toml` 再组合该 endpoint 与离线 `unity-asset-mcp`、联调 `game-mcp`；根 `frame-config.json` 的 `tools.mcp` 节是 MCP 工作区路径、开关和 Unity endpoint 的 owner。`tools/mcp_config_sync.py` 只替换工作区 Codex 配置中由模板管理的三个 MCP table，保留其它 Codex 设置。
- 根 `启动工具.bat` 与 `tools/framework_launcher.py` 负责入口编排、配置编辑与工具配置应用，不承载 Unity、Legma、Staticdata 或 MCP server 的业务实现。Unity 插件监听 `frame-config.json` 中影响本地 server 生命周期的 MCP 字段并成对停止、重启 bridge/server；启动工具不终止或替换正在运行的 Codex 会话。
- 根级文档只持有跨范围稳定事实和边界；具体系统行为进入 `TsProj/doc/`、局部 README、Unity 资产和局部入口。
- `TsProj/dist/`、`node_modules/` 与 Unity 生成目录都是派生内容，不作为源码或文档权威。

## 依赖方向

```text
TypeScript composition root
  -> game runtime / sample rules -> ECS -> core
                               -> staticdata client target
  -> Unity presentation adapters -> UI runtime -> Unity/PuerTS
  -> save adapters -> save contracts

Unity RuntimeBootstrap -> TypeScript composition root
```

- `TsProj/src/core/` 不依赖 ECS、具体游戏或 Unity。
- `TsProj/src/ecs/` 可以依赖 core，不依赖具体游戏或 Unity。
- 纯游戏规则可以依赖 core、ECS 和存储抽象，不直接访问 Unity API。
- `TsProj/staticdata/` 是静态配表手写源和工具 owner；PuerTS runtime 只消费经过 codegen、validation 与端裁剪后发布到 `TsProj/src/staticdata/generated/` 的 client target。
- Unity 表现适配可以依赖游戏命令和只读状态；纯游戏模块不得反向依赖表现适配。
- `TsProj/src/ui/common/` 与 Canvas/Widget 基类持有通用 UI runtime，不依赖具体游戏、ECS 或组合根；`src/ui/canvas/` 和 `src/ui/widgets/` 中的具体表现 owner 可以依赖游戏命令与只读视图契约。
- `TsProj/src/main.ts` 是组合根，业务模块不反向依赖它。

## UI 资产与绑定边界

```text
Unity UI Prefab + UIBinder declarations
  -> Legma Source / Projection / Unity Publish
  -> Editor validation/generation
  -> generated TypeScript binding + prefab path index
  -> local Resources loader
  -> CanvasBase / WidgetBase runtime
```

- Unity Prefab 是节点层级、组件引用和 `StateRoot` 配置的运行时资产 owner；generated TypeScript 只描述经过校验的访问契约，不复制序列化状态。
- `tools/ui-authoring/` 是本模板的本地 Legma/UI Authoring owner：`My project/UIAuthoring/Sources/` 持有唯一 Source，`My project/UIAuthoring/DeliveryState/` 持有交付 identity，`My project/Assets/Resources/UI/Prefab/` 持有正式 Prefab；Source 不能绕过 Publish 直接成为正式 Prefab 的第二写入口。
- Binder Inspector、Overlay、Prefab ownership 校验和 binding generator 只在 Unity Editor 运行；TypeScript runtime 不依赖 `UnityEditor` 或 Newtonsoft.Json。
- `CanvasBase` 按 generated path index 从 `Assets/Resources/UI/Prefab` 本地实例化 Prefab，`UIBinder` 注入完成后才进入业务 `onLoaded()`；当前边界不包含远程发布、AssetBundle、Addressables 或热更加载。
- 嵌套 Widget 由显式 `widgetType` 和 `WidgetFactory` 建立 TypeScript 实例，生命周期归所属 Canvas/Widget；ScrollRect 模板保留独立 Widget identity，但不自动提升为顶层 Canvas。

## Unity 接入约定

- Unity 拥有 Scene 生命周期、Unity 对象生命周期、物理与渲染能力，以及 PuerTS 环境的创建和销毁。
- `My project/Assets/Script/RuntimeBootstrap.cs` 保持为薄桥接，只转发稳定生命周期和引擎级能力，不为每个示例命令增加 C# 专用委托。
- TypeScript 拥有游戏规则、ECS 状态、运行时阶段和不依赖 Unity 对象的确定性逻辑。
- 表现层读取 TypeScript 状态并驱动 GameObject 和 UI，不重新计算游戏规则结论。
- 持有 Unity 对象、callback、订阅或句柄的 TypeScript 模块必须有明确的创建、场景卸载和释放边界。
- Legma Source、Unity Prefab、Binder 声明与 generated binding 使用 `TsProj/doc/ui-node-naming.md` 的同一节点命名契约；投影和生成阶段只校验与保真，不另行改名。
- Unity Projection/Publish bridge 通过 request/claim/result 文件与 Node 服务协作；已打开 Editor 优先接取任务，batchMode 仅作为无人值守 fallback。该桥接只依赖本地任务文件，不依赖 coordination server。
- coordination server 是 Web/Node 侧默认关闭、fail-open 的元数据旁路，只提供编辑活动与 hash 一致性提示；中心不可达不改变本地 Save 或 Publish 结果。远程 UI 发布、热更、AssetBundle 和 Addressables 不属于当前模板边界。
- Unity `FixedUpdate`、`Update` 和 `LateUpdate` 分别驱动 TypeScript 对应阶段；PuerTS `ScriptEnv.Tick()` 只在 Unity `Update` 中执行一次。

## 运行时与生命周期

- ECS Component 保存数据，System 执行行为，组合根负责系统注册和生命周期编排。
- 输入和 UI callback 转换为命令或意图，在明确更新阶段消费，不在系统迭代中直接修改权威集合。
- 系统初始化失败时回滚已初始化资源；释放按照初始化逆序执行并保持幂等。
- 创建/销毁、订阅/退订、加载/卸载和状态进入/退出必须成对处理。
- 存档保存稳定业务数据，不保存 Unity 对象引用、临时表现状态或可安全重建的帧内缓存。

## 长期约束

- 不把 Unity API 引入纯 ECS 和纯游戏规则层。
- 不直接修改 `TsProj/dist/`、`node_modules/` 或 Unity 生成目录。
- 不让模板依赖外部完整生产项目，也不复制与当前基线无关的系统。
- 不为复用三轨闪避示例而扭曲模板通用边界。
- 不在框架层提前抽象只有一个消费者、尚未通过真实项目验证的概念。
- 改变跨层契约、依赖方向、生命周期 owner 或 Player 发布路径时，同步更新本文档和所属局部 owner。
