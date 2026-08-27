# MCP for Unity 本地修改记录

本文记录 `com.coplaydev.unity-mcp` 相对上游包的本地维护规则。升级 MCP for Unity 时，先对照本文复核，再决定是否重新合并本地补丁。

## 当前上游基线

- 当前包版本：`9.7.3`。
- 当前包位置：`My project/PackagesResource/com.coplaydev.unity-mcp/`。
- 包从 `Packages/com.coplaydev.unity-mcp` 迁移到 `PackagesResource/com.coplaydev.unity-mcp` 的版本点为 SVN `r182407`。
- `v9.7.3` 升级提交为 SVN `r182585`。

## 升级前本地修改

### r178013：CodeDom 引用参数改用 response file

- 目的：避免 Unity 工程 asmdef 数量较多时，`ExecuteCode` 通过 CodeDom 编译传入大量 `/r:` 参数，触发 Windows CreateProcess 命令行长度限制。
- 原始文件：`Editor/Tools/ExecuteCode.cs`。
- 当前状态：已保留。当前 `CodeDomCompile` 仍通过临时 `.rsp` response file 传递引用。
- 升级复核关键词：`CodeDomCompile`、`responseFilePath`、`CompilerOptions`、`/r:`.

### r178520：GenericPropertyJSON 与 Enum 字符串归一化

- 目的：让组件属性写入与 `manage_scriptable_object` 能把 Unity serialized tree 形态的 GenericPropertyJSON payload 写回真实 `SerializedProperty`，并支持 `Enum:<Name>` 写法。
- 原始文件：
  - `Editor/Helpers/ComponentOps.cs`
  - `Editor/Tools/ManageScriptableObject.cs`
- 当前状态：已重新合并。`ComponentOps` 提供 `NormalizeSerializedPropertyValue`、`TryNormalizeGenericPropertyNode`、`NormalizeEnumString` 共享入口；组件属性写入与 `manage_scriptable_object` 在进入 `SerializedProperty` 写入前统一归一化 GenericPropertyJSON payload，并支持 `Enum:<Name>`。
- 升级复核关键词：`NormalizeSerializedPropertyValue`、`TryNormalizeGenericPropertyNode`、`NormalizeEnumString`、`Enum:`.
- 验证入口：通过 Unity 编译检查，并用 `manage_components` / `manage_scriptable_object` 分别验证 GenericPropertyJSON tree payload 与 `Enum:<Name>` 写入。

### r181269：Codex 不自动写用户级配置

- 目的：避免 UnityMCP 自动写入用户级 `~/.codex/config.toml`，导致多个工作区共用全局 `unityMCP` 配置并串目录。
- 原始文件：
  - `Editor/Clients/Configurators/CodexConfigurator.cs`
  - `Editor/Clients/McpClientConfiguratorBase.cs`
  - `Editor/Services/ClientConfigurationService.cs`
- `v9.7.3` 升级影响：上游 `v9.7.3` 带回了 Codex 用户级配置器，并新增 `StartupConfigRewrite` 启动扫描入口，旧补丁被覆盖。
- 当前状态：已重新合并并增强。Codex declarative 状态为 manual-only；启动扫描、批量配置、setup window 批量路径均不会写 `~/.codex/config.toml`；单独人工 Configure 与 Manual Setup 仍可用于显式写入。
- 升级复核关键词：`CodexMcpConfigurator`、`SupportsAutoConfigure => false`、`allowAutoRewrite`、`StartupConfigRewrite`、`ConfigureAllDetectedClients`.

## v9.7.3 升级后本地修改

### 当前工作区补丁：从 frame-config 读取本地 HTTP endpoint

- 目的：本模板不以 `program/server/etc/config.json` 为前置，UnityMCP 改由根 `frame-config.json` 的 `tools.mcp.unityEndpoint` 持有本地 endpoint，避免缺少 `clusterID` 时回退到 `longdemo` 使用的 `18080`。
- 当前规则：Unity 插件读取 `tools.mcp.enabled` 和 `tools.mcp.unityEndpoint`，并将 endpoint 归一化为 server base URL；配置缺失、无效或不可读取时使用安全默认值与 `http://127.0.0.1:18180`。已打开的 Editor 监听这两个字段，变化时成对停止 HTTP bridge 与当前项目管理的 server；配置仍启用且此前正在运行或已开启自动启动时，在新 endpoint 自动恢复。
- 文件：
  - `Editor/Helpers/HttpEndpointUtility.cs`
  - `Editor/Services/HttpAutoStartHandler.cs`
- 升级复核关键词：`GetDefaultLocalBaseUrl`、`GetFrameConfigMcpStateKey`、`ApplyFrameConfigAsync`、`frame-config.json`、`unityEndpoint`、`18180`。

### r182745：多开时本地 endpoint 与 pid 状态按项目隔离

- 目的：避免多个 Unity 工程同时打开时，HTTP URL、pidfile、instance token、last pid 等 EditorPrefs 状态互相覆盖。
- 文件：
  - `Editor/Helpers/HttpEndpointUtility.cs`
  - `Editor/Services/Server/PidFileManager.cs`
- 当前规则：
  - Local HTTP endpoint 运行时只从当前项目派生，不读取全局 `MCPForUnity.HttpUrl`。
  - Local HTTP URL 的保存仅用于 UI/诊断兼容，写入 project-scoped key。
  - HTTP server pidfile、instance token、pid、port、启动时间、args hash 使用 `ProjectIdentityUtility.GetProjectHash()` 派生 key。
  - 旧全局 EditorPrefs 仅在 pidfile 属于当前项目时迁移/兼容。
- 升级复核关键词：`GetProjectScopedLocalPrefKey`、`ProjectScopedKey`、`ProjectIdentityUtility.GetProjectHash`、`IsCurrentProjectPidFilePath`.

### 当前工作区补丁：Codex manual-only 自动配置防线

- 目的：补回并增强 `r181269`，覆盖 `v9.7.3` 新增的启动期自动重写路径。
- 文件：
  - `Editor/Clients/IMcpClientConfigurator.cs`
  - `Editor/Clients/McpClientConfiguratorBase.cs`
  - `Editor/Services/StartupConfigRewrite.cs`
  - `Editor/Services/ClientConfigurationService.cs`
  - `Editor/Windows/MCPSetupWindow.cs`
  - `Editor/Windows/Components/ClientConfig/McpClientConfigSection.cs`
  - `README.md`
- 验证入口：仓库根执行 `python tools/check_unity_mcp_codex_config_contract.py`。

## 升级复核流程

1. 记录新上游版本号、上游发布时间、升级提交号。
2. 对照本文的“升级复核关键词”检查关键文件。
3. 优先确认这些边界：
   - Codex 不得被启动扫描、Auto-Setup、Configure All 自动写入用户级 `~/.codex/config.toml`。
   - Local HTTP endpoint 必须来自当前仓库根 `frame-config.json` 的 `tools.mcp.unityEndpoint`，并与 `.codex/config.toml` 一致。
   - 已打开的 Editor 必须在 `tools.mcp.enabled` 或 endpoint 变化后停止旧生命周期，并只在原运行意图仍成立时恢复新生命周期。
   - Local HTTP server pid / pidfile / token / args hash 必须按项目隔离。
   - CodeDom 编译引用必须避免 Windows 命令行长度限制。
4. 对“当前状态：未保留”的旧补丁，先确认业务仍需要，再按当前上游代码结构重新合并并补验证；标记为历史包袱的旧补丁不再恢复。
5. 合并后至少运行 `python tools/check_unity_mcp_codex_config_contract.py`，并通过 Unity 编译检查确认 C# 可编译。
