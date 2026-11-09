@echo off

cd /d "%~dp0"
if not exist "%~dp0scripts\install_babeltower.ps1" (
    echo [LCT] Missing file: scripts\install_babeltower.ps1
    echo [LCT] The install is incomplete. Re-extract the FULL release zip
    echo [LCT] Keep its folder structure intact, then double-click this again.
    echo.
    pause
    exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install_babeltower.ps1"
echo.
pause
