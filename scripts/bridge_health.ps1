# ============================================================
#  Babel Tower - bridge health check (pure ASCII output only)
#  Usage:
#    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\bridge_health.ps1
#    (exit 0 = bridge is up, exit 1 = bridge is down)
#  Port is read from config\config.json (defaults to 8791).
#  NOTE: keep this file ASCII-only. cmd.exe parses batch files in
#  the ANSI codepage (GBK on zh-CN systems); non-ASCII bytes here
#  get misread - same root cause as the 2026-09-20 VBS 80070002 bug.
# ============================================================
param(
  [int]$WaitSeconds = 10
)
$ErrorActionPreference = "SilentlyContinue"
$Root = Split-Path -Parent $PSScriptRoot

$port = 8791
$cfgPath = Join-Path $Root "config\config.json"
if (Test-Path $cfgPath) {
  try {
    $raw = [System.IO.File]::ReadAllText($cfgPath)
    $m = [regex]::Match($raw, '"port"\s*:\s*(\d+)')
    if ($m.Success) { $port = [int]$m.Groups[1].Value }
  } catch { }
}

$url = "http://127.0.0.1:{0}/api/v1/health" -f $port
$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ($true) {
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200) {
      # Write-Output (NOT Write-Host): callers pipe this into cmd's find,
      # and Write-Host does not reliably flow through a cmd pipe.
      Write-Output ("BRIDGE_UP port={0}" -f $port)
      exit 0
    }
  } catch { }
  if ((Get-Date) -ge $deadline) { break }
  Start-Sleep -Milliseconds 1000
}
Write-Output ("BRIDGE_DOWN port={0}" -f $port)
exit 1
