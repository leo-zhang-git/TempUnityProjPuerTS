# 三轨闪避逻辑模块

本目录提供不依赖 Unity 场景对象的三轨闪避核心玩法。TypeScript ECS 持有权威游戏状态，Unity 表现层只发送命令并读取快照。

## 首版规则

- 玩家只能处于 `0`、`1`、`2` 三条离散轨道之一。
- 障碍物和金币从前方生成，并沿距离轴向玩家移动。
- 玩家与同轨障碍物接触后进入 `GameOver`。
- 玩家与同轨金币接触后增加本局金币，金币实体延迟到帧末销毁。
- 生存时间产生基础分，每枚金币额外产生 50 分。
- 物体速度随时间增加，生成间隔随时间缩短。

## 文件职责

| 文件 | 作用 |
| --- | --- |
| `model.ts` | 定义外部命令、游戏阶段和只读快照。 |
| `state.ts` | 定义 ECS 组件、初始化全局状态并生成快照。 |
| `systems.ts` | 实现命令、生成、移动、碰撞、计分、难度和延迟销毁。 |
| `profile.ts` | 定义带稳定 `profileGuid` 的玩家档案、存档校验与存取。 |
| `config.ts` | 从生成的 staticdata client target 读取 `lane-dodge-rules/default`。 |

## 固定帧顺序

```text
CommandSystem
-> SpawnSystem
-> MovementSystem
-> CollisionSystem
-> RunProgressSystem
-> DifficultySystem
-> PendingDestroySystem
```

系统只使用传入的 `deltaTime`。当阶段为 `Paused`、`Menu` 或 `GameOver` 时，玩法模拟不会继续推进。

## 外部边界

`GameRuntime.dispatch()` 接收 `GameCommand`，`GameRuntime.getSnapshot()` 返回 `LaneDodgeSnapshot`。TypeScript 表现层直接使用这两个接口，不进行 JSON 序列化，也不为具体玩法增加 C# 委托。

命令只在下一次 `fixedUpdate()` 开始时消费，因此 UI 和输入层不会在系统执行过程中直接修改 ECS 状态。

## 表现契约

- 本模块不创建或引用 Unity 对象；[UI 表现层](../../ui/README.md) 只消费命令和只读快照。
- 表现对象使用快照中的 `entityGuid` 建立稳定映射，不把 Unity 引用写回游戏状态。

## 存档与确定性

- 玩家档案通过通用 `VersionedJsonSlot` 和 TS `PlayerPrefs` 适配器保存，当前持久化档案 GUID、最高分和累计金币。
- 随机源可通过 `GameRuntimeOptions.random` 注入，以支持确定性验证。
- 生成、难度、碰撞和计分参数由 `TsProj/staticdata/data/lane-dodge-rules/` 持有；修改后运行 `npm.cmd run build:targets:client` 发布 client target。
