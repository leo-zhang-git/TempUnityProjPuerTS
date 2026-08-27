@echo off
setlocal
title Staticdata
chcp 65001 >nul
cd /d "%~dp0"

echo Checking framework configuration...
python ..\..\tools\init_frame_config.py
if errorlevel 1 goto :fail

echo.
echo Checking staticdata dependencies...
call npm.cmd install --ignore-scripts --no-audit --no-fund
if errorlevel 1 goto :fail

echo Starting staticdata Web editor...
call node tools/scripts/start-web.mjs %*
if errorlevel 1 goto :fail
exit /b 0

:fail
set "EXIT_CODE=%errorlevel%"
echo.
echo Staticdata Web editor failed with exit code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%
