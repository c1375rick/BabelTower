$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$ZipPath = Join-Path $Root "dist\BabelTower-1.0.0-win64.zip"

if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }

Add-Type -Assembly System.IO.Compression.FileSystem

$entries = @(
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
  "install-autostart.bat",
  "remove-autostart.bat",
  "StartDeadlock.bat",
  "LICENSE",
  "LICENSE_NOTICE.md",
  "pak01_dir.vpk",
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
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $fullPath, $e.Zip) | Out-Null
    Write-Host "  + $($e.Zip)"
  }
} finally {
  $zip.Dispose()
}

$size = [math]::Round((Get-Item $ZipPath).Length / 1MB, 1)
Write-Host "`n✅ Created: $ZipPath ($size MB)"
