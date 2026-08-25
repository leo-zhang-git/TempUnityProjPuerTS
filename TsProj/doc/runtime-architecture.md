# TypeScript 运行时架构

## 当前入口

- `src/main.ts` 是 Unity/PuerTS 调用的组合根，当前导出 Boot、Main、三类 Update 和 Dispose 生命周期函数。
- `GameRuntime` 持有 TypeScript `World`、SystemGroup 和运行阶段，阶段顺序为 `created -> bootInitialized -> main -> disposed`。
- Unity 的 `RuntimeBootstrap.cs` 创建 PuerTS 环境、加载 `dist/main.js`、转发生命周期并拥有环境销毁责任。
- 当前 `main.ts` 组装 `UnityLaneDodgePresentation` 作为端到端示例；正式项目可以替换该组合，不将它扩展成通用多玩法中转层。

## 模块依赖

```text
src/main.ts
  -> game composition/runtime
  -> explicit Unity presentation adapters -> src/ui + Unity/PuerTS

game rules -> src/ecs -> src/core
save adapters -> src/save contracts
```

- `src/core/` 不依赖 ECS、game、save 或 Unity。
- `src/ecs/` 可以依赖 core，不依赖具体玩法或 Unity。
- 纯游戏模块可以依赖 core、ECS 和 save contract，不直接使用 Unity API。
- Unity 表现适配可以依赖游戏只读状态、命令入口和 `src/ui/`。
- `src/main.ts` 负责装配，任何下层模块不得反向导入它。

## ECS 约束

- Entity 使用稳定 `EntityGuid` 标识；业务状态不依赖集合遍历顺序充当身份。
- Component 是纯数据和默认构造定义，不包含更新行为或 Unity 对象操作。
- System 通过 `World.query()` 读取匹配数据，并由 SystemGroup 按显式顺序执行。
- 影响行为的系统顺序属于运行时契约，修改时同步检查相邻系统、延迟销毁和同帧可见性。
- 系统初始化失败时回滚已初始化资源；释放按初始化逆序执行并保持幂等。
- System 不长期捕获可通过 owner 查询获得的临时实体引用，除非该引用有稳定身份和失效处理。

## 帧与命令边界

- `fixedUpdate` 承载物理相关、确定步长模拟和需要固定顺序的游戏规则。
- `update` 承载普通帧状态与非物理输入采样/消费；`lateUpdate` 承载依赖前序结果的表现同步。
- 输入、UI 和 Unity callback 只提交命令或意图，不在系统迭代中直接改写 ECS 权威状态。
- `deltaTime` 必须有限且非负；需要固定步长的逻辑不得改用墙钟时间。
- 帧末销毁使用显式标记或队列，避免遍历期间使查询结果失效。

## Unity 与表现层

- Unity 拥有 GameObject、Transform、Collider、Animator、AudioSource、Scene 和资源生命周期。
- TypeScript 表现适配可以持有 Unity 引用，但必须在 `dispose` 或场景卸载时释放对象并注销 callback。
- 纯游戏层只发布命令结果、事件或只读视图所需状态，不包含 Unity 类型。
- 表现层可以插值和缓存视觉状态，但不能重新计算伤害、碰撞资格、解锁状态或存档结论。
- 通用 UI 工具不得依赖具体示例；示例 Widget 的业务状态由所属表现适配负责。

## 模板扩展

- 新项目先用垂直切片验证状态 owner、生命周期和 Unity 表现边界，再固化正式目录结构。
- 跨场景长期状态与当前场景临时状态应有不同清理边界，不能只依赖一次 `World.dispose()` 才清理。
- 替换三轨闪避时同步处理组合根、运行时系统注册、存档键、表现对象和局部 README，避免两套业务入口并存。
- 只有经过真实项目验证、拥有多个合理消费者的能力才提升为模板通用层。

## 变更检查

- PuerTS 导出签名改变时同步检查 `RuntimeBootstrap.cs` 的绑定和异常处理。
- System 顺序或阶段改变时检查初始化、更新、销毁和失败回滚。
- 新增 Unity 引用时检查对象销毁、事件退订、场景卸载和域重载。
- 新增持久化状态时检查版本、默认值、无效数据恢复和旧存档兼容策略。
