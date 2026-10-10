// tests/run-tests.js —— 统一测试入口
// 决策(2026-10-10):允许 node:test;统一入口用**显式文件清单**,不用 glob
//   (glob 会因匹配规则差异漏文件,显式清单逐个可审查)。
// 兼容策略:旧平文件 assert 测试原样保留(直接 spawn 执行,按退出码判);新测试
//   可用 require("node:test") —— 单文件直跑时 node:test 同样自动执行并以退出码汇报。
// 铁律:新增/删除测试文件必须同步维护下方 files 清单(漏登记 = 不进 CI 视野)。
"use strict";
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const files = [
  // 主链与护栏(平文件 assert / node:test 混合)
  "tests/bridge_paths_logs_guard.test.js",
  "tests/btipc07_sync.test.js",
  "tests/client_copy_sync.test.js",
  "tests/launcher_condebug_guard.test.js",
  "tests/launcher_entry_guard.test.js",
  "tests/lc_btipc07_guard.test.js",
  "tests/lc_btipc_guard.test.js",
  "tests/lc_chat_settle_guard.test.js",
  "tests/lc_hud_quick_guard.test.js",
  "tests/lc_panel_nav_guard.test.js",
  "tests/loc_parser.test.js",
  "tests/providers.test.js",
  "tests/quickchat_handshake.test.js",
  "tests/quickchat_match.test.js",
  "tests/security_boundary_guard.test.js",
  "tests/umm_integration.test.js",
  // BTIPC 协议层(冻结区行为钉)
  "tests/btipc/crc.test.js",
  "tests/btipc/frame.test.js",
  "tests/btipc/line_budget_guard.test.js",
  "tests/btipc/simulator.test.js",
  "tests/btipc/translate.test.js",
  "tests/btipc/window_gc.test.js",
  // 实验分析
  "tests/exp6734D/exp6734d_analyze.test.js",
  "tests/exp6734E/exp6734e_analyze.test.js",
];

const root = path.join(__dirname, "..");
const failed = [];
for (const rel of files) {
  const abs = path.join(root, rel);
  const r = spawnSync(process.execPath, [abs], { cwd: root, encoding: "utf8" });
  const ok = r.status === 0;
  if (!ok) failed.push(rel);
  console.log((ok ? "PASS" : "FAIL") + " | " + rel);
  if (!ok) {
    const out = ((r.stdout || "") + (r.stderr || "")).trim();
    const lines = out.split(/\r?\n/);
    for (const line of lines.slice(Math.max(0, lines.length - 15))) {
      console.log("    " + line);
    }
  }
}

console.log("");
console.log(
  "TOTAL: " + (files.length - failed.length) + "/" + files.length + " passed" +
  (failed.length ? "  FAILED: " + failed.join(", ") : "")
);
process.exitCode = failed.length ? 1 : 0;
