@echo off
setlocal

set "LEGMA_LAUNCHER=%~dp0tools\ui-authoring\启动UI编辑器.bat"

if not exist "%LEGMA_LAUNCHER%" (
    echo Legma launcher not found: "%LEGMA_LAUNCHER%"
    pause
    exit /b 1
)

call "%LEGMA_LAUNCHER%" %*
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%
