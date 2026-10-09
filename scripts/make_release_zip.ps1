# Legacy packager - superseded by scripts\package_release.ps1 (which release.ps1
# actually calls). Kept only because tests\bridge_paths_logs_guard.test.js guards
# the recursive core/ copy below.
#
# 2026-09 护栏:$ZipPath 原本写死 "BabelTower-1.0.0-win64.zip",而第 5 行
# 会先 Remove-Item —— 今天跑一次就会把 dist 里真实的 1.0.0 正式发布包删掉,
# 再写一个缺 VPK / 缺说明文档的残缺版进去。改为:
#   ① 版本号从 README.md 单一来源解析(与发版铁律一致)
#   ② 目标 zip 已存在时拒绝执行,除非显式传 -Force
param(
  [switch]$Force
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

# 版本单一来源:README.md 的 "> 版本:1.0.9 (2026-10-09)"
# 2026-10-09: 本文件原本是 UTF-8 无 BOM,PowerShell 5.1 按系统 ANSI(GBK)解码执行,
# 下面正则里的中文字面量会被解成乱码 -> 永远匹配不到 README -> 脚本每次都停在
# "cannot read version from README.md"。两重保险:
#   ① 文件已另存为 UTF-8 带 BOM(PS5.1 优先按 BOM 解码);
#   ② 正则改用 \u 转义,即使编码再出问题也只依赖 ASCII。
$Version = ""
$readme = Join-Path $Root "README.md"
if (Test-Path $readme) {
  # '\u7248\u672c' = "版本"(见上方说明:即使编码再次失真也只依赖 ASCII)
  $vm = [regex]::Match([System.IO.File]::ReadAllText($readme), '\u7248\u672c:\s*([0-9]+\.[0-9]+\.[0-9]+)')
  if ($vm.Success) { $Version = $vm.Groups[1].Value }
}
if (-not $Version) {
  Write-Host "[make_release_zip] ERROR: cannot read version from README.md" -ForegroundColor Red
  exit 1
}

$ZipPath = Join-Path $Root "dist\BabelTower-$Version-win64.zip"

if ((Test-Path $ZipPath) -and -not $Force) {
  Write-Host "[make_release_zip] ERROR: $ZipPath already exists." -ForegroundColor Red
  Write-Host "  It may be a shipped release artifact. Re-run with -Force to overwrite," -ForegroundColor Yellow
  Write-Host "  or use scripts\package_release.ps1 for real releases." -ForegroundColor Yellow
  exit 1
}

if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }

# The VPK IS the package. It used to be listed below as a root-level
# "pak01_dir.vpk", which does not exist (the build writes dist\pak01_dir.vpk),
# so the loop printed "SKIP ... not found" and still ended with "Created"
# and exit 0 - a zip the user cannot install, silently. Fail instead.
$vpkFile = Join-Path $Root "dist\pak01_dir.vpk"
if (-not (Test-Path $vpkFile)) {
  Write-Host "[make_release_zip] ERROR: dist\pak01_dir.vpk not found." -ForegroundColor Red
  Write-Host "  Run scripts\build.ps1 first (or use scripts\package_release.ps1)." -ForegroundColor Yellow
  exit 1
}

Add-Type -Assembly System.IO.Compression.FileSystem

$entries = @(
  @{ Path = "dist\pak01_dir.vpk"; Zip = "pak01_dir.vpk" }
  @{ Path = "config\config.example.json"; Zip = "config\config.example.json" }
  @{ Path = "config\dictionary.builtin.json"; Zip = "config\dictionary.builtin.json" }
  @{ Path = "config\dictionary.json"; Zip = "config\dictionary.json" }
  @{ Path = "config\gamenames.json"; Zip = "config\gamenames.json" }
)

# core/ directory (recursive)
Get-ChildItem (Join-Path $Root "core") -Recurse -File | ForEach-Object {
  $rel = $_.FullName.Substring("$Root\core".Length).TrimStart("\")
  $entries += @{ Path = "core\$rel"; Zip = "core\$rel" }
}

# portable-node (just node.exe)
$nodeExe = Join-Path $Root "portable-node\node.exe"
if (Test-Path $nodeExe) {
  $entries += @{ Path = "portable-node\node.exe"; Zip = "portable-node\node.exe" }
}

# single files
$singleFiles = @(
  "scripts\autostart.ps1",
  "scripts\restart_bridge.ps1",
  "scripts\bridge_health.ps1",
  "restart_bridge.bat",
  "run-bridge.bat",
  "install-autostart.bat",
  "remove-autostart.bat",
  "StartDeadlock.bat",
  "LICENSE",
  "LICENSE_NOTICE.md",
  "README.md",
  "安装使用说明.txt"
)
foreach ($f in $singleFiles) {
  $entries += @{ Path = $f; Zip = $f }
}

$zip = [System.IO.Compression.ZipFile]::Open($ZipPath, 'Create')
try {
  foreach ($e in $entries) {
    $fullPath = Join-Path $Root $e.Path
    if (-not (Test-Path $fullPath)) {
      Write-Host "SKIP: $($e.Path) not found" -ForegroundColor Yellow
      continue
    }
    # 2026-10-09: 这里原本是 [void][...]::CreateEntryFromFile(...) | Out-Null。
    # [void] 被当成对方法返回值的类型转换,PowerShell 在【编译整个脚本时】就抛
    # "Argument type cannot be System.Void",于是一行输出都没有、直接
    # "An error occurred while creating the pipeline" 退出 —— 脚本从未真正跑过。
    # 右边已有 | Out-Null,去掉 [void] 语义不变,脚本可正常执行。
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $fullPath, $e.Zip) | Out-Null
    Write-Host "  + $($e.Zip)"
  }
} finally {
  $zip.Dispose()
}

$size = [math]::Round((Get-Item $ZipPath).Length / 1MB, 1)
Write-Host "`n✅ Created: $ZipPath ($size MB)"
