// 离线测试:游戏内自检(!lctselftest / lingua_chat_selftest.js)接线护栏
// 跑法: node tests/lc_selftest_guard.test.js
//
// 自检的价值全在"接线正确、且真进得去游戏"——任何一处静默失效都只能靠真车十几分钟复现,
// 离线先钉死:
//   ① 命令面:handleChatSubmit 认 !lctselftest,且经 LCTNS.runSelfTest 晚绑定派发;
//   ② 宿主契约:自检只经 LCTNS 懒取符号(不裸调),所需符号核心必须全部发布;
//   ③ 装载链:双 XML include 且晚于主脚本;build.ps1 关键资产清单带 selftest;
//   ④ 落桥面:selftest 是 get 类 op(走 op=config 折叠),桥端 runBtipcGet 有 selftest 分支;
//   ⑤ 清单:run-tests.js 的 SYNTAX_TARGETS 纳入自检文件(否则语法守卫漏检)。
"use strict";
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0, skipped = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS |", label); }
  else { fail++; console.log("  FAIL |", label); }
}
function skip(label) { skipped++; console.log("  SKIP |", label); }

const ROOT = path.join(__dirname, "..");
const LC = path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat.js");
const ST = path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat_selftest.js");
const BRIDGE = path.join(ROOT, "core", "bridge_server.js");
const BUILD = path.join(ROOT, "scripts", "build.ps1");
const RUNTESTS = path.join(ROOT, "tests", "run-tests.js");
const XMLS = ["chat.xml", "hudchat.xml"].map(function (x) { return path.join(ROOT, "mod", "panorama", "layout", x); });

if (!fs.existsSync(ST) || !fs.existsSync(LC) || !fs.existsSync(BRIDGE)) {
  skip("lingua_chat_selftest.js / lingua_chat.js / bridge_server.js 缺一");
  console.log("RESULT: PASS " + pass + " / FAIL " + fail + " / SKIP " + skipped);
  process.exit(0);
}
const st = fs.readFileSync(ST, "utf8");
const lc = fs.readFileSync(LC, "utf8");
const bridge = fs.readFileSync(BRIDGE, "utf8");

// ---------- ① 命令面 ----------
console.log("--- 命令面:!lctselftest 路由与派发 ---");
ok(lc.indexOf('=== "!lctselftest"') !== -1 && lc.indexOf('indexOf("!lctselftest ") === 0') !== -1,
  "handleChatSubmit 认 !lctselftest(含 quick 参数变体)");
ok(/const LN = globalThis\.LCTNS;/.test(lc) && /typeof LN\.runSelfTest === "function"/.test(lc),
  "命令经 LCTNS.runSelfTest 晚绑定派发(核心零裸调自检函数)");
ok(!/\brunSelfTest\s*\(/.test(lc.replace(/LN\.runSelfTest\s*\(/g, "")),
  "核心不裸调 runSelfTest(只经 LCTNS 句柄)");

// ---------- ② 宿主契约:发布 + 懒取 ----------
console.log("--- 宿主契约:LCTNS 发布的符号必须齐 ---");
const required = [
  "applyUILang", "bridgePost", "clearInput", "findChild", "getRoot", "injectHudTestMessage",
  "log", "resolveHudMessages", "translateOutgoing", "triggerStockSubmit", "CHAT_INPUT_ID",
  "State", "VERSION", "BTIPC",
];
for (const n of required) {
  ok(new RegExp("LCTNS\\." + n + "\\s*=").test(lc), "LCTNS." + n + " 已发布");
}
ok(/globalThis\.LCTNS = globalThis\.LCTNS \|\| \{\};/.test(st) && /globalThis\.LCTNS\.runSelfTest = runSelfTest;/.test(st),
  "自检挂 globalThis.LCTNS.runSelfTest");
ok(/function H\(\) \{ return globalThis\.LCTNS \|\| \{\}; \}/.test(st),
  "自检懒取宿主符号(函数式取,不缓存——多处装载/热重载安全)");

// ---------- ③ 装载链:双 XML + build 资产 ----------
console.log("--- 装载链:双 XML include 顺序 + build 关键资产 ---");
for (const p of XMLS) {
  const name = path.basename(p);
  if (!fs.existsSync(p)) { skip(name); continue; }
  const s = fs.readFileSync(p, "utf8");
  const iMain = s.indexOf("scripts/lingua_chat.vjs_c");
  const iSelf = s.indexOf("scripts/lingua_chat_selftest.vjs_c");
  const iExp = s.indexOf("scripts/lingua_chat_exp.vjs_c");
  ok(iSelf > 0, name + " include 自检脚本");
  ok(iMain > 0 && iSelf > iMain, name + " 自检必须晚于主脚本(先发布 LCTNS)");
  ok(iExp > 0 && iSelf > iExp, name + " 自检排在探针之后(装载顺序注释一致)");
}
{
  const build = fs.readFileSync(BUILD, "utf8");
  ok(build.indexOf("lingua_chat_selftest.vjs_c") !== -1,
    "build.ps1 VPK 关键资产清单须含 lingua_chat_selftest.vjs_c");
}

// ---------- ④ 落桥面:get 折叠 + 桥端分支 ----------
console.log("--- 落桥面:op=config 折叠 + runBtipcGet selftest 分支 ---");
ok(/const BTIPC_GET_OPS = \{ health: 1, gamenames: 1, quickchat: 1, configsync: 1, selftest: 1 \};/.test(lc),
  "selftest 是 get 类 op(走 50s 读死线 / op=config 折叠)");
ok(/L\.bridgePost\("selftest",/.test(st),
  "自检汇总经 bridgePost(\"selftest\", ...) 送桥");
ok(/if \(kind === "selftest"\)/.test(bridge),
  "桥端 runBtipcGet 有 selftest 分支");
ok(/log\("info", "SELFTEST " \+ lines\[i\]\)/.test(bridge),
  "桥端逐行写桥日志(SELFTEST 前缀,可事后查)");
ok(/return \{ ok: true, logged: lines\.length \};/.test(bridge),
  "桥端返回 {ok:true, logged}");

// ---------- ⑤ 结果分级:pass|fail|skip ----------
console.log("--- 结果分级:SKIP 不误报 FAIL ---");
ok(/Reporter\.prototype\.add = function \(name, status, detail\)/.test(st),
  "Reporter 记录 name/status/detail");
ok(/"skip"/.test(st) && /no HUD chat container/.test(st),
  "环境不满足走 skip(如非对局无 HUD 容器)");
ok(/const ctx = \{ quick: !!opts\.quick \};/.test(st) && /if \(ctx\.quick\) return finish\("skip", "quick mode"\)/.test(st),
  "quick 参数生效(!lctselftest quick 跳过 outgoing.* 副作用项)");

// ---------- ⑥ 测试清单:语法守卫纳入 ----------
console.log("--- 测试清单:run-tests.js SYNTAX_TARGETS ---");
{
  const rt = fs.readFileSync(RUNTESTS, "utf8");
  ok(rt.indexOf("lingua_chat_selftest.js") !== -1,
    "run-tests.js SYNTAX_TARGETS 纳入 lingua_chat_selftest.js");
}

console.log("RESULT: PASS " + pass + " / FAIL " + fail + " / SKIP " + skipped);
process.exit(fail > 0 ? 1 : 0);
