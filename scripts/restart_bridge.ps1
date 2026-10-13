# Babel Tower - 重启本地翻译桥
# ------------------------------------------------------------------
# 用途: 自启动(开机 vbs)或手动启动的桥没拉起来/卡死时,
#       一键杀掉残留进程 -> 重新启动 -> 健康检查确认可用。
#       (自启动偶尔拉不起来时, 双击 restart_bridge.bat 即可)
#
# 用法:
#   双击 F:\BabelTower\restart_bridge.bat
#   或 powershell -ExecutionPolicy Bypass -File scripts\restart_bridge.ps1
#
# 注意: 保持默认 watchGame 模式(桥只监视游戏进程, 2026-08-12 起游戏退出后
# 桥常驻不退出), 不加 --no-watch。
# ------------------------------------------------------------------
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Node = Join-Path $Root "portable-node\node.exe"
$Server = Join-Path $Root "core\bridge_server.js"
# 端口从 config.json 读取(用户改过端口时硬编码 8791 会假报"未通过")
$HealthPort = 8791
$cfgPath = Join-Path $Root "config\config.json"
if (Test-Path $cfgPath) {
  # 2026-10-13: JSON parse instead of a regex over the raw text. The regex took
  # the FIRST `"port": N` anywhere in the file; config.json only has the one
  # top-level port today (verified), but a provider block with a nested "port"
  # appearing first would silently point the health check at the wrong port.
  try {
    $cfg = [System.IO.File]::ReadAllText($cfgPath) | ConvertFrom-Json
    if ($cfg.PSObject.Properties.Name -contains "port" -and $cfg.port) {
      $HealthPort = [int]$cfg.port
    }
  } catch { }
}
$HealthUrl = "http://127.0.0.1:{0}/api/v1/health" -f $HealthPort

if (-not (Test-Path $Node)) { $Node = "node" }
if (-not (Test-Path $Server)) { throw "找不到桥服务器: $Server" }

# 0.5. 并发互斥(2026-10-13):两次 restart 互跑时,A 刚启动的桥会被 B 的
#     杀进程列表扫走(命令行含 bridge_server),B 的健康检查照样打到 A 的桥 ->
#     双方都报 OK 而系统里桥在反复被杀。Mutex 拦掉第二个。
$mutex = New-Object System.Threading.Mutex($false, "Local\BabelTowerRestartBridge")
$ownsMutex = $false
try {
  try { $ownsMutex = $mutex.WaitOne(0) }
  catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
  if (-not $ownsMutex) {
    Write-Host "[LCT] 另一个 restart_bridge 正在运行,本次放弃。" -ForegroundColor Yellow
    exit 1
  }

# 1. 杀掉残留 bridge 进程(只匹配命令行里含 bridge_server 的 node,
#    不碰 openclaw / Adobe 等其他 node 进程)
$killed = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match 'bridge_server' })
if ($killed.Count -gt 0) {
    foreach ($p in $killed) {
        Write-Host ("[LCT] 杀掉残留桥进程 PID {0}" -f $p.ProcessId)
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 800
    # 2026-10-13: 杀掉之后确认真的没了。以前 Stop-Process 的失败被静默吞掉,
    # 旧桥留在端口上,下面的健康检查打到旧实例 -> 输出"重启完成 OK"但根本没换血。
    $alive = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -match 'bridge_server' })
    if ($alive.Count -gt 0) {
        Write-Host ("[LCT] 残留桥进程杀不掉(访问被拒?): PID {0}" -f (($alive | ForEach-Object { $_.ProcessId }) -join ", ")) -ForegroundColor Red
        Write-Host "[LCT] 为避免健康检查打到旧实例误报成功,本次中止。请以管理员身份重试。"
        exit 1
    }
} else {
    Write-Host "[LCT] 没有残留桥进程。"
}

# 2. 启动新桥(隐藏窗口, 保留 watchGame)
Write-Host ("[LCT] 启动桥: {0} {1}" -f $Node, $Server)
# 路径手动加引号:Start-Process 不会自动为含空格/特殊字符的参数加引号
$proc = Start-Process -FilePath $Node -ArgumentList ('"' + $Server + '"') -WorkingDirectory $Root -WindowStyle Hidden -PassThru
Write-Host ("[LCT] 桥进程已启动 PID {0}" -f $proc.Id)

# 3. 健康检查: 真 15 秒死线 + 验尸
#    以前是 15 轮 x (1s sleep + 2s TimeoutSec) = 最坏 45s,注释写的 15 秒是假的;
#    而且新桥秒死(端口被占/配置报错)时循环照跑到底,最后拿旧实例的 200 当成功。
$ok = $false
$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 1000
    if ($proc.HasExited) {
        Write-Host ("[LCT] 桥进程启动后立刻退出(exit={0}),不再等健康检查。" -f $proc.ExitCode) -ForegroundColor Red
        Write-Host ("[LCT] 查看日志: {0}" -f (Join-Path $Root "logs\bridge.log"))
        exit 1
    }
    try {
        $r = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) {
            $ok = $true
            break
        }
    } catch { }
}

# 4. 健康通过后还要确认应答者就是刚起的这个 PID,而不是别的占位进程
if ($ok) {
    $listener = Get-NetTCPConnection -LocalPort $HealthPort -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($listener -and $listener.OwningProcess -ne $proc.Id) {
        Write-Host ("[LCT] 注意: 端口 {0} 的监听进程是 PID {1},与本次启动的 PID {2} 不一致。" -f $HealthPort, $listener.OwningProcess, $proc.Id) -ForegroundColor Yellow
    }
}

if ($ok) {
    Write-Host "[LCT] 健康检查通过: $HealthUrl (200)"
    Write-Host "[LCT] 重启完成 OK"
    $rc = 0
} else {
    Write-Host "[LCT] 桥启动后健康检查未通过(15 秒超时)" -ForegroundColor Yellow
    Write-Host ("[LCT] 查看日志: {0}" -f (Join-Path $Root "logs\bridge.log"))
    $rc = 1
}
} finally {
    if ($ownsMutex) { try { $mutex.ReleaseMutex() } catch { } }
    $mutex.Dispose()
}
exit $rc
