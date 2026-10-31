// 回归锁:出站方向跟随配置(2026-10-31)。
// 背景:游戏内设置面板已移除(双 UI 分叉曾导致「发送目标语言」冻结在 zh-Hans、
// 方向整反)。本测试锁定:网页配置修改 → 差分同步 → 游戏扁平字段 → 出站方向,
// 全链一致(游戏内面板文件不再加载,dirty 分叉源已消灭)。
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
const PORT = 8794;
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

function post(url, body) {
  return new Promise(function (resolve, reject) {
    const data = JSON.stringify(body);
    const req = http.request(url, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } }, function (res) {
      let b = "";
      res.on("data", function (c) { b += c; });
      res.on("end", function () { try { resolve(JSON.parse(b)); } catch (e) { resolve({ raw: b }); } });
    });
    req.setTimeout(8000, function () { req.destroy(new Error("post timeout")); });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}
function getJson(url, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const req = http.get(url, function (res) {
      let b = "";
      res.on("data", function (c) { b += c; });
      res.on("end", function () { try { resolve(JSON.parse(b)); } catch (e) { resolve({ raw: b }); } });
    });
    req.setTimeout(timeoutMs || 4000, function () { req.destroy(new Error("get timeout")); });
    req.on("error", reject);
  });
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bt-sim-"));
  const cfgDir = path.join(tmp, "config");
  fs.mkdirSync(cfgDir, { recursive: true });
  const srcCfg = path.join(ROOT, "config");
  fs.readdirSync(srcCfg).forEach(function (f) {
    if (f === "config.json" || !f.endsWith(".json")) return;
    try { fs.copyFileSync(path.join(srcCfg, f), path.join(cfgDir, f)); } catch (e) {}
  });
  const simLog = path.join(tmp, "bridge.log");
  fs.writeFileSync(path.join(cfgDir, "config.json"), JSON.stringify({
    port: PORT, provider: "bing", logFile: simLog, chatLog: { enabled: false },
  }, null, 2), "utf8");

  const child = spawn(NODE, [BRIDGE], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { BABEL_TOWER_CONFIG_DIR: cfgDir }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const killBridge = function () { try { child.kill(); } catch (e) {} };

  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      try { const j = await getJson(BASE + "/api/v1/health", 1200); up = j && j.ok === true; } catch (e) {}
      if (!up) await new Promise(function (r) { setTimeout(r, 300); });
    }
    check("sim bridge up", up);

    const sim = createSim({ bridgeBase: BASE, verbose: !!process.env.SIM_VERBOSE });
    sim.runScripts(SCRIPTS);
    await sim.sleep(300);
    const LCTNS = sim.sandbox.LCTNS;
    if (!LCTNS) throw new Error("LCTNS missing");

    await sim.waitFor(function () {
      return sim.logs.some(function (l) { return l.indexOf("https panel: ALIVE") >= 0; });
    }, 25000, "ALIVE");
    check("A0 探针 ALIVE", true);

    function waitDelta() {
      return sim.waitFor(function () {
        return sim.logs.some(function (l) { return l.indexOf("cfg sync applied") >= 0; });
      }, 15000, "delta apply").catch(function () {});
    }
    function lastTargetFromBridgeLog() {
      try {
        const t = fs.readFileSync(simLog, "utf8");
        const hits = t.match(/target=[A-Za-z-]+/g) || [];
        return hits.length ? hits[hits.length - 1] : "(none)";
      } catch (e) { return "(log unreadable)"; }
    }
    function settleOutgoing(text, tgt) {
      return new Promise(function (resolve) {
        let done = null;
        LCTNS.bridgePost("translate", {
          operation: "translate", text: text, sourceLanguage: "auto",
          targetLanguage: tgt, timeoutMs: 15000,
        }, function (p) { done = p; resolve(done); });
        setTimeout(function () { resolve(done || { ok: false, error: "test timeout" }); }, 25000);
      });
    }

    // T1:网页把发送目标语言设为 zh-Hans → 差分 → 游戏跟随
    await post(BASE + "/api/v1/config", { config: { ui: { outgoingTarget: "zh-Hans" } } });
    await waitDelta();
    await sim.sleep(300);
    const t1AppliedAt = sim.logs.length;
    check("T1 网页设 zh-Hans → 游戏跟随", LCTNS.State.cfg.outgoingTarget === "zh-Hans",
      "flat=" + LCTNS.State.cfg.outgoingTarget);

    // T2:该方向下派发目标(确定性断言,不依赖 provider 成功)
    check("T2 派发方向=zh-Hans", LCTNS.resolveOutgoingTarget() === "zh-Hans",
      "resolveOutgoingTarget=" + LCTNS.resolveOutgoingTarget());
    await settleOutgoing("hello", "zh-Hans"); // 冒烟:作业能走完整链
    await sim.sleep(300);

    // T3:网页改回 en → 差分 → 游戏跟随(dirty 分叉源的回归锁)
    await post(BASE + "/api/v1/config", { config: { ui: { outgoingTarget: "en" } } });
    await sim.waitFor(function () {
      return LCTNS.State.cfg.outgoingTarget === "en" ||
        sim.logs.some(function (l) { return l.indexOf("cfg sync applied") >= 0 && sim.logs.indexOf(l) > t1AppliedAt; });
    }, 70000, "en delta(含 watch 重挂容差)").catch(function () {});
    await sim.sleep(300);
    check("T3 网页改 en → 游戏跟随", LCTNS.State.cfg.outgoingTarget === "en",
      "flat=" + LCTNS.State.cfg.outgoingTarget);

    // T4:该方向下派发目标(方向正确性回归锁)
    check("T4 派发方向=en", LCTNS.resolveOutgoingTarget() === "en",
      "resolveOutgoingTarget=" + LCTNS.resolveOutgoingTarget());
    await settleOutgoing("hello", "en"); // 冒烟:作业能走完整链
    await sim.sleep(300);

    console.log("\nSIM RESULT: PASS " + pass + " / FAIL " + fail);
    if (process.env.SIM_DUMP) {
      console.log("---- sim logs (last 25) ----");
      sim.logs.slice(-25).forEach(function (l) { console.log("  " + l); });
    }
    killBridge();
    process.exit(fail ? 1 : 0);
  } catch (e) {
    killBridge();
    console.error("SIM FATAL: " + (e && e.message));
    process.exit(1);
  } finally {
    killBridge();
  }
}

main();
