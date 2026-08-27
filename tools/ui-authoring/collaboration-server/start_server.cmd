@echo off
python "%~dp0legma_coordination_server.py" --host 0.0.0.0 --port 8714 --db "%~dp0legma_coordination.sqlite3"
