// 诊断 convar_seed 失败根因:复用 lc_sim_convar_seed 骨架,在断言点打印一切。
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const http = require("http");
const { createSim } = require(path.join(__dirname, "..", "tests", "sim", "panorama_mock.js"));

const ROOT = path.join(__dirname, "..");
const NODE = process.env.SIM_NODE || path.join(ROOT, "portable-node", "node.exe");
const BRIDGE = path.join(ROOT, "core", "bridge_server.js");
const PORT = 8797;
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

function getJson(url, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const req = http.get(url, function (res) {
      let b = ""; res.on("data", function (c) { b += c; });
      res.on("end", function () { try { resolve(JSON.parse(b)); } catch (e) { resolve({ raw: b }); } });
    });
    req.setTimeout(timeoutMs || 4000, function () { req.destroy(new Error("timeout")); });
    req.on("error", reject);
  });
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bt-diag-"));
  const cfgDir = path.join(tmp, "config");
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.readdirSync(path.join(ROOT, "config")).forEach(function (f) {
    if (f === "config.json" || !f.endsWith(".json")) return;
    try { fs.copyFileSync(path.join(ROOT, "config", f), path.join(cfgDir, f)); } catch (e) {}
  });
  fs.writeFileSync(path.join(cfgDir, "config.json"), JSON.stringify({
    port: PORT, provider: "bing", logFile: path.join(tmp, "bridge.log"), chatLog: { enabled: false },
    ui: { enabled: true, provider: "bing", displayMode: "bilingual", outgoing: "bilingual", outgoingTarget: "en", targetLanguage: "zh-Hans", force: false, timeoutMs: 15000 },
  }, null, 2), "utf8");

  const child = spawn(NODE, [BRIDGE], { cwd: ROOT, env: Object.assign({}, process.env, { BABEL_TOWER_CONFIG_DIR: cfgDir }), stdio: ["ignore", "pipe", "pipe"] });
  const killBridge = function () { try { child.kill(); } catch (e) {} };
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      try { const j = await getJson(BASE + "/api/v1/health", 1200); up = j && j.ok === true; } catch (e) {}
      if (!up) await new Promise(function (r) { setTimeout(r, 300); });
    }
    if (!up) throw new Error("bridge not up");

    const sim = createSim({ bridgeBase: BASE, verbose: false });
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
      return sim.logs.some(function (l) { return l.indexOf("synced from bridge") >= 0 || l.indexOf("cfg sync applied") >= 0; });
    }, 15000, "boot sync");
    await sim.sleep(500);

    const raw = sim.sandbox.Convars._v;
    let parsed = null; try { parsed = JSON.parse(raw); } catch (e) {}
    console.log("---- 诊断 ----");
    console.log("convar._v 长度: " + (raw ? raw.length : "(空)"));
    console.log("convar._v 前 300: " + (raw ? raw.slice(0, 300) : "(空)"));
    console.log("convar JSON 顶层 outgoingTarget: " + (parsed ? JSON.stringify(parsed.outgoingTarget) : "(解析失败)"));
    console.log("convar JSON 顶层 outgoing: " + (parsed ? JSON.stringify(parsed.outgoing) : "-"));
    console.log("State.cfg.outgoingTarget: " + JSON.stringify(LCTNS.State.cfg.outgoingTarget));
    console.log("typeof LCTNS.resolveOutgoingTarget: " + typeof LCTNS.resolveOutgoingTarget);
    console.log("resolveOutgoingTarget(): " + (typeof LCTNS.resolveOutgoingTarget === "function" ? JSON.stringify(LCTNS.resolveOutgoingTarget()) : "-"));
    console.log("sandbox.Convars === sandbox 全局 Convars: " + (sim.sandbox.Convars === sim.sandbox.Convars));
    console.log("---- 相关日志 ----");
    sim.logs.filter(function (l) { return /saveUiConfig|synced from bridge|cfg sync|SetValue|convar/i.test(l); }).slice(-12).forEach(function (l) { console.log("  " + l); });
    killBridge();
    process.exit(0);
  } catch (e) {
    killBridge();
    console.error("DIAG FATAL: " + (e && e.message));
    process.exit(1);
  } finally { killBridge(); }
}
main();
