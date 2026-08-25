# TsProj 代码入口

## 阅读顺序

- 先读根级 `../AGENTS.md`，确认模板定位和跨范围边界。
- 涉及模板级当前事实或当前阶段时读取 `../SPECIFICATION.md`；涉及跨层边界和依赖方向时读取 `../ARCHITECTURE.md`。
- 修改运行时、模块分层、Unity/PuerTS 契约或生命周期时，读 `doc/runtime-architecture.md`。
- 修改 TypeScript 实现时，读 `doc/coding-conventions.md`。
- 修改行为、构建或验证方式时，读 `doc/testing.md`。
- 涉及具体模块时，继续读取该目录最近的 `README.md`；README 只说明局部代码，不覆盖 `doc/` owner。

## 文档路由

- `doc/runtime-architecture.md`：当前 TypeScript 运行时、依赖方向、生命周期、Unity 边界和模板扩展规则。
- `doc/coding-conventions.md`：需要人工判断的 TypeScript、ECS、集合、错误处理和资源释放约定。
- `doc/testing.md`：类型检查、lint、构建、纯逻辑验证和 Unity Play Mode 验收规则。
- `doc/AGENTS.md`：`TsProj/doc/` 的文档职责和支持资料生命周期。

## 目录边界

| 路径 | 职责 |
| --- | --- |
| `src/main.ts` | PuerTS 外部入口与组合根 |
| `src/core/` | 无游戏、ECS、Unity 依赖的通用基础能力 |
| `src/ecs/` | 通用 ECS 原语和系统调度 |
| `src/game/` | 示例游戏运行时与玩法模块 |
| `src/save/` | 存储抽象、版本化存档和命名明确的 Unity 适配 |
| `src/ui/` | 通用 Unity uGUI 操作，不持有具体玩法规则 |
| `types/` | PuerTS/Unity 环境所需的补充类型声明 |
| `dist/` | TypeScript 生成输出，不手写修改 |

## 实现原则

- 保持 `core -> ecs -> game -> presentation -> main` 的单向依赖，不创建反向引用。
- 纯游戏状态和规则不访问 Unity API；Unity 对象只进入明确命名的表现或适配层。
- `main.ts` 只负责组合和通用生命周期，不积累具体示例逻辑。
- ECS Component 保存纯数据；System 执行行为；跨系统共享状态通过单一 owner 的组件或稳定契约表达。
- 输入和 UI 事件转换为命令或意图，在明确更新阶段消费，不在系统迭代中直接改变权威集合。
- 高频路径关注重复查询、全量复制、排序和临时分配；只为真实语义或生命周期建立缓存。
- 需要 Unity 对象、callback、事件或句柄的模块必须实现对称释放。
- generated 文件、`dist/` 和 `node_modules/` 不作为源码修改目标或文档事实来源。
- 使用模板的项目可以替换三轨闪避业务 API；替换时同步清理组合根、系统注册、存档键、表现对象和局部 README。

## 验证规则

- TypeScript 改动至少运行 `npm.cmd run check`。
- 影响代码规范或新增文件时运行 `npm.cmd run lint`。
- 影响 PuerTS 加载、模块导出或发布产物时运行 `npm.cmd run build`。
- 影响 Unity 对象、输入、场景、物理或 UI 时，在 TypeScript 检查后执行 Unity Play Mode 验证。
- 不为普通实现任务静默引入新测试框架或批量测试文件；需要新增自动化测试结构时先说明范围和维护成本。

## 当前阶段

- 当前代码是可运行的 PuerTS/ECS 模板基线，三轨闪避用于证明端到端链路。
- 后续通用能力从真实项目需求反推，不把示例业务自动提升为模板约束。
- 未实现方向不写成代码 owner 的当前行为；实现完成后更新对应代码文档与根级 `SPECIFICATION.md`。

## 支持资料

- `doc/analysis/` 只保存仍需判断的技术差距、可行性和问题拆分；结论落地后删除过程稿并回写稳定 owner。
- `doc/execution/` 只保存尚未完成的一次性实施计划；完成、被替代或失真后删除，不保留完成流水。
- 不为没有实际内容的主题预建空目录或占位文档。

## 完成标准

- 受影响的运行时 owner、生命周期和依赖方向保持清晰。
- 创建/销毁、注册/注销、加载/卸载和状态进入/退出均成对处理。
- 必要的 check、lint、build 与 Play Mode 验证已执行或说明限制。
- `TsProj/doc/`、根级权威文档和 Unity 局部入口的更新义务已判断。
