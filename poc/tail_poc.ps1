# Follow the Deadlock engine console for POC lines while you test in game.
# Usage: powershell -ExecutionPolicy Bypass -File F:\BabelTower\poc\tail_poc.ps1
# Shows lines containing [POC] (POC panorama script) and [POC-PAGE] (page JS, if surfaced).
param(
  [string]$GameRoot = "C:\SteamLibrary\steamapps\common\Deadlock",
  [string]$Filter = "POC"
)
$log = Join-Path $GameRoot "game\citadel\console.log"
if (-not (Test-Path $log)) { Write-Host "[poc] console.log not found: $log" -ForegroundColor Red; exit 1 }
Write-Host "[poc] following $log for '$Filter' (Ctrl+C to stop)"
Write-Host "[poc] if you see NO [POC] lines, the POC layout lost to another pak (e.g. QOL pak03) - see poc/RESULTS.md"
Get-Content -LiteralPath $log -Wait -Tail 200 | Where-Object { $_ -match $Filter }
