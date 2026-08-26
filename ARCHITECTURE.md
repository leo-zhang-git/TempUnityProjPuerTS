# Unity PuerTS TypeScript 模板架构说明

## 设计目标

- 提供一个小而可复用的 Unity 模板，让主要游戏运行时逻辑由 TypeScript 承载。
- 保持 Unity 引擎对象、C# 桥接与 TypeScript 游戏规则之间的清晰边界。
- 保持第一条 Boot-to-Main、PuerTS 加载、ECS 更新和 Dispose 链可调试。
- 通过可运行示例验证边界，再根据真实项目需求扩展通用能力。

## 模块边界

- `TsProj/` 持有 TypeScript 运行时、ECS、示例规则、状态、存档和明确命名的 Unity 表现适配。
- `My project/` 持有 Unity 场景、GameObject、Prefab、序列化资源、物理、UI 和 C# 引擎桥接。
- 根级文档只持有跨范围稳定事实和边界；具体系统行为进入 `TsProj/doc/`、局部 README、Unity 资产和局部入口。
- `TsProj/dist/`、`node_modules/` 与 Unity 生成目录都是派生内容，不作为源码或文档权威。

## 依赖方向

```text
TypeScript composition root
  -> game runtime / sample rules -> ECS -> core
  -> Unity presentation adapters -> UI runtime -> Unity/PuerTS
  -> save adapters -> save contracts

Unity RuntimeBootstrap -> TypeScript composition root
```

- `TsProj/src/core/` 不依赖 ECS、具体游戏或 Unity。
- `TsProj/src/ecs/` 可以依赖 core，不依赖具体游戏或 Unity。
- 纯游戏规则可以依赖 core、ECS 和存储抽象，不直接访问 Unity API。
- Unity 表现适配可以依赖游戏命令和只读状态；纯游戏模块不得反向依赖表现适配。
- `TsProj/src/ui/common/` 与 Canvas/Widget 基类持有通用 UI runtime，不依赖具体游戏、ECS 或组合根；`src/ui/canvas/` 和 `src/ui/widgets/` 中的具体表现 owner 可以依赖游戏命令与只读视图契约。
- `TsProj/src/main.ts` 是组合根，业务模块不反向依赖它。

## Unity 接入约定

- Unity 拥有 Scene 生命周期、Unity 对象生命周期、物理与渲染能力，以及 PuerTS 环境的创建和销毁。
- `My project/Assets/Script/RuntimeBootstrap.cs` 保持为薄桥接，只转发稳定生命周期和引擎级能力，不为每个示例命令增加 C# 专用委托。
- TypeScript 拥有游戏规则、ECS 状态、运行时阶段和不依赖 Unity 对象的确定性逻辑。
- 表现层读取 TypeScript 状态并驱动 GameObject 和 UI，不重新计算游戏规则结论。
- 持有 Unity 对象、callback、订阅或句柄的 TypeScript 模块必须有明确的创建、场景卸载和释放边界。
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
