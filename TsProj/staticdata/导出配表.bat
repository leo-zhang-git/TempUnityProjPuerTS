@echo off
setlocal
cd /d "%~dp0"
call npm.cmd install --ignore-scripts --no-audit --no-fund
if errorlevel 1 (
    echo Failed to install staticdata dependencies.
    pause
    exit /b 1
)
call npm.cmd run build:targets
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" pause
endlocal & exit /b %EXIT_CODE%
