# 生成 Babel Tower 本机 HTTPS 证书(隐藏 HTML 面板通道用)
# ------------------------------------------------------------------
# 为什么需要:Panorama 的隐藏 HTML 面板只接受**证书有效**的 https(SB 2 引擎实测
# error:-202 = ERR_CERT_AUTHORITY_INVALID),http://127.0.0.1 与 http://localhost
# 都在 LoadPage 之前被拒。因此桥需要一张本机自签证书,并且**必须被信任**。
#
# 关键坑(2026-10-15 实测,三条都踩过):
#   ① SAN 必须带 **IP SAN**(127.0.0.1 / ::1),把 IP 写成 DNS 名字不算 —— 引擎会
#      报"名称不匹配"而不是"未知 CA",容易误判方向。
#   ② 信任库写入用 `certutil -user -addstore Root`:PowerShell 的 Import-Certificate
#      在非交互进程里会报 "UI is not allowed in this operation"(Root 库要弹确认框)。
#      删除同理用 certutil -user -delstore Root。
#   ③ **信任之后必须完全退出并重启 Steam**(托盘也退)。信任库由 Steam 宿主缓存,
#      只重启游戏不会重载 —— 当初就因为漏了这条而误判"引擎不支持 https"。
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File scripts\gen_bridge_cert.ps1            # 只生成
#   powershell -ExecutionPolicy Bypass -File scripts\gen_bridge_cert.ps1 -Trust    # 生成并信任
#   powershell -ExecutionPolicy Bypass -File scripts\gen_bridge_cert.ps1 -Untrust  # 撤销信任
#   powershell -ExecutionPolicy Bypass -File scripts\gen_bridge_cert.ps1 -Status   # 只看状态
[CmdletBinding()]
param(
  [switch]$Trust,
  [switch]$Untrust,
  [switch]$Status,
  [string]$StateDir = $(if ($env:BABEL_TOWER_STATE) { $env:BABEL_TOWER_STATE } else { Join-Path $env:LOCALAPPDATA "BabelTower" }),
  [int]$Years = 5
)

$ErrorActionPreference = "Stop"
$name = "BabelTower-localhost"
$pemDir = Join-Path $StateDir "cert"
$pem = Join-Path $pemDir "bridge-cert.pem"
$key = Join-Path $pemDir "bridge-key.pem"
$cer = Join-Path $pemDir "bridge-cert.cer"
$friendly = "BabelTower-bridge-localhost"

New-Item -ItemType Directory -Path $pemDir -Force | Out-Null
# 产物路径先定义:下面的"是否可复用"判断要用
$pfxPath = Join-Path $pemDir "bridge.pfx"
$pfxPass = "btabridge"
$cerPath = Join-Path $pemDir "bridge-cert.cer"

function Get-Cert {
  param([switch]$Any)
  $all = @(Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue |
    Where-Object { $_.FriendlyName -eq $friendly -or $_.Subject -eq "CN=$name" })
  if ($all.Count -eq 0) { return $null }
  # 优先未过期
  $live = @($all | Where-Object { $_.NotAfter -gt (Get-Date).AddDays(30) })
  if ($live.Count) { return $live[0] }
  if ($Any) { return $all[0] }
  return $null
}

function Write-Status($c) {
  $trusted = @(Get-ChildItem Cert:\CurrentUser\Root -ErrorAction SilentlyContinue |
    Where-Object { $_.Thumbprint -eq $c.Thumbprint })
  Write-Host ("证书    : " + $c.Subject + "  指纹 " + $c.Thumbprint)
  Write-Host ("到期    : " + $c.NotAfter.ToString("yyyy-MM-dd"))
  Write-Host ("PFX     : " + $(if (Test-Path $pfxPath) { $pfxPath } else { "(缺,先运行本脚本)" }))
  Write-Host ("信任库  : " + $(if ($trusted.Count) { "已信任(CurrentUser\Root)" } else { "未信任" }))
  if (-not $trusted.Count) {
    Write-Host ""
    Write-Host "下一步:运行本脚本 -Trust,然后**完全退出并重启 Steam**(托盘也退),再启动游戏。"
  }
}

if ($Untrust) {
  $c = Get-Cert -Any
  if (-not $c) { Write-Host "没有找到本项目签发的证书,无需撤销。"; exit 0 }
  & certutil.exe -user -delstore Root $c.Thumbprint | Out-Null
  Write-Host ("已从当前用户信任库移除: " + $c.Thumbprint)
  Write-Host "剩余条数 = " + @(Get-ChildItem Cert:\CurrentUser\Root | Where-Object { $_.Thumbprint -eq $c.Thumbprint }).Count
  exit 0
}

if ($Status) {
  $c = Get-Cert -Any
  if (-not $c) { Write-Host "尚未生成证书。运行:scripts\gen_bridge_cert.ps1"; exit 1 }
  Write-Status $c
  exit 0
}

# ---------- 生成(幂等:已有有效证书就复用) ----------
$c = Get-Cert
if ($c -and (Test-Path $pfxPath)) {
  Write-Host ("复用现有证书: " + $c.Thumbprint)
} else {
  Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.FriendlyName -eq $friendly } |
    Remove-Item -Force -ErrorAction SilentlyContinue
  Write-Host "生成自签证书(CN=$name,SAN 含 localhost + 127.0.0.1 + ::1,EKU=serverAuth)…"
  # SAN 必须同时给 DNS 名与 **IP 条目**;PowerShell 只允许一个 -TextExtension 参数,
  # 所以三条扩展合并成一个数组(SAN / BasicConstraints=End Entity / EKU=serverAuth)。
  $c = New-SelfSignedCertificate -Type Custom -Subject "CN=$name" -FriendlyName $friendly `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -KeyExportPolicy Exportable -KeyUsage DigitalSignature,KeyEncipherment `
    -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddYears($Years) `
    -TextExtension @(
      "2.5.29.17={text}DNS=localhost&ipaddress=127.0.0.1&ipaddress=::1",
      "2.5.29.19={text}1.3.6.1.5.5.7.3.1",
      "2.5.29.37={text}1.3.6.1.5.5.7.3.1"
    )
  $pwd = ConvertTo-SecureString -String "btabridge" -Force -AsPlainText
  Export-PfxCertificate -Cert $c -FilePath (Join-Path $pemDir "bridge.pfx") -Password $pwd | Out-Null
  Write-Host ("证书已生成: " + $c.Thumbprint)
}

# 导出 PFX 给 Node 直接读(https.createServer({pfx, passphrase})原生支持 PFX)。
# 不走 PEM:PS 5.1(.NET Framework)没有 ExportCertificatePem(),那是 .NET Core 3.0+ 的 API。
# 私钥不出 My 库、不上传输给用户;PFX 落在 %LOCALAPPDATA%\BabelTower\cert\。
$pfxPass = "btabridge"
$plain = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($c)
Export-PfxCertificate -Cert $plain -FilePath $pfxPath -Password (ConvertTo-SecureString -String $pfxPass -Force -AsPlainText) | Out-Null
# 便于用户核对/手动导入的 .cer(DER)
$cerPath = Join-Path $pemDir "bridge-cert.cer"
Export-Certificate -Cert $plain -FilePath $cerPath -Force | Out-Null
Write-Host ("PFX 已写出: " + $pfxPath)
Write-Host ("证书副本  : " + $cerPath)

# ---------- 信任 ----------
if ($Trust) {
  $already = @(Get-ChildItem Cert:\CurrentUser\Root -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $c.Thumbprint })
  if ($already.Count) {
    Write-Host "证书已在信任库中,无需重复添加。"
  } else {
    $tmpCer = Join-Path $pemDir "_trust.cer"
    Export-Certificate -Cert $c -FilePath $tmpCer -Force | Out-Null
    & certutil.exe -user -addstore Root $tmpCer | Out-Null
    Remove-Item $tmpCer -Force -ErrorAction SilentlyContinue
    Write-Host ("已加入当前用户信任库(CurrentUser\Root): " + $c.Thumbprint)
  }
  Write-Host ""
  Write-Host "★ 现在必须**完全退出并重启 Steam**(托盘图标也退掉),否则浏览器不会重载信任库。"
  Write-Host "  只重启游戏是没用的(2026-10-15 实测踩过)。"
}

Write-Status $c
