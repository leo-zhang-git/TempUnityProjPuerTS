@echo off
setlocal
title Legma
chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
cd /d "%~dp0"

echo.
for /F "delims=" %%A in ('echo prompt $E^| cmd') do set "ESC=%%A"
set "LOGO_BLUE=%ESC%[38;2;78;168;255m"
set "LOGO_GREEN=%ESC%[38;2;70;214;142m"
set "LOGO_YELLOW=%ESC%[38;2;255;214;92m"
set "LOGO_ORANGE=%ESC%[38;2;255;142;80m"
set "LOGO_PINK=%ESC%[38;2;255;105;180m"
set "ERROR_BG=%ESC%[97;41m"
set "LOGO_RESET=%ESC%[0m"

echo  %LOGO_BLUE% _     _____ ____ __  __    _    %LOGO_RESET%
echo  %LOGO_GREEN%^| ^|   ^| ____/ ___^|  \/  ^|  / \   %LOGO_RESET%
echo  %LOGO_YELLOW%^| ^|   ^|  _^|^| ^|  _^| ^|\/^| ^| / _ \  %LOGO_RESET%
echo  %LOGO_ORANGE%^| ^|___^| ^|__^| ^|_^| ^| ^|  ^| ^|/ ___ \ %LOGO_RESET%
echo  %LOGO_PINK%^|_____^|_____\____^|_^|  ^|_/_/   \_\%LOGO_RESET%
echo  %LOGO_BLUE%-------%LOGO_GREEN%-------%LOGO_YELLOW%-------%LOGO_ORANGE%-------%LOGO_PINK%------%LOGO_RESET%
echo                 %LOGO_BLUE%L%LOGO_GREEN%e%LOGO_YELLOW%g%LOGO_ORANGE%m%LOGO_PINK%a%LOGO_RESET%
echo.
echo.

echo Checking Legma dependencies...
python ..\bootstrap_ui_authoring.py
if errorlevel 1 goto :fail

echo Building Legma Web editor...
call npm run build:web
if errorlevel 1 goto :fail

python start_ui_authoring.py --production %*
if errorlevel 1 goto :fail
exit /b 0

:fail
set "EXIT_CODE=%errorlevel%"
echo.
echo %ERROR_BG%Legma failed with exit code %EXIT_CODE%.%LOGO_RESET%
pause
exit /b %EXIT_CODE%
