// 脚本层护栏(2026-10-13):安装 / 启动 / 自启脚本的硬约束。
// 这几个脚本不在产品码链路里,但装车与开局全靠它们,一次静默失败(装错车、
// 桥没换血却报 OK、自启注册了却永远起不来)排查成本极高,故源码钉。
//
// 违反任一即红:
//   ① 装车原子性:install_when_closed.ps1 必须走 tmp -> [IO.File]::Replace 原子换,
//      禁用 Move-Item -Force 覆盖(PS 5.1 非原子删+移,崩溃留空槽),
//      且必须先清 ReadOnly(Replace 对只读目标抛 UnauthorizedAccess);
//      交换瞬间必须再查一次游戏进程。
//   ② 重启不误报:restart_bridge.ps1 必须验尸($proc.HasExited)、
//      必须有 Mutex 互斥、必须确认旧桥真被杀干净,否则健康检查会打到旧实例报 OK。
//   ③ 端口按 JSON 解析(桥读顶层 cfg.port),不得用正则取首个 "port"。
//   ④ 自启缺 node 必须中止注册,不得只警告。
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const rd = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const install = rd("scripts/install_when_closed.ps1");
const restart = rd("scripts/restart_bridge.ps1");
const health = rd("scripts/bridge_health.ps1");
const autostart = rd("scripts/autostart.ps1");

test("S1-① 装车原子性:Replace 原子换 + 清只读 + 交换瞬间复查", () => {
  assert.ok(/\[System\.IO\.File\]::Replace\(\$tmp, \$Dst, \$bk\)/.test(install),
    "swap 未走 [IO.File]::Replace(单次 ReplaceFileW = 原子换 + 旧车进备份)");
  assert.ok(!/Move-Item -Path \$tmp -Destination \$Dst/.test(install),
    "swap 仍用 Move-Item -Force 覆盖(PS 5.1 非原子删+移,崩溃留空槽)");
  assert.ok(/IsReadOnly = \$false/.test(install),
    "缺清 ReadOnly(Replace 对只读目标抛 UnauthorizedAccess,Steam 装的槽位可能带只读)");
  assert.ok(/right before atomic swap/.test(install),
    "交换瞬间缺游戏进程复查(仅在复制前查一次留有窗口)");
  assert.ok(/\[System\.IO\.File\]::Move\(\$tmp, \$Dst\)/.test(install),
    "缺首次安装(File.Move)分支 —— Replace 在目标不存在时抛 FileNotFound");
  assert.ok(/unexpected error/.test(install),
    "缺外层 catch:逃逸异常会让日志停在 'armed:' 无 ABORT 行");
});

test("S1-② 重启不误报:验尸 + 互斥 + 确认杀净", () => {
  assert.ok(/\$proc\.HasExited/.test(restart),
    "缺新桥验尸(秒死时仍等健康检查,拿旧实例 200 报 OK)");
  assert.ok(/BabelTowerRestartBridge/.test(restart), "缺并发互斥 Mutex");
  assert.ok(/残留桥进程杀不掉/.test(restart),
    "缺杀进程后复查(Stop-Process 失败静默 → 旧桥留在端口 → 假成功)");
  const muteAt = restart.indexOf("BabelTowerRestartBridge");
  const killAt = restart.indexOf("bridge_server'");
  assert.ok(muteAt > 0 && killAt > 0 && muteAt < killAt,
    "互斥必须早于杀进程(否则并发的第二个先把第一个刚启的桥杀掉)");
});

test("S1-③ 端口读法:按 JSON 解析顶层 cfg.port,禁正则", () => {
  for (const [name, src] of [["restart_bridge.ps1", restart], ["bridge_health.ps1", health]]) {
    assert.ok(/ConvertFrom-Json/.test(src), name + " 未按 JSON 解析端口");
    assert.ok(!/regex\]::Match\(\$raw, '"port"/.test(src),
      name + " 仍用正则取首个 \"port\"(嵌套 provider 端口在前面时会读错)");
  }
  // 真机口径:桥读顶层 cfg.port,端口必须与之一致(实测 8791)
  const cfg = JSON.parse(rd("config/config.json"));
  assert.strictEqual(typeof cfg.port, "number", "config.json 顶层 port 应为数字");
});

test("S1-④ 自启缺 node 中止注册", () => {
  assert.ok(/throw "缺少 portable-node/.test(autostart),
    "缺 node 仍注册 Run 键 → 登录时静默失败");
  assert.ok(!/警告: 缺少 portable-node/.test(autostart),
    "仍是只警告不中止的旧行为");
});

test("S1-⑤ bat 入口失败可见", () => {
  for (const f of ["install-autostart.bat", "remove-autostart.bat"]) {
    const src = rd(f);
    assert.ok(/if errorlevel 1/.test(src),
      f + " 不检查 errorlevel,失败也显示 Done.(误导用户以为已装/已卸)");
  }
});