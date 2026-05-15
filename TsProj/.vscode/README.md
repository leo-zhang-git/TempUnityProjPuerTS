# .vscode 目录说明

`.vscode/` 存放当前 TypeScript 工作区的 VS Code 本地开发配置。它服务于开发体验，不参与运行时代码逻辑。

## 文件职责

| 文件 | 作用 |
| --- | --- |
| `tasks.json` | 定义 `1.watch` 任务，在打开工作区时运行 `1.watch.bat`，持续监听并编译 TypeScript。 |
| `launch.json` | 定义 `Attach PuerTS Runtime` 调试配置，用于附加到 PuerTS/Node 调试端口。 |

## Watch 任务

`tasks.json` 中的 `1.watch` 会：

- 使用 `${workspaceFolder}\1.watch.bat` 作为命令。
- 在工作区根目录运行。
- 设置 `runOn: "folderOpen"`，打开工作区时自动启动。
- 使用 dedicated panel 展示输出。

`1.watch.bat` 内部执行的是 `npm run watch`。

## 调试配置

`launch.json` 中的 `Attach PuerTS Runtime` 使用：

- `type: "pwa-node"`
- `request: "attach"`
- `port: 9230`
- `localRoot: "${workspaceFolder}\\dist"`

这表示调试器会附加到 9230 端口，并把本地编译输出目录 `dist/` 作为源码映射根目录。

## 修改提示

- 如果 Unity/PuerTS 调试端口变化，需要同步修改 `launch.json` 的 `port`。
- 如果 TypeScript 输出目录从 `dist/` 改到其他路径，需要同步修改 `tsconfig.json` 和 `launch.json`。
- 如果不希望打开 VS Code 时自动监听编译，可以移除或调整 `tasks.json` 里的 `runOn: "folderOpen"`。

