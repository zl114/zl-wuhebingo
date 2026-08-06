@echo off
cd /d "%~dp0"
if "%~1"=="" (
  set /p name="Season name: "
) else (
  set name=%1
)
node draw.js season "%name%"
pause
