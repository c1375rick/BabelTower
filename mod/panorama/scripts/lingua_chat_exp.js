// Babel Tower - 实验探针区(EXP6727~EXP6738)—— P4a 分区产物(2026-10-12)
// ------------------------------------------------------------------
// 本文件全部代码由 lingua_chat.js 实验探针区纯搬移而来(零逻辑改动),评审与证据见
// docs/p4-partition-review.md。装载顺序必须在 lingua_chat.vjs_c 之后(chat.xml/hudchat.xml
// 已按此排序):核心先求值并发布 globalThis.LCTNS,本文件头部别名导入、尾部向核心晚绑定派发口
// expCall 发布 6 个 /bt* 命令入口;本文件缺失时核心 expCall 自动降级为无操作。
(() => {
  "use strict";

  // 别名导入核心顶层绑定(与核心 LCTNS 发布名单逐项对账,tests/lc_p4_partition.test.js 钉)
  const L = globalThis.LCTNS || {};
  const { BRIDGE_HOST, BRIDGE_PORT, BTIPC, CHAT_INPUT_ID, LOCAL_CLIENT_ID, State, VERSION, boot, childAt, childCount, clearInput, collectText, expErr, findChild, findClass, getRoot, hasClass, isValid, log, nowMs, readMessageRow, resolveChatMessages, resolveHudMessages, resolveLobbyMessages, safeText, t, triggerStockSubmit } = L;

  // ============= EXP6727: Panorama IPC 检查表探针(检查表: 新建 文本文档.txt A~E/I) =============
  // 运行时机: boot 后 5s,每会话一次。结果双路上报:
  //   ① $.Msg -> 游戏 console.log -> 桥 tail(logs/bridge.log 中 [game] 行)
  //   ② Image SetImage(/probe?d=..) 信标 -> 桥日志 PROBE 行(同时验证出站通道)
  // 两项都到 = 出站链路双向冗余可用;后续回填 docs/ipc-checklist-6726.md 状态列。
  function expSendBeacon(data) {
    try {
      State.expSeq = (State.expSeq || 0) + 1;
      const idx = State.expSeq % 3; // 3 个面板轮换,避免连续改 src 互相取消加载
      const id = "LCTBeacon" + idx;
      let p = null;
      try { p = findChild(getRoot(), id); } catch (e0) {}
      if (!isValid(p)) {
        try { p = $.CreatePanel("Image", getRoot(), id); } catch (e1) {}
        if (isValid(p)) { try { p.visible = false; p.style.width = "2px"; p.style.height = "2px"; } catch (e2) {} }
      }
      if (!isValid(p) || typeof p.SetImage !== "function") return;
      const url = "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe?seq=" + State.expSeq +
        "&d=" + encodeURIComponent(String(data || "").slice(0, 3500));
      p.SetImage(url);
    } catch (e) {}
  }

  function expPump() {
    if (State.expPumping) return;
    if (!State.expQueue || !State.expQueue.length) return;
    State.expPumping = true;
    const msg = State.expQueue.shift();
    expSendBeacon(msg);
    // 0.2s 间隔: 信标自身也是一次高频出站小考(连续 10+ 条不丢)
    try {
      $.Schedule(0.2, function () { State.expPumping = false; expPump(); });
    } catch (e) { State.expPumping = false; }
  }

  function dlog(msg) {
    log("exp6727: " + msg);
    try {
      if (!State.expQueue) State.expQueue = [];
      if (State.expQueue.length < 400) State.expQueue.push(String(msg));
      expPump();
    } catch (e) {}
  }

  // 长枚举结果分片(每片 ~500 字符,避免单行过长被引擎截断)
  function expChunk(prefix, s) {
    const size = 500;
    for (let i = 0; i < s.length; i += size) {
      dlog(prefix + "#" + (i / size) + ": " + s.slice(i, i + size));
    }
    if (!s.length) dlog(prefix + "#0: <empty>");
  }

  // 从 GameInterfaceAPI 或全局找函数(返回 {o,f},调用时用 f.apply(o) 保 this 绑定)
  function expFindFn(name) {
    try {
      if (typeof GameInterfaceAPI !== "undefined" && GameInterfaceAPI && typeof GameInterfaceAPI[name] === "function") {
        return { o: GameInterfaceAPI, f: GameInterfaceAPI[name] };
      }
    } catch (e) {}
    try {
      if (typeof globalThis[name] === "function") return { o: globalThis, f: globalThis[name] };
    } catch (e) {}
    return null;
  }

  function runExp6727() {
    if (State.exp6727Done) return;
    State.exp6727Done = true;
    const ts = String(nowMs()).slice(-6);
    dlog("start v" + VERSION + " ts=" + ts);

    // ===== A. Panorama -> Engine 基础接口 =====
    let gia = null;
    try { gia = (typeof GameInterfaceAPI !== "undefined") ? GameInterfaceAPI : null; } catch (e) {}
    dlog("A1 typeof GameInterfaceAPI=" + (typeof GameInterfaceAPI));
    if (gia) {
      const keys = [];
      try {
        for (const k in gia) { try { keys.push(k + ":" + typeof gia[k]); } catch (e2) {} }
      } catch (e) {}
      expChunk("A1 gia keys", keys.join(","));
    }
    // A2: ConsoleCommand 执行无害命令(echo,输出进 console.log 供桥 tail 验证)
    const cmd = expFindFn("ConsoleCommand");
    if (cmd) {
      try {
        const r = cmd.f.apply(cmd.o, ["echo BT_CMD_OK_" + ts]);
        dlog("A2 ConsoleCommand(echo) returned " + String(r));
      } catch (e) { dlog("A2 ConsoleCommand threw: " + expErr(e)); }
    } else {
      dlog("A2 ConsoleCommand missing");
    }
    // A3/A4: 设置写入-回读 roundtrip(A6: 读回值再 echo 出去 = 设置->桥)
    const setS = expFindFn("SetSettingString");
    const getS = expFindFn("GetSettingString");
    dlog("A3/A4 GetSettingString=" + !!getS + " SetSettingString=" + !!setS);
    if (setS && getS) {
      const wv = "BT_SET_" + ts;
      let wr = "n/a";
      try { wr = String(setS.f.apply(setS.o, ["lct_probe", wv])); } catch (e) { wr = "threw: " + expErr(e); }
      let rv = "n/a";
      try { rv = String(getS.f.apply(getS.o, ["lct_probe", ""])); }
      catch (e1) { try { rv = String(getS.f.apply(getS.o, ["lct_probe"])); } catch (e2) { rv = "threw: " + expErr(e2); } }
      dlog("A4 set(lct_probe," + wv + ") ret=" + wr);
      dlog("A3 readback=" + rv + " match=" + (rv === wv));
      if (cmd) {
        try { cmd.f.apply(cmd.o, ["echo BT_A6 " + rv]); dlog("A6 echo of readback sent (watch bridge)"); }
        catch (e) { dlog("A6 echo threw: " + expErr(e)); }
      }
    }
    // A5: 命令行参数查询
    const hclp = expFindFn("HasCommandLineParm");
    if (hclp) {
      try {
        const b = hclp.f.apply(hclp.o, ["-novid"]);
        dlog("A5 HasCommandLineParm(-novid)=" + String(b) + " typeof=" + typeof b);
      } catch (e) { dlog("A5 threw: " + expErr(e)); }
    } else { dlog("A5 HasCommandLineParm missing"); }
    const gclp = expFindFn("GetCommandLineParm");
    dlog("A5 GetCommandLineParm present=" + !!gclp);

    // ===== I0. 全局面枚举(找现成 C++ -> Panorama 入口) =====
    try {
      const g = [];
      try { for (const k in globalThis) { try { g.push(k + ":" + typeof globalThis[k]); } catch (e2) {} } } catch (e) {}
      expChunk("I0 globals", g.join(","));
    } catch (e) { dlog("I0 globals failed: " + expErr(e)); }

    // ===== B. Console/Log 通道(桥 tail 自动验收: BT_ 前缀行) =====
    // B4 长度: 100/500/1000 字符,看 console.log 是否截断
    function rawMsg(m) { try { $.Msg(m); } catch (e) {} }
    function rep(ch, n) { return new Array(n + 1).join(ch); }
    rawMsg("BT_LEN100 " + rep("x", 91));   // 总长 100
    rawMsg("BT_LEN500 " + rep("x", 491));   // 总长 500
    rawMsg("BT_LEN1000 " + rep("x", 990));  // 总长 1000
    dlog("B4 len100/500/1000 sent");
    // B5 高频: 连发 10 条(不加间隔,测引擎/文件层丢包)
    for (let i = 1; i <= 10; i += 1) rawMsg("BT_BURST " + i + "/10 ts=" + ts);
    dlog("B5 burst x10 sent");
    // B6 特殊字符: 中文/日文/emoji/JSON/引号/竖线 + 原生换行(两行,第二行无标记 -> 验证桥 tail 续行)
    let uni = "";
    try {
      uni = JSON.stringify({ zh: "中文测试", ja: "日本語", emoji: "\ud83d\ude00", quote: "he said \"hi\"", pipe: "a|b|c" });
    } catch (e) { uni = "{\"err\":\"" + expErr(e) + "\"}"; }
    rawMsg("BT_UNI " + uni);
    rawMsg("BT_NL part1 ts=" + ts + "\npart2-continuation ts=" + ts);
    dlog("B6 unicode/json/newline sent");

    // ===== C. Clipboard =====
    try {
      const clipHits = [];
      const roots = [["gia", gia], ["$", $], ["global", globalThis]];
      for (const rr of roots) {
        try {
          for (const k in rr[1]) {
            if (String(k).toLowerCase().indexOf("clip") !== -1) clipHits.push(rr[0] + "." + k + ":" + typeof rr[1][k]);
          }
        } catch (e) {}
      }
      dlog("C1 clip APIs: " + (clipHits.length ? clipHits.join(",") : "NONE"));
      // 找到写/读口就实际交换一次
      const clipNames = ["SetClipboardText", "ClipboardCopy", "CopyToClipboard", "ClipboardSet", "GetClipboardText", "ClipboardGet", "ReadClipboard", "PasteFromClipboard"];
      let clipW = null;
      let clipR = null;
      for (const n of clipNames) {
        const fn = expFindFn(n);
        if (!fn) continue;
        if (!clipW && n.toLowerCase().indexOf("set") !== -1) clipW = { fn: fn, name: n };
        if (!clipR && (n.toLowerCase().indexOf("get") !== -1 || n.toLowerCase().indexOf("read") !== -1)) clipR = { fn: fn, name: n };
      }
      if (clipW) {
        const cv = "BT_CLIP_" + ts;
        try {
          const rr2 = clipW.fn.f.apply(clipW.fn.o, [cv]);
          dlog("C2 " + clipW.name + "(\"" + cv + "\") returned " + String(rr2) + " (check Windows clipboard)");
        } catch (e) { dlog("C2 " + clipW.name + " threw: " + expErr(e)); }
      } else { dlog("C2 no write API found (C1 list)"); }
      if (clipR) {
        try {
          const rv2 = clipR.fn.f.apply(clipR.fn.o, []);
          dlog("C3 " + clipR.name + "() read = " + String(rv2).slice(0, 120));
        } catch (e) { dlog("C3 " + clipR.name + " threw: " + expErr(e)); }
      } else { dlog("C3 no read API found (C1 list)"); }
    } catch (e) { dlog("C section failed: " + expErr(e)); }

    // ===== D. CitadelHTMLPanel =====
    let hp = null;
    try { hp = $.CreatePanel("CitadelHTMLPanel", getRoot(), "LCTHtmlProbe"); }
    catch (e) { dlog("D1 CreatePanel threw: " + expErr(e)); }
    dlog("D1 CitadelHTMLPanel created=" + !!hp);
    if (hp) {
      try {
        const pn = [];
        try { for (const k in hp) { try { pn.push(k + ":" + typeof hp[k]); } catch (e2) {} } } catch (e) {}
        expChunk("D2/D3 props", pn.join(","));
      } catch (e) { dlog("D2/D3 enumerate failed: " + expErr(e)); }
      // D5~D8 重点方法点名
      const watch = ["SetURL", "Navigate", "NavigateToURL", "LoadPage", "Load", "Evaluate", "Execute", "EvalScript", "RunScript", "PostMessage", "SendMessage", "SetReadyForDisplay", "BReadyForDisplay", "SetImage"];
      const present = [];
      const absent = [];
      for (const m of watch) {
        try { if (typeof hp[m] === "function") present.push(m); else absent.push(m); }
        catch (e) { absent.push(m); }
      }
      dlog("D5-D8 present: " + present.join(","));
      dlog("D5-D8 missing: " + absent.join(","));
      // D9/D10 title / location 回读
      try { dlog("D9 title=" + String(hp.title)); } catch (e) { dlog("D9 title threw: " + expErr(e)); }
      try { dlog("D10 location=" + String(hp.location)); } catch (e) { dlog("D10 location threw: " + expErr(e)); }
      // D4: SetURL 是否真的产生请求(桥日志出现 PROBE seq=cit1 即活)
      if (present.indexOf("SetURL") !== -1) {
        try {
          hp.SetURL("http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe?seq=cit1&d=D4-seturl-reached");
          dlog("D4 SetURL sent (watch bridge PROBE seq=cit1)");
        } catch (e) { dlog("D4 SetURL threw: " + expErr(e)); }
      }
      // D12: 若有执行 JS 能力,试无害脚本(回读 title 验证)
      const execName = present.indexOf("Evaluate") !== -1 ? "Evaluate" : (present.indexOf("Execute") !== -1 ? "Execute" : null);
      if (execName) {
        try {
          const er = hp[execName]("document.title='BT_PAGE_'+'JS'");
          dlog("D12 " + execName + "(js) returned " + String(er));
        } catch (e) { dlog("D12 " + execName + " threw: " + expErr(e)); }
      }
      // D11: 页面 -> Panorama 回调面
      const evReg = ["RegisterForReadyEvents", "RegisterForUnhandledEvent", "SetPageEvent", "AddEventListener"];
      for (const en of evReg) {
        try { if (typeof hp[en] === "function") dlog("D11 has " + en); } catch (e) {}
      }
    }

    // ===== E. Panorama 事件总线 =====
    try {
      if (typeof $.RegisterForUnhandledEvent === "function") {
        const h = $.RegisterForUnhandledEvent("LCT_DIAG_EVT", function () {
          dlog("E1 custom event FIRED");
        });
        dlog("E1 RegisterForUnhandledEvent ok, handle=" + String(h));
        const disp = [];
        try {
          for (const k in $) {
            const kl = String(k).toLowerCase();
            if (kl.indexOf("dispatch") !== -1 || kl.indexOf("fire") !== -1 || kl.indexOf("trigger") !== -1) disp.push(k);
          }
        } catch (e) {}
        dlog("E1 dispatch-ish $ fns: " + (disp.length ? disp.join(",") : "NONE"));
        if (disp.length) {
          try { $[disp[0]]("LCT_DIAG_EVT"); dlog("E1 fired via " + disp[0] + " (if no FIRED line, bus is receive-only from C++)"); }
          catch (e) { dlog("E1 fire via " + disp[0] + " threw: " + expErr(e)); }
        }
      } else { dlog("E1 $.RegisterForUnhandledEvent missing"); }
    } catch (e) { dlog("E1 failed: " + expErr(e)); }

    dlog("done (check bridge logs/bridge.log for PROBE/[game] lines)");
  }

  // ============= EXP6728: 入站三连探针(唯一目标 J2: Bridge → Panorama) =============
  // ① CitadelHTMLPanel.RunScriptInPanelContext — 能否执行 JS/有无返回值/完整异常
  // ② Object.getOwnPropertyNames 扫非枚举盲区: globalThis / panorama / $ / GameEvents
  // ③ RegisterForUnhandledEvent 白名单批量探测: VALID/INVALID/THROWS_OTHER + 触发观察
  // 本轮不碰: AsyncWebRequest / SetURL / title / 布局尺寸 / ConsoleCommand(已判死,收益低)
  // 上报同 6727: $.Msg(console.log 尾随) + /probe 信标双路。
  function runExp6728() {
    if (State.exp6728Done) return;
    State.exp6728Done = true;
    const ts = String(nowMs()).slice(-6);
    dlog("exp6728 start v" + VERSION + " ts=" + ts);

    // ---- ① RunScriptInPanelContext(第一优先级) ----
    try {
      let hp8 = null;
      try { hp8 = $.CreatePanel("CitadelHTMLPanel", getRoot(), "LCTHtmlProbe8"); }
      catch (e0) { dlog("28-① create threw: " + expErr(e0)); }
      dlog("28-① CitadelHTMLPanel created=" + !!hp8);
      if (hp8) {
        try {
          dlog("28-① paneltype=" + String(hp8.paneltype) + " type=" + String(hp8.type) + " layoutfile=" + String(hp8.layoutfile));
        } catch (e) {}
        let rs = null;
        try { rs = hp8.RunScriptInPanelContext; } catch (e) { dlog("28-① RSI access threw: " + expErr(e)); }
        dlog("28-① RunScriptInPanelContext typeof=" + typeof rs + " arity=" + (typeof rs === "function" ? rs.length : "-"));
        if (typeof rs === "function") {
          const tries = [
            ["return123", "return 123"],
            ["expr", "1+1"],
            ["console", "console.log('BT_RSTEST_123 ts=" + ts + "')"],
            ["title", "document.title = 'RSTEST_TITLE'"],
          ];
          for (const tt of tries) {
            try {
              const r = hp8.RunScriptInPanelContext(tt[1]);
              dlog("28-① RSI[" + tt[0] + "] returned typeof=" + typeof r + " val=" + String(r).slice(0, 120));
            } catch (e) { dlog("28-① RSI[" + tt[0] + "] THREW: " + expErr(e)); }
          }
          // 变体: 双参(脚本, 回调)
          try {
            const r2 = hp8.RunScriptInPanelContext("1+1", function (v) { dlog("28-① RSI cb: " + String(v)); });
            dlog("28-① RSI(2-arg) returned " + String(r2));
          } catch (e) { dlog("28-① RSI(2-arg) THREW: " + expErr(e)); }
        }
        // 同轮漏网的 Data() 方法顺带点名
        try {
          const df = hp8.Data;
          dlog("28-① Data typeof=" + typeof df + " arity=" + (typeof df === "function" ? df.length : "-"));
          if (typeof df === "function") {
            try { dlog("28-① Data() => " + String(hp8.Data()).slice(0, 120)); }
            catch (e2) { dlog("28-① Data() THREW: " + expErr(e2)); }
          }
        } catch (e) { dlog("28-① Data access THREW: " + expErr(e)); }
      }
    } catch (e) { dlog("28-① section failed: " + expErr(e)); }

    // ---- ② 隐藏全局 API 扫描(for..in 只见可枚举,这里用 getOwnPropertyNames) ----
    const KW28 = ["game", "settin", "command", "clip", "file", "http", "web", "request", "event", "panel", "engine", "console", "nettable", "steam", "route", "exec", "script", "message"];
    function expEnum28(label, obj) {
      if (obj == null) { dlog("28-② " + label + " = null/undefined"); return null; }
      let names = null;
      try { names = Object.getOwnPropertyNames(obj); }
      catch (e) { dlog("28-② " + label + " getOwnPropertyNames THREW: " + expErr(e)); return null; }
      expChunk("28-② " + label + " props", names.join(","));
      const hits = [];
      for (const n of names) {
        const nl = String(n).toLowerCase();
        for (const k of KW28) { if (nl.indexOf(k) !== -1) { hits.push(n); break; } }
      }
      dlog("28-② " + label + " keyword hits: " + (hits.length ? hits.join(",") : "NONE"));
      return hits;
    }
    try {
      dlog("28-② typeof GameInterfaceAPI=" + (typeof GameInterfaceAPI) +
        " GameEvents=" + (typeof GameEvents) +
        " CustomNetTables=" + (typeof CustomNetTables) +
        " panorama=" + (typeof panorama));
      let gn = [];
      try { gn = Object.getOwnPropertyNames(globalThis); }
      catch (e) { dlog("28-② globalThis THREW: " + expErr(e)); }
      expChunk("28-② globalThis props", gn.join(","));
      const ghits = [];
      for (const n of gn) {
        const nl = String(n).toLowerCase();
        for (const k of KW28) { if (nl.indexOf(k) !== -1) { ghits.push(n); break; } }
      }
      dlog("28-② globalThis keyword hits: " + (ghits.length ? ghits.join(",") : "NONE"));
      expEnum28("panorama", typeof panorama !== "undefined" ? panorama : null);
      expEnum28("$", $);
      try { if (typeof GameEvents !== "undefined") expEnum28("GameEvents", GameEvents); } catch (e) {}
      try { if (typeof CustomNetTables !== "undefined") expEnum28("CustomNetTables", CustomNetTables); } catch (e) {}
      // 关键字命中的全局再深挖一层(对象/函数型,最多 6 个防刷屏)
      let deepN = 0;
      for (const n of ghits) {
        if (deepN >= 6) break;
        try {
          const v = globalThis[n];
          if (v && (typeof v === "object" || typeof v === "function")) { expEnum28("deep:" + n, v); deepN += 1; }
        } catch (e) {}
      }
    } catch (e) { dlog("28-② section failed: " + expErr(e)); }

    // ---- ③ 事件白名单批量探测 ----
    try {
      if (typeof $.RegisterForUnhandledEvent !== "function") {
        dlog("28-③ RegisterForUnhandledEvent missing");
      } else {
        State.exp28Fired = State.exp28Fired || {};
        const cands = [
          // 对照组(生产代码已验证可注册)
          "HTMLContentLoaded", "HTMLChangedTitle", "ClientUI_FireOutput",
          // 聊天族
          "ChatMessage", "ChatMsg", "Chat", "PlayerChat", "PlayerChatMessage", "OnChatMessage", "CitadelChatMessage", "HUDChatMessage", "OnPlayerChat", "PlayerSay",
          // 对局状态族
          "GameEvent", "PanelLoaded", "LevelInit", "MatchStart", "MatchEnd", "MatchStateChanged", "OnMatchStateChanged", "GameStateChanged", "OnGameStateChange",
          // 玩家族
          "PlayerConnect", "PlayerDisconnect", "PlayerInfoChanged", "OnPlayerInfoChanged", "OnPlayerSpawn", "OnPlayerDeath",
          // HTML 面板族(对照+扩展)
          "HTMLLoadPage", "HTMLStartRequest", "HTMLFinishRequest", "HTMLURLChanged", "HTMLTitle",
          // 加载族(图片加载若触发事件 = 入站突破口)
          "OnImageLoaded", "ImageLoaded", "ImageLoadComplete", "OnTextureLoaded", "ContentLoaded", "OnPanelLoaded", "OnPanelLoad",
          // 自定义/网络/UI/Steam
          "CustomGameEvent", "OnCustomGameEvent", "FireGameEvent", "OnFireGameEvent", "NetTableChanged", "CustomNetTableChanged", "OnCustomNetTableChanged",
          "ClientUIEvent", "UIEvent", "OnUIEvent", "ResolutionChanged", "OnResolutionChanged", "SteamOverlayChanged", "OnSteamOverlayToggled",
          "EntityKilled", "OnEntityKilled", "OnAbilityCast", "ServerInfo", "OnTimeChanged", "OnLocalPlayerReady"
        ];
        const valid = [];
        const invalid = [];
        const other = [];
        const seen = {};
        for (const name of cands) {
          if (seen[name]) continue;
          seen[name] = true;
          try {
            $.RegisterForUnhandledEvent(name, (function (nm) {
              return function () {
                const cnt = (State.exp28Fired[nm] || 0) + 1;
                State.exp28Fired[nm] = cnt;
                if (cnt <= 3) {
                  let args = "";
                  try {
                    const arr = [];
                    for (let i = 0; i < arguments.length && i < 6; i += 1) {
                      try { arr.push(String(arguments[i]).slice(0, 160)); }
                      catch (e2) { arr.push("<" + typeof arguments[i] + ">"); }
                    }
                    args = arr.join(" | ");
                  } catch (e2) {}
                  dlog("28-③ EVENT FIRED: " + nm + " args(" + arguments.length + ")=" + args.slice(0, 400));
                }
              };
            })(name));
            valid.push(name);
          } catch (e) {
            const m = expErr(e);
            if (m.indexOf("not a valid event type") !== -1) invalid.push(name);
            else other.push(name + "{" + m + "}");
          }
        }
        expChunk("28-③ VALID", valid.join(","));
        dlog("28-③ INVALID count=" + invalid.length + " of " + cands.length);
        expChunk("28-③ THROWS_OTHER", other.join(",") || "NONE");
        // $ 里的派发口(能否自己触发事件做回环验证)
        try {
          const dk = [];
          for (const k of Object.getOwnPropertyNames($)) {
            const kl = String(k).toLowerCase();
            if (kl.indexOf("dispatch") !== -1 || kl.indexOf("fire") !== -1 || kl.indexOf("trigger") !== -1 || kl.indexOf("emit") !== -1) dk.push(k);
          }
          dlog("28-③ $ dispatch-ish: " + (dk.length ? dk.join(",") : "NONE"));
        } catch (e) { dlog("28-③ dispatch scan THREW: " + expErr(e)); }
        // 触发观察: 发一条桥信标(加载桥可控资源), 3s 后汇报哪些事件真的到达
        expSendBeacon("28-E7-trigger ts=" + ts);
        try {
          $.Schedule(3.0, function () {
            const fired = [];
            for (const k in State.exp28Fired) fired.push(k + "x" + State.exp28Fired[k]);
            dlog("28-③ fired after image trigger: " + (fired.length ? fired.join(",") : "NONE"));
            dlog("28-③ done");
          });
        } catch (e) { dlog("28-③ schedule failed: " + expErr(e)); }
      }
    } catch (e) { dlog("28-③ section failed: " + expErr(e)); }
  }

  // ============= EXP6729: 入站四连探针(J2 攻坚) =============
  // ① 事件 args 深挖(HTML*/ImageLoaded 全字段 dump) + 图片 200/404/500/204 状态码差分
  // ② SetURL 变体矩阵(检测器 = HTML* 事件 + 桥 PROBE, 不再只看桥日志)
  // ③ Data() dump / RegisterEventHandler 白名单 / BImageFileExists 文件 oracle
  // ④ RSI 域名探测(我方 context 的 location/document, 为域名对齐铺路)
  function expDumpVal(v) {
    const t = typeof v;
    if (v === null) return "null";
    if (t === "string") return JSON.stringify(String(v).slice(0, 200));
    if (t === "number" || t === "boolean") return String(v);
    if (t === "undefined") return "undefined";
    if (t === "function") return "fn<" + (v.name || "?") + ">";
    try {
      const names = Object.getOwnPropertyNames(v);
      const parts = [];
      for (let i = 0; i < names.length && parts.length < 12; i += 1) {
        let val;
        try { val = v[names[i]]; } catch (e) { parts.push(names[i] + "=<throw>"); continue; }
        const vt = typeof val;
        if (vt === "string") parts.push(names[i] + "=" + JSON.stringify(String(val).slice(0, 140)));
        else if (vt === "number" || vt === "boolean") parts.push(names[i] + "=" + String(val));
        else if (val === null) parts.push(names[i] + "=null");
        else parts.push(names[i] + "<" + vt + ">");
      }
      const more = names.length > 12 ? ",+" + (names.length - 12) : "";
      return "{" + parts.join(",") + more + "}";
    } catch (e) { return "<dump failed: " + expErr(e) + ">"; }
  }

  function expEventHandler29(nm) {
    return function () {
      if (!State.exp29Fired) State.exp29Fired = {};
      const cnt = (State.exp29Fired[nm] = (State.exp29Fired[nm] || 0) + 1);
      if (cnt <= 4) {
        const parts = [];
        for (let i = 0; i < arguments.length && i < 5; i += 1) {
          parts.push("a" + i + "=" + expDumpVal(arguments[i]));
        }
        dlog("29-EV " + nm + "#" + cnt + " (" + arguments.length + "a): " + parts.join(" | ").slice(0, 600));
      }
    };
  }

  function runExp6729() {
    if (State.exp6729Done) return;
    State.exp6729Done = true;
    const ts = String(nowMs()).slice(-6);
    dlog("exp6729 start v" + VERSION + " ts=" + ts);

    // ---- ④ RSI 域名探测: 我方 context 到底是什么 ----
    try {
      dlog("29-④ typeof location=" + (typeof location) + " document=" + (typeof document) + " window=" + (typeof window));
      try { if (typeof location !== "undefined") dlog("29-④ location = " + String(location).slice(0, 300)); } catch (e) { dlog("29-④ location THREW: " + expErr(e)); }
      try { if (typeof document !== "undefined") dlog("29-④ document.URL=" + String(document.URL) + " title=" + String(document.title)); } catch (e) { dlog("29-④ document THREW: " + expErr(e)); }
    } catch (e) { dlog("29-④ section failed: " + expErr(e)); }

    // ---- ① 挂8个 VALID 事件的 dump handler(args 全字段) ----
    try {
      const dumpEvents = ["ImageLoaded", "PanelLoaded", "HTMLLoadPage", "HTMLStartRequest", "HTMLFinishRequest", "HTMLURLChanged", "HTMLTitle", "ClientUI_FireOutput"];
      let okN = 0;
      for (const nm of dumpEvents) {
        try { $.RegisterForUnhandledEvent(nm, expEventHandler29(nm)); okN += 1; }
        catch (e) { dlog("29-① register " + nm + " THREW: " + expErr(e)); }
      }
      dlog("29-① dump handlers registered: " + okN + "/" + dumpEvents.length);
    } catch (e) { dlog("29-① register section failed: " + expErr(e)); }

    // ---- ①' 图片状态码差分: 6 个触发(200/404/200/404/500/204),对照 EV 触发序列 ----
    try {
      let diffPanel = null;
      try { diffPanel = findChild(getRoot(), "LCTDiffProbe"); } catch (e0) {}
      if (!isValid(diffPanel)) {
        try { diffPanel = $.CreatePanel("Image", getRoot(), "LCTDiffProbe"); } catch (e1) {}
        if (isValid(diffPanel)) { try { diffPanel.visible = false; diffPanel.style.width = "2px"; diffPanel.style.height = "2px"; } catch (e2) {} }
      }
      if (isValid(diffPanel) && typeof diffPanel.SetImage === "function") {
        const codes = [200, 404, 200, 404, 500, 204];
        for (let i = 0; i < codes.length; i += 1) {
          const myI = i;
          const code = codes[i];
          try {
            $.Schedule(myI * 0.8, function () {
              dlog("29-① TRIGGER n=" + (myI + 1) + " code=" + code);
              try { diffPanel.SetImage("http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe_img?code=" + code + "&n=" + (myI + 1)); }
              catch (e) { dlog("29-① SetImage THREW: " + expErr(e)); }
            });
          } catch (e) { dlog("29-① schedule THREW: " + expErr(e)); }
        }
        dlog("29-① diff sent 6 triggers (200,404,200,404,500,204), 0.8s apart; compare TRIGGER vs EV ImageLoaded sequence");
      } else {
        dlog("29-① diff panel unavailable");
      }
    } catch (e) { dlog("29-① diff section failed: " + expErr(e)); }

    // ---- ② SetURL 变体矩阵(检测器 = HTML* 事件 + 桥 PROBE) ----
    try {
      let hp9 = null;
      try { hp9 = findChild(getRoot(), "LCTHtmlProbe"); } catch (e0) {}
      if (!isValid(hp9)) {
        try { hp9 = $.CreatePanel("CitadelHTMLPanel", getRoot(), "LCTHtmlProbe"); } catch (e1) {}
      }
      if (isValid(hp9) && typeof hp9.SetURL === "function") {
        const navs = [
          ["blank", "about:blank"],
          ["file-abs", "file:///C:/Windows/win.ini"],
          ["http-local", "http://localhost:8791/probe?seq=nav1&d=seturl-local"],
          ["http-127", "http://127.0.0.1:8791/probe?seq=nav2&d=seturl-127"]
        ];
        for (let i = 0; i < navs.length; i += 1) {
          const myI = i;
          const nav = navs[i];
          try {
            $.Schedule(1.5 + myI * 1.0, function () {
              dlog("29-② NAV[" + nav[0] + "] -> " + nav[1]);
              try { hp9.SetURL(nav[1]); } catch (e) { dlog("29-② SetURL THREW: " + expErr(e)); }
            });
          } catch (e) { dlog("29-② schedule THREW: " + expErr(e)); }
        }
        dlog("29-② nav matrix queued (blank/file-abs/http-local/http-127); watch 29-EV HTML* args + PROBE seq=nav1/nav2");
      } else {
        dlog("29-② panel/SetURL unavailable");
      }
    } catch (e) { dlog("29-② section failed: " + expErr(e)); }

    // ---- ③ Data() dump / RegisterEventHandler / BImageFileExists ----
    try {
      let hpD = null;
      try { hpD = findChild(getRoot(), "LCTHtmlProbe"); } catch (e0) {}
      if (!isValid(hpD)) { try { hpD = $.CreatePanel("CitadelHTMLPanel", getRoot(), "LCTHtmlProbe"); } catch (e1) {} }
      if (isValid(hpD)) {
        try {
          const dv = hpD.Data();
          dlog("29-③ Data() = " + expDumpVal(dv));
        } catch (e) { dlog("29-③ Data() THREW: " + expErr(e)); }
      }
      // RegisterEventHandler: 另一套注册口(与 unhandled 不同),测 arity + 白名单
      try {
        const reh = $.RegisterEventHandler;
        dlog("29-③ RegisterEventHandler typeof=" + typeof reh + " arity=" + (typeof reh === "function" ? reh.length : "-"));
        if (typeof reh === "function") {
          const rehCands = ["ImageLoaded", "HTMLTitle", "ClientUI_FireOutput", "PanelLoaded", "ChatMessage", "LCT_DIAG_EVT"];
          const rehValid = [];
          const rehInvalid = [];
          for (const nm of rehCands) {
            try { reh(nm, expEventHandler29("REH:" + nm)); rehValid.push(nm); }
            catch (e) {
              const m = expErr(e);
              if (m.indexOf("not a valid event type") !== -1) rehInvalid.push(nm);
              else rehInvalid.push(nm + "{" + m.slice(0, 80) + "}");
            }
          }
          dlog("29-③ RegisterEventHandler VALID: " + (rehValid.join(",") || "NONE"));
          dlog("29-③ RegisterEventHandler INVALID: " + (rehInvalid.join(",") || "NONE"));
        }
      } catch (e) { dlog("29-③ RegisterEventHandler section THREW: " + expErr(e)); }
      // BImageFileExists: 文件存在性 oracle(桥可写文件 = 位元入站候选)
      try {
        const bf = $.BImageFileExists;
        dlog("29-③ BImageFileExists typeof=" + typeof bf + " arity=" + (typeof bf === "function" ? bf.length : "-"));
        if (typeof bf === "function") {
          const paths = [
            ["abs-exists", "C:/Windows/win.ini"],
            ["abs-missing", "C:/no_such_bt_file_zz.ini"],
            ["file-abs", "file:///C:/Windows/win.ini"],
            ["game-cfg", "cfg/video.txt"],
            ["game-console-log", "console.log"],
            ["resources", "file://{resources}/panorama/styles/lingua_chat.vcss_c"],
            ["bridge-abs", "F:/BabelTower/logs/bridge.log"]
          ];
          for (const pp of paths) {
            try { dlog("29-③ BIFE[" + pp[0] + "] = " + String(bf(pp[1]))); }
            catch (e) { dlog("29-③ BIFE[" + pp[0] + "] THREW: " + expErr(e)); }
          }
        }
      } catch (e) { dlog("29-③ BIFE section THREW: " + expErr(e)); }
    } catch (e) { dlog("29-③ section failed: " + expErr(e)); }

    // 汇总: 8s 后报事件触发统计(差分结论靠它)
    try {
      $.Schedule(8.0, function () {
        const fired = [];
        if (State.exp29Fired) { for (const k in State.exp29Fired) fired.push(k + "x" + State.exp29Fired[k]); }
        dlog("29-SUM fired: " + (fired.length ? fired.join(",") : "NONE"));
        dlog("29-SUM done");
      });
    } catch (e) { dlog("29-SUM schedule failed: " + expErr(e)); }
  }

  // ============= EXP6730: 严格三测(不扩散) =============
  // ① ImageLoaded 精确差分(身份过滤): 200/204/404/500/connection-refused -> 是否触发 + a1 内容
  // ② RegisterEventHandler arity 猜签名: 1~5 参逐个试,只找参数个数,不猜事件名
  // ③ BImageFileExists 资源对照: 真实 s2r 路径 3 形式 + 材质路径 + 不存在路径
  // 本轮不测: SetURL/file://localhost/AsyncWebRequest/RSI/Data()/GameInterfaceAPI(已判死或已定案)
  function runExp6730() {
    if (State.exp6730Done) return;
    State.exp6730Done = true;
    const ts = String(nowMs()).slice(-6);
    dlog("exp6730 start v" + VERSION + " ts=" + ts);

    // ---- ① ImageLoaded 精确差分 ----
    try {
      let dp = null;
      try { dp = findChild(getRoot(), "LCTDiffProbe"); } catch (e0) {}
      if (!isValid(dp)) {
        try { dp = $.CreatePanel("Image", getRoot(), "LCTDiffProbe"); } catch (e1) {}
        if (isValid(dp)) { try { dp.visible = false; dp.style.width = "2px"; dp.style.height = "2px"; } catch (e2) {} }
      }
      if (!isValid(dp) || typeof dp.SetImage !== "function") {
        dlog("30-① diff panel unavailable");
      } else {
        State.diffPanelId = "LCTDiffProbe";
        State.diffFired = {};
        State.diffA1 = {};
        State.curTrigger = 0;
        State.curCode = "-";
        // 身份过滤: 按 id 匹配(跨 wrapper 稳定),只记录我们自己的面板
        try {
          $.RegisterForUnhandledEvent("ImageLoaded", function (panel, a1) {
            let pid = "";
            try { pid = panel ? String(panel.id) : ""; } catch (e) {}
            if (pid !== State.diffPanelId) return;
            const t = State.curTrigger || 0;
            State.diffFired[t] = (State.diffFired[t] || 0) + 1;
            if (!State.diffA1[t]) {
              try { State.diffA1[t] = expDumpVal(a1); } catch (e) { State.diffA1[t] = "<dump fail>"; }
            }
            dlog("30-① MY_IMAGE_LOADED #" + t + " code=" + State.curCode + " a1=" + State.diffA1[t]);
          });
          dlog("30-① ImageLoaded handler registered (id filter: " + State.diffPanelId + ")");
        } catch (e) { dlog("30-① handler register THREW: " + expErr(e)); }
        // 5 个步骤: 200 / 204 / 404 / 500 / refused(死端口 8799)
        const steps = ["200", "204", "404", "500", "refused"];
        for (let i = 0; i < steps.length; i += 1) {
          const myI = i + 1;
          const code = steps[i];
          try {
            $.Schedule(1.5 + i * 1.5, function () {
              State.curTrigger = myI;
              State.curCode = code;
              dlog("30-① TRIGGER #" + myI + " code=" + code);
              const url = code === "refused"
                ? "http://localhost:8799/refused.png?n=R" + myI
                : "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe_img?code=" + code + "&n=" + myI;
              try { dp.SetImage(url); } catch (e) { dlog("30-① SetImage THREW: " + expErr(e)); }
            });
          } catch (e) { dlog("30-① schedule THREW: " + expErr(e)); }
          // 每步触发 1.3s 后判定(本地请求毫秒级,1.3s 窗口足够)
          try {
            $.Schedule(1.5 + i * 1.5 + 1.3, function () {
              const cnt = State.diffFired[myI] || 0;
              const a1v = State.diffA1[myI] || "-";
              dlog("30-① RESULT[" + code + "] = " + (cnt ? "FIRED x" + cnt : "NO-EVENT") + " a1=" + a1v);
            });
          } catch (e) {}
        }
        dlog("30-① steps queued: 200/204/404/500/refused, 1.5s apart (refused = localhost:8799 dead port)");
      }
    } catch (e) { dlog("30-① section failed: " + expErr(e)); }

    // ---- ② RegisterEventHandler arity(只找参数个数,不猜事件名) ----
    try {
      const reh = $.RegisterEventHandler;
      dlog("30-② RegisterEventHandler typeof=" + typeof reh);
      if (typeof reh === "function") {
        const mk = function (n) {
          const a = ["ImageLoaded"];
          if (n >= 2) a.push(function () {});
          if (n >= 3) a.push({});
          if (n >= 4) a.push(null);
          if (n >= 5) a.push(null);
          return a;
        };
        for (let n = 1; n <= 5; n += 1) {
          try {
            const r = reh.apply($, mk(n));
            dlog("30-② REH n=" + n + " => NO THROW, return=" + String(r) + "  <== CANDIDATE");
          } catch (e) {
            const m = expErr(e);
            const wrongN = m.indexOf("Wrong number") !== -1;
            dlog("30-② REH n=" + n + " => " + (wrongN ? "WrongNumber" : "OTHER: " + m) + "");
          }
        }
        dlog("30-② done (look for n where error stops being WrongNumber)");
      }
    } catch (e) { dlog("30-② section failed: " + expErr(e)); }

    // ---- ③ BImageFileExists 资源对照(最后测,全 false 即封案) ----
    try {
      const bf = $.BImageFileExists;
      if (typeof bf === "function") {
        const cases = [
          ["known-s2r", "s2r://panorama/images/buttons/button_border_fill_psd.vtex"],
          ["known-raw", "panorama/images/buttons/button_border_fill_psd.vtex"],
          ["known-raw-c", "panorama/images/buttons/button_border_fill_psd.vtex_c"],
          ["known-mat-c", "materials/particle/abilities/archer/mc_sparks.vtex_c"],
          ["missing", "panorama/images/buttons/definitely_missing_bt_zz.vtex"],
          ["missing-c", "panorama/images/buttons/definitely_missing_bt_zz.vtex_c"]
        ];
        for (const cc of cases) {
          try { dlog("30-③ BIFE[" + cc[0] + "] = " + String(bf(cc[1]))); }
          catch (e) { dlog("30-③ BIFE[" + cc[0] + "] THREW: " + expErr(e)); }
        }
        dlog("30-③ done (known-* true + missing false => resource-query API; all false => abandoned)");
      } else {
        dlog("30-③ BImageFileExists missing");
      }
    } catch (e) { dlog("30-③ section failed: " + expErr(e)); }

    // 总汇总(差分5步在 1.5+4*1.5+1.3=8.8s 收尾)
    try {
      $.Schedule(10.5, function () {
        const parts = [];
        if (State.diffFired) {
          const labels = ["200", "204", "404", "500", "refused"];
          for (let i = 1; i <= labels.length; i += 1) {
            parts.push(labels[i - 1] + ":" + (State.diffFired[i] ? "FIRED" : "NO"));
          }
        }
        dlog("30-SUM diff = " + (parts.length ? parts.join(" | ") : "n/a"));
        dlog("30-SUM done");
      });
    } catch (e) { dlog("30-SUM schedule failed: " + expErr(e)); }
  }

  // ============= EXP6731: 双实验(判假阴性 + 验3参签名) =============
  // ① ImageLoaded: 可见2px vs 隐藏双面板, 200/404, 不过滤打印真实 panel.id
  //    回答: ImageLoaded 能否观察到我们自己创建的 Image?(可见性/身份两嫌并查)
  // ② RegisterEventHandler 3参实调: ("ImageLoaded", panelObj, fn) 与 ("ImageLoaded", "id", fn)
  function runExp6731() {
    if (State.exp6731Done) return;
    State.exp6731Done = true;
    const ts = String(nowMs()).slice(-6);
    dlog("exp6731 start v" + VERSION + " ts=" + ts);

    // ---- 双面板: 可见 2px + 隐藏 ----
    let vis = null;
    let hid = null;
    try { vis = findChild(getRoot(), "LCTDiffVis"); } catch (e0) {}
    if (!isValid(vis)) {
      try { vis = $.CreatePanel("Image", getRoot(), "LCTDiffVis"); } catch (e) {}
      if (isValid(vis)) {
        try { vis.visible = true; vis.style.width = "2px"; vis.style.height = "2px"; vis.style.x = "0px"; vis.style.y = "0px"; } catch (e) {}
      }
    }
    try { hid = findChild(getRoot(), "LCTDiffHid"); } catch (e0) {}
    if (!isValid(hid)) {
      try { hid = $.CreatePanel("Image", getRoot(), "LCTDiffHid"); } catch (e) {}
      if (isValid(hid)) { try { hid.visible = false; hid.style.width = "2px"; hid.style.height = "2px"; } catch (e) {} }
    }
    dlog("31-① panels: vis=" + !!vis + " hid=" + !!hid);

    // ---- ② RegisterEventHandler 3参实调(先注册, 事件来了能双保险捕获) ----
    try {
      const reh = $.RegisterEventHandler;
      if (typeof reh !== "function") {
        dlog("31-② RegisterEventHandler missing");
      } else {
        const rehFn = function (tag) {
          return function () {
            const parts = [];
            for (let i = 0; i < arguments.length && i < 5; i += 1) parts.push("a" + i + "=" + expDumpVal(arguments[i]));
            dlog("31-② REH EVENT[" + tag + "] (" + arguments.length + "a): " + parts.join(" | ").slice(0, 500));
          };
        };
        // 形态1: (eventName, panelObj, fn)
        if (isValid(vis)) {
          try {
            const r1 = reh("ImageLoaded", vis, rehFn("panelObj"));
            dlog("31-② REH(panelObj) => OK, return=" + String(r1));
          } catch (e) { dlog("31-② REH(panelObj) THREW: " + expErr(e)); }
        }
        // 形态2: (eventName, panelIdString, fn)
        try {
          const r2 = reh("ImageLoaded", "LCTDiffVis", rehFn("idStr"));
          dlog("31-② REH(idStr) => OK, return=" + String(r2));
        } catch (e) { dlog("31-② REH(idStr) THREW: " + expErr(e)); }
        dlog("31-② done (which form did NOT throw?)");
      }
    } catch (e) { dlog("31-② section failed: " + expErr(e)); }

    // ---- ① ImageLoaded 全量观察(不过滤) + 我方面板计数 ----
    try {
      State.diff31 = {};
      State.cur31 = "-";
      State.img31Total = 0;
      State.img31Logged = 0;
      $.RegisterForUnhandledEvent("ImageLoaded", function (panel, a1) {
        State.img31Total += 1;
        let pid = "";
        try { pid = panel ? String(panel.id) : ""; } catch (e) {}
        if (pid === "LCTDiffVis" || pid === "LCTDiffHid") {
          State.diff31[State.cur31] = (State.diff31[State.cur31] || 0) + 1;
          dlog("31-① OURS id=" + pid + " label=" + State.cur31 + " a1=" + expDumpVal(a1));
        } else if (State.img31Logged < 8) {
          State.img31Logged += 1;
          dlog("31-① other#" + State.img31Logged + " id=\"" + pid + "\" total=" + State.img31Total);
        }
      });
      dlog("31-① unfiltered ImageLoaded handler registered");
    } catch (e) { dlog("31-① handler THREW: " + expErr(e)); }

    // ---- 差分: 4 步 (vis-200, vis-404, hid-200, hid-404) ----
    if (isValid(vis) && isValid(hid)) {
      const steps = [
        ["vis-200", vis, 200],
        ["vis-404", vis, 404],
        ["hid-200", hid, 200],
        ["hid-404", hid, 404]
      ];
      for (let i = 0; i < steps.length; i += 1) {
        const st = steps[i];
        const label = st[0];
        const panel = st[1];
        const code = st[2];
        try {
          $.Schedule(1.5 + i * 1.5, function () {
            State.cur31 = label;
            dlog("31-① TRIGGER " + label);
            try { panel.SetImage("http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe_img?code=" + code + "&n=" + label); }
            catch (e) { dlog("31-① SetImage THREW: " + expErr(e)); }
          });
        } catch (e) {}
        try {
          $.Schedule(1.5 + i * 1.5 + 1.1, function () {
            const cnt = State.diff31[label] || 0;
            dlog("31-① RESULT[" + label + "] = " + (cnt ? "FIRED x" + cnt : "NO-EVENT"));
          });
        } catch (e) {}
      }
      dlog("31-① steps queued: vis-200/vis-404/hid-200/hid-404, 1.5s apart");
    } else {
      dlog("31-① panels missing, diff skipped");
    }

    // 汇总(最后一步 1.5+3*1.5+1.1=7.1s; 留余量)
    try {
      $.Schedule(9.0, function () {
        const parts = [];
        const labels = ["vis-200", "vis-404", "hid-200", "hid-404"];
        for (const lb of labels) parts.push(lb + ":" + ((State.diff31 && State.diff31[lb]) ? "FIRED" : "NO"));
        dlog("31-SUM diff = " + parts.join(" | "));
        dlog("31-SUM ImageLoaded total=" + (State.img31Total || 0) + " (other logged " + (State.img31Logged || 0) + ")");
        dlog("31-SUM done");
      });
    } catch (e) {}
  }

  // ============= EXP6732: Bridge→Panorama 最后一公里闭环 =============
  // 规则(6731 教训): ① 每面板只 SetImage 一次,永不覆盖; ② 不轮询判定,handler 自报告; ③ +10s 汇总。
  // 结构: P200/P404/P500/PRefused 四面板各一发; P200/P404 同时挂 Unhandled + RegisterEventHandler 双路回调。
  // 期望: P200 双路 FIRED / P404·P500·PR 双路 NO = 状态码位元通道成立。
  function runExp6732() {
    if (State.exp6732Done) return;
    State.exp6732Done = true;
    const ts = String(nowMs()).slice(-6);
    dlog("exp6732 start v" + VERSION + " ts=" + ts);

    const mk = function (id) {
      let p = null;
      try { p = findChild(getRoot(), id); } catch (e) {}
      if (!isValid(p)) {
        try { p = $.CreatePanel("Image", getRoot(), id); } catch (e) {}
        if (isValid(p)) {
          try { p.visible = true; p.style.width = "2px"; p.style.height = "2px"; p.style.x = "0px"; p.style.y = "0px"; } catch (e) {}
        }
      }
      return p;
    };
    const p200 = mk("LCTP200");
    const p404 = mk("LCTP404");
    const p500 = mk("LCTP500");
    const pr = mk("LCTPR");
    dlog("32 panels: 200=" + !!p200 + " 404=" + !!p404 + " 500=" + !!p500 + " refused=" + !!pr);

    State.diff32 = {};
    State.img32Total = 0;
    State.img32Other = 0;

    // ---- 双路回调之 1: RegisterForUnhandledEvent(全局面) ----
    try {
      $.RegisterForUnhandledEvent("ImageLoaded", function (panel, a1) {
        State.img32Total += 1;
        let pid = "";
        try { pid = panel ? String(panel.id) : ""; } catch (e) {}
        if (pid === "LCTP200" || pid === "LCTP404" || pid === "LCTP500" || pid === "LCTPR") {
          State.diff32[pid] = (State.diff32[pid] || 0) + 1;
          dlog("32-① UNHANDLED FIRED id=" + pid + " t=" + nowMs() + " a1=" + expDumpVal(a1));
        } else if (State.img32Other < 4) {
          State.img32Other += 1;
          dlog("32-① other#" + State.img32Other + " id=\"" + pid + "\" total=" + State.img32Total);
        }
      });
      dlog("32-① unhandled ImageLoaded registered");
    } catch (e) { dlog("32-① unhandled THREW: " + expErr(e)); }

    // ---- 双路回调之 2: RegisterEventHandler(面板绑定, 6731 已验签名) ----
    const rehFn = function (tag) {
      return function () {
        State.diff32["REH:" + tag] = (State.diff32["REH:" + tag] || 0) + 1;
        const parts = [];
        for (let i = 0; i < arguments.length && i < 5; i += 1) parts.push("a" + i + "=" + expDumpVal(arguments[i]));
        dlog("32-② REH FIRED id=" + tag + " t=" + nowMs() + " (" + arguments.length + "a): " + parts.join(" | ").slice(0, 400));
      };
    };
    if (isValid(p200)) {
      try { $.RegisterEventHandler("ImageLoaded", p200, rehFn("LCTP200")); dlog("32-② REH registered on P200"); }
      catch (e) { dlog("32-② REH(P200) THREW: " + expErr(e)); }
    }
    if (isValid(p404)) {
      try { $.RegisterEventHandler("ImageLoaded", p404, rehFn("LCTP404")); dlog("32-② REH registered on P404"); }
      catch (e) { dlog("32-② REH(P404) THREW: " + expErr(e)); }
    }

    // ---- 单发差分: 每面板只 SetImage 一次,永不覆盖; 0.5s 错开 ----
    const shots = [
      ["LCTP200", p200, "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe_img?code=200&n=e32p200"],
      ["LCTP404", p404, "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe_img?code=404&n=e32p404"],
      ["LCTP500", p500, "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe_img?code=500&n=e32p500"],
      ["LCTPR", pr, "http://localhost:8799/refused.png?n=e32pr"]
    ];
    let shotN = 0;
    for (const sh of shots) {
      const label = sh[0];
      const panel = sh[1];
      const url = sh[2];
      if (!isValid(panel)) { dlog("32-① SHOT[" + label + "] panel missing, skipped"); continue; }
      shotN += 1;
      try {
        $.Schedule(1.5 + shotN * 0.5, function () {
          dlog("32-① SHOT[" + label + "] ONE-SHOT t=" + nowMs());
          try { panel.SetImage(url); } catch (e) { dlog("32-① SetImage THREW: " + expErr(e)); }
        });
      } catch (e) { dlog("32-① schedule THREW: " + expErr(e)); }
    }
    dlog("32-① " + shotN + " one-shot panels queued (no retarget ever)");

    // ---- 汇总: +10s, 只报告, 不提前判定 ----
    try {
      $.Schedule(10.0, function () {
        const pids = ["LCTP200", "LCTP404", "LCTP500", "LCTPR"];
        const parts = [];
        for (const pid of pids) parts.push(pid + ":" + ((State.diff32[pid]) ? "FIRED x" + State.diff32[pid] : "NO"));
        dlog("32-SUM unhandled = " + parts.join(" | "));
        const rp = [];
        rp.push("REH:200:" + (State.diff32["REH:LCTP200"] ? "FIRED" : "NO"));
        rp.push("REH:404:" + (State.diff32["REH:LCTP404"] ? "FIRED" : "NO"));
        dlog("32-SUM reh = " + rp.join(" | "));
        dlog("32-SUM other traffic total=" + State.img32Total + " (other logged " + State.img32Other + ")");
        dlog("32-SUM done");
      });
    } catch (e) {}
  }

  // ============= EXP6733: 302 重定向 + Image 面板 URL/src 回读 =============
  // 核心问题只有一个: ImageLoaded 回调里能否读到实际加载的 image URL/src/path?
  //   T1(P33A): 直接 /probe?...&d=BT_ORIG33 —— src 可读性基线
  //   T2(P33B): /redir302?o=BT_ORIG33&f=BT_FINAL33 -> 302 /rdata?f=BT_FINAL33
  //     读到 BT_FINAL33 = 最终 URL 可读 = ⭐文本入站(数量级提升)
  //     只读到 BT_ORIG33 = 跟随了但只暴露原 URL = 无增益
  //     桥无 PROBE-RDATA = 引擎不跟随重定向
  // 面板规则: 单发不覆盖(6731 教训); 双路回调; +11s 汇总。
  function runExp6733() {
    if (State.exp6733Done) return;
    State.exp6733Done = true;
    const ts = String(nowMs()).slice(-6);
    dlog("exp6733 start v" + VERSION + " ts=" + ts);

    const mk = function (id) {
      let p = null;
      try { p = findChild(getRoot(), id); } catch (e) {}
      if (!isValid(p)) {
        try { p = $.CreatePanel("Image", getRoot(), id); } catch (e) {}
        if (isValid(p)) {
          try { p.visible = true; p.style.width = "2px"; p.style.height = "2px"; p.style.x = "0px"; p.style.y = "0px"; } catch (e) {}
        }
      }
      return p;
    };
    const pA = mk("LCTP33A");
    const pB = mk("LCTP33B");
    dlog("33 panels: A(plain)=" + !!pA + " B(redirect)=" + !!pB);

    // ---- 字符串回读: 全属性扫描(URL类) + 加载前后变化 diff + 候选方法/属性 ----
    const snapStrings = function (panel) {
      const m = {};
      try {
        const names = Object.getOwnPropertyNames(panel);
        for (const n of names) {
          try { const v = panel[n]; if (typeof v === "string") m[n] = v; } catch (e) {}
        }
      } catch (e) {}
      return m;
    };
    const readback = function (pid, panel, before) {
      const hits = [];
      const after = snapStrings(panel);
      // 1) 变化检测(加载后新增/改变的字符串属性)
      for (const n in after) {
        const v = after[n];
        if (before[n] !== v) {
          const bv = before[n] === undefined ? "<none>" : before[n];
          hits.push("CHANGED " + n + ": " + String(bv).slice(0, 80) + " -> " + String(v).slice(0, 300));
        }
      }
      // 2) URL 类扫描(无论变没变)
      for (const n in after) {
        const v = after[n];
        const lv = v.toLowerCase();
        if (lv.indexOf("http") !== -1 || v.indexOf("BT_") !== -1 || lv.indexOf(".png") !== -1 || lv.indexOf("rdata") !== -1) {
          if (!hits.some(function (h) { return h.indexOf(n + ":") !== -1; })) hits.push("URLLIKE " + n + "=" + v.slice(0, 300));
        }
      }
      // 3) 候选属性读取 API
      if (typeof panel.GetAttributeString === "function") {
        const attrs = ["src", "image", "imagepath", "url", "texture", "backgroundimage"];
        for (const a of attrs) {
          try { const s = panel.GetAttributeString(a, ""); if (s) hits.push("attr:" + a + "=" + String(s).slice(0, 300)); } catch (e) {}
        }
      }
      // 4) 候选读取方法
      const fns = ["GetImage", "GetImageURL", "GetImagePath", "GetTextureName", "GetUrl"];
      for (const m of fns) {
        if (typeof panel[m] === "function") {
          try { const r = panel[m](); if (r) hits.push("fn:" + m + "()=" + String(r).slice(0, 300)); }
          catch (e) { hits.push("fn:" + m + " THREW:" + expErr(e)); }
        }
      }
      return hits;
    };

    State.base33 = {};
    State.loaded33 = {};
    State.readback33 = {};

    const onLoaded33 = function (via, panel) {
      let pid = "";
      try { pid = panel ? String(panel.id) : ""; } catch (e) {}
      if (pid !== "LCTP33A" && pid !== "LCTP33B") return;
      State.loaded33[pid] = (State.loaded33[pid] || 0) + 1;
      if (State.readback33[pid]) return; // 只回读一次
      try {
        const hits = readback(pid, panel, State.base33[pid] || {});
        State.readback33[pid] = hits.length;
        dlog("33 READBACK[" + pid + "] via " + via + " hits=" + hits.length + ": " + hits.join(" || ").slice(0, 900));
      } catch (e) { dlog("33 READBACK[" + pid + "] THREW: " + expErr(e)); }
    };

    // 双路回调
    try {
      $.RegisterForUnhandledEvent("ImageLoaded", function (panel) { onLoaded33("unhandled", panel); });
      dlog("33 unhandled registered");
    } catch (e) { dlog("33 unhandled THREW: " + expErr(e)); }
    if (isValid(pA)) {
      try { $.RegisterEventHandler("ImageLoaded", pA, function () { onLoaded33("REH", pA); }); dlog("33 REH registered on A"); }
      catch (e) { dlog("33 REH(A) THREW: " + expErr(e)); }
    }
    if (isValid(pB)) {
      try { $.RegisterEventHandler("ImageLoaded", pB, function () { onLoaded33("REH", pB); }); dlog("33 REH registered on B"); }
      catch (e) { dlog("33 REH(B) THREW: " + expErr(e)); }
    }

    // 基线快照(加载前)
    try {
      $.Schedule(1.5, function () {
        if (isValid(pA)) State.base33["LCTP33A"] = snapStrings(pA);
        if (isValid(pB)) State.base33["LCTP33B"] = snapStrings(pB);
        dlog("33 baseline captured (A strings=" + Object.keys(State.base33["LCTP33A"] || {}).length +
          ", B strings=" + Object.keys(State.base33["LCTP33B"] || {}).length + ")");
      });
    } catch (e) {}

    // 单发两枪
    if (isValid(pA)) {
      try {
        $.Schedule(2.0, function () {
          dlog("33 SHOT[T1-plain] LCTP33A t=" + nowMs());
          try { pA.SetImage("http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe?seq=33a&d=BT_ORIG33"); }
          catch (e) { dlog("33 SetImage(A) THREW: " + expErr(e)); }
        });
      } catch (e) {}
    }
    if (isValid(pB)) {
      try {
        $.Schedule(2.5, function () {
          dlog("33 SHOT[T2-redirect] LCTP33B t=" + nowMs());
          try { pB.SetImage("http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/redir302?o=BT_ORIG33&f=BT_FINAL33"); }
          catch (e) { dlog("33 SetImage(B) THREW: " + expErr(e)); }
        });
      } catch (e) {}
    }

    // 汇总
    try {
      $.Schedule(11.0, function () {
        const aL = State.loaded33["LCTP33A"] || 0;
        const bL = State.loaded33["LCTP33B"] || 0;
        dlog("33-SUM T1(plain) loaded=" + aL + " readbackHits=" + (State.readback33["LCTP33A"] !== undefined ? State.readback33["LCTP33A"] : "n/a"));
        dlog("33-SUM T2(redirect) loaded=" + bL + " readbackHits=" + (State.readback33["LCTP33B"] !== undefined ? State.readback33["LCTP33B"] : "n/a"));
        dlog("33-SUM done (check PROBE-REDIR/PROBE-RDATA in bridge log)");
      });
    } catch (e) {}
  }

  // ============= EXP6734-A: Image 面板全方法名枚举(只枚举,零调用) =============
  // 目的: 关死/捡漏 src 回读 —— 找 GetImage/GetURL/GetSource/GetTexture/GetPath/GetFile 类 accessor。
  // 规则: 只 typeof + 名字过滤,绝不调用;命中与全量名单都贴回。
  function runExp6734A() {
    if (State.exp6734ADone) return;
    State.exp6734ADone = true;
    const ts = String(nowMs()).slice(-6);
    dlog("exp6734A start v" + VERSION + " ts=" + ts);

    let p = null;
    try { p = findChild(getRoot(), "LCTP34A"); } catch (e0) {}
    if (!isValid(p)) {
      try { p = $.CreatePanel("Image", getRoot(), "LCTP34A"); } catch (e) {}
      if (isValid(p)) {
        try { p.visible = true; p.style.width = "2px"; p.style.height = "2px"; p.style.x = "0px"; p.style.y = "0px"; } catch (e) {}
      }
    }
    dlog("34-A panel=" + !!p);
    if (!isValid(p)) { dlog("34-A panel missing, abort"); return; }

    const KW = ["image", "url", "src", "texture", "path", "file"];
    const enumFns = function (tag) {
      if (State.enum34Done) return;
      State.enum34Done = true;
      try {
        const seen = {};
        const all = [];
        try {
          const own = Object.getOwnPropertyNames(p);
          for (const n of own) { if (!seen[n]) { seen[n] = 1; all.push(n); } }
        } catch (e) {}
        try {
          for (const n in p) { if (!seen[n]) { seen[n] = 1; all.push(n); } }
        } catch (e) {}
        const fns = [];
        const hits = [];
        for (const n of all) {
          let t = "";
          try { t = typeof p[n]; } catch (e) { continue; }
          if (t !== "function") continue;
          fns.push(n);
          const lo = String(n).toLowerCase();
          for (const k of KW) {
            if (lo.indexOf(k) !== -1) { hits.push(n); break; }
          }
        }
        dlog("34-A[" + tag + "] hits(" + hits.length + "): " + (hits.length ? hits.join(", ") : "EMPTY"));
        dlog("34-A[" + tag + "] total functions: " + fns.length);
        expChunk("34-A[" + tag + "] all fns", fns.join(","));
        dlog("34-A[" + tag + "] done (do NOT call any of these until reviewed)");
      } catch (e) { dlog("34-A enum THREW: " + expErr(e)); }
    };

    // 双路回调(只记 loaded,枚举在 loaded 或 6s 兜底里跑一次)
    try {
      $.RegisterForUnhandledEvent("ImageLoaded", function (panel) {
        let pid = "";
        try { pid = panel ? String(panel.id) : ""; } catch (e) {}
        if (pid !== "LCTP34A") return;
        dlog("34-A LOADED id=" + pid + " t=" + nowMs());
        enumFns("onload");
      });
    } catch (e) { dlog("34-A unhandled THREW: " + expErr(e)); }
    try {
      $.RegisterEventHandler("ImageLoaded", p, function () { dlog("34-A REH LOADED"); enumFns("reh"); });
    } catch (e) { dlog("34-A REH THREW: " + expErr(e)); }

    // 单发一枪
    try {
      $.Schedule(2.0, function () {
        dlog("34-A SHOT t=" + nowMs());
        try { p.SetImage("http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe?seq=34a&d=BT_34A"); }
        catch (e) { dlog("34-A SetImage THREW: " + expErr(e)); }
      });
    } catch (e) {}
    // 兜底: 6s 还没 loaded 也枚举(方法是静态的,不依赖加载)
    try { $.Schedule(8.0, function () { enumFns("fallback"); dlog("34-A fallback check done"); }); } catch (e) {}
  }

  // ============= EXP6734-B: 真实对局 64 面板 × 20 轮延迟测试 =============
  // 手动触发: 进对局(可移动后)聊天输入 /bt6734b。
  // 规格: 64 面板一批 → 全到齐(或 12s 超时)才开下一轮 → 20 轮;
  //       dt 在游戏内用引擎毫秒算(shot→ImageLoaded),不受日志尾随延迟影响;
  //       上报只走 $.Msg → console.log tail(1280 行不走信标,防 0.2s 队列积压)。
  function runExp6734B() {
    if (State.bitRunning) { log("exp6734B: already running, ignore"); return; }
    State.bitRunning = true;
    State.bitRound = 0;
    const N = 64;
    const ROUNDS = 20;
    log("exp6734B: START v" + VERSION + " rounds=" + ROUNDS + " panels=" + N);

    // 64 面板(隐藏;复用防重建)
    const panels = [];
    for (let i = 0; i < N; i += 1) {
      const id = "BTBIT" + i;
      let p = null;
      try { p = findChild(getRoot(), id); } catch (e) {}
      if (!isValid(p)) {
        try { p = $.CreatePanel("Image", getRoot(), id); } catch (e) {}
        if (isValid(p)) { try { p.visible = false; p.style.width = "2px"; p.style.height = "2px"; } catch (e) {} }
      }
      if (isValid(p)) panels.push(p);
    }
    log("exp6734B: panels ready " + panels.length + "/" + N);
    if (panels.length < N) {
      log("exp6734B: ABORT (not enough panels)");
      State.bitRunning = false;
      return;
    }
    State.bitPanels = panels;

    // ImageLoaded 处理(每会话只注册一次,状态全走 State 防闭包陈旧)
    if (!State.bitHandlerOn) {
      State.bitHandlerOn = true;
      try {
        $.RegisterForUnhandledEvent("ImageLoaded", function (panel) {
          let pid = "";
          try { pid = panel ? String(panel.id) : ""; } catch (e) {}
          if (pid.slice(0, 5) !== "BTBIT") return;
          if (!State.bitActive) return;
          if (State.bitIds[pid]) return;
          State.bitIds[pid] = 1;
          const dt = nowMs() - State.bitT0;
          State.bitLoaded += 1;
          if (State.bitMin === null || dt < State.bitMin) State.bitMin = dt;
          if (State.bitMax === null || dt > State.bitMax) State.bitMax = dt;
          log("exp6734B: LOADED id=" + pid + " dt=" + dt);
          if (State.bitLoaded >= State.bitPanels.length) bitFinishRound();
        });
      } catch (e) { log("exp6734B: handler THREW " + expErr(e)); }
    }

    const bitStartRound = function () {
      State.bitRound += 1;
      State.bitActive = true;
      State.bitIds = {};
      State.bitLoaded = 0;
      State.bitMin = null;
      State.bitMax = null;
      State.bitT0 = nowMs();
      log("exp6734B: ROUND=" + State.bitRound + " SHOT t=" + State.bitT0);
      for (let i = 0; i < State.bitPanels.length; i += 1) {
        try {
          State.bitPanels[i].SetImage(
            "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe_bit?id=BTBIT" + i + "&round=" + State.bitRound
          );
        } catch (e) { log("exp6734B: SetImage THREW " + expErr(e)); }
      }
      const myRound = State.bitRound;
      try {
        $.Schedule(12.0, function () {
          if (State.bitRound !== myRound || !State.bitActive) return; // 本轮已正常完成
          log("exp6734B: ROUND=" + myRound + " TIMEOUT loaded=" + State.bitLoaded + "/" + State.bitPanels.length);
          bitFinishRound();
        });
      } catch (e) {}
    };

    function bitFinishRound() {
      if (!State.bitActive) return;
      State.bitActive = false;
      log("exp6734B: ROUND=" + State.bitRound + " DONE loaded=" + State.bitLoaded + "/" + State.bitPanels.length +
        " min=" + State.bitMin + " max=" + State.bitMax + " t0=" + State.bitT0);
      if (State.bitRound >= ROUNDS) {
        log("exp6734B: ALL DONE (" + ROUNDS + " rounds complete)");
        State.bitRunning = false;
      } else {
        try { $.Schedule(1.5, bitStartRound); }
        catch (e) { log("exp6734B: schedule THREW " + expErr(e)); State.bitRunning = false; }
      }
    }

    bitStartRound();
  }

  // ============= EXP6734-C: 聊天输入框 TextEntry 控制 =============
  // C-1 树扫描找 TextEntry(能力探测,不猜名) → C-2 面板枚举 → C-3 只读 → C-4 改 p.text →
  // C-5 两段手动 Enter 判定: 发出的是原文还是改后文(= 发送前翻译"回填 TextEntry"路线判定)
  // 触发: 聊天输兣 /bt6734c;不自动 Enter,第1下拦截改写,第2下才真发送;/ 开头命令可退出布防。
  function exp6734cChunk(prefix, s) {
    const size = 480;
    if (!s.length) { log("exp6734C: " + prefix + "#0 <empty>"); return; }
    for (let i = 0; i < s.length; i += size) log("exp6734C: " + prefix + "#" + (i / size) + ": " + s.slice(i, i + size));
  }

  // C-1: 从根面板递归扫(不猜名),收集一切带 text 属性的面板,探测 TextEntry 特征方法
  function exp6734cScanTree() {
    const root = getRoot();
    const found = [];
    let scanned = 0;
    const TE_PROBES = ["GetMaxChars", "SetMaxChars", "SetSelectedText", "GetSelectedText", "InsertString", "MoveCursorEnd", "SetDisabled"];
    const visit = function (p, depth) {
      if (!isValid(p) || depth > 25 || scanned > 4000) return;
      scanned += 1;
      let hasText = false;
      try { hasText = typeof p.text === "string"; } catch (e) {}
      if (hasText) {
        let id = "", ty = "?", cls = "";
        const hits = [];
        try { id = String(p.id || ""); } catch (e) {}
        try { if (typeof p.type === "string") ty = p.type; } catch (e) {}
        try { if (typeof p.GetPanelClassList === "function") cls = String(p.GetPanelClassList().join(",")); } catch (e) {}
        for (let i = 0; i < TE_PROBES.length; i += 1) {
          try { if (typeof p[TE_PROBES[i]] === "function") hits.push(TE_PROBES[i]); } catch (e) {}
        }
        let cur = "";
        try { cur = String(p.text).slice(0, 40); } catch (e) {}
        found.push({ id: id || "?", ty: ty, cls: cls, hits: hits.join("|") || "-", text: cur });
      }
      const n = childCount(p);
      for (let i = 0; i < n; i += 1) visit(childAt(p, i), depth + 1);
    };
    visit(root, 0);
    log("exp6734C: C1 scan panels=" + scanned + " textCapable=" + found.length);
    for (let i = 0; i < found.length && i < 60; i += 1) {
      const f = found[i];
      log("exp6734C: C1 [" + i + "] id=" + f.id + " type=" + f.ty + " te-hits=" + f.hits + " cls=" + f.cls.slice(0, 70) + " text=" + JSON.stringify(f.text));
    }
    if (found.length > 60) log("exp6734C: C1 ... +" + (found.length - 60) + " more");
    let known = null;
    try { known = findChild(root, CHAT_INPUT_ID); } catch (e) {}
    log("exp6734C: C1 knownId ChatInput found=" + (isValid(known) ? "yes" : "no"));
    return found;
  }

  // C-5 观测: 从第1下 Enter 起,对 chat/lobby/hud 消息容器做基线后增量行分类
  // 分类优先级: 含唯一标记 → SENT=MODIFIED;仅含原文且 IsSelf → SENT=ORIGINAL
  function exp6734cObsStart(st) {
    const containers = function () {
      const out = [];
      try { const m = resolveChatMessages(); if (m) out.push({ k: "chat", p: m }); } catch (e) {}
      try { const l = resolveLobbyMessages(); if (l) out.push({ k: "lobby", p: l }); } catch (e) {}
      try {
        resolveHudMessages();
        for (let i = 0; i < State.hudMessages.length; i += 1) out.push({ k: "hud" + i, p: State.hudMessages[i] });
      } catch (e) {}
      return out;
    };
    const bl = {};
    const cs0 = containers();
    for (let i = 0; i < cs0.length; i += 1) {
      try { bl[cs0[i].k] = childCount(cs0[i].p); } catch (e) { bl[cs0[i].k] = 0; }
    }
    st.hits = st.hits || [];
    st.logged = st.logged || {};
    const ticks = [0.5, 1.2, 2.5, 4.5, 7.5, 11.0];
    let idx = 0;
    const step = function () {
      if (State.c5obs !== st || st.done) return;
      const cs = containers();
      for (let ci = 0; ci < cs.length; ci += 1) {
        const c = cs[ci];
        let n = 0;
        try { n = childCount(c.p); } catch (e) { continue; }
        if (typeof bl[c.k] !== "number") bl[c.k] = n; // 中途新出现的容器: 从当前水位起数
        const start = Math.min(bl[c.k], Math.max(0, n - 3)); // 已知基线 + 永远兼顾末3行
        for (let i = start; i < n; i += 1) {
          const row = childAt(c.p, i);
          let txt = "";
          try { txt = collectText(row); } catch (e) {}
          if (!txt) continue;
          let kind = "";
          if (st.marker && txt.indexOf(st.marker) >= 0) kind = "SENT=MODIFIED";
          else if (st.orig && txt.indexOf(st.orig) >= 0) {
            let own = false;
            try { own = hasClass(row, "IsSelf") || !!findClass(row, LOCAL_CLIENT_ID); } catch (e) {}
            if (own) kind = "SENT=ORIGINAL";
          }
          if (!kind) continue;
          const key = c.k + "#" + i + "#" + txt.slice(0, 20);
          if (st.logged[key]) continue;
          st.logged[key] = true;
          st.hits.push(kind);
          log("exp6734C: C5 row[" + c.k + "#" + i + "] " + kind + " text=" + JSON.stringify(txt.slice(0, 120)));
        }
        bl[c.k] = Math.max(bl[c.k], n); // 水位推进(已扫过的不重扫;末3行由 start 兼顾)
      }
      // 出结论: 双命中,或已发第2下且有命中(再补一拍),或打点用尽
      const hasM = st.hits.indexOf("SENT=MODIFIED") >= 0;
      const hasO = st.hits.indexOf("SENT=ORIGINAL") >= 0;
      const last = idx >= ticks.length - 1;
      if ((hasM && hasO) || (last) || (st.sent2 && (hasM || hasO) && idx >= 3)) {
        st.done = true;
        let verdict = "NOT_SENT";
        if (hasM && hasO) verdict = "BOTH (第1下原生发了原文?第2下又发了改后文,见上方 row 日志)";
        else if (hasM) verdict = "SENT=MODIFIED (改后文被发送 → 回填+发送链路成立)";
        else if (hasO) verdict = "SENT=ORIGINAL (原文被发送 → 引擎不吃 p.text 改写)";
        log("exp6734C: C5-RESULT " + verdict + " sent2=" + !!st.sent2 + " orig=" + JSON.stringify(String(st.orig || "").slice(0, 40)));
        State.c5obs = null;
        return;
      }
      idx += 1;
      if (idx < ticks.length) { try { $.Schedule(ticks[idx], step); } catch (e) {} }
      else {
        st.done = true;
        log("exp6734C: C5-RESULT NOT_SENT (11s 未见新行; sent2=" + !!st.sent2 + ")");
        State.c5obs = null;
      }
    };
    State.c5obs = st;
    try { $.Schedule(ticks[0], step); } catch (e) { log("exp6734C: obs schedule threw " + expErr(e)); }
  }

  // C-5 两段 Enter 拦截: wait=第1下(改写不发送) / send=第2下(与正常路径同语义发送)
  function exp6734cSubmitHook(input, trimmed) {
    try {
      const st = State.c5;
      if (!st) return false;
      if (trimmed.charAt(0) === "/") {
        log("exp6734C: disarm by command " + JSON.stringify(trimmed.slice(0, 40)));
        State.c5 = null;
        return false;
      }
      if (st.phase === "wait") {
        if (!trimmed) return true; // 布防中空回车吞掉
        st.orig = trimmed;
        st.marker = "LCTC" + String(nowMs()).slice(-6) + "M";
        const modified = st.marker + " " + trimmed.slice(0, 60);
        let wOk = false, rb = "";
        try { input.text = modified; wOk = true; } catch (e) { log("exp6734C: C5 write threw " + expErr(e)); }
        try { rb = String(input.text || ""); } catch (e) {}
        log("exp6734C: C3 userText=" + JSON.stringify(trimmed.slice(0, 80)));
        log("exp6734C: C4 rewrite=" + wOk + " readback=" + JSON.stringify(rb.slice(0, 90)) + " match=" + (rb === modified));
        st.phase = "send";
        exp6734cObsStart(st);
        log("exp6734C: C5 phase=send — 输入框已改写,再次按回车才发送(观察原文还是改后文)");
        return true; // 第1下: 不发送
      }
      if (st.phase === "send") {
        if (!trimmed) { log("exp6734C: C5 submit#2 empty, 保持 phase=send"); return true; }
        const isRewritten = trimmed === st.marker + " " + String(st.orig || "").slice(0, 60);
        log("exp6734C: C5 submit#2 raw=" + JSON.stringify(trimmed.slice(0, 90)) + " isRewritten=" + isRewritten);
        try { input.text = trimmed; } catch (e) {}
        triggerStockSubmit(input);
        clearInput();
        st.sent2 = true;
        State.c5 = null; // 布防结束,观测经 State.c5obs 继续
        log("exp6734C: C5 stock submit dispatched (normal-path semantics)");
        return true;
      }
      State.c5 = null;
      return false;
    } catch (e) {
      log("exp6734C: hook error " + expErr(e) + " — disarm");
      State.c5 = null;
      return false; // 出错必放行走正常路径,绝不吞用户消息
    }
  }

  function runExp6734C(input, cmd) {
    log("exp6734C: START v" + VERSION);
    // ---- C-1 树扫描 ----
    exp6734cScanTree();
    // ---- 定位目标输入框(能力扫描优先,回退本 mod XML 已知 id) ----
    const inp = (isValid(input) ? input : null) || State.input || findChild(getRoot(), CHAT_INPUT_ID);
    if (!isValid(inp)) { log("exp6734C: ABORT — no TextEntry(input) found"); return; }
    let inpId = "?";
    try { inpId = String(inp.id || "?"); } catch (e) {}
    // ---- C-2 面板枚举(只读) ----
    let names = [];
    try { names = Object.getOwnPropertyNames(inp); } catch (e) { log("exp6734C: C2 getOwnPropertyNames threw " + expErr(e)); }
    exp6734cChunk("C2 input[" + inpId + "] ownProps", names.join(","));
    // ---- C-3 只读当前内容(此刻应为命令串自身) ----
    let cur = "";
    try { cur = String(inp.text || ""); } catch (e) { log("exp6734C: C3 read threw " + expErr(e)); }
    log("exp6734C: C3 read id=" + inpId + " text=" + JSON.stringify(cur.slice(0, 60)) + " matchCmd=" + (cur.trim() === cmd));
    // ---- C-4 写+读回(写完即清,恢复空白输入框) ----
    const wmark = "LCTW" + String(nowMs()).slice(-6);
    let wOk = false, rb = "";
    try { inp.text = wmark; wOk = true; } catch (e) { log("exp6734C: C4 write threw " + expErr(e)); }
    try { rb = String(inp.text || ""); } catch (e) {}
    log("exp6734C: C4 write=" + wOk + " readback=" + JSON.stringify(rb.slice(0, 60)) + " match=" + (rb === wmark));
    clearInput();
    // ---- 布防 C-5 ----
    const st = { phase: "wait", t0: nowMs(), marker: "", orig: "", sent2: false, done: false };
    State.c5 = st;
    State.c5obs = null;
    try {
      $.Schedule(120.0, function () {
        if (State.c5 === st) {
          log("exp6734C: C5 timeout (120s) disarm phase=" + st.phase);
          State.c5 = null;
        }
      });
    } catch (e) {}
    log("exp6734C: ARMED — 输入测试文本按回车(第1下: 拦截改写不发送),再按回车(第2下: 真正发送);输入 / 开头命令即退出布防");
  }

  // ============= EXP6734-D: Bridge→Panorama 下行吞吐基准 =============
  // 目的: 用实测数据钉死 BTIPC v1 的 MAX_SAFE_PAYLOAD / SAFE_WINDOW / FRAME_TIMEOUT,帧规格不拍脑袋定。
  // 矩阵 D1~D6: 面板数 16/32/64/96/128/256 × 每面板 1 bit × 20 轮;
  // 窗口 W1~W5: 256 bit 帧按窗口 16/32/64/96/128 分批发射 × 10 轮(协议帧 ≠ 一次性发射的面板数)。
  // 触发: 对局内聊天 /bt6734d | /bt6734d <8..512> | /bt6734d win
  // 面板: 自建 Image 前缀 BTD*(与 6734-B 的 BTBIT* 严格隔离,两套 ImageLoaded handler 互不干扰),
  //       隐藏 2×2 复用;URL 带 c=<cfg>@<runTag> 击穿缓存 + 服务端按配置分组。
  // 指标行: LOADED(每 bit dt/seq) / WIN(每窗) / ROUND DONE|TIMEOUT(word/first/last/min/max/lost) / DUP / STALE
  // 分析: node scripts/exp6734d_analyze.js logs/bridge.log
  const EXP6734D_MATRIX = [16, 32, 64, 96, 128, 256];
  const EXP6734D_WINS = [16, 32, 64, 96, 128];

  function runExp6734D(arg) {
    if (State.dRunning) { log("exp6734D: already running, ignore"); return; }
    if (State.bitRunning) { log("exp6734D: 6734-B running, refuse(防两套探针互相污染)"); return; }

    // ---- 计划 ----
    const plan = [];
    if (arg === "win" || arg === "w") {
      for (let i = 0; i < EXP6734D_WINS.length; i += 1) {
        plan.push({ cfg: "256w" + EXP6734D_WINS[i], n: 256, win: EXP6734D_WINS[i], rounds: 10 });
      }
    } else if (arg === "") {
      for (let i = 0; i < EXP6734D_MATRIX.length; i += 1) {
        plan.push({ cfg: String(EXP6734D_MATRIX[i]), n: EXP6734D_MATRIX[i], win: 1, rounds: 20 });
      }
    } else {
      const n = parseInt(arg, 10);
      if (!(n >= 8 && n <= 512)) {
        log("exp6734D: 参数无效 " + JSON.stringify(arg) + " — 用法: /bt6734d | /bt6734d <8..512> | /bt6734d win");
        return;
      }
      plan.push({ cfg: String(n), n: n, win: 1, rounds: 20 });
    }

    // ---- 面板池(前缀 BTD*) ----
    let maxN = 0;
    for (let i = 0; i < plan.length; i += 1) if (plan[i].n > maxN) maxN = plan[i].n;
    const panels = [];
    let created = 0;
    for (let i = 0; i < maxN; i += 1) {
      const pid = "BTD" + i;
      let p = null;
      try { p = findChild(getRoot(), pid); } catch (e) {}
      if (!isValid(p)) {
        try { p = $.CreatePanel("Image", getRoot(), pid); } catch (e) {}
        if (isValid(p)) {
          created += 1;
          try { p.visible = false; p.style.width = "2px"; p.style.height = "2px"; } catch (e) {}
        }
      }
      if (isValid(p)) panels.push(p);
      else log("exp6734D: panel " + pid + " invalid");
    }
    const runTag = String(nowMs()).slice(-6);
    log("exp6734D: START v" + VERSION + " run=" + runTag + " plan=" +
        plan.map(function (c) { return c.cfg; }).join(",") +
        " panels=" + panels.length + "/" + maxN + " (new=" + created + ")");
    if (panels.length < maxN) {
      log("exp6734D: ABORT (面板不足 " + panels.length + "/" + maxN + ")");
      return;
    }

    State.dRunning = true;
    const st = {
      runTag: runTag, plan: plan, panels: panels, ci: 0,
      cfg: "", n: 0, win: 1, rounds: 0, r: 0,
      active: false, t0: 0, ids: {}, loaded: 0, seq: 0,
      first: null, last: null, min: null, max: null,
      winK: 0, winBase: 0, winShots: 0, wLoaded: 0, winT0: 0
    };
    State.d = st;

    const tagOf = function (s) { return "n=" + s.cfg + " r=" + s.r; };
    const winCountOf = function (s) { return Math.ceil(s.n / s.win); };
    const timeoutMsOf = function (s) {
      if (s.win <= 1) return 12000;
      return Math.min(60000, winCountOf(s) * 6000 + 12000);
    };

    // ---- ImageLoaded(每会话注册一次;状态全走 State.d 防闭包陈旧) ----
    if (!State.dHandlerOn) {
      State.dHandlerOn = true;
      try {
        $.RegisterForUnhandledEvent("ImageLoaded", function (panel) {
          let pid = "";
          try { pid = panel ? String(panel.id) : ""; } catch (e) {}
          if (pid.slice(0, 3) !== "BTD") return;
          const s = State.d;
          if (!s || !s.active) return;
          const idx = parseInt(pid.slice(3), 10);
          if (isNaN(idx)) return;
          const dt = nowMs() - s.t0;
          if (idx >= s.winShots) { log("exp6734D: STALE " + tagOf(s) + " i=" + idx + " dt=" + dt); return; }
          if (s.ids[pid]) { log("exp6734D: DUP " + tagOf(s) + " i=" + idx + " dt=" + dt); return; }
          s.ids[pid] = 1;
          s.loaded += 1;
          s.seq += 1;
          if (s.first === null) s.first = dt;
          s.last = dt;
          if (s.min === null || dt < s.min) s.min = dt;
          if (dt > s.max) s.max = dt;
          log("exp6734D: LOADED " + tagOf(s) + " i=" + idx + " dt=" + dt + " seq=" + s.seq);
          if (s.win > 1 && idx >= s.winBase) {
            s.wLoaded += 1;
            if (s.wLoaded >= s.winShots - s.winBase) {
              log("exp6734D: WIN " + tagOf(s) + " k=" + (s.winK + 1) + "/" + winCountOf(s) + " DONE dt=" + (nowMs() - s.winT0));
              dAdvance();
            }
          }
          if (s.loaded >= s.n) dFinishRound();
        });
      } catch (e) { log("exp6734D: handler THREW " + expErr(e)); }
    }

    // ---- 单窗口发射(	win=1 即整轮一批) ----
    const dShotWindow = function (k) {
      const s = State.d;
      if (!s || !s.active) return;
      const from = s.win > 1 ? k * s.win : 0;
      const to = Math.min(s.n, s.win > 1 ? (k + 1) * s.win : s.n);
      s.winK = k;
      s.winBase = from;
      s.winShots = to;
      s.wLoaded = 0;
      s.winT0 = nowMs();
      log("exp6734D: WIN " + tagOf(s) + " k=" + (k + 1) + "/" + winCountOf(s) +
          " SHOT " + from + ".." + (to - 1) + " t=" + s.winT0);
      const urlPrefix = "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe_bit?c=" + s.cfg + "&id=BTD";
      for (let i = from; i < to; i += 1) {
        try {
          s.panels[i].SetImage(urlPrefix + i + "&round=" + s.r);
        } catch (e) { log("exp6734D: SetImage THREW " + expErr(e)); }
      }
      // 窗口停滞推进: 单 bit 永不到不拖死整帧(仅窗口模式;win=1 由轮超时管)
      if (s.win > 1) {
        const myR = s.r, myK = k;
        try {
          $.Schedule(6.0, function () {
            const t = State.d;
            if (!t || !t.active || t.r !== myR || t.winK !== myK) return;
            log("exp6734D: WIN " + tagOf(t) + " k=" + (myK + 1) + "/" + winCountOf(t) +
                " STALL loaded=" + t.wLoaded + "/" + (t.winShots - t.winBase));
            dAdvance();
          });
        } catch (e) {}
      }
    };

    const dAdvance = function () {
      const s = State.d;
      if (!s || !s.active) return;
      if (s.winShots >= s.n) { dFinishRound(); return; }
      dShotWindow(s.winK + 1);
    };

    const dFinishRound = function () {
      const s = State.d;
      if (!s || !s.active) return;
      s.active = false;
      const word = nowMs() - s.t0;
      const lost = s.n - s.loaded;
      const label = lost <= 0 ? "DONE" : "TIMEOUT";
      log("exp6734D: ROUND " + tagOf(s) + " " + label + " loaded=" + s.loaded + "/" + s.n +
          " word=" + word +
          " first=" + (s.first === null ? -1 : s.first) + " last=" + (s.last === null ? -1 : s.last) +
          " min=" + (s.min === null ? -1 : s.min) + " max=" + (s.max === null ? -1 : s.max) +
          " lost=" + lost + " seqs=" + s.seq);
      if (s.r >= s.rounds) {
        log("exp6734D: CFG " + s.cfg + " DONE rounds=" + s.rounds + " idx=" + (s.ci + 1) + "/" + s.plan.length);
        s.ci += 1;
        if (s.ci >= s.plan.length) {
          log("exp6734D: ALL DONE — 全部配置完成;取数: node scripts/exp6734d_analyze.js logs/bridge.log");
          State.dRunning = false;
          State.d = null;
          return;
        }
        const nxt = s.plan[s.ci];
        try { $.Schedule(3.0, function () { dSetupConfig(nxt); }); }
        catch (e) { log("exp6734D: schedule THREW " + expErr(e)); State.dRunning = false; }
        return;
      }
      // 有丢失时多等一会(超时残留加载未落定,防污染下一轮 dt)
      const gap = lost <= 0 ? 0.5 : 3.0;
      try { $.Schedule(gap, dStartRound); }
      catch (e) { log("exp6734D: schedule THREW " + expErr(e)); State.dRunning = false; }
    };

    const dStartRound = function () {
      const s = State.d;
      if (!s) return;
      s.r += 1;
      s.active = true;
      s.ids = {};
      s.loaded = 0;
      s.seq = 0;
      s.first = null; s.last = null; s.min = null; s.max = null;
      s.t0 = nowMs();
      log("exp6734D: ROUND " + tagOf(s) + " SHOT t=" + s.t0);
      dShotWindow(0);
      const myR = s.r;
      try {
        $.Schedule(timeoutMsOf(s), function () {
          const t = State.d;
          if (!t || !t.active || t.r !== myR) return;
          dFinishRound();
        });
      } catch (e) { log("exp6734D: timeout schedule THREW " + expErr(e)); }
    };

    const dSetupConfig = function (cfgObj) {
      const s = State.d;
      if (!s) return;
      s.cfg = cfgObj.cfg + "@" + s.runTag;
      s.n = cfgObj.n;
      s.win = cfgObj.win;
      s.rounds = cfgObj.rounds;
      s.r = 0;
      log("exp6734D: CFG " + s.cfg + " START n=" + s.n + " win=" + s.win +
          " rounds=" + s.rounds + " idx=" + (s.ci + 1) + "/" + s.plan.length);
      dStartRound();
    };

    dSetupConfig(plan[0]);
  }

  // ============= EXP6734-E: 多值符号判别(一个 Image 面板能否 >1 bit) =============
  // 13 状态码 × 20 轮 × 1 面板/符号;面板唯一且每轮 URL 加 round 击穿缓存,同面板不重复 SetImage(6731 铁律)。
  // 服务端:2xx→空PNG;3xx→302 跳 /rdata?f=E<code>(复用 6733 的游戏端 URL 文本上报);4xx/5xx→短 HTML。
  // 预期三值判定: 200/201/204/206→LOADED(fast);301/302/304/307→LOADED(REDIR-LATE,~>800ms);
  // 4xx/5xx→LOADED(HTML)或静默——无论哪种只要**与 2xx 行为可区分**即多值符号成立。
  // 判读: node scripts/exp6734e_analyze.js logs/bridge.log
  const EXP6734E_CODES = [200, 201, 204, 206, 301, 302, 304, 307, 400, 401, 403, 404, 500];

  function runExp6734E() {
    if (State.eRunning) { log("exp6734E: already running, ignore"); return; }
    if (State.dRunning || State.bitRunning) { log("exp6734E: 6734-B/D running, refuse"); return; }

    // 每符号 1 个面板(唯一 id,复用);URL 带 round=击穿缓存,永不覆盖同一面板
    const panels = [];
    for (let i = 0; i < EXP6734E_CODES.length; i += 1) {
      const pid = "BTE" + i;
      let p = null;
      try { p = findChild(getRoot(), pid); } catch (e) {}
      if (!isValid(p)) {
        try { p = $.CreatePanel("Image", getRoot(), pid); } catch (e) {}
        if (isValid(p)) { try { p.visible = false; p.style.width = "2px"; p.style.height = "2px"; } catch (e) {} }
      }
      if (!isValid(p)) { log("exp6734E: ABORT panel " + pid); return; }
      panels.push(p);
    }
    const runTag = String(nowMs()).slice(-6);
    const ROUNDS = 20, GAP = 2.0, TIMEOUT = 12.0;
    log("exp6734E: START v" + VERSION + " run=" + runTag + " codes=" + EXP6734E_CODES.join("/") + " rounds=" + ROUNDS);
    State.eRunning = true;
    const st = { runTag: runTag, r: 0, active: false, t0: 0, seen: {} };
    State.e = st;

    if (!State.eHandlerOn) {
      State.eHandlerOn = true;
      try {
        $.RegisterForUnhandledEvent("ImageLoaded", function (panel) {
          let pid = "";
          try { pid = panel ? String(panel.id) : ""; } catch (e) {}
          if (pid.slice(0, 3) !== "BTE") return;
          const s = State.e;
          if (!s || !s.active) return;
          const idx = parseInt(pid.slice(3), 10);
          if (isNaN(idx) || idx >= EXP6734E_CODES.length) return;
          const code = EXP6734E_CODES[idx];
          if (s.seen[code]) { log("exp6734E: DUP n=" + s.runTag + " r=" + s.r + " code=" + code); return; }
          s.seen[code] = 1;
          const dt = nowMs() - s.t0;
          const speed = dt < 800 ? "FAST" : "LATE";
          log("exp6734E: LOADED n=" + s.runTag + " r=" + s.r + " code=" + code + " dt=" + dt + " " + speed);
        });
      } catch (e) { log("exp6734E: handler THREW " + expErr(e)); }
    }

    const eFinishRound = function () {
      const s = State.e;
      if (!s || !s.active) return;
      s.active = false;
      const missed = [];
      for (let i = 0; i < EXP6734E_CODES.length; i += 1) {
        if (!s.seen[EXP6734E_CODES[i]]) missed.push(EXP6734E_CODES[i]);
      }
      log("exp6734E: ROUND n=" + s.runTag + " r=" + s.r + " END loaded=" + (EXP6734E_CODES.length - missed.length) +
          "/13 missed=" + (missed.length ? missed.join("/") : "-"));
      if (s.r >= ROUNDS) {
        log("exp6734E: ALL DONE — 取数: node scripts/exp6734e_analyze.js logs/bridge.log");
        State.eRunning = false;
        State.e = null;
        return;
      }
      try { $.Schedule(GAP, eStartRound); } catch (e) { log("exp6734E: schedule THREW " + expErr(e)); State.eRunning = false; }
    };

    const eStartRound = function () {
      const s = State.e;
      if (!s) return;
      s.r += 1;
      s.active = true;
      s.seen = {};
      s.t0 = nowMs();
      log("exp6734E: ROUND n=" + s.runTag + " r=" + s.r + " SHOT t=" + s.t0);
      const urlPrefix = "http://" + BRIDGE_HOST + ":" + BRIDGE_PORT + "/probe_e?id=BTE";
      for (let i = 0; i < EXP6734E_CODES.length; i += 1) {
        try {
          panels[i].SetImage(urlPrefix + i + "&round=" + s.r + "&code=" + EXP6734E_CODES[i] + "&t=" + s.runTag);
        } catch (e) { log("exp6734E: SetImage THREW " + expErr(e)); }
      }
      const myR = s.r;
      try {
        $.Schedule(TIMEOUT, function () {
          const t = State.e;
          if (!t || !t.active || t.r !== myR) return;
          eFinishRound();
        });
      } catch (e) { log("exp6734E: timeout schedule THREW " + expErr(e)); }
    };

    eStartRound();
  }

  // ============= EXP6738: 三点「正在发送」广播指示器 + 聊天行结构取证 =============
  // 背景:9/30 更新后,普通聊天按回车 → 广播给所有人一个「...」三点对话框;快捷语音不走这条路径。
  // 目标:① 抓三点面板的 type/id/class/父链/可见性/尺寸/存活时长(C++ 动态创建,静态资源里查不到)
  //       ② 抓每条新聊天行的 class 列表 + 子树结构 + 本方 quick 判定(看游戏是否给轮盘消息留了类型标记)
  //       ③ 行到达时三点窗口是否活跃(相关性)→ 判定该信号能否当 quickchat_match 第二判据
  // 触发:聊天输入 /bt6738(toggle;/bt6738 stop 明确停);日志前缀 exp6738:
  // 回收:$.Msg → 游戏 console.log → 桥 tail → logs/bridge.log 的 [game] 行
  const P6738_POLL = 0.12;      // 120ms 轮询(三点存活 = 回车到服务器回显,通常 ≥200ms,120ms 足够不漏沿)
  const P6738_MAX_NODES = 6000; // 全树扫描节点上限(HUD 树防炸)
  const P6738_MAX_CAND = 80;    // CAND 日志上限(弱命中可能扫到静态面板,防刷屏;计数不截)
  const P6738_MAX_ROWS = 60;    // 行结构 dump 上限
  // 注意:本正则刻意零反斜杠(LEARNINGS 2026-08-31:resourcecompiler 对 JS 正则反斜杠转义有 bug)
  const P6738_TEXT_RE = /^[.…·•・․]{1,8}$/;                                // "..." "…" "・・・" 等点状文本
  const P6738_ANCHOR_RE = /typ|dots|indicator|queue|deliver|sending|chatstatus|messagestatus|pend/i; // id/class/src 锚定

  function runExp6738(arg) {
    const S = State.p6738 || (State.p6738 = { active: false });
    if (arg === "stop") {
      if (!S.active) { log("exp6738: not running"); return; }
      S.active = false;
      log("exp6738: STOP ticks=" + S.ticks + " cands=" + S.seq + " rows=" + S.rowsLogged);
      return;
    }
    if (S.active) {
      if (arg === "start") { log("exp6738: already running"); return; }
      S.active = false;
      log("exp6738: STOP ticks=" + S.ticks + " cands=" + S.seq + " rows=" + S.rowsLogged);
      return;
    }
    S.active = true;
    S.t0 = nowMs();
    S.ticks = 0;
    S.seq = 0;
    S.rowsLogged = 0;
    S.candCap = false;
    S.rowCap = false;
    S.cands = {};  // sig -> {seq, first, last, open, hit}
    S.rows = {};   // 容器 key -> 上次行数(基线,防把历史行当新行 dump)
    S.dotsOn = false;
    S.lastOn = 0;
    S.lastOff = 0;
    p6738Baseline(S);
    log("exp6738: START poll=" + P6738_POLL + "s; 动作:① 自己打字回车 ② 自己发快捷语音 ③ 等别人打字(关键:广播归因); 完了 /bt6738");
    try { $.Schedule(P6738_POLL, p6738Tick); } catch (e) { log("exp6738: schedule THREW " + expErr(e)); }
  }

  function p6738Containers() {
    const out = [];
    try { const m = resolveChatMessages(); if (m) out.push({ k: "chat", p: m }); } catch (e) {}
    try { const l = resolveLobbyMessages(); if (l) out.push({ k: "lobby", p: l }); } catch (e) {}
    try {
      resolveHudMessages();
      for (let i = 0; i < State.hudMessages.length; i += 1) out.push({ k: "hud" + i, p: State.hudMessages[i] });
    } catch (e) {}
    return out;
  }

  function p6738Baseline(S) {
    const conts = p6738Containers();
    for (let i = 0; i < conts.length; i += 1) {
      if (!isValid(conts[i].p)) continue;
      S.rows[conts[i].k] = childCount(conts[i].p);
    }
  }

  function p6738Tick() {
    const S = State.p6738;
    if (!S || !S.active) return;
    S.ticks += 1;
    try { p6738ScanDots(S); } catch (e) { log("exp6738: dots THREW " + expErr(e)); }
    try { p6738ScanRows(S); } catch (e) { log("exp6738: rows THREW " + expErr(e)); }
    try { $.Schedule(P6738_POLL, p6738Tick); } catch (e) {}
  }

  // 点组判定:面板有 2~6 个子面板,每个子面板文本都是点状字符(三个独立 "." label 的形态)
  function p6738DotGroup(p) {
    const n = childCount(p);
    if (n < 2 || n > 6) return false;
    let combined = "";
    for (let i = 0; i < n; i += 1) {
      const t = safeText(childAt(p, i));
      if (!t || !P6738_TEXT_RE.test(t)) return false;
      combined += t;
    }
    return combined.length >= 2 && combined.length <= 12;
  }

  // 父链:id.class 逐级向上(≤6 级),定位面板在树里的位置
  function p6738Path(p) {
    const parts = [];
    let cur = p;
    for (let i = 0; i < 6 && isValid(cur); i += 1) {
      let id = "", cls = "";
      try { id = String(cur.id || ""); } catch (e) {}
      try { if (cur.GetPanelClassList) cls = String(cur.GetPanelClassList().join(" ").split(" ").join(".")); } catch (e) {}
      parts.push((id || "-") + (cls ? "." + cls : ""));
      try { cur = cur.GetParent ? cur.GetParent() : null; } catch (e) { cur = null; }
    }
    return parts.join(" < ").slice(0, 240);
  }

  // 三点候选命中判定(不猜名,三条路命中任一):
  //   strong(text/dotgroup):文本本身是点状,或子面板全是点 → 直接贡献 dotsOn
  //   weak(anchor):id/class/src 命中锚定词且文本很短 → 需可见 + 对话框尺寸(≤400×400)才贡献
  function p6738Hit(p) {
    const txt = safeText(p);
    if (txt && P6738_TEXT_RE.test(txt)) return { hit: "text:" + txt, strong: true, txt: txt };
    let id = "", cls = "", src = "";
    try { id = String(p.id || ""); } catch (e) {}
    try { if (p.GetPanelClassList) cls = String(p.GetPanelClassList().join(",")); } catch (e) {}
    try { src = String(p.src || ""); } catch (e) {}
    const anchor = P6738_ANCHOR_RE.exec(id + "|" + cls + "|" + src);
    if (anchor && txt.length <= 12) {
      return { hit: "anchor:" + anchor[0], strong: false, txt: txt, id: id, cls: cls, src: src };
    }
    if (p6738DotGroup(p)) return { hit: "dotgroup", strong: true, txt: txt };
    return null;
  }

  function p6738ScanDots(S) {
    const root = getRoot();
    if (!root) return;
    const now = nowMs();
    const found = {};
    let scanned = 0;
    const visit = function (p, depth) {
      if (!isValid(p) || depth > 30 || scanned > P6738_MAX_NODES) return;
      scanned += 1;
      const h = p6738Hit(p);
      if (h) {
        let ty = "?", id = h.id, cls = h.cls;
        try { if (typeof p.type === "string") ty = p.type; } catch (e) {}
        try { if (id === undefined) id = String(p.id || ""); } catch (e) {}
        try { if (cls === undefined && p.GetPanelClassList) cls = String(p.GetPanelClassList().join(",")); } catch (e) {}
        const path = p6738Path(p);
        const sig = ty + "#" + (id || "-") + "[" + (cls || "") + "]@" + path + ":" + h.txt;
        let vis = "?", w = -1, hh = -1;
        try { vis = String(p.visible); } catch (e) {}
        try {
          if (typeof p.GetActualLayoutWidth === "function") { w = p.GetActualLayoutWidth(); hh = p.GetActualLayoutHeight(); }
        } catch (e) {}
        // 弱命中需可见 + 尺寸像对话框,否则只记录不计入 dotsOn(挡静态 Pending 之类)
        const usable = h.strong || (vis === "true" && (w < 0 || w <= 400) && (hh < 0 || hh <= 400));
        const c = S.cands[sig];
        if (!c) {
          S.seq += 1;
          S.cands[sig] = { seq: S.seq, first: now, last: now, open: usable, hit: h.hit };
          if (S.seq <= P6738_MAX_CAND) {
            log("exp6738: CAND#" + S.seq + " " + h.hit + (usable ? "" : " (weak-gated off)") +
              " t=+" + (now - S.t0) + "ms type=" + ty + " vis=" + vis + " wh=" + w + "x" + hh +
              " path=" + path + " txt=" + JSON.stringify(h.txt));
          } else if (!S.candCap) {
            S.candCap = true;
            log("exp6738: CAND cap " + P6738_MAX_CAND + " reached (counting only)");
          }
        } else {
          c.last = now;
          if (usable && !c.open) {
            c.open = true;
            log("exp6738: BACK#" + c.seq + " t=+" + (now - S.t0) + "ms");
          } else if (!usable && c.open) {
            c.open = false;
          }
        }
        found[sig] = 1;
      }
      const n = childCount(p);
      for (let i = 0; i < n; i += 1) visit(childAt(p, i), depth + 1);
    };
    visit(root, 0);
    // 消失/出现结算
    const openSeqs = [];
    for (const sig in S.cands) {
      const c = S.cands[sig];
      if (c.open && !found[sig]) {
        c.open = false;
        if (c.seq <= P6738_MAX_CAND) {
          log("exp6738: GONE#" + c.seq + " life=" + (now - c.first) + "ms sinceSeen=" + (now - c.last) + "ms");
        }
      }
      if (c.open) openSeqs.push(c.seq);
    }
    const on = openSeqs.length > 0;
    if (S.ticks === 1) {
      // 首轮基线:若此刻已有强命中,后面 ON/OFF 时间线都要带这个底噪解读
      log("exp6738: BASELINE open=" + openSeqs.length + " [" + openSeqs.join(",") + "] nodes=" + scanned);
    }
    if (on !== S.dotsOn) {
      S.dotsOn = on;
      if (on) {
        S.lastOn = now;
        if (S.ticks > 1) log("exp6738: DOTS ON t=+" + (now - S.t0) + "ms open=[" + openSeqs.join(",") + "]");
      } else {
        S.lastOff = now;
        if (S.ticks > 1) log("exp6738: DOTS OFF t=+" + (now - S.t0) + "ms 持续=" + (now - S.lastOn) + "ms");
      }
    }
  }

  function p6738ScanRows(S) {
    const conts = p6738Containers();
    for (let ci = 0; ci < conts.length; ci += 1) {
      const key = conts[ci].k, p = conts[ci].p;
      if (!isValid(p)) continue;
      const count = childCount(p);
      if (!(key in S.rows)) { S.rows[key] = count; continue; } // 首见容器:基线,不 dump 历史行
      let start = S.rows[key];
      if (count < start) {
        log("exp6738: RESET " + key + " " + start + "->" + count);
        start = 0; // 容器清空/重建,镜像主扫描逻辑从头算
      }
      for (let i = start; i < count; i += 1) p6738DumpRow(S, childAt(p, i), key, i);
      S.rows[key] = count;
    }
  }

  function p6738DumpRow(S, row, key, idx) {
    if (!isValid(row)) return;
    if (S.rowsLogged >= P6738_MAX_ROWS) {
      if (!S.rowCap) { S.rowCap = true; log("exp6738: row dump cap " + P6738_MAX_ROWS + " reached"); }
      return;
    }
    S.rowsLogged += 1;
    const now = nowMs();
    let cls = "", ty = "?";
    try { if (row.GetPanelClassList) cls = String(row.GetPanelClassList().join(",")); } catch (e) {}
    try { if (typeof row.type === "string") ty = row.type; } catch (e) {}
    const txt = collectText(row).slice(0, 100);
    let rec = null;
    try { rec = readMessageRow(row); } catch (e) {}
    // dots/sinceDotsOn:行到达时三点窗口状态(相关性的核心字段)
    log("exp6738: ROW " + key + "[" + idx + "] quick=" + (rec ? (rec.quick ? 1 : 0) : "?") +
      " own=" + (rec ? (rec.isOwn ? 1 : 0) : "?") +
      " dots=" + (S.dotsOn ? 1 : 0) +
      " sinceDotsOn=" + (S.lastOn ? now - S.lastOn : -1) +
      " t=+" + (now - S.t0) + "ms" +
      " type=" + ty + " cls=[" + cls + "] txt=" + JSON.stringify(txt));
    // 子树 dump(深度≤4,≤32 节点):行上有没有游戏自带的类型标记,一眼可见
    const lines = [];
    const visit = function (p, depth) {
      if (!isValid(p) || depth > 4 || lines.length >= 32) return;
      let id = "", c = "", t = "?";
      try { id = String(p.id || ""); } catch (e) {}
      try { if (p.GetPanelClassList) c = String(p.GetPanelClassList().join(" ").split(" ").join(".")); } catch (e) {}
      try { if (typeof p.type === "string") t = p.type; } catch (e) {}
      const tx = safeText(p).slice(0, 40);
      let wh = "";
      try {
        if (typeof p.GetActualLayoutWidth === "function") wh = " " + p.GetActualLayoutWidth() + "x" + p.GetActualLayoutHeight();
      } catch (e) {}
      lines.push(new Array(depth + 1).join("  ") + t + "#" + (id || "-") + (c ? "." + c : "") + wh + (tx ? " " + JSON.stringify(tx) : ""));
      const n = childCount(p);
      for (let i = 0; i < n; i += 1) visit(childAt(p, i), depth + 1);
    };
    visit(row, 0);
    for (let i = 0; i < lines.length; i += 1) log("exp6738: tree " + lines[i]);
  }


  // ============= EXP6739:隐藏 HTML 面板 https 导航可行性(2026-10-15)=============
  // 问题:exp6729 判死矩阵只覆盖 file:// 与 http://(含 localhost/127.0.0.1),
  //       **https:// 全家从未测过**;而"给面板一个受信任的本机 https"(自签证书 +
  //       写入 CurrentUser\Root + 信任后完全重启 Steam)这个方案本身来自一款 GPL-3.0
  //       同类实现 —— 我们此前没有这个方案。逐项对账见 docs/btipc-https-v1.md §2。
  // 判据一字不改沿用 6729:src="" = 引擎压根没开始加载(硬死签名);
  //       panel.title / GetAttributeString("title") 读回复;最终以服务端 HIT 日志为最硬判据。
  // 三臂共用 chat.xml 里已声明的 LCTBridgePanel —— 运行时 $.CreatePanel("HTML") 无效(见核心注释),
  // 所以本探针绝不自己造面板,只复用已声明的那一个,顺序执行避免 supersede 竞争。
  // 服务端:node scripts\probe_https_server.js(http 对照 8792 / https 实验 8793,同一页面同一判据)
  var EXP6739_ARMS = [
    { id: "A1-http-localhost", url: "http://localhost:8792/bridge?id=exp6739a1&t=lct-alive" },
    { id: "B1-https-localhost", url: "https://localhost:8793/bridge?id=exp6739b1&t=lct-alive" },
    { id: "A2-http-ip", url: "http://127.0.0.1:8792/bridge?id=exp6739a2&t=lct-alive" }
  ];
  var EXP6739_AT = [600, 1500, 3000, 4500]; // ms 采样点
  var EXP6739_ARM_MS = 6000; // 每臂总时长

  // ============= EXP6740:公网 https 对照(2026-10-15)=============
  // 上一轮把"引擎不认用户信任库证书"当成了定论,但用户质疑得对:那套 X509_STORE 是 Valve
  // 校验自身模块签名用的,与用户证书无关。于是根因仍有三种可能,而它们对产品的影响天差地别:
  //   (a) 信任锚为空        -> 一切 https 都死(含公网),本地 https 结案
  //   (b) 只认内嵌 DigiCert 根 -> 只有 DigiCert 签发的公网证书能用
  //   (c) 读 Windows 机器级 store -> LocalMachine\Root + 管理员可能有救(未测)
  // 用公网站点把 (a)/(b) 分开:P1 是 DigiCert 根(与二进制内嵌的唯一公共根同源),
  // P2 是 ISRG 根(不同根)。P1 通而 P2 不通 => 坐实 (b)。P3 是公网 http 对照,
  // 用来区分"scheme 门只针对 loopback"还是"全面封 http"。
  // 判读:src 变非空 = 导航真的开始了(这比 title 更硬,公网页面标题我们控制不了);
  //       title/attrTitle 非空 = 页面连标题都读回来了。
  // 说明:这三条只是让游戏向公开网站发一次普通 GET(只读探测),不带任何聊天内容或本机信息。
  var EXP6740_ARMS = [
    { id: "P1-https-digicert", url: "https://www.digicert.com/" },
    { id: "P2-https-letsencrypt", url: "https://letsencrypt.org/" },
    { id: "P3-http-example", url: "http://example.com/" },
    { id: "P4-https-google", url: "https://www.google.com/generate_204" }
  ];
  var EXP6740_AT = [1200, 3000, 6000, 10000]; // 公网更慢,采样点拉长
  var EXP6740_ARM_MS = 14000;

  function exp6739Snap(panel) {
    var src = "", ttype = "?", tval = "", attr = "";
    try { src = panel.GetAttributeString ? String(panel.GetAttributeString("src", "") || "") : ""; } catch (e) {}
    try { ttype = typeof panel.title; } catch (e) { ttype = "throw"; }
    try { tval = String(panel.title || ""); } catch (e) {}
    try { attr = panel.GetAttributeString ? String(panel.GetAttributeString("title", "") || "") : ""; } catch (e) {}
    return "src=" + JSON.stringify(src.slice(0, 48)) +
      " titleType=" + ttype + " title=" + JSON.stringify(tval.slice(0, 32)) +
      " attrTitle=" + JSON.stringify(attr.slice(0, 32));
  }

  function expArmRun(panel, arms, at, armMs, idx, tag) {
    if (idx >= arms.length) { log(tag + ": ALL ARMS DONE(" + arms.length + " 臂跑完)"); return; }
    var a = arms[idx];
    var threw = "";
    log(tag + ": ARM " + a.id + " START url=" + a.url);
    try { panel.SetURL(a.url); }
    catch (e) { threw = expErr(e); log(tag + ": ARM " + a.id + " SetURL THREW " + threw); }
    var last = "";
    for (var s = 0; s < at.length; s++) {
      (function (delay) {
        try {
          $.Schedule(delay / 1000, function () {
            if (!isValid(panel)) { log(tag + ": ARM " + a.id + " panel invalid @" + delay + "ms"); return; }
            var snap = exp6739Snap(panel);
            var mark = (snap === last) ? " (same)" : " *CHANGED*";
            last = snap;
            log(tag + ": ARM " + a.id + " t=+" + delay + "ms " + snap + mark);
          });
        } catch (e) {}
      })(at[s]);
    }
    try {
      $.Schedule(armMs / 1000, function () {
        var snap = isValid(panel) ? exp6739Snap(panel) : "panel-invalid";
        var verdict = "UNKNOWN";
        var titleSeen = "";
        try {
          var m = snap.match(/src=(".*?")/);
          var src = m ? JSON.parse(m[1]) : "";
          var tm = snap.match(/attrTitle=(".*?")/);
          titleSeen = tm ? JSON.parse(tm[1]) : "";
          if (snap.indexOf("lct-alive") >= 0) verdict = "LOADED-TITLE-OK(自家页面)";
          else if (!src) verdict = "DEAD-src-empty(引擎压根没开始加载)";
          else if (titleSeen) verdict = "NAV-STARTED+有标题(" + titleSeen.slice(0, 40) + ")";
          else verdict = "NAV-STARTED(导航已开始,标题暂空)";
        } catch (e) {}
        log(tag + ": ARM " + a.id + " VERDICT=" + verdict + " | " + snap +
          " | seturlThrew=" + (threw ? "yes" : "no") +
          " | 本地臂交叉核对 logs\\probe_https.log 的 HIT / tlsClientError");
        expArmRun(panel, arms, at, armMs, idx + 1, tag);
      });
    } catch (e) { log(tag + ": ARM " + a.id + " schedule THREW " + expErr(e)); }
  }

  function runExp6739() {
    if (State.exp6739Running) { log("exp6739: already running, skip"); return; }
    var panel = null;
    try { panel = findChild(getRoot(), "LCTBridgePanel"); } catch (e) {}
    if (!isValid(panel)) { log("exp6739: ABORT — chat.xml 里没找到 LCTBridgePanel(声明丢了?)"); return; }
    State.exp6739Running = true;
    State.exp6739Pass = (State.exp6739Pass || 0) + 1;
    log("exp6739: START pass=" + State.exp6739Pass + " ver=" + VERSION +
      " | SetURL=" + (typeof panel.SetURL === "function" ? "yes" : "NO") +
      " | titleType=" + (typeof panel.title) +
      " | 需先跑 node scripts\\probe_https_server.js");
    expArmRun(panel, EXP6739_ARMS, EXP6739_AT, EXP6739_ARM_MS, 0, "exp6739");
    try {
      $.Schedule((EXP6739_ARMS.length * EXP6739_ARM_MS) / 1000 + 3, function () {
        State.exp6739Running = false;
        log("exp6739: FINISH(共用面板已复位,不影响核心 BTIPC)");
      });
    } catch (e) {}
  }
  // EXP6740:公网 https 对照。上一轮只测了本地臂,分不开"信任锚为空"与"只认内嵌 DigiCert 根",
  // 所以这一轮直接拿公网站点分;这三条只是普通 GET(只读),不带任何聊天内容或本机信息。
  function runExp6740() {
    if (State.exp6740Running) { log("exp6740: already running, skip"); return; }
    var panel = null;
    try { panel = findChild(getRoot(), "LCTBridgePanel"); } catch (e) {}
    if (!isValid(panel)) { log("exp6740: ABORT — chat.xml 里没找到 LCTBridgePanel"); return; }
    State.exp6740Running = true;
    log("exp6740: START ver=" + VERSION +
      " | 读法:src 变非空 = 导航真的开始(硬判据);title/attrTitle 有值 = 页面标题都读回来了" +
      " | 期望:P1(DigiCert根)通 ⇒ 信任锚含 DigiCert;P1通P2(ISRG根)不通 ⇒ 只认 DigiCert;全不通 ⇒ 信任锚为空");
    expArmRun(panel, EXP6740_ARMS, EXP6740_AT, EXP6740_ARM_MS, 0, "exp6740");
    try {
      $.Schedule((EXP6740_ARMS.length * EXP6740_ARM_MS) / 1000 + 3, function () {
        State.exp6740Running = false;
        log("exp6740: FINISH(共用面板已复位,不影响核心 BTIPC)");
      });
    } catch (e) {}
  }

  // 2026-10-15 实验已收官:那轮结论是"HTML 面板 SetURL 对所有 http/https 一律失效,
  // BTIPC 位泵是唯一可用通道"。**该结论已被后续定位取代**(拦点是证书链,不是协议/地址,
  // 见上面 exp6742 处的说明),不要拿它当"面板通道不可能work"的依据。
  // **默认不自动跑**(免得每次开机白刷 8 条臂的日志)。需要复测时打开下面 3 行,
  // 或在控制台直接调 globalThis.LCTNS.runExp6739() / runExp6740()。
  // try {
  //   $.Schedule(12, function () { runExp6739(); });
  //   $.Schedule(42, function () { runExp6739(); });
  //   $.Schedule(75, function () { runExp6740(); });
  // } catch (e) {}
  // 本地臂前置条件:先跑 node scripts\probe_https_server.js(需 probe_localhost.pfx;
  // logs\probe_https.log 是最硬判据,务必先确认当次真的在监听再采信"全灭")。

  // ============= EXP6742:我们自己的 https 面板通道验证(2026-10-15)=============
  // 背景:实机对照证明"证书受信 + 完全重启 Steam"后隐藏 HTML 面板通道可用(参考实现侧
  // 计数 786、errors 0)。现在把同一条配方用在我们自己的桥上验证:
  //   桥侧已开 https://localhost:8792(证书 scripts\gen_bridge_cert.ps1 生成,含 IP SAN)。
  // 判读:title 出现 lct-alive = 页面加载了;出现 LCT<id> = 拿到应答。
  // H3 是 http 对照臂,预期仍然 DEAD(用来确认"只有 https 通",别把运气当结论)。
  var EXP6742_ARMS = [
    { id: "H1-https-localhost", url: "https://localhost:8792/bridge?op=health&id=exp6742a" },
    { id: "H2-https-ip", url: "https://127.0.0.1:8792/bridge?op=health&id=exp6742b" },
    { id: "H3-http-localhost", url: "http://localhost:8791/bridge?op=health&id=exp6742c" }
  ];
  var EXP6742_AT = [800, 2000, 4000];
  var EXP6742_ARM_MS = 6000;

  function runExp6742() {
    if (State.exp6742Running) { log("exp6742: already running, skip"); return; }
    var panel = null;
    try { panel = findChild(getRoot(), "LCTBridgePanel"); } catch (e) {}
    if (!isValid(panel)) { log("exp6742: ABORT — chat.xml 里没找到 LCTBridgePanel"); return; }
    State.exp6742Running = true;
    State.exp6742Pass = (State.exp6742Pass || 0) + 1;
    log("exp6742: START pass=" + State.exp6742Pass +
      " | 前置:已跑 gen_bridge_cert.ps1 -Trust 且**完全重启过 Steam**(只重启游戏无效)" +
      " | 判读:title=lct-alive → 页面加载;title=LCT<id> → 拿到应答;H3 http 对照预期仍 DEAD");
    expArmRun(panel, EXP6742_ARMS, EXP6742_AT, EXP6742_ARM_MS, 0, "exp6742");
    try {
      $.Schedule((EXP6742_ARMS.length * EXP6742_ARM_MS) / 1000 + 3, function () {
        State.exp6742Running = false;
        log("exp6742: FINISH(共用面板已复位,不影响核心 BTIPC)");
      });
    } catch (e) {}
  }
  // 两遍取双样本(第一遍可能在证书刚信任后仍被 Steam 缓存,第二遍确认)。
  //
  // 2026-10-15 晚:这两行**已注释掉**,原因是它会主动抢面板。
  // 隐藏 HTML 面板只有一个,生产通道(https 面板通道)与实验共用同一个单槽;开机 12s
  // 与 45s 各刷三臂共 6 次导航,会把正在飞的生产请求的 title 顶掉(读到陌生 title =
  // bad_bridge_payload 软失败),而且正好压在 config 同步与首几条翻译的窗口上。
  // 同理,上面 6739/6740 的"结论"也要更正:那轮只证明了"当时那种条件下全灭",
  // 真正的拦点是**证书链**(需 -Trust 且完全重启 Steam),https 本身是可用的 ——
  // 详见 docs/btipc-https-v1.md。现在通道生死由 lingua_chat.js 里开机自带的探针
  // 持续判定(日志 `https panel: ALIVE/...`),不再需要本文件定期开火。
  // 需要复测时打开下面 3 行,或直接调 globalThis.LCTNS.runExp6742()。
  // try {
  //   $.Schedule(12, function () { runExp6742(); });
  //   $.Schedule(45, function () { runExp6742(); });
  // } catch (e) {}

  // ---- P4a:向核心 expCall 晚绑定派发口发布探针入口(/bt* 命令链路)----
  globalThis.LCTNS = globalThis.LCTNS || {};
  globalThis.LCTNS.exp6734cSubmitHook = exp6734cSubmitHook;
  globalThis.LCTNS.runExp6734B = runExp6734B;
  globalThis.LCTNS.runExp6734C = runExp6734C;
  globalThis.LCTNS.runExp6734D = runExp6734D;
  globalThis.LCTNS.runExp6734E = runExp6734E;
  globalThis.LCTNS.runExp6738 = runExp6738;
  globalThis.LCTNS.runExp6739 = runExp6739;
  globalThis.LCTNS.runExp6740 = runExp6740;
  globalThis.LCTNS.runExp6742 = runExp6742;
})();
