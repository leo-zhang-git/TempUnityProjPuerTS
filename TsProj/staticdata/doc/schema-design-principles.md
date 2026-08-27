# Schema 设计原则

## 单一来源

- `data/<table>/schema.ts` 同时服务手写数据校验、工具视图、类型推导、codegen 和 runtime target。
- generated 类型、ref map、表级 accessor 和工具 schema 投影都是派生产物，不建立第二份手写表定义。
- 工具与 service 遇到表差异时先扩展 schema metadata 或表内 fragment，不增加按表名分支。

## 结构表达

- 互斥字段集使用 discriminated union。
- “存在即启用”的一组字段使用可选子对象。
- 同构重复项使用结构化数组，不用编号字段展开。
- 少量无法通过结构表达的依赖使用 `requiresWhen`、`forbidsWhen` 或 XOR 校验。
- 自由动态 key 只有在业务确实需要 map 语义时使用，并通过 `s.map(valueSchema)` 约束所有 value；不把未建模字段塞入开放对象。

## Default 与 optional

- default 是 authoring、resolved view 和 runtime materialization 的共同真相，消费端按必有值使用。
- 语义上必须选择的字段不设置便利默认值；使用 required、union 分支或可选子对象表达。
- `null` 只用于明确的 JSON/API literal 语义；普通缺席通过省略 key 表达。

## ID、ref 与 category

- 表唯一键决定 row identity 和生成 id 类型；跨表选择使用 `s.ref`，同表固定集合使用 enum/literal。
- 一个值允许引用多个逻辑表时使用纯 `s.ref` union；validation、lookup、正反向索引和 target 校验按全部候选表统一处理。
- 字段名不替代引用契约，raw string 不绕过 brand/literal 类型。
- category 表达同一逻辑表的 authoring 分区；row 业务身份仍由唯一键决定。

## Sidecar 与派生

- sidecar 是 row 的稀疏能力分组，适用于少量分类或记录；成为多数记录必需字段时提升到基础结构。
- 派生规则必须确定、无外部 I/O、无时间或随机输入；依赖无环且输出字段只有一个 owner。
- preview、apply、validation 和发布使用同一派生 registry，runtime target 只包含最终值。

## Runtime export

- 表级 `runtimeExport` 定义可导出端，字段级声明只能进一步收窄。
- 端归属按真实运行消费判断，不因对端存在 ref 就扩大为双端。
- 具体判断见 `runtime-export-policy.md`。

## 验收

- 新 schema 能由统一遍历完成校验、物化、工具视图和 target 生成。
- 消费端无需补默认值、类型断言、字段名约定或 per-table 解析分支。
- 结构变化通过 codegen、validation、target build 和受影响端 typecheck。

