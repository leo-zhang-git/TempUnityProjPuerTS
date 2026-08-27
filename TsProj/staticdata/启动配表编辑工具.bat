@echo off
setlocal
set "STATICDATA_LAUNCHER=%~dp0start-staticdata-web.bat"
if not exist "%STATICDATA_LAUNCHER%" (
    echo Staticdata launcher not found: "%STATICDATA_LAUNCHER%"
    pause
    exit /b 1
)
call "%STATICDATA_LAUNCHER%" %*
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" pause
endlocal & exit /b %EXIT_CODE%
