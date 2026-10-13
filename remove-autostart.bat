@echo off
rem ============================================================
rem  Babel Tower - Remove auto-start (double-click to run)
rem ============================================================
cd /d "%~dp0"
if not exist "%~dp0scripts\autostart.ps1" (
    echo [LCT] Missing file: scripts\autostart.ps1
    echo [LCT] The install is incomplete. Re-extract the FULL release zip
    echo [LCT] Keep its folder structure intact, then double-click this again.
    echo.
    pause
    exit /b 1
)
echo [BabelTower] Removing auto-start...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\autostart.ps1" -Action Remove
if errorlevel 1 (
    echo.
    echo [LCT] FAILED - see the error above.
    pause
    exit /b 1
)
echo.
echo Done.
pause
