# TsProj 目录说明

本目录是 Unity PuerTS 模板项目中的 TypeScript 运行时代码工作区。这里的代码会通过 TypeScript 编译为 CommonJS JavaScript，输出到 `dist/`，再由 Unity 侧的 PuerTS 运行时加载和调用。

## 目录结构

| 路径 | 作用 |
| --- | --- |
| `src/` | TypeScript 源码目录，包含 Unity 调用入口、游戏运行时和轻量 ECS 框架。 |
| `src/ecs/` | 通用 ECS 基础设施，包括实体 ID、组件类型、World 容器和 System 调度。 |
| `src/game/` | 当前示例游戏逻辑，负责构建 `GameRuntime`、注册系统、保存运行时状态。 |
| `types/` | 额外的 TypeScript 全局类型声明，用来补齐当前 PuerTS/JS 运行环境可用的全局对象。 |
| `.vscode/` | VS Code 任务和调试配置。 |
| `dist/` | `tsc` 生成的 JavaScript 输出目录。不要手写修改。 |
| `node_modules/` | npm 安装的依赖目录。不要手写修改。 |

## 运行和检查

常用 npm 脚本定义在 `package.json`：

| 命令 | 用途 |
| --- | --- |
| `npm run build` | 编译 `src/` 到 `dist/`。 |
| `npm run watch` | 监听 TypeScript 源码变化并持续编译。 |
| `npm run check` | 只做类型检查，不输出编译结果。 |
| `npm run lint` | 执行 ESLint 检查。 |
| `npm run lint:fix` | 执行 ESLint 自动修复。 |

`1.watch.bat` 会在当前目录执行 `npm run watch`，VS Code 的 `1.watch` 任务会在打开工作区时自动运行它。

## Unity 侧调用入口

Unity/PuerTS 侧应优先通过 `src/main.ts` 暴露的函数进入 TypeScript 运行时：

| 导出函数 | 语义 |
| --- | --- |
| `initializeBoot()` | 确保 `GameRuntime` 存在并执行 Boot 初始化系统。 |
| `enterMain()` | 进入 Main 状态。 |
| `fixedUpdate(deltaTime)` | 转发 Unity 固定帧更新。 |
| `update(deltaTime)` | 转发 Unity 普通帧更新。 |
| `lateUpdate(deltaTime)` | 转发 Unity LateUpdate。 |
| `dispose()` | 释放当前 TypeScript 运行时实例。 |

`src/main.ts` 内部维护一个模块级 `runtime`。首次调用 `initializeBoot()` 或 `enterMain()` 时会创建 `GameRuntime`，`dispose()` 后会清空它。

## 生命周期边界

当前项目里的 `World` 是 TypeScript 侧 ECS 数据容器，不等同于 Unity Scene。它现在作为 `GameRuntime` 的私有字段存在，因此生命周期默认跟 `GameRuntime` 一致。

推荐按数据归属决定生命周期：

- 跨场景的游戏逻辑状态放在 `GameRuntime` 级别的 `World` 中。
- 当前关卡、战斗、临时对象等场景内状态可以后续拆出局部 ECS scope，或在同一个 `World` 内显式清理。
- 如果组件中保存 Unity 对象引用，Unity 对象销毁或场景卸载时必须同步移除相关组件或实体，避免留下失效引用。

## 开发约定

- 源码只改 `src/` 和必要的 `types/`，不要直接改 `dist/`。
- 新增 TypeScript 源码后，使用 `npm run check` 或 `npm run build` 验证。
- `tsconfig.json` 使用 `strict: true`，新增代码应保持严格类型通过。
- 当前模块输出为 CommonJS，新增入口导出应从 `src/main.ts` 明确暴露。
- ECS 基础能力应放在 `src/ecs/`，具体游戏业务逻辑应放在 `src/game/` 或后续业务子目录。

## Agent 阅读顺序

处理任务时建议按下面顺序建立上下文：

1. 读本文件了解项目边界。
2. 读 `src/README.md` 了解源码层职责。
3. 读 `src/main.ts` 确认 Unity 调用入口。
4. 读 `src/game/game-runtime.ts` 确认运行时生命周期。
5. 涉及 ECS 时再读 `src/ecs/README.md` 和对应源码。

