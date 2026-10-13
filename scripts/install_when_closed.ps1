# Guarded installer: wait until deadlock.exe is fully gone and stable,
# then back up the installed VPK and swap in the fresh build.
# Rule: never install while the game is running. We re-check the process
# right before the copy to avoid the "crash -> auto-restart" race that would
# leave a half-written VPK on disk.
param(
  [string]$Src = "F:\BabelTower\dist\pak01_dir.vpk",
  [string]$Dst = "F:\SteamLibrary\steamapps\common\Deadlock\game\citadel\addons\pak15_dir.vpk",
  # 备份名标签。默认值 2026-10-13 起从 "pre-targethero" 改为 "install":
  #   backups accumulate with this tag forever; the old default named one specific
  #   past fix ("targethero"), so every install since then produced misleading
  #   backup names. Callers passing -Tag explicitly (e.g. "t1-echo-guard") are
  #   unaffected -- that is the preferred style.
  [string]$Tag = "install",
  [int]$PollSec = 5,
  [int]$StableSec = 15,
  [string]$Log = "F:\BabelTower\logs\install_when_closed.log"
)

# 2026-10-09 review: the default Continue lets a failed Move-Item leave the OLD
# vpk in place while the script keeps going and logs "installed" whenever both
# files happened to share a size. Make every cmdlet failure stop the run.
$ErrorActionPreference = "Stop"

function W($m) {
  $dir = Split-Path -Parent $Log
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  # 2026-10-13: date prefix added. The log spans days (install runs are rare and
  # months apart), so HH:mm:ss alone made cross-day entries indistinguishable.
  Add-Content -Path $Log -Value ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + "  " + $m) -Encoding UTF8
}

function Test-GameRunning {
  return [bool](Get-Process -Name deadlock -ErrorAction SilentlyContinue)
}

function Install-Once {
  W ("armed: waiting for game to close   src=" + $Src)
  if (-not (Test-Path $Src)) { W "ABORT: source missing"; return 1 }
  if (-not (Test-Path (Split-Path -Parent $Dst))) {
    # First run on a machine where citadel\addons was never created: the old
    # "dest dir missing" abort made a clean install impossible. Create it.
    $ddir = Split-Path -Parent $Dst
    New-Item -ItemType Directory -Path $ddir -Force | Out-Null
    W ("created dest dir: " + $ddir)
  }

  # 1) wait for the process to disappear
  while (Test-GameRunning) { Start-Sleep -Seconds $PollSec }
  W "process gone"

  # 2) stability window: make sure it is not crash-and-relaunch
  Start-Sleep -Seconds $StableSec
  if (Test-GameRunning) { W "ABORT: game came back during stability window"; return 1 }

  # 3) final check right before the copy
  if (Test-GameRunning) { W "ABORT: game running at final check"; return 1 }

  $srcLen = (Get-Item $Src).Length
  $ts = Get-Date -Format 'yyyyMMdd-HHmmss'

  # Backup is produced BY the atomic swap itself (ReplaceFileW moves the previous
  # pak into the backup path we hand it), so there is no separate Copy-Item here:
  # a separate copy could diverge from the pre-swap bytes if anything else touches
  # the slot in between, and the atomic op cannot diverge by construction.
  # NOTE: W takes a single argument; without the parentheses PowerShell parses the
  # "+" as a bare argument and everything after it lands in $args, silently
  # dropping the byte count from the log (reproduced 2026-10-09).
  $hadOld = Test-Path $Dst
  $bk = "$Dst.bak-$Tag-$ts"
  if (Test-Path $bk) { Remove-Item $bk -Force }  # same tag + same second rerun

  # 4) copy to a temp file first, then atomic swap - never leave a partial VPK
  # 2026-10-13 (same doctrine as B6 in core/config.js: tmp -> fsync-ish -> rename):
  # Move-Item -Force in PS 5.1 clears the destination's attributes and may copy
  # across volumes; when volumes match it renames, but the destination delete is
  # NOT guaranteed atomic with the rename -> a crash in between leaves the slot
  # empty (only the .bak survives). [IO.File]::Replace is a single ReplaceFileW:
  # atomic swap AND the previous file lands in the backup path we pass it.
  # Verified by probe 2026-10-13:
  #   * Replace(src, dst, realPath) -> OK, dst=new, backup=old, src gone
  #   * Replace(src, dst, $null)    -> ArgumentException ("路径的形式不合法")
  #     PowerShell binds $null to the string overload as "", and ReplaceFileW
  #     rejects an empty backup path. Must pass a real path.
  #   * dest readonly              -> UnauthorizedAccessException
  #     (unlike Move-Item -Force). Steam-installed pak slots can carry the
  #     read-only bit, so clear it right before the swap.
  #   * dest missing               -> FileNotFoundException -> File.Move branch.
  $tmp = "$Dst.new"
  try {
    if (Test-Path $tmp) { Remove-Item $tmp -Force }
    Copy-Item -Path $Src -Destination $tmp -Force
    if ((Get-Item $tmp).Length -ne $srcLen) {
      W "ABORT: temp copy size mismatch"
      return 1
    }
    if ($hadOld) {
      # Re-check AT the swap moment. The earlier final check sits before the copy
      # loop; a game launched in between must not meet a slot being swapped.
      if (Test-GameRunning) { W "ABORT: game running right before atomic swap"; return 1 }
      $dstItem = Get-Item $Dst -Force
      if ($dstItem.IsReadOnly) {
        $dstItem.IsReadOnly = $false
        W "cleared read-only bit on dest before atomic swap"
      }
      [System.IO.File]::Replace($tmp, $Dst, $bk)
      if (-not (Test-Path $bk)) {
        W "ABORT: atomic swap succeeded but swap-backup vanished"
        return 1
      }
      W ("backup -> $bk  (" + (Get-Item $bk).Length + " B)")
    } else {
      # fresh install, no previous pak: plain same-dir rename is already atomic
      if (Test-GameRunning) { W "ABORT: game running right before first install"; return 1 }
      [System.IO.File]::Move($tmp, $Dst)
      W "no existing mod at dest - first install, no backup needed"
    }
  } catch {
    W ("ABORT: install failed - " + $_.Exception.Message)
    return 1
  } finally {
    if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
  }

  # 5) verify bytes, not just length: a same-length corrupt copy used to pass.
  if ((Get-Item $Dst).Length -ne $srcLen) { W "ABORT: dest size mismatch"; return 1 }
  $shaSrc = (Get-FileHash -Path $Src -Algorithm SHA256).Hash
  $shaDst = (Get-FileHash -Path $Dst -Algorithm SHA256).Hash
  if ($shaDst -ne $shaSrc) {
    W ("ABORT: dest sha256 mismatch  src=" + $shaSrc.Substring(0, 16) + "  dst=" + $shaDst.Substring(0, 16))
    return 1
  }
  # See the note above: this call used to lose both size and sha256 in the log.
  W ("installed: size=" + (Get-Item $Dst).Length + "  sha256=" + $shaDst.Substring(0, 16))
  W "DONE - relaunch the game to pick up the fix"
  return 0
}

# 5) single-instance guard: re-arming after a killed installer used to leave two
#    waiters on the same window, and both would then back up and swap the slot.
$mutex = New-Object System.Threading.Mutex($false, "Local\BabelTowerInstallWhenClosed")
$owns = $false
$rc = 1
try {
  try { $owns = $mutex.WaitOne(0) }
  catch [System.Threading.AbandonedMutexException] { $owns = $true }  # owner died holding it
  if (-not $owns) { W "ABORT: another install_when_closed instance is running"; exit 1 }
  $rc = Install-Once
} catch {
  # 2026-10-13: with $ErrorActionPreference=Stop, a throwing cmdlet outside the
  # inner try (backup copy, Get-Item, Get-FileHash, log writes) escaped this whole
  # script, so logs\*.log ended at "armed:" with no ABORT line at all -- the one
  # thing an operator greps for. Any escaping error now gets logged and turned
  # into a non-zero exit.
  W ("ABORT: unexpected error - " + $_.Exception.Message)
  $rc = 1
} finally {
  if ($owns) { try { $mutex.ReleaseMutex() } catch { } }
  $mutex.Dispose()
}
exit $rc
