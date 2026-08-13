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
| `unity-presentation.ts` | 通过 PuerTS 直接创建 uGUI、处理输入并同步实体表现。 |

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

## Unity 表现

- `RuntimeBootstrap.cs` 只转发 Boot、Main、FixedUpdate、Update、LateUpdate 和 Dispose。
- `unity-presentation.ts` 通过 PuerTS 直接创建轨道、玩家、障碍物、金币和 uGUI 页面。
- 表现对象字典使用快照中的 `entityGuid` 创建和回收 Unity UI Image。
- TypeScript 玩法仍不创建或引用 Unity GameObject。
- 通用 uGUI 创建能力位于 `src/ui/unity-ui.ts`。
- 玩家档案通过通用 `VersionedJsonSlot` 和 TS `PlayerPrefs` 适配器保存，当前持久化档案 GUID、最高分和累计金币。
- 尚未实现表现对象池；首版对象量较低，离场视图直接销毁。
- 随机源可通过 `GameRuntimeOptions.random` 注入，以支持确定性测试。
