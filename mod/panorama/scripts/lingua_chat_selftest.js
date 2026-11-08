// Babel Tower - 游戏内自检(手动命令触发,2026-11-08)
// ------------------------------------------------------------------
// 触发:对局内聊天输入 !lctselftest(见 lingua_chat.js handleChatSubmit)。不发送聊天消息。
// 装载:必须晚于 lingua_chat.vjs_c —— 经 globalThis.LCTNS 懒取宿主符号(不参与 p4 分区契约)。
// 输出:逐项经宿主 log()(=> "[LCT] $.Msg" 控制台)打印 "[LCT-SELFTEST] ...";末尾汇总经
//       bridgePost("selftest", {...}) 送桥,由桥日志留档(桥端 runBtipcGet 有 selftest 分支)。
// 分级:env.* / ui.* 为本地只读;bridge.* 需要桥;pipe.hud 需对局内(无 HUD 容器则 skip);
//       outgoing.* 有副作用(outgoing.submit 会走真实发送链、可能真发一条消息)——全部经手动
//       命令触发,请在训练场/单人跑;!lctselftest quick 只跑只读项(跳过 outgoing.*)。
// 设计:步骤顺序执行,每步硬超时;结果 pass|fail|skip。任一环境不满足即 skip(不误报 FAIL)。
(() => {
  "use strict";
  const PREFIX = "[LCT-SELFTEST]";

  function H() { return globalThis.LCTNS || {}; }
  function hostLog(m) {
    const L = H();
    try { if (typeof L.log === "function") { L.log(PREFIX + " " + m); return; } } catch (e) {}
    try { $.Msg(PREFIX + " " + m); } catch (e2) {}
  }
  function errMsg(e) { return (e && e.message) ? e.message : String(e); }
  function now() { const L = H(); try { return L.nowMs ? L.nowMs() : Date.now(); } catch (e) { return Date.now(); } }
  function baseVersion(x) { return String(x || "").split("-")[0]; }

  // ---------------- 结果记录 ----------------
  function Reporter() { this.items = []; this.t0 = now(); }
  Reporter.prototype.add = function (name, status, detail) {
    this.items.push({ name: name, status: status, detail: detail || "" });
    hostLog((status === "pass" ? "PASS" : status === "skip" ? "SKIP" : "FAIL") +
      " " + name + (detail ? " | " + detail : ""));
  };
  Reporter.prototype.summary = function () {
    let p = 0, f = 0, s = 0;
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].status === "pass") p++;
      else if (this.items[i].status === "skip") s++;
      else f++;
    }
    return { pass: p, fail: f, skip: s, total: this.items.length, ms: now() - this.t0, items: this.items };
  };

  // ---------------- 顺序执行器(每步硬超时) ----------------
  function runSteps(steps, report, done) {
    let i = 0;
    function next() {
      if (i >= steps.length) { done(report.summary()); return; }
      const step = steps[i++];
      let settled = false;
      let timer = null;
      function finish(status, detail) {
        if (settled) return;
        settled = true;
        if (timer !== null) { try { $.CancelScheduled(timer); } catch (eC) {} }
        report.add(step.name, status, detail);
        next();
      }
      try { timer = $.Schedule(step.timeout || 20, function () { finish("fail", "timeout " + (step.timeout || 20) + "s"); }); }
      catch (e) { timer = null; }
      try { step.run(finish); }
      catch (e) { finish("fail", "threw: " + errMsg(e)); }
    }
    next();
  }

  // ---------------- 检查项 ----------------
  function buildSteps(ctx) {
    const steps = [];

    steps.push({ name: "env.globals", timeout: 5, run: function (finish) {
      const L = H(); const miss = [];
      if (typeof $ === "undefined" && typeof globalThis.$ === "undefined") miss.push("$");
      if (!L || typeof L !== "object") miss.push("LCTNS");
      if (typeof L.log !== "function") miss.push("log");
      if (typeof L.bridgePost !== "function") miss.push("bridgePost");
      if (!L.State) miss.push("State");
      if (typeof L.BTIPC !== "object") miss.push("BTIPC");
      finish(miss.length ? "fail" : "pass", miss.length ? "missing: " + miss.join(",") : "all present");
    } });

    steps.push({ name: "env.fallback", timeout: 5, run: function (finish) {
      const miss = [];
      if (typeof globalThis.LCT_GAMENAMES_FALLBACK === "undefined") miss.push("gamenames_fallback");
      if (typeof globalThis.LCT_QUICKCHAT_FALLBACK_TEMPLATES === "undefined") miss.push("quickchat_fallback");
      finish(miss.length ? "fail" : "pass", miss.length ? "missing: " + miss.join(",") : "fallback data present");
    } });

    steps.push({ name: "env.version", timeout: 5, run: function (finish) {
      const v = H().VERSION;
      finish(v ? "pass" : "fail", "VERSION=" + v);
    } });

    steps.push({ name: "env.config", timeout: 5, run: function (finish) {
      const c = H().State && H().State.cfg;
      if (!c) return finish("fail", "State.cfg missing");
      const keys = ["provider", "displayMode", "targetLanguage", "outgoing", "outgoingTarget"];
      const miss = keys.filter(function (k) { return typeof c[k] === "undefined"; });
      finish(miss.length ? "fail" : "pass",
        miss.length ? "missing keys: " + miss.join(",") : ("provider=" + c.provider + " mode=" + c.displayMode));
    } });

    steps.push({ name: "ui.lang", timeout: 5, run: function (finish) {
      const L = H();
      if (typeof L.applyUILang !== "function") return finish("skip", "applyUILang missing");
      try { L.applyUILang(); finish("pass", "no throw"); }
      catch (e) { finish("fail", "threw: " + errMsg(e)); }
    } });

    steps.push({ name: "bridge.health", timeout: 15, run: function (finish) {
      const L = H();
      if (typeof L.bridgePost !== "function") return finish("skip", "bridgePost missing");
      L.bridgePost("health", {}, function (res) {
        if (res && (res.ok === true || res.ok === "true")) {
          ctx.health = res;
          finish("pass", "provider=" + (res.provider || "?") + " version=" + (res.version || "?"));
        } else {
          finish("fail", "res=" + JSON.stringify(res || null).slice(0, 120));
        }
      });
    } });

    steps.push({ name: "bridge.version", timeout: 5, run: function (finish) {
      const v = H().VERSION || "";
      const bv = (ctx.health && ctx.health.version) || "";
      if (!bv) return finish("skip", "no bridge version (health unavailable)");
      finish(baseVersion(v) === baseVersion(bv) ? "pass" : "fail", "src=" + v + " bridge=" + bv);
    } });

    steps.push({ name: "bridge.translate", timeout: 30, run: function (finish) {
      const L = H();
      if (typeof L.bridgePost !== "function") return finish("skip", "bridgePost missing");
      L.bridgePost("translate", {
        operation: "translate", text: "hello world", sourceLanguage: "auto", targetLanguage: "zh-Hans", timeoutMs: 15000,
      }, function (res) {
        if (res && res.translation) finish("pass", "translated=" + JSON.stringify(String(res.translation).slice(0, 40)));
        else finish("fail", "res=" + JSON.stringify(res || null).slice(0, 120));
      });
    } });

    steps.push({ name: "pipe.hud", timeout: 15, run: function (finish) {
      const L = H();
      if (typeof L.injectHudTestMessage !== "function") return finish("skip", "injectHudTestMessage missing");
      try { if (typeof L.resolveHudMessages === "function") L.resolveHudMessages(); } catch (eR) {}
      const n = (L.State && L.State.hudMessages) ? L.State.hudMessages.length : 0;
      if (!n) return finish("skip", "no HUD chat container (not in-match?)");
      try { L.injectHudTestMessage("hello selftest " + String(now() % 100000)); }
      catch (e) { return finish("fail", "inject threw: " + errMsg(e)); }
      finish("pass", "injected into " + n + " container(s)");
    } });

    steps.push({ name: "outgoing.translate", timeout: 30, run: function (finish) {
      if (ctx.quick) return finish("skip", "quick mode");
      const L = H();
      if (typeof L.translateOutgoing !== "function") return finish("skip", "translateOutgoing missing");
      if (L.BTIPC && typeof L.BTIPC.busy === "function" && L.BTIPC.busy()) return finish("skip", "BTIPC busy");
      try {
        L.translateOutgoing("hello selftest", function (translated) {
          const t = translated ? String(translated).trim() : "";
          finish(t ? "pass" : "fail", t ? ("translated=" + JSON.stringify(t.slice(0, 60))) : "no translation (fallback original)");
        });
      } catch (e) { finish("fail", "threw: " + errMsg(e)); }
    } });

    steps.push({ name: "outgoing.submit", timeout: 20, run: function (finish) {
      if (ctx.quick) return finish("skip", "quick mode");
      const L = H();
      if (typeof L.triggerStockSubmit !== "function" || typeof L.findChild !== "function") return finish("skip", "submit helpers missing");
      const input = L.findChild(L.getRoot(), L.CHAT_INPUT_ID);
      if (!input) return finish("skip", "no chat input panel (not in-match?)");
      let orig = null, dispatched = null, restored = false;
      try { orig = $.DispatchEvent; } catch (e) { return finish("skip", "no $.DispatchEvent"); }
      function restore() { if (restored) return; restored = true; try { if (orig) $.DispatchEvent = orig; } catch (e) {} }
      try {
        $.DispatchEvent = function (name, panel) {
          dispatched = { name: String(name), target: panel };
          try { return orig.apply($, arguments); } catch (e) {}
        };
      } catch (e) { return finish("skip", "cannot wrap DispatchEvent"); }
      try { input.text = "lct selftest"; } catch (e) {}
      try { L.triggerStockSubmit(input); }
      catch (e) { restore(); return finish("fail", "threw: " + errMsg(e)); }
      try { if (typeof L.clearInput === "function") L.clearInput(); } catch (e) {}
      restore();
      finish(dispatched ? "pass" : "fail", dispatched ? ("dispatched " + dispatched.name) : "no submit event observed");
    } });

    return steps;
  }

  // ---------------- 汇总送桥留档 ----------------
  function sendReport(summary) {
    const L = H();
    if (typeof L.bridgePost !== "function") return;
    const lines = summary.items.map(function (it) {
      return it.status.toUpperCase() + " " + it.name + (it.detail ? " | " + it.detail : "");
    });
    const text = "pass=" + summary.pass + " fail=" + summary.fail + " skip=" + summary.skip +
      " total=" + summary.total + " ms=" + summary.ms + "\n" + lines.join("\n");
    try {
      L.bridgePost("selftest",
        { report: text, pass: summary.pass, fail: summary.fail, skip: summary.skip, version: L.VERSION || "" },
        function (res) {
          hostLog("report sent: " + ((res && res.ok) ? "ok" : JSON.stringify(res || null).slice(0, 80)));
        });
    } catch (e) { hostLog("report send failed: " + errMsg(e)); }
  }

  // ---------------- 入口 ----------------
  function runSelfTest(opts) {
    opts = opts || {};
    if (globalThis.__lctSelfTestRunning) { hostLog("already running, ignored"); return; }
    globalThis.__lctSelfTestRunning = true;
    const ctx = { quick: !!opts.quick };
    const report = new Reporter();
    hostLog("START version=" + (H().VERSION || "?") + (opts.quick ? " (quick)" : ""));
    runSteps(buildSteps(ctx), report, function (summary) {
      globalThis.__lctSelfTestRunning = false;
      hostLog("SUMMARY pass=" + summary.pass + " fail=" + summary.fail + " skip=" + summary.skip +
        " total=" + summary.total + " (" + summary.ms + "ms)");
      sendReport(summary);
      if (typeof opts.onDone === "function") { try { opts.onDone(summary); } catch (e) {} }
    });
  }

  globalThis.LCTNS = globalThis.LCTNS || {};
  globalThis.LCTNS.runSelfTest = runSelfTest;
})();
