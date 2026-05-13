# Unity PuerTS 模板

## Project Positioning

这个 Unity 项目是一个可复用的基础模板，用于通过 PuerTS 将主要运行时逻辑交给 TypeScript 承载。

当前交付目标是正式运行时基线：Unity 运行后先进入 `Boot` 场景，完成资源清理和环境初始化，再切换到 `Main` 场景；TypeScript 侧通过 ECS 结构承载运行时逻辑。

## Governance Profile

- 治理画像 ID：`stage-driven`
- 治理画像名称：按阶段推进
- 治理画像摘要：阶段内连续推进，阶段结束后统一收口。

## Document Routing

- 当前事实以 [SPECIFICATION.md](SPECIFICATION.md) 为准。
- 架构边界和设计取舍以 [ARCHITECTURE.md](ARCHITECTURE.md) 为准。
- 后续计划和阶段进度以 [ROADMAP.md](ROADMAP.md) 为准。
- 本文件只定义执行规则、文档路由和维护协议。

## Execution Boundaries

- 将 `doc-governance/My project/` 作为本模板开发文档的权威根目录。
- 将 `My project/` 作为本模板的 Unity 实现目标。
- `../program/` 只可作为结构和约定参考；本模板任务不得修改该目录。
- TypeScript 源码、TypeScript 构建配置、生成的 JavaScript 和相关 Node 工具放在工作区根目录的 `TsProj/` 下，与 Unity 项目根目录并列。
- Unity 生成目录，例如 `Library/`、`Temp/`、`Logs/`、`UserSettings/`，不参与文档权威事实判断。
- 修改 Unity 序列化资产和场景文件时必须谨慎；`.unity`、`.prefab`、`.asset`、`.meta` 或 `ProjectSettings` 文件的变更必须是有意且可解释的。
- 每个活跃阶段完成后先收口，再扩展下一阶段。

## Document Update Matrix

- 当前行为事实归 [SPECIFICATION.md](SPECIFICATION.md) 管理。
- 设计边界事实归 [ARCHITECTURE.md](ARCHITECTURE.md) 管理。
- 计划状态和路线状态归 [ROADMAP.md](ROADMAP.md) 管理。
- 执行规则和文档路由归 [AGENTS.md](AGENTS.md) 管理。

## Done Definition

- 活跃阶段的实现工作已完成。
- 需要的 Unity、TypeScript 或文档检查已执行；如无法执行，原因已记录。
- 已按文档更新矩阵判断本次工作影响。
- 被影响的权威文档已更新。
