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

Write-Host "==> 复制本地桥(core 递归整包)..."
# 2026-09-20 教训: 白名单逐个 Copy 已三次漏文件(hero_names/game_names/loc_parser+quickchat),
# 每次用户侧症状都是桥启动即崩且无日志(开发机 core 完整从未复现)。改为递归整包,新增文件不再漏。
Copy-Item (Join-Path $Root "core\*") (Join-Path $Stage "core\") -Recurse -Force -Exclude "*.bak*"
# 启动依赖断言: 递归之外的保险丝,缺任一必需文件当场 Fail
$requiredCore = @("bridge_server.js","config.js","dictionary.js","name_protect.js","game_names.js","quickchat.js","loc_parser.js","hero_names.js")
foreach ($f in $requiredCore) {
  if (-not (Test-Path (Join-Path $Stage "core\$f"))) { Fail "core\$f 缺失(桥启动必需)" }
}

Write-Host "==> 复制配置示例与脚本..."
Copy-Item (Join-Path $Root "config\config.example.json") (Join-Path $Stage "config\")
Copy-Item (Join-Path $Root "config\dictionary.json") (Join-Path $Stage "config\")
# 内置词典(Thirt927 特性, core/dictionary.js 运行时读取, 必须随包发布)
Copy-Item (Join-Path $Root "config\dictionary.builtin.json") (Join-Path $Stage "config\")
# 游戏专有名词映射(名称保护运行时读取, 由 core/game_names.js 生成)
Copy-Item (Join-Path $Root "config\gamenames.json") (Join-Path $Stage "config\")
Copy-Item (Join-Path $Root "scripts\autostart.ps1") (Join-Path $Stage "scripts\")
# 一键重启桥(autostart 安装成功提示与说明文档都指引它,漏打用户包里就没有)
Copy-Item (Join-Path $Root "restart_bridge.bat") (Join-Path $Stage "restart_bridge.bat")
Copy-Item (Join-Path $Root "scripts\restart_bridge.ps1") (Join-Path $Stage "scripts\")
Copy-Item (Join-Path $Root "scripts\bridge_health.ps1") (Join-Path $Stage "scripts\")
Copy-Item (Join-Path $Root "StartDeadlock.bat") (Join-Path $Stage "StartDeadlock.bat")
# 双击即用的自启安装/卸载包装(内部自动处理路径)
Copy-Item (Join-Path $Root "install-autostart.bat") (Join-Path $Stage "install-autostart.bat")
Copy-Item (Join-Path $Root "remove-autostart.bat") (Join-Path $Stage "remove-autostart.bat")
# 诊断启动器: 前台跑桥,崩溃不闪退,错误停留可见(StartDeadlock 活性检查失败时也指引到它)
Copy-Item (Join-Path $Root "run-bridge.bat") (Join-Path $Stage "run-bridge.bat")

Write-Host "==> 复制内置 Node 运行时..."
Copy-Item (Join-Path $Root "portable-node\node.exe") (Join-Path $Stage "portable-node\node.exe")

# ---- 启动冒烟测试: 打包产物的桥必须真能启动 ----
# 2026-09-20 教训: 1.0.0~1.0.4 所有发布包桥启动即崩,打包机全绿无感知。
# 在暂存目录里用临时端口真启动一次,健康检查 200 才允许出包。
Write-Host "==> 启动冒烟测试..."
$smokePort = 18791 + (Get-Random -Maximum 1000)
# 注意: 必须无 BOM(带 BOM 的 config.json 会被 JSON.parse 拒绝,静默回退默认端口 8791,
# 在打包机上撞正在运行的桥 → EADDRINUSE 假失败);Set-Content -Encoding UTF8 在 PS5.1 带 BOM,故用 WriteAllText
$smokeCfg = '{"port": ' + $smokePort + ', "watchGame": false}'
[System.IO.File]::WriteAllText((Join-Path $Stage "config\config.json"), $smokeCfg, (New-Object System.Text.UTF8Encoding($false)))
$smokeProc = Start-Process -FilePath (Join-Path $Stage "portable-node\node.exe") -ArgumentList ('"' + (Join-Path $Stage "core\bridge_server.js") + '"') -WorkingDirectory $Stage -WindowStyle Hidden -PassThru
$smokeOk = $false
for ($i = 1; $i -le 20; $i++) {
  Start-Sleep -Milliseconds 1000
  if ($smokeProc.HasExited) { break }
  try {
    $r = Invoke-WebRequest -Uri ("http://127.0.0.1:{0}/api/v1/health" -f $smokePort) -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200) { $smokeOk = $true; break }
  } catch { }
}
if (-not $smokeOk) {
  Stop-Process -Id $smokeProc.Id -Force -ErrorAction SilentlyContinue
  $crashLog = Join-Path $Stage "logs\bridge.log"
  if (Test-Path $crashLog) { Write-Host "--- 桥崩溃日志(最后 20 行) ---"; Get-Content $crashLog -Tail 20 | ForEach-Object { Write-Host $_ } }
  Fail "冒烟测试失败: 打包产物的桥无法启动(缺文件或依赖错误,见上方日志)"
}
Stop-Process -Id $smokeProc.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
# 清理冒烟测试产物,不随包发布
# (quickchat.json 是桥启动时从游戏本地化重新生成的,每次启动都会覆盖,不该进包固化)
Remove-Item (Join-Path $Stage "config\config.json") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $Stage "config\quickchat.json") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $Stage "logs") -Recurse -Force -ErrorAction SilentlyContinue
Write-Host ("==> 冒烟测试通过 (127.0.0.1:{0})" -f $smokePort)

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
