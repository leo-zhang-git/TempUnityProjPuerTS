# src/ecs 目录说明

`src/ecs/` 提供当前项目的轻量 ECS 基础设施。这里的代码应保持通用，不包含具体游戏业务概念。

## 文件职责

| 文件 | 作用 |
| --- | --- |
| `entity.ts` | 定义实体 ID 类型。当前实体只是递增数字。 |
| `component.ts` | 定义组件类型描述对象和 `defineComponent` 工厂。 |
| `world.ts` | 定义 `World`，负责实体创建、组件存储、组件查询和组件增删。 |
| `system.ts` | 定义 `System` 接口和 `runSystems` 调度函数。 |

## 核心概念

### Entity

`EntityId` 当前是 `number`。实体本身不保存数据，只作为组件挂载的键。

### ComponentType

`ComponentType<T>` 是组件类型标识。运行时用 `name` 作为组件存储表的键，类型参数 `T` 用于 TypeScript 静态类型推断。

定义组件时使用：

```ts
export const RuntimeStateComponent = defineComponent<RuntimeState>("game.runtimeState");
```

组件名称应保持全局唯一，建议使用命名空间风格，例如 `game.runtimeState`。

### World

`World` 是一组 ECS 数据的运行空间，内部维护：

- 下一个实体 ID。
- 按组件类型名称分组的组件存储。
- 实体与组件实例之间的映射。

常用方法：

| 方法 | 语义 |
| --- | --- |
| `createEntity()` | 创建新实体 ID。 |
| `add(entity, type, component)` | 给实体添加或覆盖组件。 |
| `get(entity, type)` | 获取组件；不存在时抛错。 |
| `tryGet(entity, type)` | 获取组件；不存在时返回 `undefined`。 |
| `has(entity, type)` | 判断实体是否拥有组件。 |
| `remove(entity, type)` | 移除指定组件。 |
| `query(...)` | 查询同时拥有指定组件的实体。 |

### System

`System` 是一段按生命周期执行的逻辑：

```ts
export interface System {
  readonly name: string;
  update(world: World, deltaTime: number): void;
}
```

系统通过 `World` 读写组件状态，不应该直接依赖其他系统实例。

## 设计边界

- `src/ecs/` 不应 import `src/game/`。
- 不要在 ECS 基础层写 Unity 场景、Boot/Main、具体资源加载等业务词汇。
- `World` 目前没有实体销毁、批量清理、事件队列或系统分组能力；如果后续添加，应先明确调用方和生命周期需求。
- `World.storeFor` 当前用 `ComponentType.name` 作为 Map key，因此组件名称冲突会导致数据混用。新增组件时必须避免重名。

## Agent 修改提示

- 修改 `World.query` 行为时，要检查所有系统是否依赖返回数组的顺序或结构。
- 修改 `System.update` 签名时，要同步更新 `runSystems` 和所有系统工厂。
- 如果需要支持销毁实体，不能只删除一个组件表中的数据，需要考虑所有组件存储中的同一实体 ID。

