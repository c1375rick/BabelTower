# ============================================================
#  Babel Tower - 发布包打包脚本
#  按安装需求打包:VPK + 本地桥 + 内置 Node + 自启/启动脚本 + 说明文档
#  产物: dist\BabelTower-v<版本>-win64.zip
#  用法: powershell -ExecutionPolicy Bypass -File scripts\package_release.ps1
# ============================================================
[CmdletBinding()]
param(
  [string]$Version = "0.1.0"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Dist = Join-Path $Root "dist"
$Stage = Join-Path $Dist "BabelTower-$Version-win64"
$ZipOut = Join-Path $Dist "BabelTower-$Version-win64.zip"

function Fail($msg) { Write-Host "[package] 错误: $msg" -ForegroundColor Red; exit 1 }

# ---- 检查必要输入 ----
$vpk = Join-Path $Dist "pak01_dir.vpk"
if (-not (Test-Path $vpk)) { Fail "缺少 $vpk,请先运行 scripts\build.ps1" }
if (-not (Test-Path (Join-Path $Root "portable-node\node.exe"))) { Fail "缺少 portable-node\node.exe(内置 Node 运行时)" }
if (-not (Test-Path (Join-Path $Root "core\bridge_server.js"))) { Fail "缺少 core\bridge_server.js" }

# ---- 组装暂存目录 ----
if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $Stage "core\providers") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $Stage "config") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $Stage "scripts") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $Stage "portable-node") -Force | Out-Null

Write-Host "==> 复制 mod VPK..."
Copy-Item $vpk (Join-Path $Stage "pak01_dir.vpk")

Write-Host "==> 复制本地桥..."
Copy-Item (Join-Path $Root "core\bridge_server.js") (Join-Path $Stage "core\")
Copy-Item (Join-Path $Root "core\config.js") (Join-Path $Stage "core\")
Copy-Item (Join-Path $Root "core\dictionary.js") (Join-Path $Stage "core\")
# hero_names 由 dictionary.js require, 漏掉会导致桥启动崩溃(离线) —— 2026-08-16 用户反馈修复
Copy-Item (Join-Path $Root "core\hero_names.js") (Join-Path $Stage "core\")
Copy-Item (Join-Path $Root "core\providers\*.js") (Join-Path $Stage "core\providers\")

Write-Host "==> 复制配置示例与脚本..."
Copy-Item (Join-Path $Root "config\config.example.json") (Join-Path $Stage "config\")
Copy-Item (Join-Path $Root "config\dictionary.json") (Join-Path $Stage "config\")
# 内置词典(Thirt927 特性, core/dictionary.js 运行时读取, 必须随包发布)
Copy-Item (Join-Path $Root "config\dictionary.builtin.json") (Join-Path $Stage "config\")
Copy-Item (Join-Path $Root "scripts\autostart.ps1") (Join-Path $Stage "scripts\")
Copy-Item (Join-Path $Root "StartDeadlock.bat") (Join-Path $Stage "StartDeadlock.bat")
# 双击即用的自启安装/卸载包装(内部自动处理路径)
Copy-Item (Join-Path $Root "install-autostart.bat") (Join-Path $Stage "install-autostart.bat")
Copy-Item (Join-Path $Root "remove-autostart.bat") (Join-Path $Stage "remove-autostart.bat")

Write-Host "==> 复制内置 Node 运行时..."
Copy-Item (Join-Path $Root "portable-node\node.exe") (Join-Path $Stage "portable-node\node.exe")

Write-Host "==> 复制文档与许可..."
Copy-Item (Join-Path $Root "安装使用说明.txt") (Join-Path $Stage "安装使用说明.txt") -ErrorAction SilentlyContinue
Copy-Item (Join-Path $Root "README.md") (Join-Path $Stage "README.md")
Copy-Item (Join-Path $Root "LICENSE") (Join-Path $Stage "LICENSE")
Copy-Item (Join-Path $Root "LICENSE_NOTICE.md") (Join-Path $Stage "LICENSE_NOTICE.md")

# ---- 打包 ----
Write-Host "==> 压缩..."
if (Test-Path $ZipOut) { Remove-Item $ZipOut -Force }
Compress-Archive -Path "$Stage\*" -DestinationPath $ZipOut -CompressionLevel Optimal
if (-not (Test-Path $ZipOut)) { Fail "压缩失败" }

$size = [math]::Round((Get-Item $ZipOut).Length / 1MB, 1)
Write-Host "==> 完成: $ZipOut ($size MB)"

# 清理暂存目录
Remove-Item $Stage -Recurse -Force
