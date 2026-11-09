# Babel Tower —— 一键安装/自检(cert + 桥 + 验收)
# ------------------------------------------------------------------
# 为什么要有这个:此前证书与桥是两个独立入口,用户要自己知道"还要去信任一张证书"。
# 而 https 面板通道(隐藏 HTML 面板加载本机 https)的**唯一拦点就是证书链**
# (引擎 neterror -202 = ERR_CERT_AUTHORITY_INVALID)—— 不信任证书,翻译就仍然走
# BTIPC 位泵(3~27s),功能不缺,只是慢。本脚本把"证书 + 桥 + 验收 + 下一步"串成一次运行。
#
# 用法:
#   双击 install-babeltower.bat
#   powershell -ExecutionPolicy Bypass -File scripts\install_babeltower.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install_babeltower.ps1 -Status      # 只看现状,不改任何东西
#   powershell -ExecutionPolicy Bypass -File scripts\install_babeltower.ps1 -Yes         # 非交互(信任库改动已在上层确认)
#   powershell -ExecutionPolicy Bypass -File scripts\install_babeltower.ps1 -SkipCert    # 只重启桥,不碰信任库
#   powershell -ExecutionPolicy Bypass -File scripts\install_babeltower.ps1 -SkipMod     # 只装证书+桥,不动 addons 里的 mod
#
# 注意:**默认就会装 mod**(证书 + 桥 + mod 一次到位),这是用户最可能的入口(双击
# install-babeltower.bat)。想只装证书与桥的用 -SkipMod。旧参数 -InstallMod 保留为兼容
# 别名(等同于默认行为,不报错)。
#
# 设计约束(都是踩过的坑换来的):
#   * 路径一律相对 $PSScriptRoot 的上级 —— 发行包里没有 F:\BabelTower 这个概念,
#     写死开发机路径 = 用户包里直接不可用。
#   * 每一步都自报:做了什么、失败了什么、失败后还剩什么能用。不做"静默 ABORT"。
#   * 证书步骤需要确认(改的是**当前用户信任库**);-Yes 才跳过确认。
#   * 幂等:证书已有就复用、信任已有就跳过、桥已在跑就重启而不是重复起。
#   * 失败**不阻断后续可用状态**:证书失败不影响 BTIPC,桥起不来不影响已装好的 mod。
#   * 本文件必须带 UTF-8 BOM(PS 5.1 只认带 BOM 的 UTF-8,丢 BOM 会按 GBK 解码,
#     乱码引号能截断参数默认值并引发静默 ABORT —— 2026-10-15 实测)。
# ------------------------------------------------------------------
[CmdletBinding()]
param(
  [switch]$Status,      # 只体检不改任何东西
  [switch]$SkipCert,    # 不碰信任库
  [switch]$Yes,         # 免交互确认(证书那一步)
  [switch]$SkipMod,     # 显式跳过装 mod(只装证书 + 桥)
  [switch]$InstallMod,  # 兼容别名:默认已会装 mod,此开关等同默认,不报错
  [string]$GameRoot = $(if ($env:DEADLOCK_ROOT) { $env:DEADLOCK_ROOT } else { "" })
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $Root "logs"
$LogFile = Join-Path $LogDir "install_babeltower.log"

# ---------- 取证基建:失败路径必须自带证据 ----------
function Say([string]$msg, [string]$level = "info") {
  $line = "[" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "] [" + $level + "] " + $msg
  Write-Host $line
  try {
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
  } catch { }
}
function Die([string]$msg, [int]$code = 1) {
  Say $msg "error"
  $ln = $null
  try { $ln = $InvocationInfo.ScriptLineNumber } catch { }
  if ($ln) { Say ("  发生在本脚本第 " + $ln + " 行") "error" }
  Say "日志: $LogFile" "error"
  exit $code
}

Say ("=== 安装/自检开始 (root=" + $Root + ") ===")

# ---------- 0. 环境自检 ----------
$node = Join-Path $Root "portable-node\node.exe"
if (-not (Test-Path $node)) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { $node = $cmd.Source; Say "没找到自带 node,改用 PATH 上的 node" "warn" }
  else { Die "找不到 Node:portable-node\node.exe 不存在,PATH 上也没有 node。发行包解压不完整,请重新解压完整 zip。" }
} else {
  Say "Node: portable-node\node.exe"
}

foreach ($must in @("core\bridge_server.js", "core\bridge_https.js", "scripts\restart_bridge.ps1", "scripts\gen_bridge_cert.ps1")) {
  if (-not (Test-Path (Join-Path $Root $must))) { Die ("发行包不完整,缺 " + $must + "。请重新解压完整 zip(不要只拷单个文件)。") }
}
Say "必需文件齐了(core\bridge_server.js / core\bridge_https.js / 两个脚本)"

# 游戏根:只为装 mod 与提示用,缺了不阻断(桥与证书都不依赖它)
if (-not $GameRoot) {
  foreach ($c in @("C:\SteamLibrary\steamapps\common\Deadlock", "F:\SteamLibrary\steamapps\common\Deadlock")) {
    if (Test-Path (Join-Path $c "game\citadel")) { $GameRoot = $c; break }
  }
}
if ($GameRoot) { Say ("游戏根: " + $GameRoot) } else { Say "没找到游戏安装根(只影响装 mod 提示,不影响桥与证书)" "warn" }

# ---------- 1. 证书(https 面板通道的唯一拦点) ----------
$certScript = Join-Path $Root "scripts\gen_bridge_cert.ps1"
$certTrusted = $false
$certThumb = ""
try {
  $mine = @(Get-ChildItem Cert:\CurrentUser\Root -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -eq "CN=BabelTower-localhost" })
  if ($mine.Count) {
    $certTrusted = $true
    $certThumb = $mine[0].Thumbprint
  }
} catch { }

if ($Status) {
  Say "STATUS 模式:不改动任何东西"
  Say ("证书信任: " + $(if ($certTrusted) { "已信任 " + $certThumb } else { "未信任" }))
  Say "证书状态详情: 运行 scripts\gen_bridge_cert.ps1 -Status"
} elseif ($SkipCert) {
  Say "按要求跳过证书(-SkipCert):https 面板通道不会启用,翻译仍走 BTIPC。" "warn"
} elseif ($certTrusted) {
  Say ("证书已在信任库,无需重复添加: " + $certThumb)
} else {
  Say "证书尚未信任 —— 这是 https 面板通道(低延迟回程)的唯一拦点。"
  $ok = $Yes
  if (-not $Yes) {
    Write-Host ""
    Write-Host "即将把一张本机自签证书加入【当前用户】的受信任根证书库。"
    Write-Host "  主体   : CN=BabelTower-localhost(SAN: localhost / 127.0.0.1 / ::1)"
    Write-Host "  作用域 : 仅当前 Windows 用户,不涉及系统级与企业级信任库"
    Write-Host "  用途   : 让游戏内隐藏 HTML 面板能加载本机 https 页面(否则只能走 BTIPC 位泵)"
    Write-Host "  撤销   : scripts\gen_bridge_cert.ps1 -Untrust"
    $ans = Read-Host "确认加入信任库?输入 y 继续,直接回车取消"
    $a = ""
    if ($ans) { $a = $ans.Trim().ToLower() }
    # 大小写不敏感地接受 y / yes;直接回车(空)或任何其它输入 = 取消。
    $ok = ($a -eq "y" -or $a -eq "yes")
  }
  if ($ok) {
    Say "开始生成并信任证书…"
    & powershell -NoProfile -ExecutionPolicy Bypass -File $certScript -Trust 2>&1 |
      ForEach-Object { Say ("  cert| " + $_) }
    # 复核:不信口头成功,查信任库实际状态
    $mine = @(Get-ChildItem Cert:\CurrentUser\Root -ErrorAction SilentlyContinue |
      Where-Object { $_.Subject -eq "CN=BabelTower-localhost" })
    if ($mine.Count) {
      $certTrusted = $true
      $certThumb = $mine[0].Thumbprint
      Say ("证书已确认进入信任库: " + $certThumb)
    } else {
      Say "证书脚本跑完了,但信任库里查不到 —— 视为**未信任**。桥仍可用(走 BTIPC)。" "error"
    }
  } else {
    Say "用户未确认,跳过证书。https 面板通道不会启用,翻译仍走 BTIPC(与今天一致)。" "warn"
  }
}

# ---------- 2. 装 mod(默认就装;显式 -SkipMod 可跳过) ----------
# 2026-11-09:默认装 mod。此前只有带 -InstallMod 才装,而用户最可能的入口(双击
# install-babeltower.bat / 维护菜单选 1)不会带参数 —— 结果"装了没反应"。现在默认装,
# 想只装证书+桥的用 -SkipMod;旧参数 -InstallMod 保留为兼容别名(等同默认,不报错)。
if ($Status) {
  # STATUS 模式只读:绝不动 addons 里的任何文件
} elseif ($SkipMod) {
  Say "按要求跳过装 mod(-SkipMod):只处理证书与桥。"
} else {
  $gameRunning = [bool](Get-Process -Name deadlock -ErrorAction SilentlyContinue)
  if ($gameRunning) {
    # 游戏在跑时替换 vpk 会留下损坏的半截文件 —— 结果块要醒目,并给一个**有界的等待**:
    # 提示后轮询最多约 60 秒(每秒一次),退出了就继续装;超时仍跳过并指路。
    Write-Host ""
    Write-Host "================================================================"
    Write-Host " !! 检测到 Deadlock 正在运行 —— 绝不 在游戏运行时替换 vpk"
    Write-Host ""
    Write-Host " 运行中替换会留下损坏的半截 vpk,所以现在不动 addons 里的文件。"
    Write-Host " 我会等你退出游戏,最多等约 60 秒(每 1 秒检查一次)…"
    Write-Host "================================================================"
    Write-Host ""
    Say "游戏正在运行 —— 绝不 在游戏运行时替换 vpk;最多等约 60 秒等它退出。" "warn"
    for ($w = 1; $w -le 60; $w++) {
      Start-Sleep -Seconds 1
      if (-not (Get-Process -Name deadlock -ErrorAction SilentlyContinue)) { $gameRunning = $false; break }
    }
    if (-not $gameRunning) { Say "游戏已退出,继续装 mod。" }
  }

  if (-not $GameRoot) {
    Say "没有游戏根,跳过装 mod(只装桥不影响已装好的 mod)。" "warn"
  } elseif ($gameRunning) {
    Write-Host ""
    Write-Host "================================================================"
    Write-Host " 等满 60 秒游戏仍在运行 —— 本次跳过装 mod。"
    Write-Host " 退出游戏后重跑本脚本即可自动安装。"
    Write-Host "================================================================"
    Write-Host ""
    Say "等待超时,游戏仍在运行:本次跳过装 mod。退出游戏后重跑本脚本即可自动安装。" "warn"
  } else {
    # 先找 build.ps1 的产物 dist\pak01_dir.vpk,再找包根的同名文件(取第一个存在的)。
    $src = Join-Path $Root "dist\pak01_dir.vpk"
    if (-not (Test-Path $src)) { $src = Join-Path $Root "pak01_dir.vpk" }
    if (-not (Test-Path $src)) { Say "发行包里没有 pak01_dir.vpk(也没找到 dist\pak01_dir.vpk),跳过装 mod(只装桥不影响已装好的 mod)。" "warn" }
    else {
      $addons = Join-Path $GameRoot "game\citadel\addons"
      if (-not (Test-Path $addons)) { Say ("找不到 addons 目录: " + $addons + ",跳过装 mod。") "warn" }
      else {
        # 槽位名与安装说明一致;但**先按内容标记认人** —— 我们历史上装过
        # 650634_pak04_dir.vpk / pak25_dir.vpk 等各种名字,只看 pak15 会漏掉真正的旧包,
        # 结果就是新旧两份同时加载(界面重复、行为错乱)。内容命中就用它那个文件名当目标。
        $dst = Join-Path $addons "pak15_dir.vpk"
        $contentHit = $false
        foreach ($f in @(Get-ChildItem $addons -Force -File -ErrorAction SilentlyContinue |
                 Where-Object { $_.Name -match '^pak\d+_dir\.vpk$' })) {
          try {
            $fs = [System.IO.File]::OpenRead($f.FullName)
            try {
              $hb = New-Object byte[] 65536
              $n2 = $fs.Read($hb, 0, 65536)
              $head = [System.Text.Encoding]::ASCII.GetString($hb, 0, [Math]::Max($n2, 0))
              if ($head -match "Babel Tower" -or $head -match "LCTBridgePanel") { $dst = $f.FullName; $contentHit = $true; break }
            } finally { $fs.Close() }
          } catch { }
        }
        if ($contentHit) { Say ("  按内容标记认出已装包,目标改为: " + (Split-Path $dst -Leaf)) }
        try {
          if (Test-Path $dst) {
            $bak = $dst + ".bak-" + (Get-Date -Format "yyyyMMdd-HHmmss")
            Copy-Item $dst $bak -Force
            Say ("旧包已备份: " + (Split-Path $bak -Leaf))
          }
          Copy-Item $src $dst -Force
          $s1 = (Get-FileHash $src).Hash
          $s2 = (Get-FileHash $dst).Hash
          if ($s1 -ne $s2) { Die "装车后 sha 不一致,新包可能没写全。游戏目录里的文件是: $dst" }
          Say ("mod 已装好: " + $dst + " (sha " + $s1.Substring(0, 16) + ")")
        } catch {
          Die ("装 mod 失败: " + $_.Exception.Message)
        }
      }
    }
  }
}

# ---------- 3. 起桥(含 https 终结进程) ----------
if (-not $Status) {
  Say "启动/重启桥…"
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\restart_bridge.ps1") 2>&1 |
    ForEach-Object { Say ("  bridge| " + $_) }
}

# https 终结进程的验收:**不依赖证书链**,只证明"监听 + TLS 握手 + HTTP 200"。
# 为什么不用 Invoke-WebRequest:Windows PowerShell 5.1 的 IWR 不吃全局
# ServicePointManager.ServerCertificateValidationCallback,证书未受信时直接抛异常,
# 被 catch 吞掉就变成**假否定**(明明进程起着,却报"不通")—— 2026-10-15 自踩。
# 这里自己走 TcpClient + SslStream,回调显式放行,验的是链路而不是信任状态。
# 信任状态是**引擎**那一侧的事,归客户端开机探针判定,不由本脚本报。
function Test-HttpsEndpoint([string]$hostName, [int]$port, [int]$timeoutMs = 3000) {
  $tcp = $null
  $ssl = $null
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $iar = $tcp.BeginConnect($hostName, $port, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne($timeoutMs)) { return $false }
    $tcp.EndConnect($iar)
    # 回调放行一切证书:这里要验的是链路通不通,不是证书可不可信
    $ssl = New-Object System.Net.Security.SslStream($tcp.GetStream(), $false, { param($s, $c, $ch, $e) $true })
    $ssl.AuthenticateAsClient($hostName)
    $req = "GET /api/v1/health HTTP/1.1`r`nHost: localhost`r`nConnection: close`r`n`r`n"
    $bytes = [System.Text.Encoding]::ASCII.GetBytes($req)
    $ssl.Write($bytes, 0, $bytes.Length)
    $ssl.Flush()
    $buf = New-Object byte[] 256
    $n = $ssl.Read($buf, 0, 256)
    if ($n -le 0) { return $false }
    $txt = [System.Text.Encoding]::ASCII.GetString($buf, 0, $n)
    return ($txt -match "200")
  } catch {
    return $false
  } finally {
    try { if ($ssl) { $ssl.Close() } } catch { }
    try { if ($tcp) { $tcp.Close() } } catch { }
  }
}

# ---------- 4. 验收:不信脚本的自报,自己探 ----------
$httpOk = $false
$httpsOk = $false
if (-not $Status) {
  foreach ($i in 1..12) {
    Start-Sleep -Seconds 1
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:8791/api/v1/health" -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -eq 200) { $httpOk = $true; break }
    } catch { }
  }
  if ($httpOk) { Say "http 桥健康(8791): 200 OK" } else { Say "http 桥健康(8791): **不通**" "error" }

  # https 终结:只验"链路通不通",刻意不验证书链(此刻证书多半还没被信任)
  $httpsOk = Test-HttpsEndpoint "localhost" 8792 4000
  if ($httpsOk) {
    Say "https 面板通道端口(8792): 通(TCP+TLS+HTTP 200;证书信任与否是另一回事)"
  } else {
    Say "https 面板通道端口(8792): 不通 —— 看 logs\bridge_https.log(证书缺失时会以退出码 3 退出,属正常降级)" "warn"
  }
}

# ---------- 5. 结论 + 下一步 ----------
Write-Host ""
Say "==================== 结论 ===================="
if ($Status) {
  Say "STATUS 模式:上面是现状,没有做任何改动。"
} else {
  Say ("桥(必需)      : " + $(if ($httpOk) { "可用 —— 翻译能工作" } else { "**不通**;看 logs\bridge.log" }))
}
Say ("证书(可选提速): " + $(if ($certTrusted) { "已信任 " + $certThumb } else { "未信任 —— 翻译仍走 BTIPC,功能不受影响" }))
if (-not $Status) {
  Say ("https 面板通道: " + $(if ($httpsOk) { "端口通;进游戏看 console.log 有没有 https panel: ALIVE" } else { "不可用 —— 翻译走 BTIPC 位泵(3~27s)" }))
  Say ("网页设置页    : " + $(if ($httpOk) { "http://127.0.0.1:8791/ui  (游戏内按 /tr 就打开它)" } else { "桥不通,先修桥" }))
}
Write-Host ""
Write-Host "★ 下一步(三步,顺序不能换):"
Write-Host "  1) 完全退出 Steam(含托盘图标)后重新打开 Steam"
Write-Host "  2) 双击 StartDeadlock.bat 启动游戏"
Write-Host "  3) 进对局后按 /tr 打开网页设置页"
Write-Host ""
# 技术细节(BTIPC 位泵 / https panel: ALIVE 等)只进日志,不写进上面用户可见的编号步骤,
# 免得开发术语吓到普通用户。证书与 https 通道的现状在下面这条日志里。
Say ("技术细节:桥 " + $(if ($httpOk) { "可用" } else { "不通(看 logs\bridge.log)" }) +
  ";证书 " + $(if ($certTrusted) { "已信任 " + $certThumb } else { "未信任(翻译仍走 BTIPC,功能不受影响)" }) +
  ";https 面板通道 " + $(if ($httpsOk) { "端口通(进游戏看 console.log 有没有 https panel: ALIVE)" } else { "不可用 —— 翻译走 BTIPC 位泵(3~27s)" }) + "。")
Write-Host ""
Say "日志: $LogFile"
exit 0