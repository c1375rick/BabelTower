# Babel Tower —— 一键检测 / 脱敏诊断报告
# ------------------------------------------------------------------
# 定位:用户说"没反应""译文不出来""是不是坏了"时,最短路径是把状态一次性摊开,
# 而不是让他猜。这个脚本只读:不改配置、不装东西、不动信任库、不停进程。
#
# 为什么要"脱敏":报告会进 logs/ 与用户的截图/工单,里面绝不能出现 API Key、
# 证书私钥口令、Steam 账号路径细节。实现上不是"记得别打印",而是**收集完统一过一遍
# 脱敏函数再落盘/打印** —— 漏一处就是泄露一处。
#
# 关键设计:每个检查都给出**判据**而不是只给结论。没有判据的报告等于让用户自己推理,
# 而这正是"到底哪里坏了"最费时的部分。
#
# 用法:
#   双击 diagnose-babeltower.bat
#   powershell -File scripts\diagnose_babeltower.ps1 -Quiet      # 只输出结论行
#   powershell -File scripts\diagnose_babeltower.ps1 -OpenLog   # 顺带打开报告文件
#
# 退出码:0 = 关键项全过;1 = 有关键项失败(其余仍会照常检查并报告)
#
# 本文件必须带 UTF-8 BOM(PS 5.1 只认带 BOM 的 UTF-8;丢 BOM 会按 GBK 解码,
# 乱码引号能截断参数默认值并引发静默 ABORT —— 2026-10-15 实测)。
# ------------------------------------------------------------------
[CmdletBinding()]
param(
  [switch]$Quiet,   # 只打印结论行
  [switch]$OpenLog, # 结束后打开报告
  [string]$GameRoot = $(if ($env:DEADLOCK_ROOT) { $env:DEADLOCK_ROOT } else { "" })
)

$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $Root "logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$Report = Join-Path $LogDir ("diagnose_" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".txt")

$script:Buf = New-Object System.Collections.ArrayList
$script:Problems = @()
$script:Warns = @()

function Line([string]$s) { $null = $script:Buf.Add($s) }
function Ok([string]$name, [string]$detail, [string]$judge) {
  Line ("  [OK]   " + $name.PadRight(22) + " " + $detail)
  Line ("         判据: " + $judge)
}
function Warn([string]$name, [string]$detail, [string]$judge) {
  Line ("  [warn] " + $name.PadRight(22) + " " + $detail)
  Line ("         判据: " + $judge)
  $script:Warns += ($name + ": " + $detail)
}
function Bad([string]$name, [string]$detail, [string]$judge, [string]$fix) {
  Line ("  [FAIL] " + $name.PadRight(22) + " " + $detail)
  Line ("         判据: " + $judge)
  if ($fix) { Line ("         处理: " + $fix) }
  $script:Problems += ($name + ": " + $detail)
}

# ---------- 脱敏:统一出口,不是"记得别打印" ----------
function Redact([string]$s) {
  if ($null -eq $s) { return "" }
  $t = $s
  # 常见 key 前缀的长串一律打码(即使是我们没预料到的字段名)
  $t = [regex]::Replace($t, '(?i)(sk-|sentinel_)[A-Za-z0-9_\-]{8,}', '$1***REDACTED***')
  $t = [regex]::Replace($t, '(?i)("?(apiKey|apikey|key|token|secret|password|pwd)"?\s*[:=]\s*"?)([^",\s}]{6,})', '$1***REDACTED***')
  # 长得像密钥的无前缀 base64 串(>=32字符且混大小写数字)
  $t = [regex]::Replace($t, '(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{32,}={0,2}(?![A-Za-z0-9+/=])', '***REDACTED-LONG-BLOB***')
  return $t
}
function Emit {
  foreach ($l in $script:Buf) { Write-Host (Redact $l) }
}

Line ("Babel Tower 诊断报告  " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
Line ("安装目录: " + $Root)
Line ""

# ---------- 1. Node ----------
Line "== 1. 运行环境 =="
$nodeExe = Join-Path $Root "portable-node\node.exe"
$nodeVer = ""
if (Test-Path $nodeExe) {
  try { $nodeVer = (& $nodeExe -v 2>&1 | Out-String).Trim() } catch { }
  Ok "Node" ("portable-node " + $nodeVer) "自带 node 可执行(发行包应自带,不依赖系统 PATH)"
} else {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) {
    try { $nodeVer = (& node -v 2>&1 | Out-String).Trim() } catch { }
    Warn "Node" ("只有系统 node(" + $nodeVer + "),没有 portable-node") "发行包解压不完整,或你用的是源码目录"
  } else {
    Bad "Node" "找不到 node" "桥需要 node 才能跑" "重新解压完整发行包"
  }
}

# ---------- 2. 版本 ----------
Line ""
Line "== 2. 版本 =="
$verFile = Join-Path $Root "VERSION"
$localVer = ""
if (Test-Path $verFile) { $localVer = (Get-Content $verFile -Raw -Encoding UTF8).Trim() }
$srcVer = ""
$srcFile = Join-Path $Root "mod\panorama\scripts\lingua_chat.js"
if (Test-Path $srcFile) {
  $m = [regex]::Match((Get-Content $srcFile -Raw -Encoding UTF8), 'VERSION\s*=\s*"([^"]+)"')
  if ($m.Success) { $srcVer = $m.Groups[1].Value }
}
if ($localVer) { Ok "本地 VERSION" $localVer "根目录 VERSION 文件可读" } else { Warn "本地 VERSION" "(发行包里可能没有这个文件,正常)" "-" }
if ($srcVer) { Ok "脚本版本串" $srcVer "从 lingua_chat.js 的 VERSION 常量读出" }

# ---------- 3. 桥 ----------
Line ""
Line "== 3. 本地桥 =="
$health = $null
try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:8791/api/v1/health" -TimeoutSec 3
} catch { }
if ($health -and $health.ok) {
  $prov = [string]$health.provider
  $keys = @()
  if ($health.providers) { $keys = @($health.providers | ForEach-Object { $_.id }) }
  Ok "桥 http" ("运行中  版本=" + $health.version + "  provider=" + $prov) "GET /api/v1/health 返回 ok:true"
  Line ("         可用 provider: " + $(if ($keys.Count) { $keys -join ", " } else { "(未列出)" }))
  $chatLog = $health.chatLog
  if ($chatLog) {
    Line ("         聊天日志: " + $(if ($chatLog.enabled) { "开 -> " + $chatLog.dir } else { "关" }))
  }
} else {
  Bad "桥 http" "不通(8791 无响应或返回非 ok)" "健康检查 3 秒内必须 200 且 ok:true" "双击 install-autostart.bat 或 restart_bridge.bat"
}
# 网页设置页(1.2.1 起:游戏内 /tr 打开的就是它)
try {
  $ui = Invoke-WebRequest -Uri "http://127.0.0.1:8791/ui" -UseBasicParsing -TimeoutSec 3
  if ($ui.StatusCode -eq 200 -and $ui.Content -match 'id="uiLang"') {
    Ok "网页设置页" "可达(http://127.0.0.1:8791/ui)" "1.2.1 起:游戏内按 /tr 用浏览器打开这个页面;服务商/语言/游戏内行为都在那儿,保存后游戏 1 秒内生效"
  } else {
    Warn "网页设置页" "返回了 " + $ui.StatusCode + ",但不是预期的设置页" "core\web\ui.html 缺失或被改坏;游戏内 /tr 会打开一个打不开的页面"
  }
} catch {
  Warn "网页设置页" "打不开" "桥不通或 core\web\ui.html 缺失;游戏内 /tr 会打不开浏览器页面"
}

# 桥配置:只报"设没设",绝不报值
$cfgPath = Join-Path $Root "config\config.json"
if (Test-Path $cfgPath) {
  try {
    $raw = Get-Content $cfgPath -Raw -Encoding UTF8
    $cfg = $raw | ConvertFrom-Json
    $hasKey = $false
    foreach ($k in @("microsoft", "deepl", "google", "openai", "free")) {
      $p = $cfg.PSObject.Properties[$k]
      if ($p -and $p.Value -and $p.Value.apiKey -and ([string]$p.Value.apiKey).Length -gt 0) { $hasKey = $true }
    }
    $port = $cfg.port
    $line = "provider=" + $cfg.provider + "  port=" + $port + "  至少一个 provider 配了 Key=" + $hasKey
    if ($hasKey) { Ok "桥配置" $line "config.json 可解析且至少一个 provider 有 Key(**只查有没有,不读值**)" }
    else {
      Warn "桥配置" $line "配了 Key 才能翻;免费源(google/bing)无 Key 也能用,此告警不一定是故障"
    }
  } catch {
    Bad "桥配置" ("config.json 解析失败: " + $_.Exception.Message) "必须是合法 JSON" "用设置面板重存一次,或从 config.example.json 复制一份"
  }
} else {
  Bad "桥配置" "config.json 不存在" "桥没有它会用默认值,provider/Key 都不对" "复制 config\config.example.json 为 config.json,或跑一次 install-babeltower.bat"
}

# ---------- 4. https 面板通道(证书) ----------
Line ""
Line "== 4. https 面板通道(低延迟回程;没有也能用,只是慢) =="
$stateDir = $(if ($env:BABEL_TOWER_STATE) { $env:BABEL_TOWER_STATE } else { Join-Path $env:LOCALAPPDATA "BabelTower" })
$pfx = Join-Path $stateDir "cert\bridge.pfx"
$certMine = @(Get-ChildItem Cert:\CurrentUser\Root -ErrorAction SilentlyContinue | Where-Object { $_.Subject -eq "CN=BabelTower-localhost" })
if (Test-Path $pfx) {
  Ok "证书已生成" $pfx "PFX 存在(桥侧 https 终结进程需要它)"
} else {
  Warn "证书未生成" ("没有 " + $pfx) "没证书 = https 通道不可用,翻译走 BTIPC"
}
if ($certMine.Count) {
  $c = $certMine[0]
  $days = [int]([math]::Floor(($c.NotAfter - (Get-Date)).TotalDays))
  if ($days -gt 30) { Ok "证书受信" ($c.Thumbprint + "  " + $c.NotAfter.ToString("yyyy-MM-dd") + "(" + $days + " 天后到期)") "当前用户信任库里有它" }
  else { Warn "证书受信" ($c.Thumbprint + "  仅剩 " + $days + " 天") "30 天内到期:重跑 gen_bridge_cert.ps1 会复用未过期证书,过期后自动重签" }
} else {
  Warn "证书未受信" "当前用户信任库里没有 CN=BabelTower-localhost" "未受信 = 引擎会拒面板 https(error:-202),翻译走 BTIPC;信任后必须完全退出并重启 Steam"
}

# https 端口是否在听(只验链路,不验信任)
function Test-Port($hostName, $port, $timeoutMs = 2500) {
  $tcp = $null; $ssl = $null
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $iar = $tcp.BeginConnect($hostName, $port, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne($timeoutMs)) { return $false }
    $tcp.EndConnect($iar)
    $ssl = New-Object System.Net.Security.SslStream($tcp.GetStream(), $false, { param($s, $c, $ch, $e) $true })
    $ssl.AuthenticateAsClient($hostName)
    $req = "GET /api/v1/health HTTP/1.1`r`nHost: localhost`r`nConnection: close`r`n`r`n"
    $b = [System.Text.Encoding]::ASCII.GetBytes($req)
    $ssl.Write($b, 0, $b.Length); $ssl.Flush()
    $headBuf = New-Object byte[] 128
    $n = $ssl.Read($headBuf, 0, 128)
    if ($n -le 0) { return $false }
    return ([System.Text.Encoding]::ASCII.GetString($headBuf, 0, $n) -match "200")
  } catch { return $false }
  finally { try { if ($ssl) { $ssl.Close() } } catch { }; try { if ($tcp) { $tcp.Close() } } catch { } }
}
if (Test-Port "localhost" 8792) {
  Ok "https 端口" "8792 通(TCP+TLS+HTTP 200)" "终结进程在听且能代理;能不能被引擎接受由**客户端开机探针**判定"
} else {
  Warn "https 端口" "8792 不通" "证书缺失时终结进程会以退出码 3 退出,属正常降级;看 logs\bridge_https.log"
}

# ---------- 5. 游戏侧 ----------
Line ""
Line "== 5. 游戏侧 =="
$running = @(Get-Process -Name deadlock -ErrorAction SilentlyContinue)
if ($running.Count) { Ok "游戏进程" ("运行中 (pid " + (($running | ForEach-Object { $_.Id }) -join ",") + ")") "装/换包必须在游戏退出时做" }
else { Ok "游戏进程" "未运行" "装/换包的好时机" }

if (-not $GameRoot) {
  foreach ($c in @("C:\SteamLibrary\steamapps\common\Deadlock", "F:\SteamLibrary\steamapps\common\Deadlock")) {
    if (Test-Path (Join-Path $c "game\citadel")) { $GameRoot = $c; break }
  }
}
if ($GameRoot) {
  Ok "游戏根" $GameRoot "game\citadel 存在"
  # -condebug:桥唯一能收到游戏消息的途径
  $clog = Join-Path $GameRoot "game\citadel\console.log"
  if (Test-Path $clog) {
    $age = [int]((Get-Date) - (Get-Item $clog).LastWriteTime).TotalMinutes
    $size = [math]::Round((Get-Item $clog).Length / 1KB, 1)
    if ($age -le 120) { Ok "console.log" ("存在," + $age + " 分钟内有更新, " + $size + " KB") "桥靠读它收游戏消息;陈旧 = 游戏没带 -condebug 或没在跑" }
    else { Bad "console.log" ("存在但 " + $age + " 分钟没更新(" + $size + " KB)") "游戏跑着时它应该持续增长" "启动参数加 -condebug(Steam → 属性 → 启动选项);这是**静默失效**的最常见原因" }
    # 通道判据:客户端开机探针的结论就写在游戏侧日志里
    try {
      $tail = Get-Content $clog -Tail 400 -ErrorAction SilentlyContinue
      $alive = @($tail | Where-Object { $_ -match "https panel: ALIVE" }).Count
      $dead = @($tail | Where-Object { $_ -match "https panel: not usable" }).Count
      if ($alive -gt 0) { Ok "面板通道" ("最近日志里有 " + $alive + " 条 https panel: ALIVE") "低延迟回程已启用" }
      elseif ($dead -gt 0) { Warn "面板通道" ("最近日志里 " + $dead + " 条 https panel: not usable") "低延迟没启用(多半是没信任证书/没重启 Steam),功能不受影响" }
      else { Line "         (最近 400 行里没有面板通道的判据行 —— 该行只在进对局后的探针里出现)" }
    } catch { }
  } else {
    Bad "console.log" ("不存在: " + $clog) "桥只认这个文件" "游戏必须带 -condebug 启动参数才会生成它"
  }
  # mod 包:内容标记认包,不靠文件名
  $addons = Join-Path $GameRoot "game\citadel\addons"
  if (Test-Path $addons) {
    $active = @(Get-ChildItem $addons -Force -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "^pak\d+_dir\.vpk$" })
    $ours = @()
    foreach ($f in $active) {
      try {
        $fs = [System.IO.File]::OpenRead($f.FullName)
        try {
          $headBuf = New-Object byte[] 65536
          $n = $fs.Read($headBuf, 0, 65536)
          $head = [System.Text.Encoding]::ASCII.GetString($headBuf, 0, [Math]::Max($n, 0))
          if ($head -match "Babel Tower" -or $head -match "LCTBridgePanel") { $ours += $f }
        } finally { $fs.Close() }
      } catch { }
    }
    $stale = @(Get-ChildItem $addons -Force -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match "^pak\d+_dir\.vpk\.(bak|dup)" -or $_.Name -match "\.bak-" -or $_.Name -match "\.dup-" })
    if ($ours.Count -eq 1) {
      $kb = [math]::Round($ours[0].Length / 1KB, 0)
      $when = $ours[0].LastWriteTime.ToString("MM-dd HH:mm")
      Ok "mod 包" ("{0}  {1} KB  {2}" -f $ours[0].Name, $kb, $when) "内容确认是我们的,且只有一份"
    } elseif ($ours.Count -eq 0) {
      Bad "mod 包" ("有效包里没有我们的(" + $active.Count + " 个 pak 都不是)") "内容标记 Babel Tower/LCTBridgePanel" "双击 install-babeltower.bat 并加 -InstallMod"
    } else {
      Bad "mod 包" ($ours.Count + " 个有效包都是我们的") "只能有一份" "多份会界面重复、行为错乱;用 uninstall-babeltower.ps1 -List 看清单"
    }
    if ($stale.Count) {
      $sb = ($stale | Measure-Object Length -Sum).Sum
      $staleMB = [math]::Round($sb / 1MB, 1)
      Warn "历史残件" ("{0} 个 .bak-/.dup-,共 {1} MB(含别人的;卸载脚本只删能确认是我们的,所以两个数字对不上是正常的)" -f $stale.Count, $staleMB) "引擎不加载(名字不是 pakNN_dir.vpk),只是占地方/看着乱" "uninstall-babeltower.bat 加 -PurgeBackups 可清"
    }
  }
} else {
  Warn "游戏根" "没找到" "装 mod 与检查 console.log 都依赖它"
}

# ---------- 6. 自启与磁盘 ----------
Line ""
Line "== 6. 自启与磁盘 =="
$startup = @(Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup" -Filter "*BabelTower*" -ErrorAction SilentlyContinue)
if ($startup.Count) { Ok "开机自启" ($startup[0].Name) "已装(开机自动起桥)" }
else { Warn "开机自启" "没装" "不装的话每次玩都要先双击 StartDeadlock.bat" }

$drive = (Get-Item $Root).PSDrive.Name
$free = [math]::Round((Get-PSDrive $drive).Free / 1GB, 1)
if ($free -ge 2) { Ok "磁盘空间" ($drive + ": 盘剩余 " + $free + " GB") "更新/装包需要几百 MB" }
else { Warn "磁盘空间" ($drive + ": 盘仅剩 " + $free + " GB") "更新会失败" }

# ---------- 结论 ----------
Line ""
Line "== 结论 =="
if ($script:Problems.Count -eq 0) {
  Line ("  关键项全过。" + $(if ($script:Warns.Count) { "另有 " + $script:Warns.Count + " 条提醒(见上)。" } else { "" }))
} else {
  Line ("  有 " + $script:Problems.Count + " 项关键失败:")
  foreach ($p in $script:Problems) { Line ("    - " + $p) }
}
if ($Quiet) {
  $head = $(if ($script:Problems.Count) { "FAIL " + $script:Problems.Count + " 项:" } else { "OK 关键项全过" })
  Write-Host ($head + $(if ($script:Warns.Count) { "(+" + $script:Warns.Count + " 提醒)" } else { "" }))
  foreach ($p in $script:Problems) { Write-Host ("  - " + $p) }
} else {
  Emit
}

# 落盘(脱敏后再写)
try {
  $redacted = (Redact ($script:Buf -join "`r`n"))
  [System.IO.File]::WriteAllText($Report, $redacted, (New-Object System.Text.UTF8Encoding($true)))
  Write-Host ""
  Write-Host ("报告已保存: " + $Report + "(已脱敏)")
} catch {
  Write-Host ("报告写入失败: " + $_.Exception.Message)
}
if ($OpenLog) { try { Start-Process notepad.exe -ArgumentList $Report } catch { } }

if ($script:Problems.Count) { exit 1 } else { exit 0 }
