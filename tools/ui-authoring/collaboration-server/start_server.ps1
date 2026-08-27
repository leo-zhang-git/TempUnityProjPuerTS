param(
    [string]$HostAddress = "0.0.0.0",
    [int]$Port = 8714,
    [string]$Database = "$PSScriptRoot\legma_coordination.sqlite3"
)

python "$PSScriptRoot\legma_coordination_server.py" --host $HostAddress --port $Port --db $Database
