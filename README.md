# Unity PuerTS TypeScript 模板

用于验证和复用 Unity、PuerTS、TypeScript、轻量 ECS、存档与表现适配边界的基础游戏项目框架。

开始开发前请先阅读 [AGENTS.md](AGENTS.md)。

常用工具可通过根目录 `启动工具.bat` 的卡片式界面统一打开；首次使用先执行 `0.初始化框架配置.bat --slot 0`，再通过单页滚动、按配置域分区并显示修改差异的图形化配置中心编辑、应用 `frame-config.json`，或启动 Unity、Legma 和 Staticdata。MCP 配置保存后会同步到工作区 Codex 配置并通知已打开的 Unity Editor；已有 Codex 会话需重启后重建 MCP client。
