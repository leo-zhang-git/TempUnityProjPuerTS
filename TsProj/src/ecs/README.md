# src/ecs 目录说明

`src/ecs/` 提供项目通用的轻量 ECS 基础设施，不包含 Unity 场景、Boot/Main 或具体游戏业务。

## 文件职责

| 文件 | 作用 |
| --- | --- |
| `entity.ts` | 定义带品牌标记的 `EntityId`。 |
| `component.ts` | 定义具有唯一运行时身份和默认工厂的 `ComponentType<T>`。 |
| `world.ts` | 管理实体生命周期、组件存储、增删和类型安全查询。 |
| `system.ts` | 定义 `SystemBase` 和统一管理生命周期的 `SystemGroup`。 |

## Entity

实体 ID 只能由 `World.createEntity()` 创建。`World` 会维护实体存活状态：

- 不允许给未创建、已销毁或属于其他 World 的实体添加组件。
- `destroyEntity()` 会从所有组件存储中删除该实体。
- `dispose()` 会清空整个 World；释放后调用其他操作会抛错。

`EntityId` 在类型层使用品牌标记，减少普通数字被误当作实体 ID 的情况；运行时仍由 `World` 校验。

## Component

组件实例保持为纯数据接口或类型，不继承 `ComponentBase`，也不在自身实现初始化和释放逻辑：

```ts
export interface RuntimeState {
  elapsedSeconds: number;
}

export const RuntimeStateComponent = defineComponent<RuntimeState>(
  "game.runtimeState",
  () => ({ elapsedSeconds: 0 })
);
```

`ComponentType<T>` 是组件类型描述对象。每次 `defineComponent` 都会产生独立的运行时身份，即使名称相同也不会混用存储。默认工厂供 `World.emplace()` 初始化组件数据。

组件常用操作：

| 方法 | 语义 |
| --- | --- |
| `add(entity, type, value)` | 首次添加现有数据；重复添加会抛错。 |
| `emplace(entity, type)` | 使用组件类型的默认工厂创建并添加。 |
| `get(entity, type)` | 获取组件；不存在时抛错。 |
| `tryGet(entity, type)` | 获取组件；不存在时返回 `undefined`。 |
| `has(entity, type)` | 判断实体是否拥有组件。 |
| `remove(entity, type)` | 删除组件并返回是否实际删除。 |
| `query(...types)` | 查询同时拥有所有指定组件的实体。 |

`query` 使用可变元组泛型，调用方传入任意数量的组件类型时都会按传入顺序推导返回组件类型。查询从最小组件存储开始遍历，但当前仍会为结果分配数组。

## System

逐帧系统继承 `SystemBase`，只覆盖需要的生命周期钩子：

```ts
export class RuntimeUpdateSystem extends SystemBase {
  constructor() {
    super("runtime.update");
  }

  protected onUpdate(world: World, deltaTime: number): void {
    for (const [, runtime] of world.query(RuntimeStateComponent)) {
      runtime.elapsedSeconds += deltaTime;
    }
  }
}
```

可覆盖的钩子包括：

- `onInitialize(world)`：系统组初始化时调用一次。
- `onUpdate(world, deltaTime)`：系统组每次更新时调用。
- `onDispose(world)`：系统成功初始化后，在释放时调用一次。

外部代码不应直接调用钩子。`SystemBase` 的公开方法负责状态检查，`SystemGroup` 负责按注册顺序初始化和更新，并按相反顺序释放。初始化中途失败时，已经成功初始化的系统会自动回滚。

一次性的 Boot、场景切换或命令逻辑不应为了复用调度器而伪装成逐帧 System，应放在业务生命周期模块中显式调用。

## 设计边界

- `src/ecs/` 不得 import `src/game/`。
- 组件保持纯数据；通用初始化放在 `ComponentType` 工厂中。
- 外部资源的复杂释放应由 System 或业务生命周期统一处理，不给所有组件增加空的 `dispose()`。
- System 之间通过 World 中的数据协作，不直接持有其他 System。
- 查询期间需要批量增删实体或组件时，应先引入延迟命令队列；当前实现没有定义迭代期间结构变更语义。
