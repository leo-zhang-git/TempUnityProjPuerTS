# src 目录说明

`src/` 是 TypeScript 源码根目录。`tsconfig.json` 的 `rootDir` 指向这里，编译后的 JavaScript 会输出到项目根目录下的 `dist/`。

## 当前结构

| 路径 | 作用 |
| --- | --- |
| `main.ts` | Unity/PuerTS 调用 TypeScript 的模块入口，负责持有和转发生命周期到 `GameRuntime`。 |
| `ecs/` | 通用 ECS 基础设施。 |
| `game/` | 当前游戏运行时和示例业务系统。 |

## 入口职责

`main.ts` 是外部调用边界。它不直接承载复杂业务逻辑，只负责：

- 延迟创建 `GameRuntime`。
- 暴露 Boot、Main、Update、Dispose 等生命周期函数。
- 在 `dispose()` 时清空模块级 runtime，确保下一次启动可以重新创建运行时。

新增 Unity 侧需要调用的 TypeScript 能力时，优先在业务模块中实现，再从 `main.ts` 暴露稳定入口。

## 分层约定

- `src/ecs/` 只放可复用的 ECS 基础概念，不依赖 `src/game/`。
- `src/game/` 可以依赖 `src/ecs/`，并负责具体游戏状态、系统和运行时编排。
- `main.ts` 可以依赖 `src/game/`，但不要让 `src/game/` 反向依赖 `main.ts`。

当前依赖方向应保持为：

```text
main.ts -> game -> ecs
```

## 修改提示

- 需要新增系统时，通常先在 `src/game/systems.ts` 添加系统工厂，再在 `GameRuntime` 的对应系统列表中注册。
- 需要新增状态时，通常先在 `src/game/components.ts` 定义接口和组件类型，再在 `GameRuntime` 构造函数中初始化。
- 需要扩展 ECS 能力时，修改 `src/ecs/`，同时检查所有已有系统调用方式是否仍然兼容。

