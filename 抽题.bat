@echo off
cd /d "%~dp0"
if "%~1"=="" (
  set /p name="Season name: "
) else (
  set name=%1
)
if "%~2"=="" (
  set /p round="Round number: "
  if "%round%"=="" set round=1
) else (
  set round=%2
)
node draw.js round "%name%" %round%
pause
