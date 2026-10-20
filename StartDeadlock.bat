@echo off
rem ============================================================
rem  Babel Tower launcher (pure ASCII only - no CJK here!)
rem  1. Start local translation bridge (core\bridge_server.js)
rem  2. Wait until the bridge answers its health endpoint
rem  3. Launch Deadlock via Steam
rem  If the bridge crashes at startup, a diagnostic window
rem  (run-bridge.bat) opens automatically with the error visible.
rem ============================================================
setlocal
cd /d "%~dp0"

rem Entry self-check: a half-extracted zip otherwise makes PowerShell fail
rem with a raw red error right before the window disappears, which reads
rem like "the button does nothing". Fail early with a readable reason.
set "MISSING="
if not exist "%~dp0core\bridge_server.js" set "MISSING=core\bridge_server.js"
if not exist "%~dp0scripts\bridge_health.ps1" if not defined MISSING set "MISSING=scripts\bridge_health.ps1"
if not exist "%~dp0run-bridge.bat" if not defined MISSING set "MISSING=run-bridge.bat"
if defined MISSING (
    echo [LCT] Missing file: %MISSING%
    echo [LCT] The install is incomplete. Re-extract the FULL release zip
    echo [LCT] Keep its folder structure intact, then run this again.
    echo.
    pause
    exit /b 1
)

set "NODE_EXE="
if exist "portable-node\r\node.exe" (
    set "NODE_EXE=portable-node\r\node.exe"
) else (
    where node >nul 2>nul && set "NODE_EXE=node"
)
if not defined NODE_EXE (
    echo [LCT] Node.js not found. Install Node.js 18+ or put a portable
    echo [LCT] copy at portable-node\r\node.exe
    pause
    exit /b 1
)

echo [LCT] Starting local translation bridge...
start "LinguaChatBridge" /min "%NODE_EXE%" "core\bridge_server.js"

rem Liveness check: poll the health endpoint (reads the port from
rem config). Do NOT use "tasklist node.exe" here - other apps also
rem run on node and would make a dead bridge look alive.
rem Absolute path for find: under Git Bash environments a bare "find"
rem resolves to the UNIX find and eats the pipe silently.
set "FIND_EXE=%SystemRoot%\System32\find.exe"
set "BRIDGE_OK="
for /l %%i in (1,1,15) do (
    if not defined BRIDGE_OK (
        powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bridge_health.ps1" -WaitSeconds 1 | "%FIND_EXE%" "BRIDGE_UP" >nul 2>nul
        if not errorlevel 1 set "BRIDGE_OK=1"
    )
)

if not defined BRIDGE_OK (
    echo [LCT] Bridge failed to start. Opening diagnostic window...
    start "LinguaChatBridge-Diag" cmd /c run-bridge.bat
    echo [LCT] Check the error there, and send logs\bridge.log to the dev.
    pause
    exit /b 1
)

echo [LCT] Bridge is up. Launching Deadlock...
rem -condebug is MANDATORY: without it the game never writes
rem game\citadel\console.log and the bridge cannot read a single [LCT]/BTIPC
rem line back => BTIPC uplink dead => the mod silently does nothing.
rem steam://run/<appid>//<args>/ is the supported way to pass game args
rem (steam://rungameid/ has no argument slot). One-time alternative:
rem Steam library -> Deadlock -> Properties -> Launch Options -> -condebug
start "" "steam://run/1422450//-condebug"

echo [LCT] Done. In game: open chat (Enter), type /tr to open the web settings page.
endlocal
