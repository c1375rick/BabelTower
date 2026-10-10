# ============================================================
#  Babel Tower - 一键发布脚本
#  流程: (可选构建) -> 打包完整安装包 -> 生成更新日志 -> gh 发布 -> 版本号自增
#
#  用法:
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 0.2.0 -Build
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -WhatIf   # 演练,不实际发布
#
#  参数:
#   -Version      指定版本(默认读 VERSION 文件)
#   -Build        先运行 build.ps1 编译 VPK(需要 -Csdk12Root)
#   -Csdk12Root   CSDK 12 根目录(仅 -Build 时用)
#   -Draft        创建草稿 Release
#   -WhatIf       只打印将要执行的步骤,不发布
#   -Force        工作区有未提交改动时也继续(默认中止,保证发布内容与代码一致)
# ============================================================
[CmdletBinding()]
param(
  [string]$Version = "",
  [switch]$Build,
  [string]$Csdk12Root = "F:\SteamLibrary\steamapps\common\Deadlock\Reduced_CSDK_12",
  [switch]$Draft,
  [switch]$WhatIf,
  [switch]$Force
)

$ErrorActionPreference = "Continue"  # 原生命令(git/gh)的 stderr 不中断流程,改为显式检查退出码
$Root = Split-Path -Parent $PSScriptRoot
$Dist = Join-Path $Root "dist"

function Fail($msg) { Write-Host "[release] 错误: $msg" -ForegroundColor Red; exit 1 }
function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

# ---------- 代理引导(本机常见本地代理端口在监听时自动启用) ----------
if (-not $env:HTTPS_PROXY) {
  foreach ($port in @(10809, 7890, 1080)) {
    $t = Test-NetConnection -ComputerName 127.0.0.1 -Port $port -WarningAction SilentlyContinue -InformationLevel Quiet
    if ($t) {
      $env:HTTPS_PROXY = "http://127.0.0.1:$port"
      $env:HTTP_PROXY = $env:HTTPS_PROXY
      Write-Host "(代理引导) 使用 http://127.0.0.1:$port"
      break
    }
  }
}

# ---------- 版本 ----------
if (-not $Version) {
  $Version = (Get-Content (Join-Path $Root "VERSION") -Raw -Encoding UTF8).Trim()
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') { Fail "版本号格式无效: $Version(应为 x.y.z)" }
$Tag = "v$Version"
Write-Host "目标版本: $Version (tag: $Tag)"

# ---------- 工作区检查 ----------
cd $Root
$dirty = git status --porcelain 2>$null
if ($dirty -and -not $Force) {
  Fail "工作区有未提交改动:`n$dirty`n请先提交,或加 -Force 强制发布"
}

# ---------- 构建 ----------
if ($Build) {
  if (-not (Test-Path $Csdk12Root)) { Fail "CSDK 根目录不存在: $Csdk12Root" }
  Step "编译 VPK..."
  if ($WhatIf) { Write-Host "  (WhatIf) 运行 build.ps1" }
  else {
    powershell -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\build.ps1") -Csdk12Root $Csdk12Root
    if ($LASTEXITCODE -ne 0) { Fail "build.ps1 失败(exit=$LASTEXITCODE)" }
  }
}

# ---------- 打包 ----------
Step "打包完整安装包..."
if ($WhatIf) { Write-Host "  (WhatIf) 运行 package_release.ps1 -Version $Version" }
else {
  powershell -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\package_release.ps1") -Version $Version
  if ($LASTEXITCODE -ne 0) { Fail "package_release.ps1 失败(exit=$LASTEXITCODE)" }
}

$Zip = Join-Path $Dist "BabelTower-$Version-win64.zip"
$Vpk = Join-Path $Dist "pak01_dir.vpk"
if (-not (Test-Path $Zip)) { Fail "缺少安装包: $Zip" }
if (-not (Test-Path $Vpk)) { Fail "缺少 VPK: $Vpk" }

# ---------- 生成更新日志 ----------
Step "生成更新日志..."
cd $Root
git fetch --tags 2>&1 | Out-Null
$prevTag = ""
try { $prevTag = (git describe --tags --abbrev=0 2>&1 | Select-Object -First 1).Trim() } catch {}
if ($prevTag) {
  $log = git log "$prevTag..HEAD" --oneline --no-decorate 2>$null
  $logSection = "自 $prevTag 以来的提交:`n`n$log"
} else {
  $log = git log --oneline --no-decorate 2>$null
  $logSection = "提交记录:`n`n$log"
}
$notes = @"
Babel Tower v$Version

完整安装包($([System.IO.Path]::GetFileName($Zip)))含:VPK + 本地桥 + 内置 Node + 自启脚本 + 安装说明,下载即用。

## 更新内容
$logSection

## 安装(3 步)
1. 解压 zip,Mod Manager 导入 pak01_dir.vpk
2. powershell -ExecutionPolicy Bypass -File scripts\autostart.ps1 -Action Install
3. 游戏内 /tr → 测试 → 保存

详细说明见包内《安装使用说明.txt》。
"@
$notesFile = Join-Path $env:TEMP "babeltower_notes_$Version.md"
[System.IO.File]::WriteAllText($notesFile, $notes, (New-Object System.Text.UTF8Encoding($true)))
if ($WhatIf) { Write-Host "  (WhatIf) 更新日志将写入: $notesFile" }

# ---------- 推送 ----------
# 2026-10-10:停用原"VERSION 补丁号自动自增"步骤。原因:
#  1) tests/lc_btipc_guard.test.js 锁 "const VERSION 主版本 == VERSION 文件",单边自增
#     VERSION 会让测试当场转红(两处必须一起改,而 const 是打进 VPK 的,发布后不能单边动);
#  2) §16.7 版本口径 = VERSION 文件即发布号(发完停在已发版本,下一窗口手动双处升 1.0.11);
#  3) 1.0.8/1.0.9 实际均手动升版,从未走过这个自增 —— 此步是旧流程遗留。
if ($WhatIf) {
  Write-Host "  (WhatIf) 之后将: git push origin main(发布提交上远端;不自动自增 VERSION)"
  exit 0
}

Step "推送 main 到 origin..."
git push origin main 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "git push 失败,请手动推送" }

Step "创建 GitHub Release..."
$args = @("release", "create", $Tag, $Zip, $Vpk, "--title", "Babel Tower v$Version", "--notes-file", $notesFile)
if ($Draft) { $args += "--draft" }
gh @args 2>&1 | Select-Object -Last 2
if ($LASTEXITCODE -ne 0) { Fail "gh release create 失败" }

# ---------- 收尾 ----------
# (原"版本号自增"段已于 2026-10-10 停用,见上方推送节说明;VERSION 停在已发版本)
Write-Host ""
Write-Host "发布完成: https://github.com/c1375rick/BabelTower/releases/tag/$Tag" -ForegroundColor Green
