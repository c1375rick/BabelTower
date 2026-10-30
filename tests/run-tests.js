// tests/run-tests.js —— 统一测试入口
// 决策(2026-10-10):允许 node:test;统一入口用**显式文件清单**,不用 glob
//   (glob 会因匹配规则差异漏文件,显式清单逐个可审查)。
// 兼容策略:旧平文件 assert 测试原样保留(直接 spawn 执行,按退出码判);新测试
//   可用 require("node:test") —— 单文件直跑时 node:test 同样自动执行并以退出码汇报。
// 铁律:新增/删除测试文件必须同步维护下方 files 清单(漏登记 = 不进 CI 视野)。
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const files = [
  // 主链与护栏(平文件 assert / node:test 混合)
  "tests/bridge_paths_logs_guard.test.js",
  "tests/btipc07_sync.test.js",
  "tests/btipc_echo_storm_guard.test.js",
  "tests/cfg_delta_sync.test.js",
  "tests/cfg_sync_guard.test.js",
  "tests/client_copy_sync.test.js",
  // 拼接器/跨文件契约检查器(工具,不在构建流程里;真机四文件零重名的现状钉在这里)
  "tests/concat_panorama.test.js",
  "tests/config_atomic_write.test.js",
  // 2026-10-15:https 面板通道的降级纪律 + 发行包自足(新增文件必须显式登记,
  // 这个清单是显式的而非 glob —— 漏登记 = 护栏永远不跑,而"全链 30/30"照样绿)。
  "tests/pak_scan.test.js",
"tests/https_panel_guard.test.js",
  "tests/launcher_condebug_guard.test.js",
  "tests/launcher_entry_guard.test.js",
  "tests/lc_btipc07_guard.test.js",
  "tests/lc_btipc_guard.test.js",
  "tests/lc_chat_settle_guard.test.js",
  "tests/lc_hud_quick_guard.test.js",
  "tests/lc_p4_partition.test.js",
  "tests/lc_panel_nav_guard.test.js",
"tests/lc_sim_channel.test.js",
  "tests/loc_parser.test.js",
  "tests/log_redaction.test.js",
  "tests/providers.test.js",
  "tests/quickchat_handshake.test.js",
  "tests/quickchat_match.test.js",
  "tests/release_entry_guard.test.js",
  "tests/script_hardening_guard.test.js",
  "tests/security_boundary_guard.test.js",
  "tests/tls_guard.test.js",
  "tests/umm_integration.test.js",
  // BTIPC 协议层(冻结区行为钉)
  "tests/btipc/crc.test.js",
  "tests/btipc/frame.test.js",
  "tests/btipc/index_surface_guard.test.js",
  "tests/btipc/line_budget_guard.test.js",
  "tests/btipc/op_log_guard.test.js",
  "tests/btipc/simulator.test.js",
  "tests/btipc/translate.test.js",
  "tests/btipc/window_gc.test.js",
  // 实验分析
  "tests/exp6734D/exp6734d_analyze.test.js",
  "tests/exp6734E/exp6734e_analyze.test.js",
];

const root = path.join(__dirname, "..");
const failed = [];

// ---- 第 0 关:产品代码的语法检查(2026-10-15 补)----
// 为什么排在最前面:护栏测试都是**读源码做正则断言**,不 require 产品模块。
// 于是 `core/bridge_server.js` 里一处正则语法错(/"apiKey":"(?!\\*{8})…" 的 Nothing to repeat)
// 能让**全链 33/33 全绿** —— 桥却起不来,重启脚本只打印最后一行,一眼扫过去根本看不出来。
// 「测试全绿但产品跑不起来」是最贵的失败类型:它把错误伪装成通过。
// 这里对所有随包分发的 JS 做 node --check,语法错 = 直接红,不必等到装车或重启桥才发现。
const SYNTAX_TARGETS = [
  "core/bridge_server.js",
  "core/bridge_https.js",
  "core/config.js",
  "core/loc_parser.js",
  "core/sync_data.js",
  "core/steam_paths.js",
  "core/quickchat_match.js",
  "core/btipc/index.js",
  "core/btipc/transport.js",
  "core/btipc/framer.js",
  "core/btipc/window.js",
  "core/providers/bing.js",
  "core/providers/google.js",
  "core/providers/microsoft.js",
  "core/providers/deepl.js",
  "core/providers/openai.js",
  "core/providers/registry.js",
  "mod/panorama/scripts/lingua_chat_btipc.js",
  "mod/panorama/scripts/lingua_chat_i18n.js",
  "mod/panorama/scripts/lingua_chat.js",
  "mod/panorama/scripts/lingua_chat_panel.js",
  "mod/panorama/scripts/lingua_chat_exp.js",
  "scripts/concat_panorama.js",
];
let syntaxBad = 0;
for (const rel of SYNTAX_TARGETS) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) continue;
  const r = spawnSync(process.execPath, ["--check", abs], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) {
    syntaxBad += 1;
    const msg = ((r.stderr || r.stdout || "").split(/\r?\n/).find((l) => /SyntaxError|Error/.test(l)) || "").trim();
    console.log("FAIL | syntax: " + rel + (msg ? "  ->  " + msg : ""));
  }
}
console.log((syntaxBad ? "FAIL" : "PASS") + " | syntax check (" + SYNTAX_TARGETS.length + " 个产品文件)");
if (syntaxBad) failed.push("syntax-check");

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
