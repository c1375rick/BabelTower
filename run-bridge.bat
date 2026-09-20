@echo off
rem ============================================================
rem  Babel Tower - diagnostic launcher (run-bridge.bat)
rem  Runs the bridge in the FOREGROUND: errors stay visible
rem  instead of the window flashing away.
rem  While the bridge is running this window stays open; closing
rem  it stops the bridge. Normally you do not need this script -
rem  use install-autostart.bat instead.
rem  If it crashes, send logs\bridge.log to the developer.
rem ============================================================
setlocal
cd /d "%~dp0"

set "NODE_EXE="
if exist "portable-node\node.exe" (
    set "NODE_EXE=portable-node\node.exe"
) else (
    where node >nul 2>nul && set "NODE_EXE=node"
)
if not defined NODE_EXE (
    echo [LCT] Node.js not found. Make sure portable-node\node.exe exists,
    echo [LCT] or install Node.js 18+ and try again.
    pause
    exit /b 1
)

echo [LCT] Starting bridge in foreground (close this window = stop bridge)...
echo [LCT] If an error appears below, send logs\bridge.log with your report.
echo.
"%NODE_EXE%" "core\bridge_server.js"

echo.
echo [LCT] Bridge exited (exit code %errorlevel%).
echo [LCT] If this was unexpected, send logs\bridge.log to the developer.
pause
endlocal
