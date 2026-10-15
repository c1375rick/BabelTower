# 读 minidump:异常码 + 出错模块 + 贫民版栈回溯(不解符号)
# 用法: . scripts\minidump_info.ps1 -Path @(dir\of\dumps)  [-Stack]
param(
  [Parameter(Mandatory = $true)][string[]]$Path,
  [switch]$Stack
)

$CodeName = @{
  0x80000003 = 'EXCEPTION_BREAKPOINT'
  0x80000004 = 'EXCEPTION_SINGLE_STEP'
  0xC0000005 = 'ACCESS_VIOLATION'
  0xC000001D = 'ILLEGAL_INSTRUCTION'
  0xC0000094 = 'INTEGER_DIVIDE_BY_ZERO'
  0xC0000096 = 'PRIVILEGED_INSTRUCTION'
  0xC00000FD = 'STACK_OVERFLOW'
  0xC0000135 = 'DLL_NOT_FOUND'
  0xC000013A = 'CONTROL_C_EXIT'
  0xC0000142 = 'DLL_INIT_FAILED'
  0xC0000374 = 'HEAP_CORRUPTION'
  0xC0000409 = 'STACK_BUFFER_OVERRUN / FAIL_FAST'
  0xC0000417 = 'INVALID_CRUNTIME_PARAMETER'
  0xE06D7363 = 'CPP_EXCEPTION'
}

function RB($b, $o, $l) { if ($o -lt 0 -or $o + $l -gt $b.Length) { return $null }; ,($b[$o..($o + $l - 1)]) }
function U32($b, $o) { $s = RB $b $o 4; if ($null -eq $s) { return $null }; [BitConverter]::ToUInt32($s, 0) }
function U64($b, $o) { $s = RB $b $o 8; if ($null -eq $s) { return $null }; [BitConverter]::ToUInt64($s, 0) }

function New-Reader([byte[]]$b) {
  $n = U32 $b 8
  $dir = U32 $b 12
  $st = @{}
  for ($i = 0; $i -lt $n; $i++) {
    $e = $dir + $i * 12
    $t = U32 $b $e; if ($null -eq $t) { break }
    $st[[int]$t] = @{ size = (U32 $b ($e + 4)); rva = (U32 $b ($e + 8)) }
  }
  return $st
}

function Get-Modules($b, $st) {
  $out = @()
  if (-not $st.ContainsKey(4)) { return $out }
  $rva = $st[4].rva
  $n = U32 $b $rva
  for ($m = 0; $m -lt $n; $m++) {
    $mo = $rva + 4 + $m * 108
    $base = U64 $b $mo; if ($null -eq $base) { break }
    $sz  = U32 $b ($mo + 8)
    $nrv = U32 $b ($mo + 20)
    $nm = ''
    if ($null -ne $nrv -and $nrv -lt $b.Length) {
      $len = U32 $b $nrv
      if ($null -ne $len -and $len -gt 0 -and $len -lt 800) {
        $raw = RB $b ($nrv + 4) $len
        if ($raw) { $nm = [System.Text.Encoding]::Unicode.GetString($raw, 0, $len) }
      }
    }
    $out += [pscustomobject]@{ base = [uint64]$base; size = [uint32]$sz; name = $nm }
  }
  return $out
}

function Get-ModOf($mods, $addr) {
  if ($null -eq $addr) { return $null }
  foreach ($m in $mods) { if ($addr -ge $m.base -and $addr -lt ($m.base + $m.size)) { return $m } }
  return $null
}
function Fmt($mods, $addr) {
  $m = Get-ModOf $mods $addr
  if ($m) { $off = $addr - $m.base; return ("{0}+0x{1:X}" -f (Split-Path $m.name -Leaf), $off) }
  return ("0x{0:X}" -f $addr)
}

foreach ($p in $Path) {
  if (-not (Test-Path $p)) { Write-Output "MISSING $p"; continue }
  $b = [System.IO.File]::ReadAllBytes($p)
  $fi = Get-Item $p
  Write-Output ""
  Write-Output ("=== " + $fi.Name + "   " + $fi.Length + "B   mtime " + $fi.LastWriteTime.ToString('MM-dd HH:mm:ss') + " ===")
  if ([System.Text.Encoding]::ASCII.GetString($b, 0, 4) -ne 'MDMP') { Write-Output "  not a minidump"; continue }

  $st = New-Reader $b
  $mods = Get-Modules $b $st
  $bad = @($mods | Where-Object { -not $_.name }).Count
  if ($bad -gt 0) { Write-Output ("  WARN: " + $bad + "/" + $mods.Count + " module names unreadable") }

  # ---- 异常 ----
  $exCode = $null; $exAddr = $null; $thrId = $null; $exInfo = @()
  if ($st.ContainsKey(6)) {
    $r = $st[6].rva
    $thrId = U32 $b $r
    $exCode = U32 $b ($r + 8)
    $exAddr = U64 $b ($r + 24)
    for ($k = 0; $k -lt 15; $k++) { $v = U64 $b ($r + 40 + $k * 8); if ($null -ne $v) { $exInfo += $v } }
  }
  if ($null -ne $exCode) {
    $cn = $CodeName[[uint32]$exCode]; if (-not $cn) { $cn = '?' }
    Write-Output ("  exception   : 0x{0:X8}  {1}" -f [uint32]$exCode, $cn)
    Write-Output ("  raise addr  : " + (Fmt $mods $exAddr))
    if ([uint32]$exCode -eq 0xC0000005 -and $exInfo.Count -ge 3) {
      Write-Output ("  AV type     : {0}  at 0x{1:X}" -f $exInfo[0], $exInfo[1])
    }
  } else { Write-Output "  no exception stream" }

  # ---- 出错线程 CONTEXT ----
  $rip = $null; $rsp = $null; $frame = $null
  if ($st.ContainsKey(3)) {
    $tl = $st[3].rva
    $nt = U32 $b $tl
    for ($t = 0; $t -lt $nt; $t++) {
      $to = $tl + 4 + $t * 48
      $id = U32 $b $to
      if ($id -ne $thrId) { continue }
      $frame = [pscustomobject]@{
        stackStart = (U64 $b ($to + 24))
        stackSize  = (U32 $b ($to + 32))
        stackRva   = (U32 $b ($to + 36))
        ctxRva     = (U32 $b ($to + 44))
      }
      break
    }
  }
  if ($frame -and $frame.ctxRva) {
    $rip = U64 $b ($frame.ctxRva + 0xF8)
    $rsp = U64 $b ($frame.ctxRva + 0x98)
    Write-Output ("  RIP         : " + (Fmt $mods $rip))
    Write-Output ("  RSP         : 0x{0:X}" -f $rsp)
  }

  # ---- 内存映射(Memory64List / MemoryList)----
  $mem = @()
  if ($st.ContainsKey(9)) {
    $r = $st[9].rva
    $n = U64 $b $r; $base = U64 $b ($r + 8); $acc = [uint64]$base
    for ($i = 0; $i -lt $n; $i++) {
      $e = $r + 16 + $i * 16
      $s = U64 $b $e; $sz = U64 $b ($e + 8)
      if ($null -eq $s -or $null -eq $sz) { break }
      $mem += [pscustomobject]@{ start = [uint64]$s; size = [uint64]$sz; rva = [uint64]$acc }
      $acc += [uint64]$sz
    }
  }
  elseif ($st.ContainsKey(5)) {
    $r = $st[5].rva
    $n = U32 $b $r
    for ($i = 0; $i -lt $n; $i++) {
      $e = $r + 4 + $i * 16
      $s = U64 $b $e; $sz = U32 $b ($e + 8); $rv = U32 $b ($e + 12)
      if ($null -eq $s) { break }
      $mem += [pscustomobject]@{ start = [uint64]$s; size = [uint64]$sz; rva = [uint64]$rv }
    }
  }
  function ReadAt([uint64]$addr, [int]$len) {
    foreach ($rg in $mem) {
      if ($addr -ge $rg.start -and ($addr + $len) -le ($rg.start + $rg.size)) {
        return (RB $b ([int]($rg.rva + ($addr - $rg.start))) $len)
      }
    }
    return $null
  }

  # ---- 贫民版栈回溯 ----
  if ($Stack -and $mem.Count -gt 0 -and $null -ne $rsp) {
    $lo = $frame.stackStart; $hi = $frame.stackStart + $frame.stackSize
    if ($null -eq $lo -or $hi -le $lo) { $lo = $rsp; $hi = $rsp + 0x8000 }
    Write-Output ("  --- stack (0x{0:X} .. 0x{1:X}) ---" -f $lo, $hi)
    $shown = 0
    for ($a = $rsp; $a -le $hi - 8 -and $shown -lt 24; $a += 8) {
      $raw = ReadAt $a 8
      if ($null -eq $raw) { continue }
      $v = [BitConverter]::ToUInt64($raw, 0)
      if ($v -lt 0x10000 -or $v -gt 0x7FFFFFFFFFFF) { continue }
      $m = Get-ModOf $mods $v
      if ($null -eq $m) { continue }
      Write-Output ("    " + (Fmt $mods $v))
      $shown++
    }
    if ($shown -eq 0) { Write-Output "    <no readable stack>" }
  }
}
