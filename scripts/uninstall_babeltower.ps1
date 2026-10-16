# Babel Tower —— 卸载 / 还原(默认保守,删东西都要显式开关)
# ------------------------------------------------------------------
# 为什么要有这个:此前只有 remove-autostart.bat(只删自启)。而实际"卸载"散落着五处东西:
#   ① addons 里的 mod 包      ② 自启项        ③ 常驻的桥 + https 终结进程
#   ④ 信任库里的本机证书(用户可见的安全变更)  ⑤ %LOCALAPPDATA%\BabelTower 里的证书状态
# 另外历史上"换装车命名"留下的旧包与几十个 .bak-* 备份从来没人清 —— addons 里堆到
# 几十个我们的文件,任何一个被误当有效包加载都会导致界面重复、行为错乱。
#
# 两条硬纪律(都是本轮踩出来的):
#   * **认包靠内容标记,不靠文件名** —— 手工安装叫 pak15_dir.vpk,旧命名叫
#     650634_pak04_dir.vpk,别人也可能叫 pak25_dir.vpk;文件名完全不可靠。
#     扫描 `Babel Tower` / `LCTBridgePanel` 标记,命中才认定为"我们的"。
#   * **默认不删** —— 列出将要动的东西 + 要多少空间,逐类要确认;
#     删备份/删证书状态必须额外开关(-PurgeBackups / -PurgeState),因为它们不可逆。
#
# 用法:
#   双击 uninstall-babeltower.bat                      # 交互式,逐项确认
#   powershell -File scripts\uninstall_babeltower.ps1 -List   # 只列现状,什么都不改
#   powershell -File scripts\uninstall_babeltower.ps1 -Yes -PurgeBackups -PurgeState  # 全量(无人值守)
#
# 本文件必须带 UTF-8 BOM(PS 5.1 只认带 BOM 的 UTF-8;丢 BOM 会按 GBK 解码,
# 乱码引号能截断参数默认值并引发静默 ABORT —— 2026-10-15 实测)。
# ------------------------------------------------------------------
[CmdletBinding()]
param(
  [switch]$List,         # 只列现状,不改任何东西
  [switch]$Yes,          # 免逐项确认(上层已知情)
  [switch]$KeepMod,      # 保留 mod 包(只清桥/自启/证书)
  [switch]$PurgeBackups, # 真删旧包与 .bak-*(不可逆)
  [switch]$PurgeState,   # 真删 %LOCALAPPDATA%\BabelTower(证书状态,不可逆)
  [string]$GameRoot = $(if ($env:DEADLOCK_ROOT) { $env:DEADLOCK_ROOT } else { "" })
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $Root "logs"
$LogFile = Join-Path $LogDir "uninstall_babeltower.log"

function Say([string]$msg, [string]$level = "info") {
  $line = "[" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "] [" + $level + "] " + $msg
  Write-Host $line
  try {
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
  } catch { }
}
function Confirm([string]$q) {
  if ($Yes) { return $true }
  $a = Read-Host ("  " + $q + "(输入 YES 继续)")
  return ($a -ceq "YES")
}
function Human([double]$bytes) {
  if ($bytes -ge 1GB) { return "{0} GB" -f [math]::Round($bytes / 1GB, 2) }
  if ($bytes -ge 1MB) { return "{0} MB" -f [math]::Round($bytes / 1MB, 1) }
  return "{0} KB" -f [math]::Round($bytes / 1KB, 1)
}

Say ("=== 卸载检查开始 (root=" + $Root + ") ===")

# ---------- 游戏根 ----------
if (-not $GameRoot) {
  foreach ($c in @("C:\SteamLibrary\steamapps\common\Deadlock", "F:\SteamLibrary\steamapps\common\Deadlock")) {
    if (Test-Path (Join-Path $c "game\citadel")) { $GameRoot = $c; break }
  }
}

# ---------- 盘点:addons 里哪些是"我们的" ----------
# 认包靠内容标记。pakNN_dir.vpk 是有效包;*.bak-* / *.dup-* 是历史残件(引擎不会加载,
# 因为名字不是 pakNN_dir.vpk),但它们占地方、且极易被"哪个是我们的"这种问题绊倒。
$activePk = @()
$stalePk = @()
$addons = ""
if ($GameRoot) {
  $addons = Join-Path $GameRoot "game\citadel\addons"
  if (Test-Path $addons) {
    $all = @(Get-ChildItem $addons -Force -File -ErrorAction SilentlyContinue)
    foreach ($f in $all) {
      $isActiveName = $f.Name -match "^pak\d+_dir\.vpk$"
      $isStaleName = $f.Name -match "^pak\d+_dir\.vpk\.(bak|dup)" -or $f.Name -match "\.bak-" -or $f.Name -match "\.dup-"
      if (-not ($isActiveName -or $isStaleName)) { continue }
      # 内容判定:只有命中我们的标记才算数(避免删掉别人的 pak)
      $ours = $false
      try {
        $fs = [System.IO.File]::OpenRead($f.FullName)
        try {
          $buf = New-Object byte[] 65536
          $n = $fs.Read($buf, 0, 65536)
          # 大文件标记可能在更靠后;对候选只读头 64KB 足以覆盖未压缩的编译产物
          $head = [System.Text.Encoding]::ASCII.GetString($buf, 0, [Math]::Max($n, 0))
          $ours = ($head -match "Babel Tower" -or $head -match "LCTBridgePanel" -or $head -match "LCTTranslation")
        } finally { $fs.Close() }
      } catch { }
      if (-not $ours) { continue }
      if ($isActiveName) { $activePk += $f } else { $stalePk += $f }
    }
  }
}

$staleBytes = ($stalePk | Measure-Object Length -Sum).Sum
Say ("有效包(会被引擎加载,内容确认是我们的): " + $activePk.Count + " 个")
foreach ($f in $activePk) { $h = Human $f.Length; Say ("    " + $f.Name + "  " + $h) }
Say ("历史残件(引擎不加载,但占地方/易误认): " + $stalePk.Count + " 个,合计 " + $(if ($staleBytes) { Human $staleBytes } else { "0" }))
foreach ($f in ($stalePk | Sort-Object Name)) { $h = Human $f.Length; Say ("    " + $f.Name + "  " + $h) }

# ---------- 盘点:自启 / 桥进程 / 证书 ----------
$autostartEntry = @(Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup" -Filter "*BabelTower*" -ErrorAction SilentlyContinue)
$bridgeProcs = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and ($_.CommandLine -match 'bridge_server|bridge_https') })
$certMine = @(Get-ChildItem Cert:\CurrentUser\Root -ErrorAction SilentlyContinue | Where-Object { $_.Subject -eq "CN=BabelTower-localhost" })
$stateDir = $(if ($env:BABEL_TOWER_STATE) { $env:BABEL_TOWER_STATE } else { Join-Path $env:LOCALAPPDATA "BabelTower" })

# 汇总行改成"先算变量再拼串":把 $(if …) 直接夹进字符串拼接既难读又易缺括号
# (本文件已因此连错两轮:少一个右括号、把命令调用直接夹进加法)。
$asNames = @(($autostartEntry | ForEach-Object { $_.Name }) -join ", ")
$asTail = $(if ($autostartEntry.Count) { " (" + $asNames + ")" } else { "" })
Say ("自启项: " + $autostartEntry.Count + " 个" + $asTail)

$procIds = @(($bridgeProcs | ForEach-Object { $_.ProcessId }) -join ",")
$procTail = $(if ($bridgeProcs.Count) { " (pid " + $procIds + ")" } else { "" })
Say ("桥进程: " + $bridgeProcs.Count + " 个" + $procTail)

$certTail = $(if ($certMine.Count) { " (" + $certMine[0].Thumbprint + ")" } else { "" })
Say ("受信任证书: " + $certMine.Count + " 个" + $certTail)

# 状态目录体积先算出来:PowerShell 不允许 "x" + Human (…) 把命令调用夹进加法
$stateBytes = 0
if (Test-Path $stateDir) {
  $stateBytes = (Get-ChildItem $stateDir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
}
$stateTail = $(if (Test-Path $stateDir) { " (存在," + (Human $stateBytes) + ")" } else { " (不存在)" })
Say ("证书状态目录: " + $stateDir + $stateTail)

if ($List) {
  Say "-List:到此为止,没有改动任何东西。"
  exit 0
}

# ---------- 前置:游戏在跑就不碰 vpk ----------
$gameRunning = @(Get-Process -Name deadlock -ErrorAction SilentlyContinue).Count -gt 0
if ($gameRunning) { Say "游戏正在运行 —— **不碰 addons 里的任何文件**(运行中替换会留下损坏的半截 VPK)。请退出游戏后重跑。" "warn" }

# ---------- 1. 停桥 ----------
if ($bridgeProcs.Count) {
  Say "停止桥与 https 终结进程…"
  foreach ($p in $bridgeProcs) {
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Say ("  已停 pid " + $p.ProcessId) }
    catch { Say ("  停不掉 pid " + $p.ProcessId + "(" + $_.Exception.Message + ")") "warn" }
  }
} else { Say "没有桥进程在跑,跳过" }

# ---------- 2. 自启 ----------
if ($autostartEntry.Count) {
  if (Confirm "删除开机自启项?") {
    $as = Join-Path $Root "scripts\autostart.ps1"
    if (Test-Path $as) {
      & powershell -NoProfile -ExecutionPolicy Bypass -File $as -Action Remove 2>&1 |
        ForEach-Object { Say ("  autostart| " + $_) }
    } else {
      foreach ($f in $autostartEntry) { Remove-Item $f.FullName -Force -ErrorAction SilentlyContinue }
      Say "  已直接删除启动文件夹里的条目"
    }
    $left = @(Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup" -Filter "*BabelTower*" -ErrorAction SilentlyContinue)
    Say ("自启项剩余: " + $left.Count + " 个" + $(if ($left.Count) { " (删不掉,可能需管理员)" } else { " ✓" }))
  } else { Say "按你的选择保留自启项" }
} else { Say "没有自启项,跳过" }

# ---------- 3. mod 包 ----------
if ($activePk.Count -and -not $KeepMod) {
  if ($gameRunning) {
    Say "游戏在跑,跳过移除 mod 包(退出游戏后重跑)。" "warn"
  } elseif (Confirm ("移除 " + $activePk.Count + " 个有效包(游戏内功能会消失)?")) {
    foreach ($f in $activePk) {
      try {
        Remove-Item $f.FullName -Force -ErrorAction Stop
        Say ("  已移除 " + $f.Name)
      } catch { Say ("  移除失败 " + $f.Name + ": " + $_.Exception.Message) "error" }
    }
  } else { Say "按你的选择保留 mod 包" }
} elseif ($KeepMod) { Say "按要求保留 mod 包(-KeepMod)" }
else { Say "addons 里没有我们的有效包,跳过" }

# ---------- 4. 证书(用户可见的安全变更,要确认) ----------
if ($certMine.Count) {
  Write-Host ""
  Write-Host "受信任的证书:CN=BabelTower-localhost(仅当前用户信任库)"
  Write-Host "  留着 = 以后重装即用;撤销 = 系统里不再有这张本机证书。"
  if (Confirm "从当前用户信任库撤销这张证书?") {
    $cs = Join-Path $Root "scripts\gen_bridge_cert.ps1"
    if (Test-Path $cs) {
      & powershell -NoProfile -ExecutionPolicy Bypass -File $cs -Untrust 2>&1 |
        ForEach-Object { Say ("  cert| " + $_) }
    } else {
      foreach ($c in $certMine) { & certutil.exe -user -delstore Root $c.Thumbprint | Out-Null }
      Say "  已直接用 certutil 撤销(证书脚本不在包内)"
    }
    $left = @(Get-ChildItem Cert:\CurrentUser\Root -ErrorAction SilentlyContinue | Where-Object { $_.Subject -eq "CN=BabelTower-localhost" })
    Say ("信任库剩余条数: " + $left.Count + $(if ($left.Count) { " ✗ 没删干净" } else { " ✓" }))
  } else { Say "按你的选择保留证书信任" }
} else { Say "信任库里没有我们的证书,跳过" }

# ---------- 5. 残件与状态目录(不可逆,必须显式开关) ----------
if ($stalePk.Count) {
  if ($PurgeBackups) {
    if (Confirm ("删除 " + $stalePk.Count + " 个历史残件(不可逆,共 " + (Human $staleBytes) + ")?")) {
      foreach ($f in $stalePk) {
        try { Remove-Item $f.FullName -Force -ErrorAction Stop } catch { Say ("  删不掉 " + $f.Name + ": " + $_.Exception.Message) "warn" }
      }
      $left2 = @(Get-ChildItem $addons -Force -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match "^pak\d+_dir\.vpk\.(bak|dup)" -or $_.Name -match "\.bak-" -or $_.Name -match "\.dup-" })
      Say ("清理后 addons 里的 .bak-/.dup- 残件: " + $left2.Count + " 个" + $(if ($left2.Count) { "(还剩一些,见 logs)" } else { " ✓" }))
    } else { Say "按你的选择保留历史残件" }
  } else {
    Say ("历史残件 " + $stalePk.Count + " 个(" + (Human $staleBytes) + ")已保留。它们不会被引擎加载(名字不是 pakNN_dir.vpk)," +
      "留着只是占地方/看着乱。要真删:重跑并加 -PurgeBackups。")
  }
}

if (Test-Path $stateDir) {
  if ($PurgeState) {
    if (Confirm ("删除证书状态目录 " + $stateDir + "(下次重装要重新生成证书,不可逆)?")) {
      try { Remove-Item $stateDir -Recurse -Force -ErrorAction Stop; Say "  已删除" }
      catch { Say ("  删除失败: " + $_.Exception.Message) "error" }
    } else { Say "按你的选择保留状态目录" }
  } else {
    Say ("状态目录 " + $stateDir + " 已保留(证书 PFX 在里面,删了下次要重新生成)。要真删:重跑并加 -PurgeState。")
  }
}

# ---------- 收尾:复核 ----------
Write-Host ""
Say "==================== 卸载后复核 ===================="
$stillActive = 0
if ($GameRoot -and (Test-Path $addons)) {
  $stillActive = @(Get-ChildItem $addons -Force -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "^pak\d+_dir\.vpk$" }).Count
}
$stillProc = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and ($_.CommandLine -match 'bridge_server|bridge_https') }).Count
$stillCert = @(Get-ChildItem Cert:\CurrentUser\Root -ErrorAction SilentlyContinue | Where-Object { $_.Subject -eq "CN=BabelTower-localhost" }).Count
Say ("addons 里剩余有效 pakNN_dir.vpk: " + $stillActive + " 个" + $(if ($stillActive) { "(可能都是别的 mod —— 本脚本只删内容确认是我们的)" } else { " ✓" }))
Say ("桥进程: " + $stillProc + " 个" + $(if ($stillProc -eq 0) { " ✓" } else { " ✗ 还有残留" }))
Say ("受信任证书: " + $stillCert + " 条" + $(if ($stillCert -eq 0) { " ✓" } else { "(按你的选择保留)" }))
Write-Host ""
Say "要恢复:重新解压发行包并双击 install-babeltower.bat(证书若被撤销会自动重新生成)。"
Say "日志: $LogFile"
exit 0