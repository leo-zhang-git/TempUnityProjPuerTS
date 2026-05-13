# Unity PuerTS 模板路线图

<!-- governance-profile:start -->

## Current Stage

阶段 6：正式 ECS 启动验证。

项目当前需要进行 Play Mode 验证：运行时先进入 `Boot`，清理资源，初始化 TypeScript ECS 运行时，然后切换到 `Main`。

## Active Goals

- 阶段 1：Unity 项目中已存在 PuerTS，并具备 C# smoke-test 入口。
- 阶段 2：工作区根目录存在 `TsProj/`，包含最小 TypeScript 项目、源码目录、构建输出目录和编译脚本。
- 阶段 3：Unity 通过 PuerTS 连接到 `TsProj/dist/main.js`。
- 阶段 4：用正式 Boot/Main 场景流替换测试 UI 切片。
- 阶段 5：在 `TsProj/src/ecs/` 和 `TsProj/src/game/` 下建立 TypeScript ECS 基线。
- 阶段 6：运行 Play Mode，验证 Boot-to-Main 启动流。

## Progress

- 当前权威根目录：`doc-governance/My project/`。
- 当前治理画像：`stage-driven`。
- 活跃工作：运行 Unity 场景，确认 `RuntimeBootstrap` 从 `Boot` 开始，初始化 TypeScript ECS 运行时，并切换到 `Main`。
- 剩余工作：确定 Player 构建中的 JavaScript 打包路径，然后才能将模板视为构建就绪。
- 剩余工作：启动和 ECS 基线验证完成后，为 `Main` 增加运行时内容。

## Explicit Non-goals

- 第一版模板切片不包含服务端 TypeScript 结构。
- 第一版模板切片不包含热更打包流水线。
- 第一版模板切片不复制完整的 `../program/TsProj` 树。
- 正式运行时基线不包含测试 UI 或样例 UI。
- 除非明确要求，否则不生成公开 README。

<!-- governance-profile:end -->
