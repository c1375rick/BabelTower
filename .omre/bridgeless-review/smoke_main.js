// Babel Tower Community 0.1.0 - minimal smoke for the REAL game-side script.
// Usage: F:\BabelTower\portable-node\node.exe poc\sim\smoke_main.js
//
// What it proves (and what it does NOT):
//   CAN   : the shipped panarama scripts (i18n -> panel -> lingua_chat.js) parse AND execute
//           their load-time IIFE inside a fake Panorama without throwing; boot() runs; the
//           https-panel probe fires with the community PAGE_URL; no crash in the boot tail.
//   CANNOT: real CEF loading c1375rick.github.io, real CORS, cfg sync round-trip, /tr panel
//           interaction, hash translation flow. Those need the in-game run on pak90_ce_dir.vpk
//           (see CHANGELOG-0.1.0.md verification checklist).
//
// The mock is deliberately permissive (Proxy fallback to no-op): we want the script's own
// defensive try/catch paths exercised, not a fake that hides missing engine surface.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createSim } = require("./poc_sim");

const SCRIPTS = path.join(__dirname, "..", "..", "mod", "panorama", "scripts");
const ORDER = ["lingua_chat_i18n.js", "lingua_chat_panel.js", "lingua_chat_btipc.js", "lingua_chat.js"];

let pass = 0, fail = 0;
function check(name, cond, extra) {
  const tag = cond ? "PASS" : "FAIL";
  if (cond) pass++; else fail++;
  console.log("  " + tag + " " + name + (extra !== undefined && extra !== null ? "  [" + extra + "]" : ""));
}

// ---- permissive stub: any unknown member is a no-op function (Panorama surface is huge) ----
function loose(obj, cache) {
  const c = cache || new WeakMap();
  if (!obj || typeof obj !== "object") return obj;
  if (c.has(obj)) return c.get(obj);
  const p = new Proxy(obj, {
    get(t, k) {
      if (k in t) {
        const v = t[k];
        return typeof v === "function" ? v.bind(t) : v;
      }
      return function stub() { return undefined; };
    },
  });
  c.set(obj, p);
  return p;
}

async function main() {
  // The sim's static server serves the POC page; the probe here targets the real Pages URL,
  // which the sim's httpGet cannot fetch (https). That is fine: we assert the ATTEMPT.
  const sim = createSim({ pageUrl: "https://c1375rick.github.io/babeltower-community-pages/" });
  const panelCache = new WeakMap();
  const base$ = sim.$;

  // Convars/Players: minimal but stateful so loadUiConfig/applyUILang take the real branches.
  const convars = Object.create(null);
  const convarsApi = {
    GetStr(k, d) { return Object.prototype.hasOwnProperty.call(convars, k) ? convars[k] : (d === undefined ? "" : d); },
    SetValue(k, v) { convars[k] = String(v); return true; },
    RegisterConVar() { return true; },
  };
  const playersApi = {
    GetLocalPlayer() { return 0; },
    GetPlayerInfo() { return null; },
    GetPlayerName() { return ""; },
  };

  sim.sandbox.$ = new Proxy(base$, {
    get(t, k) {
      if (k === "GetContextPanel") return function () { return loose(t.GetContextPanel(), panelCache); };
      if (k === "CreatePanel") return function (type, parent, id) { return loose(t.CreatePanel(type, parent, id), panelCache); };
      if (k in t) { const v = t[k]; return typeof v === "function" ? v.bind(t) : v; }
      return function stub() { return undefined; };
    },
  });

  // panels handed out earlier (sim.panels.*) must be the loose proxies too
  Object.keys(sim.panels).forEach(function (k) { sim.panels[k] = loose(sim.panels[k], panelCache); });

  // chat.xml declares <CitadelHTMLPanel id="LCTBridgePanel"> inside <CitadelChat>: mirror that,
  // otherwise ensurePanel() finds nothing and the https probe can never start.
  const bridgePanel = sim.makePanel("LCTBridgePanel", "CitadelHTMLPanel", sim.panels.context);

  // Serve the REAL hosted page (pages/index.html) for the community origin instead of doing a
  // network fetch: the sim cannot speak https, but the page's own hash/title protocol is local,
  // so this proves the game->page cfg op (V2) offline.
  const PAGE_HTML = fs.readFileSync(path.join(__dirname, "..", "..", "pages", "index.html"), "utf8");
  const origNavigate = sim.cef.navigate;
  sim.cef.navigate = function (panel, url) {
    const s = String(url);
    const base = s.split("#")[0];
    const cur = sim.cef.docs.get(panel);
    if (cur && cur.base === base) return origNavigate.call(sim.cef, panel, s);
    sim.navigations.push({ panel: panel.id, url: s, kind: "full", at: Date.now() });
    sim.fullLoads++;
    sim.cef.loadPage(panel, base, PAGE_HTML);
  };

  sim.sandbox.Convars = convarsApi;
  sim.sandbox.Players = playersApi;
  sim.sandbox.Game = loose({});
  sim.sandbox.GameEvents = loose({});
  sim.sandbox.Entities = loose({});
  sim.sandbox.CustomNetTable = loose({});
  sim.sandbox.Localize = function (s) { return String(s || ""); };
  sim.sandbox.SteamID = "STEAM_0:0:0";
  sim.sandbox.setTimeout = setTimeout;
  sim.sandbox.clearTimeout = clearTimeout;

  const logs = [];
  const origMsg = base$.Msg;
  sim.sandbox.$.Msg = function (s) { logs.push(String(s)); origMsg(s); };
  sim.sandbox.console = {
    log: function () { logs.push(Array.prototype.slice.call(arguments).join(" ")); },
    error: function () { logs.push(Array.prototype.slice.call(arguments).join(" ")); },
    warn: function () { logs.push(Array.prototype.slice.call(arguments).join(" ")); },
  };

  // ---- load scripts in the same order chat.xml does (minus layout-driven helpers) ----
  const ctx = vm.createContext(sim.sandbox);
  for (const f of ORDER) {
    const p = path.join(SCRIPTS, f);
    let err = null;
    try {
      vm.runInContext(fs.readFileSync(p, "utf8"), ctx, { filename: f, timeout: 15000 });
    } catch (e) { err = e; }
    check("load " + f + " (no throw)", err === null, err ? String(err && err.message).slice(0, 160) : "ok");
  }

  // boot is scheduled at 0.1s by the script itself; the probe fires at 1.2s
  await sim.sleep(7000);

  const booted = logs.some(function (l) { return l.indexOf("boot probe: loadUiConfig") >= 0; });
  check("boot() executed (log: 'boot probe: loadUiConfig')", booted,
    (logs.find(function (l) { return l.indexOf("boot probe") >= 0; }) || "").slice(0, 120));

  const panelFound = logs.some(function (l) { return l.indexOf("bridge panel found") >= 0; });
  check("layout panel LCTBridgePanel resolved (mirrors chat.xml)", panelFound,
    (logs.find(function (l) { return l.indexOf("bridge panel") >= 0; }) || "").slice(0, 120));

  const pageNav = sim.navigations.find(function (n) { return n.url.indexOf("babeltower-community-pages") >= 0; });
  check("https panel probe fired with community PAGE_URL", !!pageNav, pageNav ? pageNav.url.slice(0, 80) : "no nav");
  check("probe navigated as a full page load (CitadelHTMLPanel.SetURL)", !!pageNav && pageNav.kind === "full",
    pageNav ? pageNav.kind : "n/a");

  const aliveLog = logs.find(function (l) { return l.indexOf("https panel: ALIVE") >= 0; });
  const pageTitle = String((sim.cef.docs.get(bridgePanel) || {}).doc && (sim.cef.docs.get(bridgePanel) || {}).doc.title);
  check("probe settled ALIVE after real page boot (V1 marker contract)", !!aliveLog,
    aliveLog ? aliveLog.slice(0, 90) : "no ALIVE log; titleEvents=" + sim.titleEvents + " pageTitle=" + JSON.stringify(pageTitle.slice(0, 60)));

  // V2: the cfg poll (hashCfgSync -> #LCTQ cfg op) must be answered by the page, which replies
  // as title "LCT<id>{...}" and resolves the pending slot.
  const pageCfgReply = /^LCTcfg[\w]*\{/.test(pageTitle);
  check("page answered cfg op (V2 wiring: #LCTQ cfg -> LCT<id>{...} title)", pageCfgReply,
    pageCfgReply ? pageTitle.slice(0, 60) : "last title=" + JSON.stringify(pageTitle.slice(0, 60)));
  console.log("  INFO page-cfg apply log " + (logs.some(function (l) { return l.indexOf("page-cfg") >= 0; }) ? "seen" : "not seen (empty localStorage in sim -> empty cfg mask)") +
    "; page errors=" + sim.pageErrors.length);

  // any uncaught engine-surface exception shows up as a thrown load; the script's own
  // try/catch paths are expected and appear as [LCT] lines, so we only fail on load throws.

  console.log("\nSMOKE RESULT: PASS " + pass + " / FAIL " + fail);
  if (process.env.SMOKE_DEBUG) {
    console.log("\n--- panorama logs ---\n" + logs.join("\n"));
    console.log("\n--- page logs ---\n" + sim.pageLogs.join("\n"));
    console.log("\n--- page errors ---\n" + sim.pageErrors.join("\n"));
    console.log("\n--- title/dbg --- titleEvents=" + sim.titleEvents + " navs=" + JSON.stringify(sim.navigations.map(function (n) { return n.kind + " " + n.url.slice(0, 50); })));
    sim.cef.docs.forEach(function (v) { console.log("doc title=" + JSON.stringify(String(v.doc && v.doc.title).slice(0, 80)) + " hash=" + String(v.hash).slice(0, 60)); });
  }
  sim.dispose();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (e) {
  console.error("SMOKE CRASHED: " + (e && e.stack ? e.stack : e));
  process.exit(2);
});
