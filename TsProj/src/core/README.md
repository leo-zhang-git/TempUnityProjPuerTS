# 通用基础能力

`src/core/` 放置不依赖 ECS、游戏业务或 Unity 的基础能力。

## GUID

`guid.ts` 提供：

| 导出 | 作用 |
| --- | --- |
| `Guid` | 稳定唯一字符串标识的品牌类型。 |
| `GuidGenerator` | 所有 GUID 生成器共同实现的最小接口。 |
| `UuidV7Generator` | 默认 UUIDv7 生成器，支持时间源和随机源注入。 |
| `defaultGuidGenerator` | 进程内共享的默认生成器。 |
| `generateGuid()` | 使用默认生成器创建 GUID。 |
| `asGuid()` / `isGuid()` | 校验外部加载的 GUID 字符串。 |

需要稳定唯一标识的对象统一依赖 `GuidGenerator`，例如实体、存档槽、任务实例或运行时资源句柄。业务模块不得另建递增 ID、时间戳字符串或各自的随机 ID 实现。

默认实现采用 UUIDv7：48 位毫秒时间戳用于排序，同毫秒内使用单调序列，并保留随机位降低跨进程碰撞概率。生成的 GUID 可以直接序列化到 JSON 和本地存档。

使用注入的生成器时，调用方必须保证其不会返回重复值。`World` 还会在自身生命周期内拒绝重复的实体 GUID。
