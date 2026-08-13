@echo off

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\restart_bridge.ps1"
echo.
pause
