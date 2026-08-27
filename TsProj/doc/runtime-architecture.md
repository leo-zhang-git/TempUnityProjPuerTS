# TypeScript 运行时架构

## 当前入口

- `src/main.ts` 是 Unity/PuerTS 调用的组合根，当前导出 Boot、Main、三类 Update 和 Dispose 生命周期函数。
- `GameRuntime` 持有 TypeScript `World`、SystemGroup 和运行阶段，阶段顺序为 `created -> bootInitialized -> main -> disposed`。
- Unity 的 `RuntimeBootstrap.cs` 创建 PuerTS 环境、加载 `dist/main.js`、转发生命周期并拥有环境销毁责任。
- 当前 `main.ts` 组装 `UIManager` 并打开示例 Canvas；正式项目可以替换该组合。

## 模块依赖

```text
src/main.ts
  -> game composition/runtime
  -> UIManager -> concrete Canvas/Widget presentation -> Unity/PuerTS
                         -> game command/read-only view contracts

game rules -> src/ecs -> src/core
game rules -> src/staticdata/generated client target
save adapters -> src/save contracts
```

- `src/core/` 不依赖 ECS、game、save 或 Unity。
- `src/ecs/` 可以依赖 core，不依赖具体玩法或 Unity。
- 纯游戏模块可以依赖 core、ECS 和 save contract，不直接使用 Unity API。
- 静态配表由 `staticdata/` authoring 和工具链持有；运行时只依赖发布到 `src/staticdata/generated/` 的纯内存 client target，不读取 Node 文件系统。
- `src/ui/common/`、`CanvasBase` 与 `WidgetBase` 不依赖具体玩法、ECS、save 或组合根。
- `src/ui/canvas/` 与 `src/ui/widgets/` 中的具体表现 owner 可以依赖游戏只读状态和命令入口，不得反向成为游戏规则或 ECS 状态 owner。
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
- `UIManager` 是 UI root、EventSystem、Canvas registry、帧转发和整体释放的唯一全局 owner；具体节点生命周期、Canvas 层级与布局规范由 [src/ui/README.md](../src/ui/README.md) 持有。

## UI Prefab 与 Binder

- Legma UI Authoring 位于 `tools/ui-authoring/`，Source、DeliveryState、正式 Prefab 和 generated binding 的路径契约由根级 `ARCHITECTURE.md` 与 `tools/ui-authoring/README.md` 持有；TypeScript runtime 只消费 Publish 产生的正式 Prefab 和 generated contract。
- `CanvasBase` 通过 generated `prefab-paths.json` 和 C# `LocalUiPrefabLoader` 实例化 `Assets/Resources/UI/Prefab` 下的本地 Prefab；加载接口不承担热更、远程发布或 AssetBundle/Addressables 策略。
- `UINodeBase` 的初始化顺序固定为设置 root、解析 effective Binder declaration、创建嵌套 Widget、执行 `onLoaded()`、进入 loaded 状态；任一步失败都销毁已创建子节点、callback 和所属 root。
- `WidgetFactory` 以 Binder 的 effective `widgetType` 选择具体 TypeScript Widget，并把实例挂入父节点的显隐、Update 和销毁链；未知类型必须显式登记，不使用反射猜测模块。
- Unity Editor generator 从校验通过的 Prefab 生成只读 TypeScript binding 和 Prefab path index；generated 文件不手工修改，业务 Canvas/Widget 通过 `getBinderUI<T>()` 取得类型化视图。
- `StateRootBinding<TState>` 把 Prefab 中的字符串状态集合投影为 TypeScript 联合类型，状态配置仍由 Unity `StateRoot` 持有；`ScrollRectEx` template key 使用独立 Widget identity。
- Binder 节点与字段命名统一由 `doc/ui-node-naming.md` 持有；Legma、Unity Prefab 和 generated binding 不建立第二套命名规则。无法确认组件前缀或无法安全写入 capability 的字段在 Authoring/Projection 阶段阻断。

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
