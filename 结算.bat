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
if "%~3"=="" (
  echo Available CSV:
  dir /b "%name%\round_%round%\*.csv" 2>nul
  dir /b "%name%\*.csv" 2>nul
  dir /b "*.csv" 2>nul
  set /p csv="CSV path: "
) else (
  set csv=%3
)
node settle.js "%name%" %round% "%csv%"
pause
