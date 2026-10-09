# Guarded installer: wait until deadlock.exe is fully gone and stable,
# then back up the installed VPK and swap in the fresh build.
# Rule: never install while the game is running. We re-check the process
# right before the copy to avoid the "crash -> auto-restart" race that would
# leave a half-written VPK on disk.
param(
  [string]$Src = "F:\BabelTower\dist\pak01_dir.vpk",
  [string]$Dst = "F:\SteamLibrary\steamapps\common\Deadlock\game\citadel\addons\pak15_dir.vpk",
  [string]$Tag = "pre-targethero",
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
  Add-Content -Path $Log -Value ((Get-Date).ToString('HH:mm:ss') + "  " + $m) -Encoding UTF8
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

  # Fresh install: no pak at the slot yet -> nothing to back up, still proceed.
  if (Test-Path $Dst) {
    $bk = "$Dst.bak-$Tag-$ts"
    Copy-Item -Path $Dst -Destination $bk -Force
    if (-not (Test-Path $bk)) { W "ABORT: backup failed"; return 1 }
    # NOTE: W takes a single argument; without the parentheses PowerShell parses the
    # "+" as a bare argument and everything after it lands in $args, silently
    # dropping the byte count from the log (reproduced 2026-10-09).
    W ("backup -> $bk  (" + (Get-Item $bk).Length + " B)")
  } else {
    W "no existing mod at dest - first install, no backup needed"
  }

  # 4) copy to a temp file first, then rename - never leave a partial VPK
  $tmp = "$Dst.new"
  try {
    if (Test-Path $tmp) { Remove-Item $tmp -Force }
    Copy-Item -Path $Src -Destination $tmp -Force
    if ((Get-Item $tmp).Length -ne $srcLen) {
      W "ABORT: temp copy size mismatch"
      return 1
    }
    Move-Item -Path $tmp -Destination $Dst -Force
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
} finally {
  if ($owns) { try { $mutex.ReleaseMutex() } catch { } }
  $mutex.Dispose()
}
exit $rc
