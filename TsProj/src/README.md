# src 目录说明

`src/` 是 TypeScript 源码根目录。`tsconfig.json` 的 `rootDir` 指向这里，编译后的 JavaScript 会输出到项目根目录下的 `dist/`。

## 当前结构

| 路径 | 作用 |
| --- | --- |
| `main.ts` | Unity/PuerTS 调用 TypeScript 的组合根，负责组装运行时与 Unity 表现层并转发生命周期。 |
| `core/` | 不依赖 ECS、游戏和 Unity 的通用基础能力，例如 GUID 生成。 |
| `ecs/` | 通用 ECS 基础设施。 |
| `game/` | 游戏运行时、示例玩法逻辑，以及玩法对应的 Unity 表现适配。 |
| `save/` | 通用字符串存储、版本化 JSON 槽和 Unity PlayerPrefs 适配。 |
| `ui/` | TypeScript 直接调用 Unity uGUI 的通用轻量工具。 |

## 入口职责

`main.ts` 是外部调用边界。它不直接承载复杂业务逻辑，只负责：

- 延迟创建 `GameRuntime`。
- 在进入 Main 时创建 TypeScript Unity 表现层。
- 暴露 Boot、Main、Update、Dispose 等生命周期函数。
- 在 `dispose()` 时释放表现层和 runtime，确保下一次启动可以重新创建完整运行环境。

`main.ts` 只暴露通用生命周期。具体玩法命令由 TypeScript 表现层直接调用游戏运行时，不向 C# 增加玩法专用委托或快照桥接。

## 分层约定

- `src/core/` 放最底层通用能力，不依赖 ECS、游戏或 Unity API。
- `src/ecs/` 只放可复用的 ECS 基础概念，可以依赖 `src/core/`，不依赖 `src/game/`。
- 纯游戏逻辑可以依赖 `src/core/` 和 `src/ecs/`，不得依赖 Unity API。
- Unity 表现适配可以依赖游戏逻辑和 `src/ui/`，负责输入、页面和实体视图同步。
- `src/ui/` 只封装通用 Unity uGUI 操作，不依赖具体玩法。
- `src/save/` 的存盘核心不依赖 Unity，只有命名明确的 Unity 适配器可以访问 `PlayerPrefs`。
- `main.ts` 负责组装上述模块，其他模块不要反向依赖 `main.ts`。

当前依赖方向应保持为：

```text
main.ts -> game/lane-dodge/unity-presentation -> ui -> Unity/PuerTS
   |                     |
   +-> game runtime -----+-> game logic -> ecs -> core
   |                             |
   +-> Unity PlayerPrefs adapter +-> save interface
```

Unity API 的直接调用应限制在 `src/ui/` 和 `unity-presentation.ts` 这类明确的表现适配文件中。ECS 和玩法规则保持为可在非 Unity 环境执行的纯 TypeScript。

## 修改提示

- 需要新增逐帧系统时，在对应玩法目录中继承 `SystemBase`，再注册到 `GameRuntime` 对应的 `SystemGroup`。
- Boot、场景切换等一次性步骤放在 `src/game/lifecycle.ts`，由 `GameRuntime` 按运行阶段显式调用。
- 需要新增状态时，在对应玩法状态模块中定义纯数据组件，再由 `GameRuntime` 统一装配。
- 需要扩展 ECS 能力时，修改 `src/ecs/`，同时检查所有已有系统调用方式是否仍然兼容。
