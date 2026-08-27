@echo off
setlocal

chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
cd /d "%~dp0"

python tools\framework_launcher.py --action unity
if errorlevel 1 pause
endlocal
