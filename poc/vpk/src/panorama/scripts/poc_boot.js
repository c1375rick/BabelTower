// Babel Tower - 无桥 POC 面板引导脚本(独立 POC,不改动任何 1.2.5 正式代码)
// ------------------------------------------------------------------
// 目标(见 docs/poc_bridgeless_cef.md):
//   S1  CEF 加载公网 https 托管页并执行 JS → 页面写 document.title=POC-ALIVE …
//   S2  hash 上行(#LCTQ: + encodeURIComponent(JSON)) → 页面解析 → title 回程
//   S3  localStorage 跨重启(页面侧写入/读回)
//   S4  CORS 诊断矩阵(页面侧 fetch 公网翻译端点)
//   S5  端到端:hash 发文本 → 页面翻译 → title 回中文译文
//
// 设计:与 lingua_chat.js 的 hash 通道同构(SetURL 只换 fragment;title="LCT"+id+JSON 回程),
// 但**不依赖本地桥**:面板直载远程托管页。
//
// 仿真:globalThis.POC 暴露 API;仿真设置 POC_NO_AUTORUN=1 后手动驱动。
// 游戏:默认 1.0s 后自启,自动跑一遍 S2/S3/S4/S5 序列,结果全部经 $.Msg("[POC] …") 进引擎日志。
(function () {
  "use strict";

  var PAGE_URL = (typeof globalThis !== "undefined" && globalThis.POC_PAGE_URL) ||
    "https://c1375rick.github.io/babeltower-poc-pages/index.html";
  var PANEL_ID = "LCTPocPanel";
  var TIMEOUT_MS = 20000;
  var ECHO_COUNT = (typeof globalThis !== "undefined" && globalThis.POC_ECHO_COUNT) || 12;
  var STEP_SECONDS = (typeof globalThis !== "undefined" && globalThis.POC_STEP_SECONDS) || 5;
  var LOG_PREFIX = "[POC] ";

  var State = {
    panel: null,
    panelBound: false,
    busBound: false,
    seq: 0,
    pending: null,
    hashBase: "",
    alive: false,
    aliveTitle: "",
    events: [],     // {at, title}
    results: [],    // {label, ok, payload, ms}
    started: false,
  };

  function nowMs() { return Date.now ? Date.now() : 0; }
  function log(m) { try { $.Msg(LOG_PREFIX + String(m)); } catch (e) {} }

  function isValid(p) { return !!(p && (!p.IsValid || p.IsValid())); }

  function getRoot() {
    var r = $.GetContextPanel();
    while (r && r.GetParent && r.GetParent()) r = r.GetParent();
    return r;
  }

  function findChild(root, id) {
    if (!isValid(root) || typeof root.FindChildTraverse !== "function") return null;
    try { var f = root.FindChildTraverse(id); return isValid(f) ? f : null; } catch (e) { return null; }
  }

  function getPanel() {
    if (isValid(State.panel) && typeof State.panel.SetURL === "function") return State.panel;
    State.panel = findChild(getRoot(), PANEL_ID);
    if (!isValid(State.panel)) { log("panel NOT found (id=" + PANEL_ID + ")"); return null; }
    if (typeof State.panel.SetURL !== "function") { log("panel has no SetURL"); return null; }
    return State.panel;
  }

  var EVENTS = [
    "HTMLContentLoaded", "HTMLLoadPage", "HTMLStartRequest", "HTMLFinishRequest",
    "HTMLURLChanged", "HTMLChangedTitle", "HTMLTitle"
  ];

  function ensureEvents(panel) {
    if (!State.busBound && typeof $.RegisterForUnhandledEvent === "function") {
      State.busBound = true;
      for (var i = 0; i < EVENTS.length; i++) { try { $.RegisterForUnhandledEvent(EVENTS[i], onTitle); } catch (e) {} }
    }
    if (panel && !State.panelBound && typeof $.RegisterEventHandler === "function") {
      State.panelBound = true;
      try { $.RegisterEventHandler("HTMLTitle", panel, onTitle); log("panel-bound HTMLTitle registered"); }
      catch (e) { log("HTMLTitle register FAILED: " + (e && e.message)); }
    }
  }

  function extractText(a) {
    if (a == null) return "";
    try { if (typeof a === "string") return a; } catch (e) {}
    try { if (typeof a.title === "string") return a.title; } catch (e) {}
    try { if (typeof a.url === "string") return a.url; } catch (e) {}
    try { if (typeof a.text === "string") return a.text; } catch (e) {}
    try { if (typeof a.GetAttributeString === "function") return String(a.GetAttributeString("title", "") || ""); } catch (e) {}
    return "";
  }

  function onTitle(a, b, c, d) {
    var t = extractText(a) || extractText(b) || extractText(c) || extractText(d);
    if (!t) return;
    State.events.push({ at: nowMs(), title: String(t) });
    log("title=" + String(t).slice(0, 400));
    if (!State.alive && String(t).indexOf("POC-ALIVE") === 0) {
      State.alive = true;
      State.aliveTitle = String(t);
      log("S1 ALIVE at t=" + nowMs());
    }
    var p = State.pending;
    if (!p) return;
    var marker = "LCT" + p.id;
    var idx = String(t).indexOf(marker);
    if (idx === -1) return;
    var payload = null;
    try { payload = JSON.parse(String(t).slice(idx + marker.length)); } catch (e) {}
    if (!payload) return;
    State.pending = null;
    var ms = nowMs() - p.at;
    State.results.push({ label: p.label, ok: !!payload.ok, ms: ms, payload: payload });
    log("reply " + p.label + " " + (payload.ok ? "ok" : "FAIL") + " " + ms + "ms " + JSON.stringify(payload).slice(0, 200));
    try { if (p.cb) p.cb(payload, ms); } catch (e2) {}
  }

  // label = 诊断标签;op = 命令名(页面按 op 路由);q = 去重 nonce(与桥页协议一致)
  function send(label, op, d, cb) {
    var panel = getPanel();
    if (!panel) { log("send skipped (no panel): " + label); return null; }
    if (State.pending) { var old = State.pending; State.pending = null; log("superseded pending " + old.label); }
    var id = "p" + (++State.seq);
    State.pending = { id: id, label: label, at: nowMs(), cb: cb };
    var payload = { q: "h" + State.seq + "_" + nowMs(), id: id, op: String(op), d: d || {} };
    if (!State.hashBase) State.hashBase = PAGE_URL + "?boot=1";
    var url = State.hashBase + "#LCTQ:" + encodeURIComponent(JSON.stringify(payload));
    try { panel.SetURL(url); } catch (e) { log("SetURL THREW: " + (e && e.message)); }
    return id;
  }

  function boot() {
    if (State.started) return;
    State.started = true;
    var panel = getPanel();
    if (!panel) { try { $.Schedule(1.0, bootAgain); } catch (e) { bootAgain(); } return; }
    ensureEvents(panel);
    // EXP-6726b 同款:不可见/非激活面板不加载网页
    try { panel.visible = true; } catch (e) {}
    try { panel.style.opacity = "1"; } catch (e) {}
    try { if (typeof panel.Activate === "function") panel.Activate(); } catch (e) {}
    try { if (typeof panel.SetFocus === "function") panel.SetFocus(); } catch (e) {}
    State.hashBase = PAGE_URL + "?boot=1";
    try {
      panel.SetURL(State.hashBase);
      log("S1 SetURL " + PAGE_URL + " (boot)");
    } catch (e) { log("S1 SetURL THREW: " + (e && e.message)); return; }
    if (!(typeof globalThis !== "undefined" && globalThis.POC_NO_AUTORUN)) {
      try { $.Schedule(6.0, autoSequence); } catch (e) {}
    }
  }

  function bootAgain() { State.started = false; boot(); }

  // ---------------- 自动序列(仅游戏内;仿真用 POC_NO_AUTORUN=1 手动驱动) ----------------
  function autoSequence() {
    var plan = [];
    // S3:先读回上一次写入的值(跨重启),再写新值
    plan.push({ label: "3-load-before", op: "load", d: { k: "pocKey" } });
    plan.push({ label: "3-store", op: "store", d: { k: "pocKey", v: "hello-" + new Date().toISOString().slice(0, 10) } });
    plan.push({ label: "3-load-after", op: "load", d: { k: "pocKey" } });
    // S2:12 次 echo 回环
    for (var i = 1; i <= ECHO_COUNT; i++) {
      plan.push({ label: "2-echo", op: "echo", d: { text: "ping-" + i } });
    }
    // S4:CORS 矩阵
    var names = ["bing-edge", "openai", "deepl-free", "google-v2", "mymemory", "libretranslate-com", "libretranslate-terraprint"];
    for (var j = 0; j < names.length; j++) plan.push({ label: "4-cors-" + names[j], op: "cors", d: { endpoint: names[j] } });
    // S5:端到端翻译(mymemory 免 Key)
    plan.push({ label: "5-translate", op: "translate", d: { provider: "mymemory", text: "hello world", target: "zh-CN" } });

    var idx = 0;
    function step() {
      if (idx >= plan.length) {
        log("auto sequence done; results=" + JSON.stringify(State.results.map(function (r) {
          return r.label + ":" + (r.ok ? "ok" : "FAIL") + ":" + r.ms + "ms";
        })));
        return;
      }
      var it = plan[idx++];
      send(it.label, it.op, it.d);
      try { $.Schedule(STEP_SECONDS, step); } catch (e) { setTimeout(step, STEP_SECONDS * 1000); }
    }
    step();
  }

  var API = {
    boot: boot, send: send, State: State, log: log,
    pageUrl: PAGE_URL,
    echoLatencies: function () {
      return State.results.filter(function (r) { return r.label === "2-echo"; }).map(function (r) { return r.ms; });
    },
  };
  try { globalThis.POC = API; } catch (e) {}
  try { window.POC = API; } catch (e) {}

  if (!(typeof globalThis !== "undefined" && globalThis.POC_NO_AUTORUN)) {
    try { $.Schedule(1.0, boot); } catch (e) { boot(); }
  }
})();
