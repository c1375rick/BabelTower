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
# 注意: 保持默认 watchGame 模式(游戏退出桥自动关闭), 不加 --no-watch。
# ------------------------------------------------------------------
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Node = Join-Path $Root "portable-node\node.exe"
$Server = Join-Path $Root "core\bridge_server.js"
$HealthUrl = "http://127.0.0.1:8791/api/v1/health"

if (-not (Test-Path $Node)) { $Node = "node" }
if (-not (Test-Path $Server)) { throw "找不到桥服务器: $Server" }

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
} else {
    Write-Host "[LCT] 没有残留桥进程。"
}

# 2. 启动新桥(隐藏窗口, 保留 watchGame)
Write-Host ("[LCT] 启动桥: {0} {1}" -f $Node, $Server)
$proc = Start-Process -FilePath $Node -ArgumentList $Server -WorkingDirectory $Root -WindowStyle Hidden -PassThru
Write-Host ("[LCT] 桥进程已启动 PID {0}" -f $proc.Id)

# 3. 健康检查: 最多等 15 秒
$ok = $false
for ($i = 1; $i -le 15; $i++) {
    Start-Sleep -Milliseconds 1000
    try {
        $r = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) {
            $ok = $true
            break
        }
    } catch { }
}

if ($ok) {
    Write-Host "[LCT] 健康检查通过: $HealthUrl (200)"
    Write-Host "[LCT] 重启完成 OK"
    exit 0
} else {
    Write-Host "[LCT] 桥启动后健康检查未通过(15 秒超时)" -ForegroundColor Yellow
    Write-Host ("[LCT] 查看日志: {0}" -f (Join-Path $Root "logs\bridge.log"))
    exit 1
}
