// 探针自验(模拟环境):确认三个新探针都能输出真实值——不让你白跑线上。
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const http = require("http");
const { createSim } = require("../tests/sim/panorama_mock.js");

const ROOT = path.join(__dirname, "..");
const NODE = process.env.SIM_NODE || path.join(ROOT, "portable-node", "node.exe");
const BRIDGE = path.join(ROOT, "core", "bridge_server.js");
const PORT = 8796;
const BASE = "http://127.0.0.1:" + PORT;
const SCRIPTS = [
  path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat_btipc.js"),
  path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat_i18n.js"),
  path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat.js"),
];
// 预置 convar:zh-Hans(用户实车的持久化状态)
const SEEDED_CONVAR = JSON.stringify({
  enabled: true, provider: "bing", displayMode: "bilingual",
  outgoing: "bilingual", outgoingTarget: "zh-Hans", targetLanguage: "zh-Hans",
  force: false, timeoutMs: 15000, translateOwn: true, uiLang: "zh",
});

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? " | " + extra : "")); }
}
function getJson(url, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const req = http.get(url, function (res) {
      let b = "";
      res.on("data", function (c) { b += c; });
      res.on("end", function () { try { resolve(JSON.parse(b)); } catch (e) { resolve({ raw: b }); } });
    });
    req.setTimeout(timeoutMs || 4000, function () { req.destroy(new Error("timeout")); });
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
  fs.writeFileSync(path.join(cfgDir, "config.json"), JSON.stringify({
    port: PORT, provider: "bing", logFile: path.join(tmp, "bridge.log"), chatLog: { enabled: false },
    ui: { enabled: true, provider: "bing", displayMode: "bilingual", outgoing: "bilingual", outgoingTarget: "en", targetLanguage: "zh-Hans", force: false, timeoutMs: 15000 },
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
    check("bridge up", up);

    const sim = createSim({ bridgeBase: BASE, verbose: !!process.env.SIM_VERBOSE });
    sim.sandbox.Convars = {
      _v: SEEDED_CONVAR,
      RegisterConVar: function () {},
      SetValue: function (name, v) { this._v = v; },
      GetStr: function (name, dflt) { return this._v || dflt; },
    };
    sim.runScripts(SCRIPTS);
    await sim.sleep(300);
    const LCTNS = sim.sandbox.LCTNS;

    await sim.waitFor(function () {
      return sim.logs.some(function (l) { return l.indexOf("synced from bridge") >= 0; });
    }, 15000, "boot sync").catch(function () {});
    await sim.sleep(500);

    // 探针 ①:boot probe(loadUiConfig 载入值)——convar 是 zh-Hans,应输出 zh-Hans
    const probe1 = sim.logs.find(function (l) { return l.indexOf("boot probe: loadUiConfig") >= 0; });
    check("P1 boot probe(loadUiConfig)有输出", !!probe1, probe1 || "(无)");
    check("P1b 载入值=zh-Hans(convar 忠实)", !!probe1 && probe1.indexOf("outgoingTarget=zh-Hans") >= 0, probe1 || "");

    // 探针 ②:applyBridgeConfig 日志带 outgoingTarget(en——桥配置纠正)
    const probe2 = sim.logs.find(function (l) { return l.indexOf("outgoingTarget=en") >= 0 && l.indexOf("synced from bridge") >= 0; });
    check("P2 sync 日志带 outgoingTarget=en", !!probe2, probe2 || "(无)");

    // 探针 ③:派发诊断 d.target(触发一次出站作业)
    if (typeof LCTNS.bridgePost === "function") {
      let settled = false;
      LCTNS.bridgePost("translate", {
        operation: "translate", text: "hello", sourceLanguage: "auto",
        targetLanguage: "en", timeoutMs: 15000,
      }, function () { settled = true; });
      await sim.waitFor(function () { return settled; }, 25000, "outgoing settle").catch(function () {});
      const disp = sim.logs.filter(function (l) { return l.indexOf("outgoing dispatch") >= 0; });
      check("P3 dispatch 诊断有输出", disp.length > 0, disp[0] || "(无)");
      check("P3b d.target 已读取(非 undefined 占位)", disp.some(function (l) { return l.indexOf("d.target=undefined") < 0; }), disp[0] || "");
    }

    console.log("\nPROBE SELF-TEST: PASS " + pass + " / FAIL " + fail);
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
