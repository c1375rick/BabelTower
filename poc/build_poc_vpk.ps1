# Babel Tower bridgeless POC - standalone vpk build.
# Does NOT touch dist/ and does NOT run the product build.ps1.
# Usage: powershell -ExecutionPolicy Bypass -File poc\build_poc_vpk.ps1
# Output: poc\pak90_dir.vpk  (independent slot; delete after the test; pak15 untouched)
# Name note: Deadlock/DMM only load "pakNN_dir.vpk" (numeric NN). The task brief's example
# "pak90_poc_dir.vpk" does NOT match that pattern, so the numeric form is used here.
# Deps: resourcecompiler.exe from Reduced CSDK 12 + tools\vpkeditcli.exe
[CmdletBinding()]
param(
  [string]$Csdk12Root = "F:\dev-tools\Reduced_CSDK_12"
)
$ErrorActionPreference = "Stop"
$PocRoot = $PSScriptRoot
$RepoRoot = Split-Path -Parent $PocRoot
$Src = Join-Path $PocRoot "vpk\src"
$AddonName = "pocpano"
# resourcecompiler refuses paths outside a CSDK addon root ("Unable to determine mod"),
# so the POC sources are staged under the CSDK content addons tree (same as build.ps1),
# using a dedicated addon name so the linguachat addon dir is never touched.
$ContentAddon = Join-Path $Csdk12Root "content\citadel_addons\$AddonName"
$GameAddon = Join-Path $Csdk12Root "game\citadel_addons\$AddonName"
$Build = $GameAddon
$Out = Join-Path $PocRoot "pak90_dir.vpk"

function Find-Compiler {
  $c = @(
    (Join-Path $Csdk12Root "game\bin_cs2\win64\resourcecompiler.exe"),
    (Join-Path $Csdk12Root "game\bin\win64\resourcecompiler.exe"),
    (Join-Path $Csdk12Root "game\bin_tools\win64\resourcecompiler.exe")
  )
  foreach ($x in $c) { if (Test-Path $x) { return $x } }
  return ""
}
$compiler = Find-Compiler
if (-not $compiler) { Write-Host "[poc] resourcecompiler not found ($Csdk12Root)" -ForegroundColor Red; exit 1 }
$vpkEdit = Join-Path $RepoRoot "tools\vpkeditcli.exe"
if (-not (Test-Path $vpkEdit)) { Write-Host "[poc] vpkeditcli.exe not found" -ForegroundColor Red; exit 1 }
$node = Join-Path $RepoRoot "portable-node\node.exe"

Write-Host "==> resourcecompiler: $compiler"
Write-Host "==> node: $node"

if (Test-Path $node) {
  Get-ChildItem $Src -Recurse -Filter *.js | ForEach-Object {
    & $node --check $_.FullName
    if ($LASTEXITCODE -ne 0) { Write-Host "[poc] JS syntax error: $($_.FullName)" -ForegroundColor Red; exit 1 }
    Write-Host "   ok(node --check): $($_.Name)"
  }
}

# Stage sources into the CSDK addon tree (resourcecompiler needs this root).
if (Test-Path $ContentAddon) { Remove-Item $ContentAddon -Recurse -Force }
if (Test-Path $GameAddon) { Remove-Item $GameAddon -Recurse -Force }
New-Item -ItemType Directory -Path $ContentAddon -Force | Out-Null
Copy-Item (Join-Path $Src "*") $ContentAddon -Recurse -Force
Write-Host "==> staged to $ContentAddon"

$map = @{ ".xml" = "vxml_c"; ".js" = "vjs_c"; ".css" = "vcss_c" }
Get-ChildItem $ContentAddon -Recurse -File | ForEach-Object {
  $ext = $_.Extension.ToLower()
  if (-not $map.ContainsKey($ext)) { return }
  $rel = $_.FullName.Substring($ContentAddon.Length).TrimStart("\")
  $outRel = [System.IO.Path]::ChangeExtension($rel, $map[$ext])
  $dst = Join-Path $GameAddon $outRel
  New-Item -ItemType Directory -Path (Split-Path -Parent $dst) -Force | Out-Null
  & $compiler -i $_.FullName -o $dst | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $dst)) { Write-Host "[poc] compile failed: $rel" -ForegroundColor Red; exit 1 }
  Write-Host "   compiled: $outRel"
}

if (Test-Path $Out) { Remove-Item $Out -Force }
& $vpkEdit $Build -o $Out --single-file --no-progress 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $Out)) { Write-Host "[poc] vpk pack failed" -ForegroundColor Red; exit 1 }
Write-Host "==> output: $Out"
Write-Host "---- file tree ----"
& $vpkEdit $Out --file-tree
