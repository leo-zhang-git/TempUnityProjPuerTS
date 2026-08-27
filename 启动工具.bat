@echo off
setlocal
title Unity PuerTS Framework Launcher
chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
cd /d "%~dp0"

where pythonw >nul 2>nul
if errorlevel 1 (
    echo Python with tkinter was not found in PATH.
    pause
    exit /b 1
)
pythonw -c "import tkinter" >nul 2>nul
if errorlevel 1 (
    echo Python tkinter module was not found.
    pause
    exit /b 1
)

start "Unity PuerTS Framework Launcher" pythonw tools\framework_launcher.py
endlocal
