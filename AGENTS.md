# Unity PuerTS TypeScript 模板

## 项目定位

- 本仓库提供一个可复用的 Unity、PuerTS 与 TypeScript 游戏运行时基线。
- 模板覆盖 Boot/Main 场景流、PuerTS 生命周期、TypeScript 组合根、轻量 ECS、存档抽象和示例表现链。
- 根级权威来源只承载模板级稳定事实、架构边界、范围路由和 agent 读写约定；具体实现事实进入所属范围的本地 owner。
- 三轨闪避模块是验证运行时链路的示例，不规定基于模板创建的正式产品玩法。

## 权威来源

- `AGENTS.md` 记录仓库入口、范围路由、执行规则、文档维护和完成标准。
- `SPECIFICATION.md` 记录模板当前事实、默认技术前提、当前阶段和非目标。
- `ARCHITECTURE.md` 记录 Unity 与 TypeScript 的架构边界、依赖方向和长期约束。
- `TsProj/AGENTS.md` 是 TypeScript 实现入口；运行时、编码约束、验证规则和支持资料由 `TsProj/doc/` 路由。
- `My project/AGENTS.md` 是 Unity 工程入口；场景、资源、序列化资产、C# 桥接和 Play Mode 验证按该范围规则处理。
- `README.md` 只提供简短模板介绍，不承担开发权威。
- 当用户指令改变既有方向或事实时，同步更新真实 owner；存在明显冲突但用户意图不清时，先指出差异再修改。

## 范围与边界

| 路径 | 角色 |
| --- | --- |
| `/` | 模板级权威来源与跨范围边界 |
| `TsProj/` | TypeScript、ECS、示例运行时、存档和 TS 表现适配 |
| `My project/` | Unity 场景、资源、物理、UI 和 C# 引擎桥接 |

- 按改动路径读取最具体的 `AGENTS.md`；跨范围改动同时读取两侧入口。
- 局部入口只细化所属目录，不反向覆盖根级模板定位和跨范围边界。
- Unity 生成目录以及 TypeScript 生成输出不参与当前事实判断；需要确认行为时回到源码、配置和可复现验证入口。

## 工作流程

- 涉及模板级当前事实或当前阶段时读取 `SPECIFICATION.md`；涉及跨层边界、依赖方向或 Unity/PuerTS 接入时读取 `ARCHITECTURE.md`。
- 处理 TypeScript 时先读 `TsProj/AGENTS.md`，再按其路由读取 `TsProj/doc/*.md` 和最近的局部 README。
- 处理 Unity 工程时先读 `My project/AGENTS.md`；涉及 TypeScript 契约时同时读取 `TsProj/doc/runtime-architecture.md`。
- TypeScript 变更至少从 `TsProj/` 运行 `npm.cmd run check`；按影响补充 lint、build 和 Unity Play Mode 验证。
- 不直接修改 Unity 的 `Library/`、`Temp/`、`Logs/`、`UserSettings/`，或 TypeScript 的 `node_modules/`、`dist/`。
- 模板允许使用者替换示例玩法；通用能力与示例业务之间保持清晰边界，不为示例 API 建立无价值兼容层。

## 协作与判断

- 默认使用简体中文交流和编写项目文档；文件名、API、运行时专名和工具名保留英文。
- 不把用户表述自动当成当前事实；先区分已实现行为、已确认目标和待验证方案。
- 修复与设计以方便后续复用和整体迭代为准，优先处理根因、owner、生命周期和必要配套。
- 同一事实由一个 owner 持有；其它文档只做短路由，不复制第二份解释。
- 涉及创建/销毁、注册/注销、加载/卸载或状态进入/退出时，按同一改动检查完整配对。
- 新增抽象、共享状态或跨层契约前，先确认其稳定语义、生命周期和真实消费者。

## 文档写作

- 新增或改写文本文件使用 UTF-8，路径引用使用仓库相对路径。
- 权威文档采用稳定、正向的规格表达，不记录提交历史、完成流水和临时调试过程。
- 当前行为更新 `SPECIFICATION.md` 或所属代码 owner；跨层设计边界更新 `ARCHITECTURE.md`；范围路由和执行规则更新对应 `AGENTS.md`。
- 尚需分析的技术问题可按需放入 `TsProj/doc/analysis/`；尚未完成的一次性实施计划可按需放入 `TsProj/doc/execution/`。结论落地后删除过程稿并回写稳定 owner。
- 具体字段、局部 API、资产路径、调参值和可由代码直接确定的细节留在代码、配置或局部说明中。

## Git 与工作区规则

- 保留用户已有改动，不清理、覆盖或回退任务外文件。
- 默认不提交、不推送、不创建分支，除非用户明确要求。
- 修改 Unity 序列化文件时保持对应 `.meta` 完整，确认变更有意且可解释。
- 提交前确认改动范围、必要验证和文档影响；提交信息默认使用简体中文。

## 完成标准

- 当前工作范围已解析，相关根级和局部 owner 已读取。
- 改动完成并覆盖受影响的依赖、生命周期和配对边界。
- 已执行与风险相称的类型检查、lint、构建或 Unity 验证；无法执行的部分已说明。
- 当前事实、架构、代码约束和范围路由的文档影响已判断并同步。
- 示例行为、模板稳定规则、未来方案和过程记录没有混为一谈。
