# 本地存盘模块

本目录提供不依赖具体玩法的轻量本地存盘边界。

| 文件 | 作用 |
| --- | --- |
| `string-storage.ts` | 定义字符串键值存储接口，并提供内存实现。 |
| `versioned-json-slot.ts` | 在字符串存储之上读写带版本号的 JSON 数据。 |
| `unity-player-prefs-storage.ts` | TypeScript 直接调用 Unity `PlayerPrefs` 的持久化适配器。 |

`VersionedJsonSlot` 不猜测业务数据结构。每个业务模块传入自己的解码和校验函数，避免损坏或过期存档被直接当成可信对象使用。版本不匹配时由业务层决定迁移、重置或提示用户。

纯游戏逻辑只依赖 `StringStorage`。Unity API 仅出现在适配器中，因此逻辑验证可以注入 `MemoryStringStorage`，无需增加 C# 存盘桥接。
