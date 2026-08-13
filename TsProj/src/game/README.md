# src/game 目录说明

`src/game/` 承载 TypeScript 游戏运行时业务，依赖 `src/ecs/`，负责状态组件、一次性生命周期步骤、逐帧系统和运行时编排。

## 文件职责

| 文件 | 作用 |
| --- | --- |
| `components.ts` | 定义纯数据组件接口、唯一组件类型及其默认工厂。 |
| `lifecycle.ts` | 定义 Boot 初始化和进入 Main 等一次性业务步骤。 |
| `systems.ts` | 定义继承 `SystemBase` 的逐帧系统。 |
| `game-runtime.ts` | 管理 World、SystemGroup 和运行时阶段。 |

## 运行时阶段

`GameRuntime` 使用显式状态机约束外部调用：

```text
created
   |
initializeBoot()
   v
bootInitialized
   |
enterMain()
   v
main
   |
dispose()
   v
disposed
```

- 不能跳过 Boot 直接进入 Main。
- Boot 和 Main 不能重复进入。
- 只有 Main 阶段可以执行 FixedUpdate、Update 和 LateUpdate。
- `dispose()` 可以在任意阶段调用并且幂等；释放后不能继续更新。

对 Unity/PuerTS 暴露的 `main.ts` 函数签名保持不变。

## 组件模型

构造 `GameRuntime` 时创建一个状态实体，通过 `World.emplace()` 挂载：

| 组件 | 数据 | 作用 |
| --- | --- | --- |
| `SceneStateComponent` | `{ current: "Boot" | "Main" }` | 当前逻辑场景。 |
| `EnvironmentStateComponent` | `{ resourcesCleaned; initialized }` | Boot 环境准备状态。 |
| `RuntimeStateComponent` | `{ elapsedSeconds }` | 运行时累计时间。 |

这些组件是纯数据，不继承基类。默认值由各自的 `ComponentType` 工厂集中定义。

## 生命周期与系统边界

`lifecycle.ts` 中的函数只执行一次，由 `GameRuntime` 按阶段显式编排：

```text
markBootResourcesCleaned
   -> initializeEnvironment
   -> activateMainScene
```

`systems.ts` 只放可被 SystemGroup 调度的逐帧系统。当前 `RuntimeUpdateSystem` 通过查询 `RuntimeStateComponent` 累加时间，不捕获固定实体。

SystemGroup 在进入 Main 时初始化：

- `fixedUpdateSystems`
- `updateSystems`
- `lateUpdateSystems`

释放时按照相反顺序关闭系统组，每个组内部也按系统初始化的相反顺序释放，最后释放 World。

## 扩展约定

- 新增组件：在 `components.ts` 定义纯数据类型、组件类型和默认工厂。
- 新增逐帧逻辑：继承 `SystemBase`，使用 `World.query()` 处理匹配实体，并注册到对应 SystemGroup。
- 新增一次性流程：放入 `lifecycle.ts` 或专门的业务模块，由 `GameRuntime` 显式编排。
- 新增运行阶段：同步更新 `RuntimePhase`、状态转换、释放逻辑、`main.ts` 和 Unity 调用方。
- 涉及 Unity 对象、订阅或句柄的系统：在 `onInitialize` 获取，在 `onDispose` 释放。
- 不要让组件持有行为或互相调用；跨系统共享状态通过组件表达。

## 验证

运行 `npm test` 会构建 TypeScript 并执行 ECS 生命周期回归测试；`npm run check` 和 `npm run lint` 分别验证类型和代码规范。
