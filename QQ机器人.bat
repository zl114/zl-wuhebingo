@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ================================
echo   WuheBingo QQ Bot
echo ================================
echo.

set /p QQ="Input QQ number: "
if "%QQ%"=="" echo QQ number required && pause && exit /b

set /p PASS="Input password (or press Enter for QR scan): "

echo.
echo Starting...
echo.
if "%PASS%"=="" (
    node qqbot.js rS1 %QQ% 2>&1
) else (
    node qqbot.js rS1 %QQ% %PASS% 2>&1
)
pause
