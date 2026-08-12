@echo off
rem 乌合bingo 自动上传 GitHub（双击运行）
cd /d D:\wuhebingo
powershell -ExecutionPolicy Bypass -File "D:\wuhebingo\auto_push.ps1" %*
echo.
pause
