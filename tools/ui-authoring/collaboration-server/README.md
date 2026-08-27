# Legma Coordination Server

Legma 的局域网协作感知服务。服务只保存文档身份、内容 hash、昵称、保存时间和短期编辑 lease，不接收 UI Source 内容，也不提供编辑锁。

默认监听 `0.0.0.0:8714`，使用 Python 标准库 `http.server` 与 `sqlite3`，数据库默认位于本目录的 `legma_coordination.sqlite3`。

## 本地验证

```powershell
cd tools/ui-authoring/collaboration-server
python .\test_server.py
.\start_server.ps1 -HostAddress 127.0.0.1
```

## 局域网部署示例

以下以 `192.168.5.113` 为示例地址；客户端默认不连接任何 coordination server。

1. 将本目录复制到 `192.168.5.113`。
2. 放通局域网 TCP `8714`。
3. 运行 `start_server.cmd`，或将同一命令配置为开机任务。
4. 启动 Legma 客户端前显式设置 `LEGMA_COLLAB_SERVER=http://192.168.5.113:8714`；本机联调使用 `http://127.0.0.1:8714`。

客户端还可设置 `LEGMA_COLLAB_PROJECT`、`LEGMA_USER_CONFIG` 和 `TOKEN_BUBBLE_USER`；未设置 `LEGMA_COLLAB_SERVER` 时协作状态保持 unavailable，不影响本地 Save 或 Publish。

服务端可用环境变量：

- `LEGMA_COLLAB_HOST`
- `LEGMA_COLLAB_PORT`
- `LEGMA_COLLAB_DB`
