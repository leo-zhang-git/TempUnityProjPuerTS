# TsProj 目录说明

本目录是 Unity PuerTS 模板项目中的 TypeScript 运行时代码工作区。这里的代码会通过 TypeScript 编译为 CommonJS JavaScript，输出到 `dist/`，再由 Unity 侧的 PuerTS 运行时加载和调用。

## 目录结构

| 路径 | 作用 |
| --- | --- |
| `src/` | TypeScript 源码；局部目录职责由 [src/README.md](src/README.md) 路由。 |
| `staticdata/` | 静态配表 authoring、schema、CLI/Web/MCP 工具和 client/server target 生成。 |
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

`check`、`build` 和 `watch` 会先执行 `staticdata:prepare`：安装 staticdata 工具依赖、校验并生成 client target，再发布到 `src/staticdata/generated/`。

`1.watch.bat` 会在当前目录执行 `npm run watch`，VS Code 的 `1.watch` 任务会在打开工作区时自动运行它。

## Unity 侧入口

Unity 的 `RuntimeBootstrap.cs` 加载 `dist/main.js`，并调用 `src/main.ts` 暴露的 Boot、Main、三类 Update 和 Dispose 生命周期。导出契约、运行阶段与跨层依赖由 [运行时架构](doc/runtime-architecture.md) 持有。

## 文档路由

- TypeScript 范围、执行规则和 owner 路由见 [AGENTS.md](AGENTS.md)。
- 编码判断见 [coding-conventions.md](doc/coding-conventions.md)，验证入口见 [testing.md](doc/testing.md)。
- 静态配表的 owner、生成和运行时消费边界见 [staticdata.md](doc/staticdata.md)。
- UI 生命周期、层级和布局标准见 [src/ui/README.md](src/ui/README.md)。
