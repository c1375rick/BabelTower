# Babel Tower - 开机自启安装/卸载脚本
# ------------------------------------------------------------------
# 目标:不再需要 StartDeadlock.bat —— 桥随 Windows 登录静默启动并常驻,
#      游戏开关不影响桥(2026-08-12 起: 桥不再随游戏退出, 避免"关游戏再开就没桥")。
#
# 方式:注册表 HKCU Run 键 + wscript 无窗口运行项目内 vbs
#      (不依赖启动文件夹,避免已知文件夹重定向问题)
#
# 用法(当前用户级,无需管理员):
#   powershell -ExecutionPolicy Bypass -File scripts\autostart.ps1 -Action Install
#   powershell -ExecutionPolicy Bypass -File scripts\autostart.ps1 -Action Remove
# ------------------------------------------------------------------
[CmdletBinding()]
param(
  [ValidateSet("Install", "Remove")]
  [string]$Action = "Install"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$RunKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$ValueName = "BabelTowerBridge"
$VbsPath = Join-Path $Root "scripts\babel_bridge_autostart.vbs"
# 启动项"禁用标记"位置:任务管理器/联想电脑管家等"禁用开机启动"时在这里写禁用标记,
# 即使 Run 键值还在,系统也会跳过 → 脚本只写回 Run 键会"设置不回去"。
$ApprovedKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"

# 清除禁用标记(删除 = 恢复默认启用;不存在的项系统按启用处理)
function Clear-ApprovedFlag {
  if (Test-Path $ApprovedKey) {
    $p = Get-ItemProperty -Path $ApprovedKey -Name $ValueName -ErrorAction SilentlyContinue
    if ($p) {
      Remove-ItemProperty -Path $ApprovedKey -Name $ValueName -ErrorAction SilentlyContinue
      Write-Host "已清除开机自启禁用标记(StartupApproved)。"
    }
  }
}

if ($Action -eq "Install") {
  $Node = Join-Path $Root "portable-node\node.exe"
  if (-not (Test-Path $Node)) { $Node = "node" }
  $Server = Join-Path $Root "core\bridge_server.js"
  if (-not (Test-Path $Server)) { throw "找不到桥服务器: $Server" }

  # 生成无窗口启动脚本(第 2 个参数 0 = 隐藏窗口)
  # 引号规则:VBScript 中 "" 表示一个字面引号;两个路径之间必须是 2引号+空格+2引号
  $vbs = 'Set sh = CreateObject("WScript.Shell")' + "`r`n"
  $vbs += 'sh.Run """' + $Node + '"" ""' + $Server + '""", 0, False' + "`r`n"
  [System.IO.File]::WriteAllText($VbsPath, $vbs, (New-Object System.Text.UTF8Encoding($false)))

  # 注册到 HKCU Run(wscript 静默执行 vbs)
  Set-ItemProperty -Path $RunKey -Name $ValueName -Value ('"' + (Join-Path $env:WINDIR "System32\wscript.exe") + '" "' + $VbsPath + '"')
  # 关键:清掉安全软件/任务管理器写入的"禁用标记"(联想电脑管家等禁用启动项后,
  # Run 键值仍在但 StartupApproved 标记禁用 → 开机不启动,且脚本重装"设置不回去")
  Clear-ApprovedFlag
  $installed = (Get-ItemProperty -Path $RunKey -Name $ValueName).$ValueName
  $installed = (Get-ItemProperty -Path $RunKey -Name $ValueName).$ValueName
  Write-Host "已注册开机自启(Run 键): $installed"
  Write-Host "vbs 位置: $VbsPath"
  Write-Host ""
  Write-Host "之后直接 Steam 启动 Deadlock 即可;桥常驻,游戏开关不影响。"
  Write-Host "若桥意外不在(如手动杀掉): 双击 restart_bridge.bat 重启。"
  Write-Host "卸载: powershell -ExecutionPolicy Bypass -File scripts\autostart.ps1 -Action Remove"
} else {
  $removed = $false
  if (Test-Path $VbsPath) { Remove-Item $VbsPath -Force; $removed = $true }
  if (Test-Path $RunKey) {
    $p = Get-ItemProperty -Path $RunKey -Name $ValueName -ErrorAction SilentlyContinue
    if ($p) {
      Remove-ItemProperty -Path $RunKey -Name $ValueName -ErrorAction SilentlyContinue
      $removed = $true
    }
  }
  # 卸载时也清掉禁用标记,保持环境干净
  if (Test-Path $ApprovedKey) {
    $p = Get-ItemProperty -Path $ApprovedKey -Name $ValueName -ErrorAction SilentlyContinue
    if ($p) {
      Remove-ItemProperty -Path $ApprovedKey -Name $ValueName -ErrorAction SilentlyContinue
      $removed = $true
    }
  }
  if ($removed) { Write-Host "已移除开机自启。" } else { Write-Host "未安装过开机自启。" }
}
