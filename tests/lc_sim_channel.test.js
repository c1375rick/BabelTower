// 模拟环境通道测试(2026-10-30)——"先模拟,后实车"的主场景。
// 真桥(独立端口/独立状态目录) + 真页面 JS(假 CEF 执行) + 真游戏脚本(假 Panorama)。
//
// 场景:
//   A. boot → 探针 → 面板绑定注册 → lct-alive 事件 → 探针事件驱动结算 → ALIVE
//      (回归锁:2026-10-30 的两个 bug——boot() 无参先调锁死守卫;结算只认陈旧属性)
//   B. ALIVE 后 hash 作业往返:bridgePost("health") → fragment 导航 → 页面 onHash
//      → 真 fetch /api/v1/health → 响应 title → 事件 → 作业结算
//   C. 真 HUD 消息注入 → 扫描 → 翻译作业走 hash 通道(至多验证到"作业派发+结算",
//      翻译质量依赖外部 bing,不作硬断言)
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const http = require("http");
const { createSim } = require("./sim/panorama_mock.js");

const ROOT = path.join(__dirname, "..");
const NODE = process.env.SIM_NODE || path.join(ROOT, "portable-node", "node.exe");
const BRIDGE = path.join(ROOT, "core", "bridge_server.js");
const PORT = 8793;
const BASE = "http://127.0.0.1:" + PORT;
const SCRIPTS = [
  path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat_btipc.js"),
  path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat_i18n.js"),
  path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat.js"),
];

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? " | " + extra : "")); }
}

function httpGetJson(url, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const req = http.get(url, function (res) {
      let b = "";
      res.on("data", function (c) { b += c; });
      res.on("end", function () { try { resolve(JSON.parse(b)); } catch (e) { resolve({ raw: b }); } });
    });
    req.setTimeout(timeoutMs || 4000, function () { req.destroy(new Error("health poll timeout")); });
    req.on("error", reject);
  });
}

async function waitBridgeUp() {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    try {
      const j = await httpGetJson(BASE + "/api/v1/health", 1500);
      if (j && (j.ok === true || j.ok === "true")) return j;
    } catch (e) { /* not yet */ }
    await new Promise(function (r) { setTimeout(r, 300); });
  }
  throw new Error("sim bridge did not come up on " + BASE);
}

async function main() {
  // ---- 独立 state 目录(不碰生产 config/logs) ----
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bt-sim-"));
  const cfgDir = path.join(tmp, "config");
  fs.mkdirSync(cfgDir, { recursive: true });
  // 复制配套数据(gamenames/quickchat 等),config.json 用模拟专用
  const srcCfg = path.join(ROOT, "config");
  fs.readdirSync(srcCfg).forEach(function (f) {
    if (f === "config.json" || !f.endsWith(".json")) return;
    try { fs.copyFileSync(path.join(srcCfg, f), path.join(cfgDir, f)); } catch (e) { /* 目录项跳过 */ }
  });
  fs.writeFileSync(path.join(cfgDir, "config.json"), JSON.stringify({
    port: PORT,
    provider: "bing",
    logFile: path.join(tmp, "bridge.log"),
    chatLog: { enabled: false },
  }, null, 2), "utf8");

  // ---- 起 真·桥 ----
  const child = spawn(NODE, [BRIDGE], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { BABEL_TOWER_CONFIG_DIR: cfgDir }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let childLogs = "";
  child.stdout.on("data", function (d) { childLogs += d; });
  child.stderr.on("data", function (d) { childLogs += d; });
  const killBridge = function () { try { child.kill(); } catch (e) {} };

  try {
    const health = await waitBridgeUp();
    check("sim bridge up (port " + PORT + ")", true);

    // ---- 假 Panorama + 真脚本 ----
    const sim = createSim({ bridgeBase: BASE, verbose: !!process.env.SIM_VERBOSE });
    sim.runScripts(SCRIPTS);
    await sim.sleep(300);
    const LCTNS = sim.sandbox.LCTNS || null;
    if (!sim.logs.some(function (l) { return l.indexOf("loaded v") >= 0; }) && LCTNS && typeof LCTNS.boot === "function") {
      // 脚本未自启则手动 boot(与游戏上下文装载一致)
      try { LCTNS.boot(); } catch (e) { console.log("  [sim] manual boot THREW: " + (e && e.message)); }
    }

    // 场景 A:探针全链
    await sim.waitFor(function () {
      return sim.logs.some(function (l) { return l.indexOf("https panel: ALIVE") >= 0; });
    }, 25000, "https panel: ALIVE").catch(function (e) { check("A1 探针结算 ALIVE", false, e.message); throw e; });
    check("A1 探针结算 ALIVE", true);
    check("A2 面板绑定已注册(guard 解耦回归锁)",
      sim.logs.some(function (l) { return l.indexOf("bridge: panel-bound HTMLTitle registered") >= 0; }));
    check("A3 hashReady 置位", !!(LCTNS && LCTNS.State && LCTNS.State.hashReady === true));
    check("A4 探针页面整页加载恰好发生", sim.fullLoads >= 1, "fullLoads=" + sim.fullLoads);
    check("A5 lct-alive 事件到达脚本", sim.titleEvents >= 1, "titleEvents=" + sim.titleEvents);
    check("A6 页面 JS 零异常", sim.pageErrors.length === 0, sim.pageErrors.slice(0, 3).join(" | "));

    // 场景 B:hash 作业往返(真翻译作业——config/health 类作业按设计走 BTIPC,
    // hash 通道的正当用户是 translate/outgoing)
    const navsBefore = sim.hashNavs;
    let bDone = null;
    let bSettled = false;
    LCTNS.bridgePost("translate", {
      operation: "translate",
      text: "hello world",
      sourceLanguage: "auto",
      targetLanguage: "zh-Hans",
      timeoutMs: 15000,
    }, function (payload) { bSettled = true; bDone = payload; });
    await sim.waitFor(function () { return bSettled; }, 30000, "translate job settle").catch(function () {});
    check("B1 hash 作业结算(bridgePost translate)", bSettled === true,
      "payload=" + JSON.stringify(bDone || null).slice(0, 150));
    check("B1b hash 载荷过桥(非 bad_json——wire-format 回归锁)", !!(bDone && bDone.error !== "bad_json"),
      "payload=" + JSON.stringify(bDone || null).slice(0, 150));
    check("B2 走了 fragment 导航(hash 通道)", sim.hashNavs > navsBefore, "hashNavs=" + sim.hashNavs + " (before " + navsBefore + ")");
    check("B3 响应经 title 事件回程", bSettled && sim.titleEvents >= 2, "titleEvents=" + sim.titleEvents);
    console.log("  [info] B payload: " + JSON.stringify(bDone || null).slice(0, 200));

    // 场景 C:真 HUD 消息 → 扫描 → 翻译作业
    const chat = sim.makePanel("Team1Chat", "Panel", sim.panels.root);
    chat.AddClass("CitadelHudTopBarChat");
    const messages = sim.makePanel("Messages", "Panel", chat); // HUD_MESSAGES_ID="Messages"
    // 等 HUD 扫描发现容器(watching HUD top bar chat (1))
    await sim.waitFor(function () {
      return sim.logs.some(function (l) { return l.indexOf("watching HUD top bar chat") >= 0; });
    }, 10000, "hud container discovered").catch(function () {});
    const discovered = sim.logs.some(function (l) { return l.indexOf("watching HUD top bar chat") >= 0; });
    check("C1 HUD 容器被发现", discovered);
    if (discovered) {
      // 完整复刻 injectHudTestMessage 的行结构(含 TextContainer class 与
      // __lctTestForce 强制标记——缺了会被 seen 去重跳过)
      const row = sim.$.CreatePanel("Panel", messages, "SimRow" + Date.now());
      row.AddClass("ChatMessage");
      const contents = sim.$.CreatePanel("Panel", row, "MessageContents");
      const bubble = sim.$.CreatePanel("Panel", contents, "");
      bubble.AddClass("ChatBubble");
      const tc = sim.$.CreatePanel("Panel", bubble, "");
      tc.AddClass("TextContainer");
      const label = sim.$.CreatePanel("Label", tc, "MessageText");
      label.text = "good morning";
      row.__lctTestForce = true;
      const navsSnapshot = sim.navigations.length;
      await sim.sleep(8000); // 扫描(0.4s)+入队+hash 派发+页面 fetch(bing 外部,放宽)
      // hash 分支开火的证据:URL 带 #LCTQ(纯 hashchange 或 漂移后整页加载均算——
      // 2026-10-30 页面修复后,漂移整页加载也能完成作业,属正常自愈路径)
      const newHashAttempt = sim.navigations.slice(navsSnapshot).some(function (n) {
        return n.url.indexOf("LCTQ:") >= 0;
      });
      check("C2 翻译作业经 hash 通道派发", newHashAttempt,
        "snapshot 后新增导航: " + sim.navigations.slice(navsSnapshot).map(function (n) { return n.kind + ":" + n.url.slice(-40); }).join(" | "));
    }

    // 场景 D:常驻漂移自愈(2026-10-30 实车 14:39 实证:cfg nav 破坏常驻后,hash
    // 作业 SetURL 陈旧 hashBase → 整页重载探针页 → 作业丢失 → PROBE-ACK 泄漏)。
    // 修复:页面 boot 分支处理初始 #LCTQ fragment → 整页加载也能完成作业 + 常驻自愈。
    // 模拟:先制造漂移(整页加载 watch 类页面),再派 hash 翻译作业 → 应结算且常驻恢复。
    sim.cef.navigate(sim.panels.bridgePanel, BASE + "/bridge?op=watch&rev=drifttest");
    await sim.sleep(600); // 漂移页加载
    const drifted = !(sim.cef.docs.get(sim.panels.bridgePanel).base.indexOf("op=health") >= 0);
    check("D1 已制造常驻漂移", drifted);
    let dDone = null, dSettled = false;
    const dNavSnapshot = sim.navigations.length;
    LCTNS.bridgePost("translate", {
      operation: "translate", text: "drift test", sourceLanguage: "auto",
      targetLanguage: "zh-Hans", timeoutMs: 15000,
    }, function (payload) { dSettled = true; dDone = payload; });
    await sim.waitFor(function () { return dSettled; }, 30000, "drifted hash job settle").catch(function () {});
    check("D2 漂移后 hash 作业仍结算(自愈)", dSettled === true,
      "payload=" + JSON.stringify(dDone || null).slice(0, 150));
    // 自愈证据:漂移后 hash 分支对 hashBase(op=health) 带 #LCTQ 整页加载
    // (该加载里 boot 分支处理初始 fragment 完成作业;之后 watch 页空闲重武装属正常设计)
    const driftRecovery = sim.navigations.slice(dNavSnapshot).some(function (n) {
      return n.url.indexOf("op=health") >= 0 && n.url.indexOf("LCTQ:") >= 0;
    });
    check("D3 自愈整页加载(hashBase+#LCTQ)已发生", driftRecovery);

    // 汇总
    console.log("\nSIM RESULT: PASS " + pass + " / FAIL " + fail);
    if (process.env.SIM_DUMP) {
      console.log("---- sim logs (last 40) ----");
      sim.logs.slice(-40).forEach(function (l) { console.log("  " + l); });
    }
    killBridge();          // 显式杀桥(process.exit 不跑 finally)
    process.exit(fail ? 1 : 0); // 硬退出:杀掉残留的 $.Schedule 定时器
  } catch (e) {
    killBridge();
    throw e;
  } finally {
    killBridge();
  }
}

main().catch(function (e) {
  console.error("SIM FATAL: " + (e && e.message));
  process.exit(1);
});
