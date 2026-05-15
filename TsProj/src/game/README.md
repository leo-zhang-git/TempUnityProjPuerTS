# src/game 目录说明

`src/game/` 承载当前 TypeScript 游戏运行时的业务逻辑。这里依赖 `src/ecs/`，负责定义游戏状态组件、系统工厂和运行时编排。

## 文件职责

| 文件 | 作用 |
| --- | --- |
| `components.ts` | 定义当前游戏逻辑使用的状态接口和组件类型。 |
| `systems.ts` | 定义系统工厂，系统通过 `World` 读写组件状态。 |
| `game-runtime.ts` | 创建 `World`、初始化状态实体、注册系统列表，并向 `main.ts` 提供生命周期方法。 |

## 当前运行时模型

`GameRuntime` 构造时会：

1. 创建一个私有 `World`。
2. 创建一个 `stateEntity`。
3. 给 `stateEntity` 添加场景状态、环境状态、运行时状态三个组件。
4. 构建 Boot、Main、FixedUpdate、Update、LateUpdate 等系统列表。

当前状态组件包括：

| 组件 | 数据 | 作用 |
| --- | --- | --- |
| `SceneStateComponent` | `{ current: "Boot" | "Main" }` | 记录当前逻辑场景状态。 |
| `EnvironmentStateComponent` | `{ resourcesCleaned: boolean; initialized: boolean }` | 记录 Boot 初始化阶段的环境准备状态。 |
| `RuntimeStateComponent` | `{ elapsedSeconds: number }` | 记录运行时累计时间。 |

## 生命周期方法

| 方法 | 执行内容 |
| --- | --- |
| `initializeBoot()` | 运行 Boot 系统列表，完成资源清理标记和环境初始化标记。 |
| `enterMain()` | 运行 Main 进入系统，要求环境已经初始化。 |
| `fixedUpdate(deltaTime)` | 运行固定帧系统列表。当前为空。 |
| `update(deltaTime)` | 运行普通帧系统列表。当前会累计运行时间。 |
| `lateUpdate(deltaTime)` | 运行 LateUpdate 系统列表。当前为空。 |
| `dispose()` | 当前只输出日志；后续可在这里释放 TS 侧引用和订阅。 |

## 系统顺序

系统列表的顺序就是执行顺序。当前 Boot 阶段依赖顺序：

```text
createBootCleanupSystem -> createEnvironmentInitializeSystem
```

`createEnvironmentInitializeSystem` 会检查 `environment.resourcesCleaned`，因此不能放到清理系统之前。

Main 阶段依赖 Boot 初始化：

```text
createMainEnterSystem
```

该系统会检查 `environment.initialized`。如果 Unity 侧绕过 `initializeBoot()` 直接进入 Main，会抛出错误。

## 扩展约定

- 新增游戏状态：在 `components.ts` 定义接口和组件类型，并在 `GameRuntime` 初始化。
- 新增系统：在 `systems.ts` 添加系统工厂，并在 `GameRuntime` 的对应生命周期系统列表中注册。
- 跨系统共享状态：优先通过组件表达，不要让系统之间互相持有引用。
- 涉及 Unity 对象引用的组件：必须设计清理时机，通常在场景卸载、实体销毁或 `dispose()` 中移除。

## Agent 修改提示

- 修改初始化流程时，要保持 Boot 到 Main 的前置条件清楚可查。
- 新增生命周期阶段时，需要同时考虑 `GameRuntime`、`src/main.ts` 导出函数和 Unity 侧调用点。
- 当前 `dispose()` 尚未真正清理 `World` 内部数据；因为 `main.ts` 会把整个 `GameRuntime` 置空，所以通常足够。若后续有外部订阅、计时器或 Unity 对象引用，需要在这里显式释放。

