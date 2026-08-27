# Staticdata 运行时与工具

`TsProj/staticdata/` 是本模板的静态配表 owner，迁移自 `longdemo/program/staticdata` 的 schema 驱动机制，并按当前 Unity/PuerTS 工程重新设置路径和数据范围。

## 边界

- `data/<table>/` 持有手写 schema 与 authoring JSON；`data/framework/` 持有 schema DSL、materialization、模板和 accessor 公共能力。
- `tools/src/` 提供 CLI、Web、MCP、workspace revision、canonical plan、引用索引、校验、review、verify 和 runtime catalog。
- `generated/` 是 schema codegen 输出；`targets/<side>/` 是按端裁剪后的运行时 target；两者都由脚本维护。
- 当前只迁入 `lane-dodge-rules` 示例表，不迁入参考项目的产品表、素材、server/setting 业务规则或协议。

## 本地消费

`TsProj/src/game/lane-dodge/config.ts` 通过 `targets/client/data/tables/lane-dodge-rules/info.ts` 读取生成 accessor。Unity/PuerTS 只加载编译后的 TypeScript target，不读取 authoring JSON、Node API 或 Web 工具。

更新表源后，在 `TsProj/staticdata/` 执行 `npm.cmd run build:targets:client`；该命令会先运行 codegen、validation 和 client target build，再把 client target 发布到 `TsProj/src/staticdata/generated/`。发布目录是派生物，不手工编辑。

## 工具入口

- `npm.cmd run codegen` / `codegen:check`：刷新或检查 generated schema accessor。
- `npm.cmd run validate -- --json`：校验 authoring workspace。
- `npm.cmd run build:targets`：生成 client/server target，并发布 client target给 PuerTS。
- `npm.cmd run web`：直接启动本地 Web 工作台；图片预览映射到 `My project/Assets`，默认端口来自根 `frame-config.json` 和本地 `frame-config.local.json`，不负责进程替换或备用端口扫描。
- `npm.cmd run web:launch`：按工作区端口槽位选择首选端口；首选端口被占用时从 `staticdataWebBase + slotCount` 起扫描 `fallbackPortCount` 个备用端口。只关闭当前工作区的旧 Web 服务，等待 `/api/manifest` 就绪后再打开浏览器。
- `npm.cmd run mcp`：启动共享 semantic core 的 MCP server。

schema 建模、端裁剪和 Web 交互细节分别由 `TsProj/staticdata/doc/` 与 `TsProj/staticdata/tools/doc/` 持有；本文件只说明本模板的 owner 和消费边界。
