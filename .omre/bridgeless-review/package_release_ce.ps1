# ============================================================
#  Babel Tower **Community** (no-bridge) 发行包脚本
#  产物: dist\BabelTower-<版本>-win64.zip
#        dist\BabelTower-Community-<版本>-win64.zip(别名副本,便于区分主线)
#  用法: powershell -ExecutionPolicy Bypass -File scripts\package_release.ps1
#        (scripts\package_release.ps1 会转发到这里 —— 那个脚本是**主线带桥**的发包器,
#         需要 core\ + portable-node\ + 一堆 bat 入口;社区仓库里没有这些文件,
#         强行跑只会 "缺少 portable-node\node.exe" 而失败,理由见 CHANGELOG-0.1.0.md)
#
#  社区包内容(故意最小):
#    pak90_ce_dir.vpk   社区测试用 VPK,独立文件名,永不覆盖主线 pak15
#    README.md LICENSE LICENSE_NOTICE.md CHANGELOG-0.1.0.md VERSION
#  不含: core/(本地桥)、portable-node/(随包 Node)、bat 入口 —— 无桥形态不需要,
#        也避免用户误以为还要起一个本地服务。
# ============================================================
[CmdletBinding()]
param(
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Dist = Join-Path $Root "dist"

function Fail($msg) { Write-Host "[package-ce] 错误: $msg" -ForegroundColor Red; exit 1 }

if (-not $Version) {
  $vfile = Join-Path $Root "VERSION"
  if (Test-Path $vfile) { $Version = (Get-Content $vfile -Raw -Encoding UTF8).Trim() }
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') { Fail "版本号无效: '$Version'" }

$Stage = Join-Path $Dist "BabelTower-$Version-win64"
$ZipOut = Join-Path $Dist "BabelTower-$Version-win64.zip"
$ZipAlias = Join-Path $Dist "BabelTower-Community-$Version-win64.zip"

# ---- 必需资产 ----
$vpk = Join-Path $Dist "pak90_ce_dir.vpk"
if (-not (Test-Path $vpk)) {
  $fallback = Join-Path $Dist "pak01_dir.vpk"
  if (Test-Path $fallback) {
    Write-Host "==> dist\pak90_ce_dir.vpk 不存在,从 dist\pak01_dir.vpk 复制(社区版独立文件名)"
    Copy-Item $fallback $vpk -Force
  } else {
    Fail "缺少 dist\pak90_ce_dir.vpk(先跑 scripts\build.ps1,再复制 pak01_dir.vpk -> pak90_ce_dir.vpk)"
  }
}
$changelog = Join-Path $Root "CHANGELOG-0.1.0.md"
if (-not (Test-Path $changelog)) { Fail "缺少 CHANGELOG-0.1.0.md(发行说明必须随包)" }

# ---- 组装 ----
if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Path $Stage -Force | Out-Null

Write-Host "==> 复制 VPK 与文档..."
Copy-Item $vpk (Join-Path $Stage "pak90_ce_dir.vpk")
Copy-Item (Join-Path $Root "README.md") (Join-Path $Stage "README.md")
Copy-Item (Join-Path $Root "LICENSE") (Join-Path $Stage "LICENSE")
Copy-Item (Join-Path $Root "LICENSE_NOTICE.md") (Join-Path $Stage "LICENSE_NOTICE.md")
Copy-Item $changelog (Join-Path $Stage "CHANGELOG-0.1.0.md")
Copy-Item (Join-Path $Root "VERSION") (Join-Path $Stage "VERSION") -Force

# ---- 入口断言:缺一个就拒绝出包(用户侧症状是"装了没反应",没有报错能指向打包) ----
$required = @("pak90_ce_dir.vpk", "README.md", "LICENSE", "LICENSE_NOTICE.md",
              "CHANGELOG-0.1.0.md", "VERSION")
foreach ($f in $required) {
  if (-not (Test-Path (Join-Path $Stage $f))) { Fail "发行包缺 $f" }
}
$vpkBytes = (Get-Item (Join-Path $Stage "pak90_ce_dir.vpk")).Length
if ($vpkBytes -lt 100KB -or $vpkBytes -gt 8MB) { Fail "VPK 体积异常: $vpkBytes B(预期 0.1~8MB)" }
Write-Host ("==> VPK 体积 OK: {0:N0} B" -f $vpkBytes)

# ---- 压缩 ----
Write-Host "==> 压缩..."
if (Test-Path $ZipOut) { Remove-Item $ZipOut -Force }
Compress-Archive -Path "$Stage\*" -DestinationPath $ZipOut -CompressionLevel Optimal
if (-not (Test-Path $ZipOut)) { Fail "压缩失败" }
Copy-Item $ZipOut $ZipAlias -Force

$size = [math]::Round((Get-Item $ZipOut).Length / 1MB, 2)
if ($size -lt 0.1 -or $size -gt 40) { Fail "zip 体积异常: $size MB" }
Write-Host "==> 完成: $ZipOut ($size MB)"
Write-Host "==> 别名: $ZipAlias"

# ---- 内容清单(可核对包内文件) ----
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($ZipOut)
Write-Host "==> zip 内容:"
$zip.Entries | ForEach-Object { Write-Host ("    {0}  ({1:N0} B)" -f $_.FullName, $_.Length) }
$zip.Dispose()

Remove-Item $Stage -Recurse -Force
