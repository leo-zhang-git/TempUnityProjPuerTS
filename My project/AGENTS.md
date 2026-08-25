# Unity 工程入口

## 阅读顺序

- 先读根级 `../AGENTS.md`，确认模板定位、范围边界和完成标准。
- 涉及 Unity/PuerTS 分工、跨层依赖或长期约束时读取 `../ARCHITECTURE.md`。
- 涉及 TypeScript 导出、运行时阶段或表现适配时同时读取 `../TsProj/doc/runtime-architecture.md`。

## 工程边界

- 本目录是 Unity `2022.3.45f1` 工程，持有场景、GameObject、Prefab、序列化资源、物理、UI 和 C# 引擎桥接。
- `Assets/Script/RuntimeBootstrap.cs` 负责 PuerTS 环境、Boot/Main 场景流和通用生命周期转发。
- 游戏运行时、ECS 和存档逻辑位于兄弟目录 `../TsProj/`；C# 不复制 TypeScript 的游戏结论。
- `Assets/Scenes/Boot.unity` 是启动与环境准备场景，`Assets/Scenes/Main.unity` 是当前示例运行场景。
- `Packages/` 和 `ProjectSettings/` 属于工程配置；修改时需要确认 Unity 版本、包引用和 Player 行为影响。

## 修改规则

- 不修改 `Library/`、`Temp/`、`Logs/`、`UserSettings/` 等 Unity 生成目录。
- 修改 `.unity`、`.prefab`、`.asset`、`.meta` 或 `ProjectSettings/` 文件时，确认序列化变更有意且对应 `.meta` 完整。
- Unity 对象的创建与销毁、事件注册与注销、场景加载与卸载必须由明确 owner 成对处理。
- C# 桥接保持粗粒度和稳定，不为单一按钮或示例动作增加专用跨栈函数。
- 表现层可以缓存视觉状态和进行插值，但不能成为游戏状态或存档结论的第二权威来源。
- 新增 Unity API binding 或 TypeScript 可见类型时，同步检查 PuerTS 类型声明和 TypeScript 构建。

## 验证

- 影响 TypeScript 加载前，先在 `../TsProj/` 运行 `npm.cmd run check`；涉及模块输出时运行 `npm.cmd run build`。
- 场景、PuerTS、输入、物理或 UI 变更使用 Unity Play Mode 验证。
- 启动链验证包括：进入 Boot、初始化 TypeScript、切换 Main、每帧生命周期正常转发，并且退出 Play Mode 后完整 Dispose。
- 检查 Unity Console 中的编译错误、加载错误、重复初始化和对象泄漏信号。

## 文档维护

- Unity 当前行为变化时更新根级 `../SPECIFICATION.md` 或本入口中的工程边界。
- Unity/TypeScript 依赖方向和跨层契约变化时更新 `../ARCHITECTURE.md` 与 `../TsProj/doc/runtime-architecture.md`。
- 具体示例行为由 TypeScript owner 和局部 README 定义，本文件不复制示例规格。

## 完成标准

- Unity 序列化资产及 `.meta` 完整，生成目录未被纳入修改。
- 相关 TypeScript 检查和 Play Mode 验证已执行或说明限制。
- 对象、callback、场景和 PuerTS 生命周期没有遗留不对称状态。
- 根级与 TypeScript 局部文档影响已判断并同步。
