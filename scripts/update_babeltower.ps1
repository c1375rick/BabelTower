# Babel Tower —— 从官方 GitHub Releases 自更新
# ------------------------------------------------------------------
# 这个脚本解决的是"之前那些人是怎么更新 mod 的"。社区启动器
# (alloywr147/BabelTowerLauncher,MIT)公开的机制是:**只读官方 Releases**、
# 下载前查名称与来源、下载后校验体积与 SHA256、整包替换、**游戏运行时只下载
# 退出后再确认安装**、失败保留旧版并回滚。本脚本照这套纪律做,但不依赖 GUI。
#
# 为什么必须校验和:"下载一个 36MB 的 zip 并解压覆盖自己的安装目录"是典型的
# 高危操作 —— 校验和不对还照样覆盖,等于把能用的东西换成坏的。所以:
#   · 资产名必须严格匹配 ^BabelTower-<语义版本>-win64\.zip$(白名单,不做模糊匹配)
#   · 体积必须等于 API 报的 size
#   · SHA256 必须等于 API 报的 digest(2025 起 GitHub 对 release 资产提供该字段)
#   · digest 缺失时**默认拒绝**,要显式 -AllowNoDigest 才继续(没有校验就不叫校验)
#
# PS 5.1 的两个必备细节(不设就一定失败):
#   ① TLS:GitHub 只接受 TLS 1.2+,而 Windows PowerShell 5.1 默认协议集常常不含它,
#      症状是 "Could not create SSL/TLS secure channel"。
#   ② 下载:Invoke-WebRequest 拿 36MB 会明显慢且吃内存,用 WebClient + 流式落盘。
#
# 用法:
#   powershell -File scripts\update_babeltower.ps1            # 检查,有新版就问你要不要装
#   powershell -File scripts\update_babeltower.ps1 -Check     # 只检查,不下载不安装
#   powershell -File scripts\update_babeltower.ps1 -Yes       # 无人值守(确认过再用)
#   powershell -File scripts\update_babeltower.ps1 -Force     # 版本相同也重装
#   powershell -File scripts\update_babeltower.ps1 -AllowNoDigest  # 该版本没有 digest 时放行(不推荐)
#
# 退出码:0 = 已是最新或更新成功;2 = 有新版但没装(用户拒绝/游戏在跑/只检查);1 = 失败
#
# 本文件必须带 UTF-8 BOM(PS 5.1 只认带 BOM 的 UTF-8;丢 BOM 会按 GBK 解码)。
# ------------------------------------------------------------------
[CmdletBinding()]
param(
  [switch]$Check,         # 只检查
  [switch]$DownloadOnly,  # 只下载并校验,不碰安装目录与游戏目录(限流量/先下后装)
  [switch]$Yes,           # 免确认
  [switch]$Force,         # 版本相同也重装
  [switch]$AllowNoDigest, # 该资产没有 sha256 时仍继续
  [string]$Repo = "c1375rick/BabelTower",
  [string]$GameRoot = $(if ($env:DEADLOCK_ROOT) { $env:DEADLOCK_ROOT } else { "" })
)

$ErrorActionPreference = "Stop"
# ① TLS:不设必失败(GitHub 要 1.2+)
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11
} catch { }

$Root = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $Root "logs"
$StageDir = Join-Path $LogDir "updates"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

function Say([string]$m, [string]$lv = "info") {
  $line = "[" + (Get-Date -Format "HH:mm:ss") + "] [" + $lv + "] " + $m
  Write-Host $line
  try { Add-Content -Path (Join-Path $LogDir "update_babeltower.log") -Value $line -Encoding UTF8 } catch { }
}
function Confirm([string]$q) {
  if ($Yes) { return $true }
  $a = Read-Host ("  " + $q + "(输入 YES 继续)")
  return ($a -ceq "YES")
}
function Sha256([string]$p) { (Get-FileHash -Path $p -Algorithm SHA256).Hash.ToLower() }

# ---------- 本地版本 ----------
$localVer = ""
$vf = Join-Path $Root "VERSION"
if (Test-Path $vf) { $localVer = (Get-Content $vf -Raw -Encoding UTF8).Trim() }
if (-not $localVer) {
  try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:8791/api/v1/health" -TimeoutSec 3
    if ($h.version) { $localVer = [string]$h.version }
  } catch { }
}
Say ("本地版本: " + $(if ($localVer) { $localVer } else { "(未知;将只能按 -Force 装)" }))

# ---------- 查官方 Releases ----------
$api = "https://api.github.com/repos/$Repo/releases/latest"
Say "查询官方 Releases: $api"
try {
  $rel = Invoke-RestMethod -Uri $api -Headers @{ "User-Agent" = "BabelTower-updater"; "Accept" = "application/vnd.github+json" } -TimeoutSec 20
} catch {
  Say ("查不到官方版本信息: " + $_.Exception.Message + " | 常见原因:断网 / 被代理拦截 / API 限流") "error"
  Say "此时**不要**手动下载覆盖:无法校验来源与完整性。稍后重试,或直接看 https://github.com/$Repo/releases" "error"
  exit 1
}
$tag = [string]$rel.tag_name
Say ("官方最新版: " + $tag + "  (" + $rel.published_at + ")")

# ---------- 资产白名单:只认严格匹配的整包,不做模糊匹配 ----------
$asset = $null
foreach ($a in $rel.assets) {
  if ([string]$a.name -match '^BabelTower-\d+(\.\d+)*-win64\.zip$') { $asset = $a; break }
}
if (-not $asset) {
  Say ("这次发布里没有符合命名规则的整包(只认 BabelTower-<版本>-win64.zip)。看到的资产: " +
    (($rel.assets | ForEach-Object { $_.name }) -join ", ")) "error"
  Say "拒绝在规则不符时安装 —— 宁可什么都不做,也不要装一个来源不明的包。" "error"
  exit 1
}
$remoteVer = [string]$asset.name -replace '^BabelTower-', '' -replace '-win64\.zip$', ''
$digest = ""
if ($asset.PSObject.Properties.Name -contains "digest" -and $asset.digest) {
  $digest = ([string]$asset.digest) -replace '^sha256:', ''
}
$assetMB = [math]::Round($asset.size / 1MB, 1)
Say ("选中资产: {0}  {1} MB" -f $asset.name, $assetMB)
Say ("远端版本: " + $remoteVer + $(if ($digest) { "  sha256=" + $digest.Substring(0, 16) + "…" } else { "  **(该资产没有 sha256)**" }))

# ---------- 版本比较 ----------
function VerNewer([string]$a, [string]$b) {
  if (-not $a) { return $false }
  if (-not $b) { return $true }
  $pa = $a -split '[^\d]' | Where-Object { $_ -ne "" }
  $pb = $b -split '[^\d]' | Where-Object { $_ -ne "" }
  for ($i = 0; $i -lt [Math]::Max($pa.Count, $pb.Count); $i++) {
    $x = 0; $y = 0
    if ($i -lt $pa.Count) { $x = [int]$pa[$i] }
    if ($i -lt $pb.Count) { $y = [int]$pb[$i] }
    if ($x -gt $y) { return $true }
    if ($x -lt $y) { return $false }
  }
  return $false
}
if (-not $Force -and -not (VerNewer $remoteVer $localVer)) {
  Say ("已是最新(" + $localVer + " = " + $remoteVer + ")。要强制重装加 -Force。")
  exit 0
}
if ($Check) {
  Say ("-Check:有新版 " + $remoteVer + "(本地 " + $localVer + ")。去掉 -Check 即可下载安装。")
  exit 2
}

# ---------- 下载 ----------
if (-not $digest -and -not $AllowNoDigest) {
  Say "该资产没有 sha256(digest 为空),**默认拒绝安装** —— 校验是这一步的全部意义。" "error"
  Say "确实要装(自行承担风险)就加 -AllowNoDigest。" "warn"
  exit 1
}
$sizeMB = [math]::Round($asset.size / 1MB, 1)
# 注意:PS 里函数不能写成 $Confirm(...) 参与表达式,必须用 $(Confirm ...)(自踩:解析器报"意外的标记(")
if (-not $(Confirm ("下载并安装 {0}? 约 {1} MB" -f $remoteVer, $sizeMB))) {
  Say "已取消,什么都没改。"
  exit 2
}
New-Item -ItemType Directory -Path $StageDir -Force | Out-Null
$zipPath = Join-Path $StageDir $asset.name
Say ("下载 -> " + $zipPath)
try {
  # ② WebClient 流式落盘(IWR 拿 36MB 慢且吃内存)
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $wc = New-Object System.Net.WebClient
  $wc.Headers.Add("User-Agent", "BabelTower-updater")
  $wc.DownloadFile($asset.browser_download_url, $zipPath)
  $wc.Dispose()
} catch {
  Say ("下载失败: " + $_.Exception.Message) "error"
  exit 1
}
$got = (Get-Item $zipPath).Length
$gotMB = [math]::Round($got / 1MB, 1)
Say ("下载完成: {0} MB" -f $gotMB)
if ($got -ne [int64]$asset.size) {
  Say ("体积不符:期望 " + $asset.size + " 实际 " + $got + " —— 判定为下载不完整,已保留文件供你手动检查,**没有解压、没有改动任何东西**。") "error"
  exit 1
}
if ($digest) {
  $h = Sha256 $zipPath
  if ($h -ne $digest.ToLower()) {
    Say ("SHA256 不符:期望 " + $digest + " 实际 " + $h + " —— 判定为损坏或被篡改,**已拒绝安装**。") "error"
    Say "文件留在 " + $zipPath + " 供你核对;确认无误后可手动解压。" "warn"
    exit 1
  }
  Say "SHA256 校验通过 ✓"
} else {
  Say "跳过 SHA256 校验(你用了 -AllowNoDigest)" "warn"
}

# ---------- 游戏在跑就到此为止:延后安装 ----------
if ($DownloadOnly) {
  Say "-DownloadOnly:包已下载并通过校验,**没有碰安装目录,也没有碰游戏目录**。"
  Say "之后去掉 -DownloadOnly 重跑即可安装(会重新校验)。"
  exit 0
}
if (@(Get-Process -Name deadlock -ErrorAction SilentlyContinue).Count) {
  Say "游戏正在运行 —— **运行中替换 vpk 会留下损坏的半截文件**,所以现在只下载不安装。" "warn"
  Say "包已下好:" + $zipPath
  Say "退出游戏后重跑本脚本即可完成安装(会重新检查、重新校验)。"
  exit 2
}

# ---------- 解压 ----------
$unzip = Join-Path $StageDir ("x_" + (Get-Date -Format "yyyyMMdd-HHmmss"))
try {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $unzip)
} catch {
  Say ("解压失败: " + $_.Exception.Message) "error"
  exit 1
}
$need = @("core\bridge_server.js", "core\bridge_https.js", "portable-node\node.exe", "pak01_dir.vpk",
  "scripts\restart_bridge.ps1", "scripts\gen_bridge_cert.ps1", "scripts\update_babeltower.ps1")
$missing = @()
foreach ($f in $need) { if (-not (Test-Path (Join-Path $unzip $f))) { $missing += $f } }
if ($missing.Count) {
  Say ("解压出来的包不完整,缺: " + ($missing -join ", ") + " —— **已放弃安装**,你的现有安装没被动过。") "error"
  exit 1
}
Say "包内容校验通过(" + $need.Count + " 个必需文件都在)"

# ---------- 覆盖安装目录(保留用户数据) ----------
# 保留清单:配置、词典、quickchat、日志。证书状态在 %LOCALAPPDATA%,不在这里,天然不受影响。
$keep = @("config\config.json", "config\quickchat.json", "config\dictionary.json", "logs")
Say "覆盖 core\ / scripts\ / mod\ / portable-node\ / 顶层 bat 与文档;保留: " + ($keep -join ", ")
$copied = 0
foreach ($item in @("core", "scripts", "mod", "portable-node")) {
  $src = Join-Path $unzip $item
  if (-not (Test-Path $src)) { continue }
  try {
    Copy-Item (Join-Path $src "*") (Join-Path $Root $item) -Recurse -Force
    $copied++
  } catch { Say ("复制 " + $item + " 时出错:" + $_.Exception.Message) "warn" }
}
foreach ($f in (Get-ChildItem $unzip -File -ErrorAction SilentlyContinue)) {
  try { Copy-Item $f.FullName (Join-Path $Root $f.Name) -Force } catch { }
}
Say ("已覆盖 " + $copied + " 个目录")

# ---------- 换 mod 包(内容标记认包,备份 + 校验 + 可回滚) ----------
$pakSwap = ""
if (-not $GameRoot) {
  foreach ($c in @("C:\SteamLibrary\steamapps\common\Deadlock", "F:\SteamLibrary\steamapps\common\Deadlock")) {
    if (Test-Path (Join-Path $c "game\citadel")) { $GameRoot = $c; break }
  }
}
if ($GameRoot) {
  $addons = Join-Path $GameRoot "game\citadel\addons"
  $newPak = Join-Path $unzip "pak01_dir.vpk"
  $newSha = Sha256 $newPak
  $target = $null
  if (Test-Path $addons) {
    foreach ($f in @(Get-ChildItem $addons -Force -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^pak\d+_dir\.vpk$' })) {
      try {
        $fs = [System.IO.File]::OpenRead($f.FullName)
        try {
          $b = New-Object byte[] 65536
          $n = $fs.Read($b, 0, 65536)
          $head = [System.Text.Encoding]::ASCII.GetString($b, 0, [Math]::Max($n, 0))
          if ($head -match "Babel Tower" -or $head -match "LCTBridgePanel") { $target = $f; break }
        } finally { $fs.Close() }
      } catch { }
    }
  }
  if (-not $target) {
    Say "addons 里没找到我们已装的包(内容标记没命中),**没有动任何 vpk**。请用 install-babeltower.bat -InstallMod 手动装。" "warn"
  } else {
    $bak = $target.FullName + ".bak-upd-" + (Get-Date -Format "yyyyMMdd-HHmmss")
    try {
      Copy-Item $target.FullName $bak -Force
      Copy-Item $newPak $target.FullName -Force
      $after = Sha256 $target.FullName
      if ($after -ne $newSha) { throw ("装后 sha 不符(" + $after.Substring(0, 12) + " vs " + $newSha.Substring(0, 12) + ")") }
      $pakSwap = $bak
      Say ("mod 已更新: " + $target.Name + "  旧包备份 " + (Split-Path $bak -Leaf))
    } catch {
      Say ("换包失败:" + $_.Exception.Message) "error"
      if (Test-Path $bak) { try { Copy-Item $bak $target.FullName -Force; Say "已回滚到旧包" } catch { } }
      exit 1
    }
  }
}

# ---------- 重启桥让新代码真的跑起来 ----------
Say "重启桥(让新版代码生效)…"
try {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\restart_bridge.ps1") 2>&1 |
    ForEach-Object { Say ("  bridge| " + $_) }
} catch { Say ("重启桥失败(不影响已装好的文件):" + $_.Exception.Message) "warn" }

Say ""
Say "==================== 更新完成 ===================="
Say ("版本: " + $localVer + " -> " + $remoteVer)
Say ("下载包保留在: " + $zipPath)
if ($pakSwap) { Say ("旧 mod 包备份: " + $pakSwap + "(要回滚就把它改回原名)") }
Say "建议接着跑一次 diagnose-babeltower.bat 确认各项正常。"
exit 0