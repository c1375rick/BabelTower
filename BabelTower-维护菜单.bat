@echo off
rem Babel Tower maintenance entry.
rem UTF-8 file + chcp 65001 below: menu is bilingual (Chinese/English).
rem Do NOT save this file as ANSI/GBK and do NOT drop the chcp line,
rem otherwise the Chinese menu turns into mojibake (ASCII-only rule
rem in tests/launcher_entry_guard.test.js is waived for this file only).
chcp 65001 >nul
cd /d "%~dp0"
if not exist "%~dp0scripts\install_babeltower.ps1" (
    echo [LCT] Missing file: scripts\install_babeltower.ps1
    echo [LCT] The install is incomplete. Re-extract the FULL release zip
    echo [LCT] Keep its folder structure intact, then double-click this again.
    echo.
    pause
    exit /b 1
)
if not exist "%~dp0scripts\update_babeltower.ps1" (
    echo [LCT] Missing file: scripts\update_babeltower.ps1
    echo [LCT] Re-extract the FULL release zip
    echo.
    pause
    exit /b 1
)
if not exist "%~dp0scripts\uninstall_babeltower.ps1" (
    echo [LCT] Missing file: scripts\uninstall_babeltower.ps1
    echo [LCT] Re-extract the FULL release zip
    echo.
    pause
    exit /b 1
)
if not exist "%~dp0scripts\diagnose_babeltower.ps1" (
    echo [LCT] Missing file: scripts\diagnose_babeltower.ps1
    echo [LCT] Re-extract the FULL release zip
    echo.
    pause
    exit /b 1
)
if not exist "%~dp0scripts\autostart.ps1" (
    echo [LCT] Missing file: scripts\autostart.ps1
    echo [LCT] Re-extract the FULL release zip
    echo.
    pause
    exit /b 1
)

if "%~1"=="" goto lang
if /i "%~1"=="install" goto do_install
if /i "%~1"=="update" goto do_update
if /i "%~1"=="uninstall" goto do_uninstall
if /i "%~1"=="diagnose" goto do_diagnose
if /i "%~1"=="status" goto do_status
if /i "%~1"=="autostart-on" goto do_autostart_on
if /i "%~1"=="autostart-off" goto do_autostart_off
echo [LCT] Unknown action: %~1
echo [LCT] Usage: %~nx0 [install ^| update ^| uninstall ^| diagnose ^| status ^| autostart-on ^| autostart-off]
echo.
pause
exit /b 1

:lang
echo [LCT] 请选择语言 / Select language:
echo   1 = 中文
echo   2 = English
echo.
set /p lang=选择 / Select [1]:
if "%lang%"=="2" goto menu_en
goto menu_zh

:menu_zh
echo [LCT] 巴别塔维护菜单:
echo   1 = 一键安装 / 首次设置
echo   2 = 从官方 Releases 更新
echo   3 = 卸载 / 还原
echo   4 = 诊断(只读,生成脱敏报告)
echo   5 = 开机自启:开
echo   6 = 开机自启:关
echo.
set /p choice=输入数字 [1-6]:
if "%choice%"=="1" goto do_install
if "%choice%"=="2" goto do_update
if "%choice%"=="3" goto do_uninstall
if "%choice%"=="4" goto do_diagnose
if "%choice%"=="5" goto do_autostart_on
if "%choice%"=="6" goto do_autostart_off
echo [LCT] 已取消。
echo.
pause
exit /b 0

:menu_en
echo [LCT] Babel Tower maintenance:
echo   1 = install / first-time setup
echo   2 = update from official Releases
echo   3 = uninstall / restore
echo   4 = diagnose (read-only report)
echo   5 = enable auto-start with Windows
echo   6 = disable auto-start
echo.
set /p choice=Select [1-6]:
if "%choice%"=="1" goto do_install
if "%choice%"=="2" goto do_update
if "%choice%"=="3" goto do_uninstall
if "%choice%"=="4" goto do_diagnose
if "%choice%"=="5" goto do_autostart_on
if "%choice%"=="6" goto do_autostart_off
echo [LCT] Cancelled.
echo.
pause
exit /b 0

:do_install
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install_babeltower.ps1" %2 %3 %4 %5 %6 %7 %8 %9
echo.
pause
exit /b 0

:do_update
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update_babeltower.ps1" %2 %3 %4 %5 %6 %7 %8 %9
echo.
pause
exit /b 0

:do_uninstall
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\uninstall_babeltower.ps1" %2 %3 %4 %5 %6 %7 %8 %9
echo.
pause
exit /b 0

:do_diagnose
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\diagnose_babeltower.ps1" %2 %3 %4 %5 %6 %7 %8 %9
echo.
pause
exit /b 0

:do_status
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install_babeltower.ps1" -Status %2 %3 %4 %5 %6 %7 %8 %9
echo.
pause
exit /b 0

:do_autostart_on
if not exist "%~dp0scripts\autostart.ps1" (
    echo [LCT] Missing file: scripts\autostart.ps1
    echo [LCT] Re-extract the FULL release zip
    echo.
    pause
    exit /b 1
)
echo [BabelTower] Installing auto-start...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\autostart.ps1" -Action Install
if errorlevel 1 (
    echo.
    echo [LCT] FAILED - see the error above. Nothing was registered.
    pause
    exit /b 1
)
echo.
echo Done. Now you can just launch Deadlock from Steam.
echo Disable anytime: run this again - 6
pause
exit /b 0

:do_autostart_off
if not exist "%~dp0scripts\autostart.ps1" (
    echo [LCT] Missing file: scripts\autostart.ps1
    echo [LCT] Re-extract the FULL release zip
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
exit /b 0
