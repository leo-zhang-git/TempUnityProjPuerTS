@echo off
setlocal

set "UNITY_EXE=F:\Unity6000.6b\Editor\Unity.exe"
set "PROJECT_PATH=%~dp0My project"

if not exist "%UNITY_EXE%" (
    echo Unity editor not found: "%UNITY_EXE%"
    pause
    exit /b 1
)

if not exist "%PROJECT_PATH%\ProjectSettings\ProjectVersion.txt" (
    echo Unity project not found: "%PROJECT_PATH%"
    pause
    exit /b 1
)

start "Unity PuerTS Template" "%UNITY_EXE%" -projectPath "%PROJECT_PATH%"
endlocal
