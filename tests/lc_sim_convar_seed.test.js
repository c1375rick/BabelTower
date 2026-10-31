// 诊断:模拟真实 boot——convar 里持久化了 zh-Hans(用户此前的面板选择),
// 桥配置是 en。boot 同步之后,flat 应该被桥配置纠正为 en。
// 纠正不了 → 同步传输/应用坏了(用户假设);能纠正 → 实车另有变量。
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
const PORT = 8795;
const BASE = "http://127.0.0.1:" + PORT;
const SCRIPTS = [
  path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat_btipc.js"),
  path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat_i18n.js"),
  path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat.js"),
];
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

    console.log("boot 后(convar 已载入): flat=" + LCTNS.State.cfg.outgoingTarget +
      "  ui.outgoingTarget=" + (LCTNS.State.cfg.ui ? LCTNS.State.cfg.ui.outgoingTarget : "(无 ui 块)"));

    await sim.waitFor(function () {
      return sim.logs.some(function (l) { return l.indexOf("https panel: ALIVE") >= 0; });
    }, 25000, "ALIVE");

    await sim.waitFor(function () {
      return sim.logs.some(function (l) { return l.indexOf("synced from bridge") >= 0 || l.indexOf("cfg sync applied") >= 0; });
    }, 15000, "boot sync").catch(function () { return false; });
    await sim.sleep(500);

    const flatAfter = LCTNS.State.cfg.outgoingTarget;
    console.log("boot 同步后: flat=" + flatAfter +
      "  ui.outgoingTarget=" + (LCTNS.State.cfg.ui ? LCTNS.State.cfg.ui.outgoingTarget : "(无)"));
    check("boot 同步纠正 flat=en(同步传输正常)", flatAfter === "en", "flat=" + flatAfter);
    const resolved = LCTNS.resolveOutgoingTarget ? LCTNS.resolveOutgoingTarget() : "(未导出)";
    check("resolveOutgoingTarget=en", resolved === "en", "resolved=" + resolved);

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
