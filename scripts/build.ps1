# Babel Tower - 构建脚本
# ------------------------------------------------------------------
# 流程:mod/panorama 源码 -> resourcecompiler 编译 -> vpkeditcli 打包 -> dist/pak01_dir.vpk
#
# 用法(任选):
#   powershell -ExecutionPolicy Bypass -File scripts\build.ps1 -Csdk12Root "D:\Reduced_CSDK_12"
#   powershell -ExecutionPolicy Bypass -File scripts\build.ps1 -Csdk12Root "D:\Reduced_CSDK_12" -Mode Source
#
# 参数:
#   -Csdk12Root   Reduced CSDK 12 根目录(必须能从中找到 resourcecompiler.exe)
#   -AddonName    临时 addon 名,默认 linguachat(全小写)
#   -Mode         Compiled(默认,编译+打包) | Source(只把源码复制到 dist/src 供检查)
#   -SkipPack     只编译不打包(调试用)
# 依赖工具:
#   - resourcecompiler.exe: 优先 CSDK12 的 game\bin_cs2\win64\,其次 bin_tools/bin/bin_server
#   - vpkeditcli.exe: 项目 tools\vpkeditcli.exe,或系统 PATH 中的 vpkedit
# 产物:dist\pak01_dir.vpk(直接放入 Deadlock 的 citadel\addons 目录)
# ------------------------------------------------------------------
[CmdletBinding()]
param(
  [string]$Csdk12Root = "",
  [string]$AddonName = "linguachat",
  [ValidateSet("Compiled", "Source")]
  [string]$Mode = "Compiled",
  [switch]$SkipPack
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ModDir = Join-Path $ProjectRoot "mod"
$DistDir = Join-Path $ProjectRoot "dist"
$ToolsDir = Join-Path $ProjectRoot "tools"

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "[build] 错误: $msg" -ForegroundColor Red; exit 1 }

# ---------- 构建前护栏:扫描源码非法控制字符 ----------
# 防止类似 "注释里混入 0x00/0x07 导致 resourcecompiler 编译出截断的 vjs_c,
# 游戏加载时整个脚本 SyntaxError 不执行" 的静默损坏。
# 允许的控制字符: Tab(0x09) / LF(0x0A) / CR(0x0D)。其余 <0x20 一律视为脏数据。
function Test-SourceClean {
  $badFiles = @()
  $scan = Get-ChildItem $ModDir -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
    $_.Extension -in @(".js", ".css", ".xml", ".txt", ".json", ".md")
  }
  foreach ($f in $scan) {
    try {
      $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
    } catch {
      continue
    }
    $hits = @()
    for ($i = 0; $i -lt $bytes.Length; $i++) {
      $b = $bytes[$i]
      if ($b -lt 0x20 -and $b -ne 0x09 -and $b -ne 0x0A -and $b -ne 0x0D) {
        $hits += "0x$($b.ToString('x2'))@$($i+1)"
        if ($hits.Count -ge 10) { break }
      }
    }
    if ($hits.Count -gt 0) {
      $badFiles += "$($f.FullName): $($hits -join ', ')"
    }
  }
  if ($badFiles.Count -gt 0) {
    Fail "源码含非法控制字符(会导致编译产物损坏):`n" + ($badFiles -join "`n")
  }
}

# ---------- 工具探测 ----------
function Find-ResourceCompiler {
  if (-not $Csdk12Root -or -not (Test-Path $Csdk12Root)) { return "" }
  $candidates = @(
    (Join-Path $Csdk12Root "game\bin_cs2\win64\resourcecompiler.exe"),
    (Join-Path $Csdk12Root "game\bin_tools\win64\resourcecompiler.exe"),
    (Join-Path $Csdk12Root "game\bin\win64\resourcecompiler.exe"),
    (Join-Path $Csdk12Root "game\bin_server\win64\resourcecompiler.exe")
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  return ""
}

function Find-VpkEdit {
  $local = Join-Path $ToolsDir "vpkeditcli.exe"
  if (Test-Path $local) { return $local }
  $cmd = Get-Command vpkedit -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return ""
}

# ---------- 编译单个文件 ----------
# 注意:resourcecompiler 会把输出扩展名规范化为 .vxml_c/.vjs_c/.vcss_c
function Get-CompiledExtension($ext) {
  switch ($ext.ToLower()) {
    ".xml" { return "vxml_c" }
    ".js"  { return "vjs_c" }
    ".css" { return "vcss_c" }
    default { return $ext.TrimStart(".") + "_c" }
  }
}

function Compile-File($compiler, $contentFile, $gameFile) {
  $outDir = Split-Path -Parent $gameFile
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
  $contentFile = [System.IO.Path]::GetFullPath($contentFile)
  $gameFile = [System.IO.Path]::GetFullPath($gameFile)
  $args = @("-i", $contentFile, "-o", $gameFile)
  & $compiler @args | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Fail "resourcecompiler 编译失败: $contentFile (exit=$LASTEXITCODE)"
  }
  if (-not (Test-Path $gameFile)) {
    Fail "编译未产出文件: $gameFile"
  }
  Write-Host "   ok: $([System.IO.Path]::GetFileName($gameFile))"
}

# ---------- 主流程 ----------
Write-Step "Babel Tower build (Mode=$Mode, Addon=$AddonName)"

if ($Mode -eq "Source") {
  $srcOut = Join-Path $DistDir "src"
  if (Test-Path $srcOut) { Remove-Item $srcOut -Recurse -Force }
  Copy-Item $ModDir $srcOut -Recurse -Force
  Write-Step "源码已复制到 $srcOut"
  exit 0
}

$compiler = Find-ResourceCompiler
if (-not $compiler) {
  Fail "找不到 resourcecompiler.exe,请用 -Csdk12Root 指定 Reduced CSDK 12 根目录"
}
Write-Step "resourcecompiler: $compiler"

# 0. 构建前护栏:源码非法控制字符扫描(必须在编译前)
Test-SourceClean
Write-Step "源码扫描通过(无非法控制字符)"

$contentAddon = Join-Path $Csdk12Root "content\citadel_addons\$AddonName"
$gameAddon = Join-Path $Csdk12Root "game\citadel_addons\$AddonName"

# 1. 同步源码到 CSDK addon 的 content 目录
if (Test-Path $contentAddon) { Remove-Item $contentAddon -Recurse -Force }
if (Test-Path $gameAddon) { Remove-Item $gameAddon -Recurse -Force }
New-Item -ItemType Directory -Path $contentAddon -Force | Out-Null
Copy-Item $ModDir\* $contentAddon -Recurse -Force
Write-Step "源码已同步到 $contentAddon"

# 2. 编译 panorama 资源
$contentPano = Join-Path $contentAddon "panorama"
if (-not (Test-Path $contentPano)) { Fail "content addon 中没有 panorama 目录" }

$files = Get-ChildItem $contentPano -Recurse -File | Where-Object {
  $_.Extension -in @(".xml", ".js", ".css")
}
if ($files.Count -eq 0) { Fail "没有可编译的 xml/js/css 文件" }
Write-Step "编译 $($files.Count) 个文件..."

foreach ($f in $files) {
  $rel = $f.FullName.Substring($contentPano.Length).TrimStart("\")
  $outRel = [System.IO.Path]::ChangeExtension($rel, (Get-CompiledExtension $f.Extension))
  $gameFile = Join-Path (Join-Path $gameAddon "panorama") $outRel
  Compile-File $compiler $f.FullName $gameFile
}

if ($SkipPack) {
  Write-Step "已跳过打包(SkipPack),编译产物在 $gameAddon"
  exit 0
}

# 3. 打包 VPK
$vpkEdit = Find-VpkEdit
if (-not $vpkEdit) {
  Fail "找不到 vpkeditcli.exe,请放入 tools\ 目录或加入 PATH(下载: https://github.com/craftablescience/VPKEdit/releases)"
}
Write-Step "vpkedit: $vpkEdit"
New-Item -ItemType Directory -Path $DistDir -Force | Out-Null
$vpkOut = Join-Path $DistDir "pak01_dir.vpk"
if (Test-Path $vpkOut) { Remove-Item $vpkOut -Force }
Remove-Item (Join-Path $DistDir "pak01_*.vpk") -Force -ErrorAction SilentlyContinue

# vpkeditcli <输入目录> -o <输出.vpk> (将目录内文件全部打入单个 dir vpk)
& $vpkEdit $gameAddon -o $vpkOut --single-file --no-progress 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "vpkedit 打包失败 (exit=$LASTEXITCODE)" }
if (-not (Test-Path $vpkOut)) { Fail "打包未产出 $vpkOut" }

# 4. 校验关键资产
Write-Step "校验 VPK 内容..."
$listing = & $vpkEdit $vpkOut --file-tree 2>&1 | Out-String
$required = @("chat.vxml_c", "lingua_chat.vjs_c", "lingua_chat.vcss_c")
foreach ($r in $required) {
  if (-not ($listing -match [regex]::Escape($r))) {
    Fail "VPK 中缺少关键资产: $r"
  }
}

Write-Step "构建完成: $vpkOut"
Write-Host "安装:把 pak01_dir.vpk 复制到 Deadlock 的 game/citadel/addons 目录"
