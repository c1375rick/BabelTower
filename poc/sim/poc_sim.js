// Babel Tower bridgeless POC - simulation harness (adapts tests/sim/panorama_mock.js).
// Runs the REAL POC page JS (poc/pages/index.html) inside a fake CEF, driven by the REAL
// POC panorama script (poc/vpk/src/panorama/scripts/poc_boot.js) inside a fake Panorama.
//
// Fidelity notes (what this CAN and CANNOT prove):
//   CAN   : hash uplink (#LCTQ) + title downlink protocol, page JS execution, page
//           localStorage logic + persistence across "restart" (same CEF profile dir),
//           round-trip latency distribution, CORS-diagnostic plumbing.
//   CANNOT: real CEF loading a public https origin, real CORS enforcement (Node fetch
//           does NOT enforce CORS - see poc/browser_cors_* evidence instead), real CEF
//           localStorage on-disk persistence across a game restart, engine HTMLTitle
//           delivery quirks. Those need the in-game run on pak90_poc_dir.vpk.
"use strict";
const vm = require("vm");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PAGE_HTML = path.join(__dirname, "..", "pages", "index.html");
const POC_BOOT = path.join(__dirname, "..", "vpk", "src", "panorama", "scripts", "poc_boot.js");

function startStaticServer() {
  return new Promise(function (resolve) {
    const srv = http.createServer(function (req, res) {
      let body = "";
      try { body = fs.readFileSync(PAGE_HTML, "utf8"); } catch (e) {}
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(body);
    });
    srv.listen(0, "127.0.0.1", function () { resolve({ srv: srv, port: srv.address().port }); });
  });
}

function createSim(opts) {
  opts = opts || {};
  const sim = {
    logs: [], navigations: [], pageLogs: [], pageErrors: [],
    fullLoads: 0, hashNavs: 0, titleEvents: 0,
    timers: new Set(),
  };
  const t0 = Date.now();
  function slog(s) { sim.logs.push("+" + Math.round((Date.now() - t0) / 100) / 10 + "s " + String(s)); }

  // ---- panels ----
  let panelSeq = 1;
  function makePanel(id, typeName, parent) {
    const p = {
      id: id || ("anon" + panelSeq++), typeName: typeName || "Panel",
      children: [], classes: new Set(), text: "", visible: false,
      _deleted: false, _activated: false, style: {},
      IsValid() { return !p._deleted; },
      GetParent() { return p._parent; },
      FindChildTraverse(id2) {
        if (p.id === id2) return p;
        for (let i = 0; i < p.children.length; i++) { const r = p.children[i].FindChildTraverse(id2); if (r) return r; }
        return null;
      },
      FindChildrenWithClassTraverse(cls) { const out = []; (function w(x) { if (x.classes.has(cls)) out.push(x); x.children.forEach(w); })(p); return out; },
      AddClass(c) { p.classes.add(String(c)); },
      RemoveClass(c) { p.classes.delete(String(c)); },
      BHasClass(c) { return p.classes.has(String(c)); },
      Activate() { p._activated = true; },
      SetFocus() {},
      SetURL(url) { if (sim.cef) sim.cef.navigate(p, String(url)); },
      GetChildCount() { return p.children.length; },
      GetChild(i) { return p.children[i] || null; },
      GetTitle() { return ""; },           // stale attribute (real CEF behaviour)
      get title() { return ""; },
      set title(v) { /* stale */ },
      get src() { return p._url || ""; },
      get url() { return p._url || ""; },
      get IsActive() { return p._activated ? 1 : 0; },
    };
    p._parent = parent || null;
    if (parent) parent.children.push(p);
    return p;
  }

  const rootPanel = makePanel("Root", "Panel", null);
  const contextPanel = makePanel("ContextPanel", "Panel", rootPanel);
  const panels = {
    root: rootPanel,
    context: contextPanel,
    pocPanel: makePanel("LCTPocPanel", "CitadelHTMLPanel", rootPanel),
  };

  // ---- $ ----
  let schedSeq = 1;
  const $ = {
    GetContextPanel() { return contextPanel; },
    Msg(s) { slog("[Msg] " + s); },
    RegisterForUnhandledEvent(name, cb) {
      if (!sim._unhandled) sim._unhandled = new Map();
      if (!sim._unhandled.has(name)) sim._unhandled.set(name, []);
      sim._unhandled.get(name).push(cb);
      return true;
    },
    RegisterEventHandler(event, panel, cb) {
      if (!sim._panelEvents) sim._panelEvents = [];
      sim._panelEvents.push({ event: String(event), panel, cb });
      return true;
    },
    CreatePanel(type, parent, id) { return makePanel(id, type, parent); },
    Schedule(delaySec, fn) {
      const timer = setTimeout(function () { sim.timers.delete(timer); try { fn(); } catch (e) { slog("$.Schedule fn THREW: " + (e && e.message)); } }, Math.max(1, Number(delaySec) * 1000));
      sim.timers.add(timer);
      return schedSeq++;
    },
    CancelScheduled() { return false; },
    DispatchEvent() {},
  };

  function fireTitleEvents(panel, title) {
    sim.titleEvents++;
    (sim._panelEvents || []).forEach(function (h) {
      if (h.event !== "HTMLTitle" || h.panel !== panel) return;
      try { h.cb(panel, title); } catch (e) { slog("HTMLTitle cb THREW: " + (e && e.message)); }
    });
    if (sim._unhandled && sim._unhandled.has("HTMLTitle")) {
      sim._unhandled.get("HTMLTitle").forEach(function (cb) { try { cb(panel, title); } catch (e) {} });
    }
  }

  // ---- fake CEF ----
  const cef = {
    docs: new Map(),
    navigate(panel, url) {
      url = String(url);
      const base = url.split("#")[0];
      const frag = url.indexOf("#") >= 0 ? url.slice(url.indexOf("#")) : "";
      const cur = cef.docs.get(panel);
      const kind = (cur && cur.base === base) ? "hash" : "full";
      sim.navigations.push({ panel: panel.id, url: url, kind: kind, at: Date.now() });
      if (kind === "hash") {
        sim.hashNavs++;
        cur.hash = frag;
        setImmediate(function () {
          cur.hashListeners.forEach(function (fn) { try { fn(); } catch (e) { slog("[cef] hashchange THREW: " + (e && e.message)); } });
        });
        return;
      }
      sim.fullLoads++;
      let full = base;
      try { const u = new URL(base); full = u.toString(); } catch (e) {}
      httpGet(full).then(function (res) {
        if (res.status !== 200) { slog("[cef] load " + full.slice(0, 90) + " -> HTTP " + res.status); return; }
        cef.loadPage(panel, base, res.body);
      }).catch(function (e) { slog("[cef] load FAILED " + full.slice(0, 90) + " : " + (e && e.message)); });
    },
    loadPage(panel, base, html) {
      const m = html.match(/<script>([\s\S]*?)<\/script>/);
      const doc = { title: "" };
      const entry = { base: base, doc: doc, hashListeners: [], hash: "" };
      const sandbox = {
        console: { log: function () { sim.pageLogs.push(Array.prototype.slice.call(arguments).join(" ")); },
                   error: function () {}, warn: function () {} },
        URLSearchParams: URLSearchParams, URL: URL, Date: Date, JSON: JSON, Object: Object, Math: Math,
        setTimeout: setTimeout, clearTimeout: clearTimeout, setImmediate: setImmediate,
        AbortController: (typeof AbortController !== "undefined" ? AbortController : undefined),
        navigator: { userAgent: "POC-SIM/1.0 (fake CEF; real CEF UA not reproduced)" },
        localStorage: makeLocalStorageStore(opts.store || sim.localStore),
        fetch: function (p, init) {
          const abs = String(p).match(/^https?:\/\//i) ? String(p) : (base.replace(/[?#].*$/, "").replace(/\/[^/]*$/, "") + String(p));
          return fetch(abs, init);
        },
        window: { addEventListener: function (ev, fn) { if (ev === "hashchange") entry.hashListeners.push(fn); } },
        location: {
          get search() { const i = base.indexOf("?"); return i >= 0 ? base.slice(i) : ""; },
          get hash() { return entry.hash; },
          set hash(v) { entry.hash = String(v); },
          get href() { return base + (entry.hash || ""); },
          get origin() { return base.replace(/^([^/]+\/\/[^/]+).*$/, "$1"); },
        },
        document: {
          get title() { return doc.title; },
          set title(v) { doc.title = String(v); setImmediate(function () { fireTitleEvents(panel, doc.title); }); },
          getElementById: function () { return null; },
        },
      };
      sandbox.globalThis = sandbox;
      cef.docs.set(panel, entry);
      if (!m) return;
      try { vm.runInNewContext(m[1], sandbox, { filename: "cef-page.js", timeout: 5000 }); }
      catch (e) { sim.pageErrors.push(String(e && e.message)); slog("[cef] page JS THREW: " + (e && e.message)); }
      entry.sandbox = sandbox;
    },
  };
  sim.cef = cef;

  // ---- panorama sandbox ----
  const sandbox = {
    $: $,
    console: { log: function () {}, error: function () {}, warn: function () {} },
    URLSearchParams: URLSearchParams, URL: URL,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.POC_PAGE_URL = opts.pageUrl;
  sandbox.POC_NO_AUTORUN = 1;
  const ctx = vm.createContext(sandbox);
  sim.sandbox = sandbox;

  sim.loadPocScript = function () {
    const code = fs.readFileSync(POC_BOOT, "utf8");
    vm.runInContext(code, ctx, { filename: "poc_boot.js", timeout: 15000 });
    slog("[sim] loaded poc_boot.js (" + code.length + " chars)");
    return sandbox.POC;
  };

  sim.makePanel = makePanel;
  sim.$ = $;
  sim.panels = panels;
  sim.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  sim.waitFor = function (cond, timeoutMs, label) {
    const start = Date.now();
    return new Promise(function (resolve, reject) {
      (function tick() {
        let v = null; try { v = cond(); } catch (e) {}
        if (v) return resolve(v);
        if (Date.now() - start > (timeoutMs || 15000)) return reject(new Error("waitFor timeout: " + (label || "") + " (tail: " + sim.logs.slice(-5).join(" || ").slice(0, 300) + ")"));
        setTimeout(tick, 50);
      })();
    });
  };
  sim.dispose = function () { sim.timers.forEach(function (t) { try { clearTimeout(t); } catch (e) {} }); sim.timers.clear(); };
  return sim;
}

function httpGet(url, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const req = http.get(url, function (res) {
      let b = ""; res.setEncoding("utf8");
      res.on("data", function (c) { b += c; });
      res.on("end", function () { resolve({ status: res.statusCode, body: b }); });
    });
    req.setTimeout(timeoutMs || 10000, function () { req.destroy(new Error("timeout")); });
    req.on("error", reject);
  });
}

// In-memory localStorage; ONE store object is shared across sims to emulate the same
// CEF profile/origin surviving a page reload (and, in the sim, a "restart").
function makeLocalStorageStore(store) {
  if (!store) store = {};
  const api = {
    getItem(k) { k = String(k); return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[String(k)] = String(v); },
    removeItem(k) { delete store[String(k)]; },
    clear() { Object.keys(store).forEach(function (k) { delete store[k]; }); },
    key(i) { return Object.keys(store)[i] || null; },
    _dump() { return Object.assign({}, store); },
  };
  Object.defineProperty(api, "length", { get: function () { return Object.keys(store).length; } });
  return api;
}

module.exports = { createSim, startStaticServer, makeLocalStorageStore };
