# Staticdata 代码入口

## 阅读顺序

- 先读 `../AGENTS.md` 与 `../doc/staticdata.md`，确认 TypeScript 和运行时消费边界。
- schema 建模读 `doc/schema-design-principles.md`；端裁剪读 `doc/runtime-export-policy.md`；字段迁移读 `doc/field-operations.md`。
- Web 工作台行为读 `tools/doc/web-ui-design.md`。

## 执行边界

- `data/` 是手写源；`generated/`、`targets/`、`dist/`、`dist-web/` 与 `.artifacts/` 是生成输出。
- 新表先定义稳定 identity、唯一键、默认值、引用和 `runtimeExport`，再登记到 `data/schema-registry.ts`。
- 运行时只消费发布到 `../src/staticdata/generated/` 的 client target，不直接导入 authoring 或 Node 工具。
- 修改表源后至少运行 `npm.cmd run typecheck`、`npm.cmd run validate -- --json` 和受影响端的 target build。
- 本目录不承载运行期状态、Unity 对象、场景实例、协议或存档。

## 本地化

- Web 图片预览以仓库根的 `My project/Assets` 为 Unity 资源根。
- client target 发布到 `../src/staticdata/generated/`，由主 TypeScript 项目编译进 `dist/`。
- 不恢复 `longdemo` 的产品表、素材、server/setting workspace 或业务专用交叉校验。
