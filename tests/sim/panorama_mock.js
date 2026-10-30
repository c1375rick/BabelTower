// Panorama/CEF 模拟环境(2026-10-30)——"先模拟,后实车"工作流的落地件。
// 目标:在 Node 里跑**真的** lingua_chat*.js + **真的** bridge_server.js,
// 复现 游戏脚本 ↔ CEF 面板 ↔ 桥 的完整通道,实车验证前先在这里跑通。
//
// 忠实度约定(以 2026-10-30 实车证据为准):
//   ① $.Language / $.AsyncWebRequest / setTimeout / clearTimeout **不存在**
//      (10-29 实车:typeof 全 undefined,代码自身有守卫);
//   ② panel.GetTitle()/panel.title 是**陈旧属性**——永远返回 ""
//      (10-20 起实测"读属性永远读不到推送包";diag-title title="");
//   ③ document.title 赋值 → HTMLTitle 事件异步派发(cb(panel, title),QOL 4.0.5
//      同款签名;12:40 boot 实证该通道在 CitadelHTMLPanel + RegisterEventHandler 下工作);
//   ④ SetURL 只换 fragment 时页面常驻(不重载),触发 hashchange;
//      换 path/query 时整页重载(重新 fetch + 执行页面 JS)。
"use strict";
const vm = require("vm");
const http = require("http");
const fs = require("fs");
const path = require("path");

function httpGet(url, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const req = http.get(url, function (res) {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", function (c) { body += c; });
      res.on("end", function () { resolve({ status: res.statusCode, body: body }); });
    });
    req.setTimeout(timeoutMs || 10000, function () { req.destroy(new Error("sim httpGet timeout")); });
    req.on("error", reject);
  });
}

function createSim(opts) {
  opts = opts || {};
  const sim = {
    logs: [],
    unhandled: new Map(),      // eventName -> [cb]
    panelEvents: [],           // {event, panel, cb}
    navigations: [],           // {panel, url, kind: "full"|"hash"}
    fullLoads: 0,
    hashNavs: 0,
    titleEvents: 0,            // 实际派发到脚本回调的 title 事件数
    pageErrors: [],
  };

  function slog(s) {
    sim.logs.push(String(s));
    if (opts.verbose) process.stdout.write("  [sim] " + s + "\n");
  }

  // ---------- 面板 ----------
  let panelSeq = 1;
  function makePanel(id, typeName, parent) {
    const p = {
      id: id || ("anon" + panelSeq++),
      typeName: typeName || "Panel",
      children: [],
      classes: new Set(),
      text: "",
      visible: false,
      loadfailure: undefined,
      _activated: false,
      _deleted: false,
      IsValid() { return !p._deleted; },
      GetParent() { return p._parent; },
      FindChildTraverse(id2) {
        if (p.id === id2) return p;
        for (let i = 0; i < p.children.length; i++) {
          const r = p.children[i].FindChildTraverse(id2);
          if (r) return r;
        }
        return null;
      },
      FindChildrenWithClassTraverse(cls) {
        const out = [];
        (function walk(x) { if (x.classes.has(cls)) out.push(x); x.children.forEach(walk); })(p);
        return out;
      },
      AddClass(c) { p.classes.add(String(c)); },
      RemoveClass(c) { p.classes.delete(String(c)); },
      BReadyForDisplay() { return true; },
      // 陈旧属性(约定②):永远空串
      GetTitle() { return ""; },
      Activate() { p._activated = true; },
      SetFocus() {},
      SetURL(url) { if (sim.cef) sim.cef.navigate(p, String(url)); },
      BHasClass(c) { return p.classes.has(String(c)); },
      style: {},
      GetChildCount() { return p.children.length; },
      GetChild(i) { return p.children[i] || null; },
      get title() { return ""; },
      set title(v) { /* 陈旧:写入不生效 */ },
      get src() { return p._url || ""; },
      get url() { return p._url || ""; },
      get IsActive() { return p._activated ? 1 : 0; },
    };
    p._parent = parent || null;
    if (parent) parent.children.push(p);
    return p;
  }

  // chat.xml 的最小结构(getRoot = 顶层;上下文面板在其下)
  const rootPanel = makePanel("Root", "Panel", null);
  const contextPanel = makePanel("ContextPanel", "Panel", rootPanel);
  const panels = {
    root: rootPanel,
    context: contextPanel,
    chatMessages: makePanel("ChatMessages", "Panel", rootPanel),
    bridgePanel: makePanel("LCTBridgePanel", "CitadelHTMLPanel", rootPanel),
    bridgeDot: makePanel("LCTBridgeDot", "Panel", rootPanel),
    settings: makePanel("LCTSettingsPanel", "Panel", rootPanel),
  };

  // ---------- $ ----------
  let schedSeq = 1;
  const scheduled = new Map();
  const $ = {
    GetContextPanel() { return contextPanel; },
    Msg(s) { slog("[Msg] " + s); },
    RegisterForUnhandledEvent(name, cb) {
      if (!sim.unhandled.has(name)) sim.unhandled.set(name, []);
      sim.unhandled.get(name).push(cb);
      return true;
    },
    RegisterEventHandler(event, panel, cb) {
      sim.panelEvents.push({ event: String(event), panel, cb });
      return true;
    },
    CreatePanel(type, parent, id) { return makePanel(id, type, parent); },
    Schedule(delaySec, fn) {
      const h = schedSeq++;
      const timer = setTimeout(function () {
        scheduled.delete(h);
        try { fn(); } catch (e) { slog("$.Schedule fn THREW: " + (e && e.message)); }
      }, Math.max(1, Number(delaySec) * 1000));
      scheduled.set(h, timer);
      return h;
    },
    CancelScheduled(h) {
      const t = scheduled.get(h);
      if (t) { clearTimeout(t); scheduled.delete(h); return true; }
      return false;
    },
    DispatchEvent() { /* 记录级:脚本用它派 UI 事件,通道测试不依赖 */ },
    BImageFileExists() { return false; },
    // 注意:Language / AsyncWebRequest / setTimeout / clearTimeout 按 10-29 实车**不提供**
  };

  // ---------- 标题事件派发(约定③) ----------
  function fireTitleEvents(panel, title) {
    sim.titleEvents++;
    sim.panelEvents.forEach(function (h) {
      if (h.event !== "HTMLTitle") return;
      if (h.panel !== panel) return;
      try { h.cb(panel, title); } catch (e) { slog("HTMLTitle cb THREW: " + (e && e.message)); }
    });
  }

  // ---------- 假 CEF ----------
  const SHIM = opts.bridgeBase || "http://127.0.0.1:8793"; // 页面 fetch/导航的统一重写目标
  const cef = {
    docs: new Map(), // panel -> {base, sandbox, hashListeners, hash}
    navigate(panel, url) {
      url = String(url);
      const base = url.split("#")[0];
      const frag = url.indexOf("#") >= 0 ? url.slice(url.indexOf("#")) : "";
      const cur = cef.docs.get(panel);
      const kind = (cur && cur.base === base) ? "hash" : "full";
      sim.navigations.push({ panel: panel.id, url: url, kind: kind });
      if (kind === "hash") {
        sim.hashNavs++;
        cur.hash = frag;
        if (opts.verbose) slog("[cef] HASH NAV frag=" + frag.slice(0, 60) + " listeners=" + cur.hashListeners.length);
        setImmediate(function () {
          cur.hashListeners.forEach(function (fn) {
            try { fn(); } catch (e) { slog("[cef] hashchange listener THREW: " + (e && e.message)); }
          });
        });
        return;
      }
      sim.fullLoads++;
      // 传输垫片:游戏脚本里的 https://localhost:8792 / 127.0.0.1:8791 → 模拟桥
      const fetchUrl = base
        .replace(/^https:\/\/localhost:8792/i, SHIM)
        .replace(/^http:\/\/127\.0\.0\.1:8791/i, SHIM)
        .replace(/^https:\/\/127\.0\.0\.1:8792/i, SHIM);
      httpGet(fetchUrl).then(function (res) {
        if (res.status !== 200) { slog("[cef] load " + fetchUrl.slice(0, 80) + " -> HTTP " + res.status); return; }
        cef.loadPage(panel, base, res.body);
      }).catch(function (e) {
        slog("[cef] load FAILED " + fetchUrl.slice(0, 80) + " : " + (e && e.message));
      });
    },
    loadPage(panel, base, html) {
      const m = html.match(/<script>([\s\S]*?)<\/script>/);
      const doc = { base: base, title: "" };
      const entry = { base: base, doc: doc, hashListeners: [], hash: "" };
      const sandbox = {
        console: { log: function () {}, error: function () {}, warn: function () {} },
        URLSearchParams: URLSearchParams,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        // 页面 JS 用绝对路径 fetch('/api/v1/...')——按 origin 解析,并重写到模拟桥
        fetch: function (p, init) {
          if (opts.verbose) slog("[cef-page] fetch " + String(p));
          return fetch(SHIM + String(p), init);
        },
        window: {
          addEventListener: function (ev, fn) { if (ev === "hashchange") entry.hashListeners.push(fn); },
        },
        location: {
          get search() { const i = base.indexOf("?"); return i >= 0 ? base.slice(i) : ""; },
          get hash() { return entry.hash; },
          set hash(v) { entry.hash = String(v); },
          get href() { return base + (entry.hash || ""); },
        },
        document: {
          get title() { return doc.title; },
          set title(v) {
            doc.title = String(v);
            // CEF:标题变化 → HTMLTitle 事件(异步,下一拍派发)
            setImmediate(function () { fireTitleEvents(panel, doc.title); });
          },
        },
      };
      cef.docs.set(panel, entry);
      if (!m) return; // 无脚本页面(纯静态)
      try {
        vm.runInNewContext(m[1], sandbox, { filename: "cef-page.js", timeout: 5000 });
      } catch (e) {
        sim.pageErrors.push(String(e && e.message));
        slog("[cef] page JS THREW: " + (e && e.message));
      }
    },
  };
  sim.cef = cef;

  // ---------- 脚本装载 ----------
  const scriptConsole = {
    log: function () { slog("[js] " + Array.prototype.slice.call(arguments).join(" ")); },
    error: function () { slog("[js-err] " + Array.prototype.slice.call(arguments).join(" ")); },
    warn: function () { slog("[js-warn] " + Array.prototype.slice.call(arguments).join(" ")); },
  };
  const sandbox = {
    $: $,
    console: scriptConsole,
    URLSearchParams: URLSearchParams,
    URL: URL,
    // Panorama 没有 setTimeout/clearTimeout(实车 10-29 实证)——故意不提供
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  sim.sandbox = sandbox;

  sim.runScripts = function (files) {
    files.forEach(function (f) {
      const code = fs.readFileSync(f, "utf8");
      try {
        vm.runInContext(code, ctx, { filename: path.basename(f), timeout: 15000 });
        slog("[sim] loaded " + path.basename(f) + " (" + code.length + " chars)");
      } catch (e) {
        slog("[sim] LOAD THREW " + path.basename(f) + ": " + (e && e.stack ? e.stack.split("\n").slice(0, 4).join(" | ") : e));
        throw e;
      }
    });
  };

  sim.fireUnhandled = function (name) {
    const args = Array.prototype.slice.call(arguments, 1);
    (sim.unhandled.get(name) || []).forEach(function (cb) {
      try { cb.apply(null, args); } catch (e) { slog("unhandled cb THREW: " + (e && e.message)); }
    });
  };

  sim.makePanel = makePanel;
  sim.$ = $;
  sim.panels = panels;

  sim.waitFor = function (cond, timeoutMs, label) {
    const start = Date.now();
    return new Promise(function (resolve, reject) {
      (function tick() {
        let v = null;
        try { v = cond(); } catch (e) {}
        if (v) return resolve(v);
        if (Date.now() - start > (timeoutMs || 15000)) {
          return reject(new Error("waitFor timeout: " + (label || "condition") + " (logs tail: " + sim.logs.slice(-6).join(" || ").slice(0, 400) + ")"));
        }
        setTimeout(tick, 100);
      })();
    });
  };

  sim.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  return sim;
}

module.exports = { createSim };
