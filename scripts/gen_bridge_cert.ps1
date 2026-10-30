# 生成 Babel Tower 本机 HTTPS 证书链(隐藏 HTML 面板通道用)
# ==================================================================
# 2026-10-30 重构:自签直发 → Root CA 链签发。动因(10-29 游戏更新实测):
#   旧方案(自签证书直接进信任库,5 年有效期)从 10-28 11:23 起不再被引擎接受:
#   页面 HTML 能加载但 JS 不执行,探针恒超时。同一时段 QOL Lock 的桥
#   (GitHub Pages,公开 CA 签发)完全正常 —— 指向"引擎收紧了证书策略"。
#   新方案把证书质量提到公开 CA 同级,覆盖全部已知收紧点:
#     ① CA 链:Root CA(BasicConstraints CA:TRUE)签发叶子,不再依赖
#        "自签即锚点"的宽容验证路径;
#     ② 叶子有效期默认 397 天:Chromium 对 >398 天的证书有拒收规则(公开 CA
#        规则,引擎收紧后可能全局套用;QOL 的 90 天 Let's Encrypt 证书不受
#        影响是旁证)。短叶子靠"每次启动自检续期"消化(见 StartDeadlock.bat);
#     ③ SAN 完整:DNS=localhost + IP:127.0.0.1 + IP:::1(坑①,10-15 实测)。
#
# 关键坑(继承自 10-15 版,仍然有效):
#   ① SAN 必须带 **IP SAN**(127.0.0.1 / ::1),把 IP 写成 DNS 名字不算 —— 引擎会
#      报"名称不匹配"而不是"未知 CA",容易误判方向。
#   ② 信任库写入用 `certutil -user -addstore Root`:PowerShell 的 Import-Certificate
#      在非交互进程里会报 "UI is not allowed in this operation"(Root 库要弹确认框)。
#      删除同理用 certutil -user -delstore Root。
#   ③ **信任之后必须完全退出并重启 Steam**(托盘也退)。信任库由 Steam 宿主缓存,
#      只重启游戏不会重载 —— 当初就因为漏了这条而误判"引擎不支持 https"。
#
# 路线来源(逐项对账见 docs/btipc-https-v1.md §2):
#   ① 通道设计是我们自己的(隐藏 HTML 面板 → /bridge → document.title 轮询,
#      早于 BTIPC 就记在 docs/architecture.md §4.2 的通道③);本脚本只补它缺的证书。
#   ② "本机自签证书 + 写入 CurrentUser\Root + 信任后完全重启 Steam"这个方案来自
#      一款 GPL-3.0 同类实现;2026-10-30 的 CA 链升级是我们对 10-29 引擎收紧的
#      独立应对(mkcert 同款思路:本地 Root CA + 短期叶子)。
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File scripts\gen_bridge_cert.ps1            # 生成/续期
#   powershell -ExecutionPolicy Bypass -File scripts\gen_bridge_cert.ps1 -Trust    # 生成并信任
#   powershell -ExecutionPolicy Bypass -File scripts\gen_bridge_cert.ps1 -Untrust  # 撤销信任
#   powershell -ExecutionPolicy Bypass -File scripts\gen_bridge_cert.ps1 -Status   # 只看状态
[CmdletBinding()]
param(
  [switch]$Trust,
  [switch]$Untrust,
  [switch]$Status,
  [string]$StateDir = $(if ($env:BABEL_TOWER_STATE) { $env:BABEL_TOWER_STATE } else { Join-Path $env:LOCALAPPDATA "BabelTower" }),
  [int]$CaYears = 10,
  [int]$LeafDays = 397
)

$ErrorActionPreference = "Stop"
$caSubject = "CN=BabelTower Root CA"
$caFriendly = "BabelTower Root CA"
$leafSubject = "CN=localhost"
$leafFriendly = "BabelTower-bridge-localhost"
$pemDir = Join-Path $StateDir "cert"
$pfxPath = Join-Path $pemDir "bridge.pfx"
$pfxPass = "btabridge"
$cerPath = Join-Path $pemDir "bridge-cert.cer"          # 叶子公钥(bridge_https.js 日志边车)
$caCerPath = Join-Path $pemDir "babeltower-root-ca.cer" # 根 CA 公钥(交给信任库的就是它)

New-Item -ItemType Directory -Path $pemDir -Force | Out-Null

function Get-Ca {
  $all = @(Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -eq $caSubject -and $_.NotAfter -gt (Get-Date) })
  if ($all.Count -eq 0) { return $null }
  return $all[0]
}

function Get-Leaf {
  param($Ca)
  if (-not $Ca) { return $null }
  $all = @(Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -eq $leafSubject -and $_.Issuer -eq $Ca.Subject -and $_.NotAfter -gt (Get-Date).AddDays(30) })
  if ($all.Count -eq 0) { return $null }
  return $all[0]
}

function Test-Trusted {
  param($Cert, [string]$Store)
  $path = if ($Store -eq "LM") { "Cert:\LocalMachine\Root" } else { "Cert:\CurrentUser\Root" }
  return @((Get-ChildItem $path -ErrorAction SilentlyContinue |
    Where-Object { $_.Thumbprint -eq $Cert.Thumbprint })).Count -gt 0
}

function Write-Status {
  $ca = Get-Ca
  if (-not $ca) { Write-Host "尚未生成证书链。运行: scripts\gen_bridge_cert.ps1 -Trust"; return }
  $leaf = Get-Leaf -Ca $ca
  Write-Host ("根CA    : " + $ca.Subject + "  指纹 " + $ca.Thumbprint)
  Write-Host ("  到期  : " + $ca.NotAfter.ToString("yyyy-MM-dd"))
  Write-Host ("  信任  : " + $(if (Test-Trusted $ca "CU") { "CurrentUser\Root 已信任" } else { "未信任(运行 -Trust)" }) + $(if (Test-Trusted $ca "LM") { " / LocalMachine\Root 已信任" } else { "" }))
  if ($leaf) {
    $days = [int]($leaf.NotAfter - (Get-Date)).TotalDays
    Write-Host ("叶子    : " + $leaf.Subject + "  指纹 " + $leaf.Thumbprint)
    Write-Host ("  到期  : " + $leaf.NotAfter.ToString("yyyy-MM-dd") + "  (剩 $days 天,叶子上限 $LeafDays 天)")
  } else {
    Write-Host "叶子    : (缺,运行本脚本续期)"
  }
  Write-Host ("PFX     : " + $(if (Test-Path $pfxPath) { $pfxPath } else { "(缺,先运行本脚本)" }))
}

# ---------- 撤销信任 ----------
if ($Untrust) {
  $ca = Get-Ca
  if ($ca) {
    & certutil.exe -user -delstore Root $ca.Thumbprint | Out-Null
    Write-Host ("已从当前用户信任库移除根 CA: " + $ca.Thumbprint)
  } else {
    Write-Host "未找到本项目根 CA,无需撤销。"
  }
  exit 0
}

# ---------- 状态 ----------
if ($Status) {
  Write-Status
  exit 0
}

# ---------- 生成(幂等:CA 复用;叶子缺失或 30 天内到期才重签) ----------
$ca = Get-Ca
if ($ca) {
  Write-Host ("复用现有根 CA: " + $ca.Thumbprint)
} else {
  Write-Host "生成根 CA(CN=BabelTower Root CA, RSA-4096, CA:TRUE, ${CaYears} 年)…"
  $ca = New-SelfSignedCertificate -Subject $caSubject -FriendlyName $caFriendly `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -KeyExportPolicy Exportable -KeyUsage CertSign, CRLSign, DigitalSignature `
    -KeyAlgorithm RSA -KeyLength 4096 -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddYears($CaYears) `
    -TextExtension @("2.5.29.19={text}ca=TRUE")
  Write-Host ("根 CA 已生成: " + $ca.Thumbprint)
}

$leaf = Get-Leaf -Ca $ca
if ($leaf) {
  Write-Host ("复用现有叶子证书: " + $leaf.Thumbprint)
} else {
  # 清掉同主体的旧叶子(旧 CA 签发的/快过期的),保持 My 库干净
  Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -eq $leafSubject -and $_.FriendlyName -eq $leafFriendly } |
    Remove-Item -Force -ErrorAction SilentlyContinue
  Write-Host "签发叶子证书(CN=localhost, RSA-2048, ${LeafDays} 天, SAN=DNS+IP×2)…"
  # SAN 语法沿用 10-15 验证过的写法:DNS=localhost&ipaddress=…(小写 ipaddress)
  $leaf = New-SelfSignedCertificate -Subject $leafSubject -FriendlyName $leafFriendly `
    -Signer $ca -CertStoreLocation "Cert:\CurrentUser\My" `
    -KeyExportPolicy Exportable -KeyUsage DigitalSignature, KeyEncipherment `
    -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddDays($LeafDays) -Type Custom `
    -TextExtension @(
      "2.5.29.17={text}DNS=localhost&ipaddress=127.0.0.1&ipaddress=::1",
      "2.5.29.37={text}1.3.6.1.5.5.7.3.1"
    )
  Write-Host ("叶子已签发: " + $leaf.Thumbprint)
}

# 导出 PFX 给 Node 直接读(https.createServer({pfx, passphrase})原生支持 PFX)。
# 不走 PEM:PS 5.1(.NET Framework)没有 ExportCertificatePem(),那是 .NET Core 3.0+ 的 API。
# 私钥不出 My 库、不上传给任何人;PFX 落在 %LOCALAPPDATA%\BabelTower\cert\。
$plain = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($leaf)
Export-PfxCertificate -Cert $plain -FilePath $pfxPath -Password (ConvertTo-SecureString -String $pfxPass -Force -AsPlainText) | Out-Null
Export-Certificate -Cert $plain -FilePath $cerPath -Force | Out-Null
Export-Certificate -Cert $ca -FilePath $caCerPath -Force | Out-Null
Write-Host ("PFX 已写出 : " + $pfxPath)
Write-Host ("叶子公钥   : " + $cerPath)
Write-Host ("根 CA 公钥 : " + $caCerPath)

# ---------- 信任 ----------
if ($Trust) {
  if (Test-Trusted $ca "CU") {
    Write-Host "根 CA 已在当前用户信任库,无需重复添加。"
  } else {
    # 坑②:必须 certutil(Import-Certificate 非交互会报 UI not allowed)
    & certutil.exe -user -addstore Root $caCerPath | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Write-Host ("已加入当前用户信任库(CurrentUser\Root): " + $ca.Thumbprint)
    } else {
      Write-Host "写入 CurrentUser\Root 失败,请手动运行: certutil -user -addstore Root `"$caCerPath`""
    }
  }
  # LocalMachine\Root 是兜底(需要管理员;失败不影响 CurrentUser 路线)
  if (-not (Test-Trusted $ca "LM")) {
    & certutil.exe -addstore Root $caCerPath | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Host "已加入 LocalMachine\Root(管理员权限生效)" }
  }
  # 迁移清理:移除 10-15 方案的直发自签信任条目(CN=BabelTower-localhost)
  $legacy = @(Get-ChildItem Cert:\CurrentUser\Root -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -eq "CN=BabelTower-localhost" })
  foreach ($l in $legacy) {
    & certutil.exe -user -delstore Root $l.Thumbprint | Out-Null
    Write-Host ("迁移清理: 移除旧直发证书信任条目 " + $l.Thumbprint)
  }
  Write-Host ""
  Write-Host "下一步(必须):完全退出并重启 Steam(托盘也退),再启动游戏。"
  Write-Host "原因见本文件头部坑③:信任库由 Steam 宿主缓存,只重启游戏不会重载。"
}
