# Staticdata

`TsProj/staticdata/` 提供参考 `longdemo/program/staticdata` 的 schema 驱动静态配表机制，并按本模板边界完成了本地化：

- `data/<table>/` 是手写 JSON、schema 和表内 helper 的唯一来源。
- `tools/` 提供共享的 materialization、校验、引用索引、canonical plan、CLI、Web 和 MCP 能力。
- `generated/` 由 `npm run codegen` 维护；`targets/client` 与 `targets/server` 由 target pipeline 维护。
- 本地只保留 `lane-dodge-rules` 示例表，不携带 `longdemo` 的产品数据、素材和跨项目业务规则。

## 常用命令

在 `TsProj/staticdata/` 执行：

```powershell
npm.cmd install
npm.cmd run codegen
npm.cmd run validate -- --json
npm.cmd run build:targets
npm.cmd run typecheck
npm.cmd test
npm.cmd run web
npm.cmd run web:launch
```

运行端只消费生成的 `targets/<side>/data/tables/*` 入口，不直接读取 authoring JSON。

Windows 下可直接运行 `start-staticdata-web.bat`、`启动配表编辑工具.bat` 或 `修改导表.bat` 打开 Web 工作台。启动器会先读取仓库根 `frame-config.json` 与本地 `frame-config.local.json`，优先使用 `staticdataWebBase + portSlot`，端口被其它进程占用时从 `staticdataWebBase + slotCount` 起扫描 `fallbackPortCount` 个备用端口；如果命中当前工作区之前的 Web 服务则先关闭并复用该端口，绝不强制关闭其它工作区的进程。等待新服务成功返回 `/api/manifest` 后再打开浏览器页签；首次使用先运行仓库根 `0.初始化框架配置.bat`，运行 `导出配表.bat` 刷新全部 runtime target。仓库根的 `打开配表编辑工具.bat` 是工作台快捷入口。

`npm.cmd run web` 是直接绑定指定端口的底层服务入口；需要端口探测、旧服务替换和浏览器启动时使用 `npm.cmd run web:launch` 或上述 BAT 入口。
