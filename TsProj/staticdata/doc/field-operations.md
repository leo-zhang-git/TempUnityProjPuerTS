# staticdata 字段操作

## 适用范围

- 字段操作面向表格工作台中的顶层 core 导出字段。
- backend 通过 `schemaFieldMutation` capability 声明支持后，Web、HTTP 与 MCP 才开放改名和删除。
- 默认 `schema-first` backend 不提供 schema 源文件写入能力；此时 Web 隐藏字段操作，HTTP 返回 `501 schema_field_mutation_unsupported`，MCP 不注册字段迁移工具。
- 主键和仍被 schema 规则引用的字段不能直接迁移；先调整所属 schema 契约，再重新预览。

## Web 操作

1. 打开目标表和 category，确认当前记录草稿已经保存。
2. 使用列标题旁的改名或删除按钮。
3. 检查预览中的作用域、记录数、显式值数量和 runtime export 范围。
4. 确认后由 backend 写入 schema 与 authoring，并完成校验和发布；页面随后刷新到新 schema。

`Ctrl+S` / `Cmd+S` 是工作台全局保存快捷键。网格页保存全部网格草稿，详情页保存当前记录草稿；预览尚未就绪时等待预览完成后再次保存。

## AI 操作

MCP 使用两阶段入口：

- `preview_schema_field_mutation`：传入 `table`、`category`、`field`、`action`，改名时同时传入 `newName`。
- `apply_schema_field_mutation`：复用预览结果的 `expectedRevision` 执行事务。

backend 返回统一的字段作用域、受影响 category、记录数、显式值数量和 reload 状态。AI 必须先预览再应用，不使用 record patch 模拟 schema 迁移。

## 验收

- schema 字段 key、authoring 记录 key 和字段顺序一致。
- client/server runtime export 按字段 `runtimeExport` 重新生成。
- 生成类型声明、refer、replace_name 与 runtime mirror 由所属 backend 的发布链同步更新。
- 旧字段 key 不残留在本次表的 schema、authoring 和生成产物中。

