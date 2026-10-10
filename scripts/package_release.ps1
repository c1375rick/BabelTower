# ============================================================
#  Babel Tower - 发布包打包脚本
#  按安装需求打包:VPK + 本地桥 + 内置 Node + 自启/启动脚本 + 说明文档
#  产物: dist\BabelTower-v<版本>-win64.zip
#  用法: powershell -ExecutionPolicy Bypass -File scripts\package_release.ps1
# ============================================================
[CmdletBinding()]
param(
  # 2026-10-09 review: the default was the literal "0.1.0", so running this
  # script on its own (release.ps1 always passes -Version, we do not) staged
  # BabelTower-0.1.0-win64 and overwrote that entry in dist. Single source of
  # truth for the version is the VERSION file - same one release.ps1 reads.
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Dist = Join-Path $Root "dist"
# 注意:$Stage/$ZipOut 不能在这里算 —— 此时 $Version 还是参数默认值(独立运行时为 ""),
# 要等下方从 VERSION 读完再算(见版本单一来源节后的计算点)。

function Fail($msg) { Write-Host "[package] 错误: $msg" -ForegroundColor Red; exit 1 }

# ---- 版本单一来源:VERSION(release.ps1 读的就是它) ----
if (-not $Version) {
  $vfile = Join-Path $Root "VERSION"
  if (Test-Path $vfile) { $Version = (Get-Content $vfile -Raw -Encoding UTF8).Trim() }
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') { Fail "版本号无效: '$Version'(传 -Version 或修正 VERSION 文件)" }

# 2026-10-10 修:这两个必须在 VERSION 读取**之后**算。此前算点在读取前,独立运行
# (不带 -Version,与 release.ps1 不同)时 $Version 还是 "" → 暂存目录成
# BabelTower--win64、zip 名也错 —— 1.0.9 走 release.ps1 显式传参一直掩盖着这个顺序缺陷。
$Stage = Join-Path $Dist "BabelTower-$Version-win64"
$ZipOut = Join-Path $Dist "BabelTower-$Version-win64.zip"

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
$requiredCore = @("bridge_server.js","config.js","dictionary.js","name_protect.js","game_names.js","quickchat.js","loc_parser.js","hero_names.js","steam_paths.js","sync_data.js")
foreach ($f in $requiredCore) {
  if (-not (Test-Path (Join-Path $Stage "core\$f"))) { Fail "core\$f 缺失(桥启动必需)" }
}

# btipc07:桥需要客户端那一版兜底名单当"差分基线" —— 有了它,游戏更新后桥只需下发
# 增删改(几百字节 / 半分钟),否则只能全量走 12.6 B/s 的下行通道(十几分钟)。
# 这两个文件与打进 VPK 的完全同源,包里没有 mod/ 目录,单独补一份到 mod\panorama\scripts\。
Write-Host "==> 复制 btipc07 同步基线..."
New-Item -ItemType Directory -Path (Join-Path $Stage "mod\panorama\scripts") -Force | Out-Null
$syncBaselines = @("lingua_chat_gamenames_pairs_fallback.js","lingua_chat_quickchat_fallback.js")
foreach ($f in $syncBaselines) {
  $src = Join-Path $Root "mod\panorama\scripts\$f"
  if (-not (Test-Path $src)) { Fail "mod\panorama\scripts\$f 缺失(btipc07 同步基线)" }
  Copy-Item $src (Join-Path $Stage "mod\panorama\scripts\$f")
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
# 2026-10-10 修:固定 500ms 不保证进程真正退净,Compress-Archive 紧随其后就撞
# "node.exe being used by another process"(1.0.10 独立打包时实炸)。轮询到句柄释放。
for ($w = 0; $w -lt 40; $w++) {
  Start-Sleep -Milliseconds 250
  if (-not (Get-Process -Id $smokeProc.Id -ErrorAction SilentlyContinue)) { break }
}
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
# 2026-10-10 修:新复制+被执行过的 node.exe 会被实时防护以写意图短暂独占(两次独立
# 打包均实炸 "being used by another process",失败后数秒再探又是 FREE —— 典型扫描窗口)。
# 压缩前按 ZipArchive 的打开方式(Read + Share Read)轮询到可读为止,最多 30s。
$stageNode = Join-Path $Stage "portable-node\node.exe"
$nodeReadable = $false
for ($w = 0; $w -lt 60; $w++) {
  try {
    $probe = [System.IO.File]::Open($stageNode, 'Open', 'Read', 'Read')
    $probe.Close()
    $nodeReadable = $true
    break
  } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $nodeReadable) { Fail "portable-node\node.exe 持续被占用(30s),拒绝在锁定状态出包" }
Compress-Archive -Path "$Stage\*" -DestinationPath $ZipOut -CompressionLevel Optimal
if (-not (Test-Path $ZipOut)) { Fail "压缩失败" }

$size = [math]::Round((Get-Item $ZipOut).Length / 1MB, 1)
Write-Host "==> 完成: $ZipOut ($size MB)"

# 清理暂存目录
Remove-Item $Stage -Recurse -Force
