// Babel Tower - lingua_chat.js 模拟测试器 v4
// 每个测试:独立面板树 + 先写配置再加载脚本(loadUiConfig 只在 boot 时读一次)
// 翻译走真实本地桥(127.0.0.1:8791)。用法: node lingua_chat_simtest.js
"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs");

// btipc05c:仿真器打通 BTIPC 下行 —— 桥 tail 只认真 console.log,游戏侧 TRQ/REQ 行
// 必须落盘桥才收得到;MockPanel 另补 SetImage(真 HTTP GET /btipc/dl),200 → 触发
// ImageLoaded 置位。缺这两处时 128 位恒 0 → 全零轮 → CRC 必败,表现为 frameFails
// 风暴 + "bridge offline" + 翻译全灭(属仿真环境缺口,非产品 bug)。
// 2026-10-15:游戏迁到 C:\SteamLibrary;DEADLOCK_ROOT 优先,兜底写新安装根。
const GAME_LOG =
  (process.env.DEADLOCK_ROOT || "C:/SteamLibrary/steamapps/common/Deadlock") +
  "/game/citadel/console.log";
let imageLoadedHandler = null;

// node 原生 setTimeout 引用:mock 基础设施必须用它,不查全局
// (test13 会摘掉全局 setTimeout 模拟 Panorama 环境,若 mock 依赖全局会被误炸)
const nativeSetTimeout = setTimeout;

const SCRIPT = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
// 2026-10-28:BTIPC 传输层拆到独立文件,装载顺序同 XML(先 btipc,后主脚本)
const SCRIPT_BTIPCS = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat_btipc.js");
// P4a(2026-10-12):实验探针区独立文件 —— 与游戏 include 顺序对齐(主脚本先行)
const SCRIPT_EXP = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat_exp.js");

// ---------------- Mock 面板 ----------------
// 环境隔离(2026-09-17):真实引擎里 UI 重载会销毁整个 JS 上下文,旧轮询链/挂起回调随之死亡;
// simtest 的 $ 与 setTimeout 是进程级全局,旧环境实例永生,其轮询链会借全局 $ 重新
// resolveHudMessages 到【当前】环境的面板树,用旧配置抢先送译(实锤:test10 窗口内出现
// 多个旧实例 token 的扫描记录,cfgOwn=true ≠ 当前环境配置)。freshEnv 创建新环境时
// 取消上一环境注册的所有 $.Schedule 定时器与桥请求回调 = 等价引擎的上下文销毁语义。
let envTimers = [];
let uid = 0;
class MockPanel {
  constructor(id, parent) {
    this._id = id || ("p" + (++uid));
    this._parent = parent || null;
    this._children = [];
    this._classes = new Set();
    this._deleted = false;
    this.text = "";
    this.title = "";
    this.style = { visibility: "visible" };
    this._attrs = {};
    this.__lctSig = undefined;
    this.__lctProcessed = false;
    this._submits = [];
    this._focused = false;
  }
  // btipc05c:Panorama Panel 暴露只读 .id —— 游戏侧 ImageLoaded 处理器读 panel.id 判
  // BTIPCD* 前缀后才 st.fire[p]=1。原 mock 只有 _id → String(panel.id)="undefined"
  // → 前缀不匹配提前 return → 128 位永不置 1 → 全零轮 → CRC 恒败。
  // 这是仿真器 27 个 FAIL 的真正根因(环境缺口,非产品 bug)。
  get id() { return this._id; }
  IsValid() { return !this._deleted; }
  GetParent() { return this._parent; }
  GetChildCount() { return this._children.length; }
  GetChild(i) { return this._children[i] || null; }
  BHasClass(c) { return this._classes.has(c); }
  AddClass(c) { this._classes.add(c); }
  RemoveClass(c) { this._classes.delete(c); }
  SetFocus() { this._focused = true; }
  GetAttributeString(k, def) { return this._attrs[k] !== undefined ? this._attrs[k] : def; }
  SetAttributeString(k, v) { this._attrs[k] = v; }
  DeleteAsync() {
    if (this._parent) {
      const i = this._parent._children.indexOf(this);
      if (i >= 0) this._parent._children.splice(i, 1);
    }
    this._deleted = true;
    this._parent = null;
  }
  FindChildTraverse(id) {
    if (this._id === id) return this;
    for (const c of this._children) {
      const r = c.FindChildTraverse(id);
      if (r) return r;
    }
    return null;
  }
  FindChildrenWithClassTraverse(cls) {
    const out = [];
    if (this._classes.has(cls)) out.push(this);
    for (const c of this._children) out.push(...c.FindChildrenWithClassTraverse(cls));
    return out;
  }
  addChild(panel) { panel._parent = this; this._children.push(panel); return panel; }
  setClass(...cs) { cs.forEach((c) => this._classes.add(c)); return this; }
}

// btipc05c:图片面板下行(§3.1)—— 200 = 位1(触发 ImageLoaded 置位),404/出错 = 位0
MockPanel.prototype.SetImage = function (url) {
  const panel = this;
  globalThis.__imgSet = (globalThis.__imgSet || 0) + 1;
  if (globalThis.__imgSet === 1) console.log("[LCT-sim][dbg] SetImage FIRST url=" + String(url).slice(0, 110));
  try {
    const req = http.get(url, (res) => {
      globalThis.__imgHttp = (globalThis.__imgHttp || 0) + 1;
      if (globalThis.__imgHttp === 1) console.log("[LCT-sim][dbg] SetImage HTTP FIRST status=" + res.statusCode);
      if (res.statusCode === 200) {
        globalThis.__img200 = (globalThis.__img200 || 0) + 1;
        res.resume();
        nativeSetTimeout(() => {
          if (imageLoadedHandler) {
            globalThis.__imgFire = (globalThis.__imgFire || 0) + 1;
            if (globalThis.__imgFire === 1) console.log("[LCT-sim][dbg] ImageLoaded handler FIRST fire");
            try { imageLoadedHandler(panel); } catch (e) { console.log("[LCT-sim][dbg] handler THREW " + e.message); }
          } else if (!globalThis.__imgNoHandler) {
            globalThis.__imgNoHandler = true;
            console.log("[LCT-sim][dbg] imageLoadedHandler IS NULL at fire time");
          }
        }, 0);
      } else { res.resume(); }
    });
    req.on("error", (e) => { if (!globalThis.__imgErr) { globalThis.__imgErr = true; console.log("[LCT-sim][dbg] SetImage HTTP ERR " + e.message); } });
    req.setTimeout(4000, () => { try { req.destroy(); } catch (e) {} });
  } catch (e) { console.log("[LCT-sim][dbg] SetImage THREW " + e.message); }
};

// ---------------- 独立环境:面板树 + $ + 配置 + 模块加载 ----------------
// ---------- 隐藏 HTML 面板的页面仿真(2026-10-15 改造) ----------
// 真引擎里:面板导航到 https:// 页面 → 页面 JS 在**桥这一侧**同源 fetch 完
// /api/v1/translate,再把整条结果一次写进 document.title;引擎只认一个 RTT。
// 若 https 证书不被信任,引擎在 LoadPage 之前就拒掉,页面从不加载(title 恒空)。
//
// 旧 mock 无视 URL 里的 scheme/host,一律直连 POST 8791 —— 那等于把 https 通道也
// 假成功,降级路径永远测不到(而且 BTIPC 与面板两条路都测不出差别)。现在照抄语义,
// 并留三种故障开关:
//   httpsBroken  : 证书未受信 / Steam 未重启 → 引擎拒 https,页面从不加载
//   aliveOnly    : 页面 alive 到了但结果始终不来(软失败那类,不触发降级)
//   op=health    : 探针专用,回 {ok:true} 而不是翻译结果
let panelSim = null;

function freshEnv(cfg) {
  // 上一环境的所有定时器与挂起桥回调在此终止(见 envTimers 注释)
  for (const tid of envTimers) { try { clearTimeout(tid); } catch (e) {} }
  envTimers = [];
  panelSim = { navUrls: [], httpsBroken: false, aliveOnly: false };
  delete require.cache[require.resolve(SCRIPT)];
  delete require.cache[require.resolve(SCRIPT_BTIPCS)];
  delete require.cache[require.resolve(SCRIPT_EXP)];

  const contextPanel = new MockPanel("ContextPanel");
  const chatPanel = contextPanel.addChild(new MockPanel("Chat"));
  const messagesPanel = chatPanel.addChild(new MockPanel("ChatMessages"));
  // ChatControls 区(输入框+桥状态圆点+出站失败提示):与 chat.xml 同构
  const chatControls = chatPanel.addChild(new MockPanel("ChatControls"));
  chatControls.addChild(new MockPanel("ChatTargetLabel"));
  chatControls.addChild(new MockPanel("ChatInput"));
  chatControls.addChild(new MockPanel("LCTOutgoingFailTip"));
  chatControls.addChild(new MockPanel("LCTBridgeDot"));
  // 设置面板(与 chat.xml 同构):TextEntry 焦点处理测试用
  const settingsPanel = contextPanel.addChild(new MockPanel("LCTSettingsPanel"));
  const settingsBody = settingsPanel.addChild(new MockPanel("LCTSettingsBody"));
  settingsBody.addChild(new MockPanel("LCTEnabled"));
  settingsBody.addChild(new MockPanel("LCTApiKey"));
  settingsBody.addChild(new MockPanel("LCTTimeout"));
  const bridgePanel = contextPanel.addChild(new MockPanel("LCTBridgePanel"));
  // HUD 顶栏聊天(与真实 citadel_hud_top_bar_chat.vxml 同构)
  // 关键:CitadelHudTopBarChat 是面板 TYPE 不是 class → FindChildrenWithClassTraverse 找不到,
  // 只能靠固定 id(Team1Chat/Team2Chat)查找。这里不 setClass(type),仅设 id。
  const hudChat = contextPanel.addChild(new MockPanel("Team1Chat"));
  const hudMessages = hudChat.addChild(new MockPanel("Messages"));
  const hudChat2 = contextPanel.addChild(new MockPanel("Team2Chat"));
  const hudMessages2 = hudChat2.addChild(new MockPanel("Messages"));

  bridgePanel.SetURL = function (url) {
    const q = new URL(url, "http://x").searchParams;
    const id = q.get("id") || "x";
    const text = q.get("text") || "";
    const source = q.get("source") || "auto";
    const target = q.get("target") || "zh-Hans";
    const op = q.get("op") || "translate";
    const isHttps = String(url).indexOf("https://") === 0;
    panelSim.navUrls.push(String(url));
    // 故障一:证书未受信 / Steam 没重启 —— 引擎在 LoadPage 之前拒掉,页面从不加载。
    if (isHttps && panelSim.httpsBroken) return;
    // 故障二:页面 alive 到了但结果始终不来(软失败,不该触发降级交接)。
    const aliveOnly = panelSim.aliveOnly;
    envTimers.push(nativeSetTimeout(() => {
      if (bridgePanel._deleted) return;
      bridgePanel.title = "lct-alive"; // 真页面第一件事就是置 alive
      if (aliveOnly) return;
      // 探针(op=health)要的是健康应答,不是翻译结果 —— 真页面同样走 GET /api/v1/health。
      if (op === "health") {
        bridgePanel.title = "LCT" + id + JSON.stringify({ ok: true, name: "Babel Tower Bridge", sim: true });
        return;
      }
      const body = JSON.stringify({ text, sourceLanguage: source, targetLanguage: target });
      const req = http.request({
        host: "127.0.0.1", port: 8791, path: "/api/v1/translate",
        method: "POST", headers: { "Content-Type": "application/json" }, timeout: 15000,
      }, (res) => {
        let data = "";
        res.on("data", (c) => { data += c; });
        res.on("end", () => {
          let payload = { ok: false, error: "bad_response" };
          try { payload = JSON.parse(data); } catch (e) {}
          bridgePanel.title = "LCT" + id + JSON.stringify(payload);
        });
      });
      req.on("error", () => { bridgePanel.title = "LCT" + id + JSON.stringify({ ok: false, error: "bridge_fetch_error" }); });
      req.write(body); req.end();
    }, 0));
  };

  contextPanel.SetAttributeString("lct_ui", JSON.stringify(cfg)); // UI_CONVAR = "lct_ui"

  // 当前"聚焦"面板(模拟 TextEntry 获得焦点) + DropInputFocus 调用记录
  let focusedPanel = null;
  const dispatchLog = [];
  globalThis.$ = {
    Msg: (...a) => {
      console.log("[LCT-sim]", ...a);
      // btipc05c:仅把 BTIPC TRQ/REQ 行落到真 console.log(桥 tail 自 [LCT] 起解析)。
      // 只落这两类行 —— 全量落盘等于在仿真里重演一次 console.log 涌塞。
      const line = a.map(String).join(" ");
      if (line.indexOf("[LCT] BTIPC TRQ ") === 0 || line.indexOf("[LCT] BTIPC REQ ") === 0) {
        try {
          const d = new Date();
          const p2 = (n) => ("0" + n).slice(-2);
          const stamp = (d.getMonth() + 1) + "/" + d.getDate() + " " +
            p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds());
          fs.appendFileSync(GAME_LOG, stamp + " [PanoramaScript] " + line + "\n", "utf8");
        } catch (e) {}
      }
    },
    Schedule: (sec, fn) => { const tid = nativeSetTimeout(fn, sec * 1000); envTimers.push(tid); return tid; },
    CreatePanel: (type, parent, id) => parent.addChild(new MockPanel(id)).setClass(type === "Label" ? "Label" : type),
    // btipc05c:原为空桩 → ImageLoaded 永不登记 → 128 位恒 0 → CRC 必败。现捕获处理器。
    RegisterForUnhandledEvent: (name, fn) => {
      if (name === "ImageLoaded") {
        imageLoadedHandler = fn;
        console.log("[LCT-sim][dbg] ImageLoaded handler REGISTERED");
      }
      return 0;
    },
    DispatchEvent: (name, target) => { dispatchLog.push({ name, target }); },
    GetContextPanel: () => focusedPanel || contextPanel,
  };
  globalThis.Convars = { GetStr: () => "", RegisterConVar: () => {}, SetValue: () => {} };

  // 快捷语音模板兑底语料 + 专名表(模拟游戏 xml 的 include 顺序:先语料后主脚本)
  require(path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat_quickchat_fallback.js"));
  require(path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat_gamenames_fallback.js"));
  // require 是模块作用域,生成的全局用 var 赋值会挂到 globalThis;若主脚本 typeof 检查失败,手动补挂
  if (typeof globalThis.LCT_QUICKCHAT_FALLBACK_TEMPLATES === "undefined" && globalThis.LCT_QUICKCHAT_FALLBACK_TEMPLATES !== undefined) {
    // noop
  }

  require(SCRIPT_BTIPCS); // 传输层:先装载,主脚本顶层 const 别名解构 LCTBTIPC
  require(SCRIPT);
  require(SCRIPT_EXP); // 探针文件:依赖核心先求值发布的 LCTNS,顺序不可倒

  return {
    cfg, // 场景配置快照:waitBootSync 后回写 State.cfg(桥同步会以真机偏好覆盖)
    panelSim, // 面板页面仿真状态(httpsBroken / aliveOnly / navUrls),见上方说明
    contextPanel, messagesPanel, hudMessages, hudMessages2, settingsPanel, dispatchLog,
    setFocusedPanel(p) { focusedPanel = p; },
    addRow(kind, sender, text, opts) {
      const row = new MockPanel(null).setClass("ChatMessage", "Expired");
      if (opts && opts.own) row.setClass("IsSelf");
      row.addChild(new MockPanel("SenderImage"));
      const body = row.addChild(new MockPanel(null).setClass("MessageBody"));
      const source = body.addChild(new MockPanel("MessageSource"));
      source.addChild(new MockPanel(null).setClass("ChannelName")).text = (opts && opts.channel) || "chat";
      source.addChild(new MockPanel(null).setClass("SenderName")).text = sender;
      const contents = body.addChild(new MockPanel("MessageContents"));
      if (kind === "ping") {
        contents.setClass("Ping");
        contents.addChild(new MockPanel("PingLabel")).text = text;
      } else {
        contents.setClass("Text");
        contents.addChild(new MockPanel(null)).text = text;
      }
      messagesPanel.addChild(row);
      return row;
    },
    // HUD 顶栏气泡行(真实结构:ChatMessage -> MessageContents -> ChatBubble -> TextContainer -> MessageText)
    addHudRow(text, opts) {
      const row = new MockPanel(null).setClass("ChatMessage");
      if (opts && opts.own) row.setClass("IsSelf");
      const contents = row.addChild(new MockPanel("MessageContents"));
      const bubble = contents.addChild(new MockPanel(null).setClass("ChatBubble"));
      const tc = bubble.addChild(new MockPanel(null).setClass("TextContainer"));
      tc.addChild(new MockPanel(null).setClass("bubble_bg"));
      tc.addChild(new MockPanel("MessageText")).text = text;
      bubble.addChild(new MockPanel("HeroImage"));
      contents.addChild(new MockPanel(null).setClass("ResponsesContainer"));
      hudMessages.addChild(row);
      return row;
    },
    recycleRow(row, kind, sender, text, opts) {
      const contents = row.FindChildTraverse("MessageContents");
      contents._children = [];
      contents._classes.clear();
      if (kind === "ping") {
        contents.setClass("Ping");
        contents.addChild(new MockPanel("PingLabel")).text = text;
      } else {
        contents.setClass("Text");
        contents.addChild(new MockPanel(null)).text = text;
      }
      const source = row.FindChildTraverse("MessageSource");
      const sn = source.FindChildrenWithClassTraverse("SenderName")[0];
      if (sn) sn.text = sender;
      if (opts && opts.own) row.setClass("IsSelf"); else row._classes.delete("IsSelf");
    },
    // 模拟玩家输入并回车(触发 handleChatSubmit)
    submitChat(text) {
      const input = contextPanel.FindChildTraverse("ChatTextEntry") || (() => {
        const c = chatPanel.addChild(new MockPanel("ChatTextEntry"));
        c.text = "";
        return c;
      })();
      input.text = text;
      $.DispatchEvent("TextEntrySubmit", input);
      return input;
    },
  };
}

const CFG = {
  translationOnly: { enabled: true, displayMode: "translation_only", targetLanguage: "zh-Hans", force: false, outgoing: "off", provider: "bing", timeoutMs: 15000 },
  bilingual: { enabled: true, displayMode: "bilingual", targetLanguage: "zh-Hans", force: false, outgoing: "off", provider: "bing", timeoutMs: 15000 },
  outgoingTranslation: { enabled: true, displayMode: "bilingual", targetLanguage: "zh-Hans", force: false, outgoing: "translation", outgoingTarget: "zh-Hans", provider: "bing", timeoutMs: 15000 },
};

// ---------------- 断言与工具 ----------------
let passCount = 0, failCount = 0;
function assert(name, cond, extra) {
  if (cond) { passCount++; console.log("  PASS " + name); }
  else { failCount++; console.log("  FAIL " + name + (extra ? "  [" + extra + "]" : "")); }
}
function bodyOf(row) {
  const found = row.FindChildrenWithClassTraverse("MessageBody");
  return found.length ? found[0] : null;
}
function labelsOf(row) {
  const body = bodyOf(row);
  return body ? body._children.filter((c) => c.BHasClass("LCTTranslation")) : [];
}
function sleep(ms) { return new Promise((r) => nativeSetTimeout(r, ms)); }
async function waitFor(cond, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if (cond()) return true; } catch (e) {}
    await sleep(200);
  }
  return false;
}

// TRQ 应答回程补齐(2026-10-12):boot 的 op=config 是 BTIPC 单槽的首个在途作业
// (maskCompact 38 帧 x ~600ms/帧 ~= 24s 实测,实车最坏 43s;btipc05d 读死线 50s)。
// 翻译类场景若在同步完成前动作:入站 chat 只肯等 6x0.5s/12s -> 掉死旧通道 settle
// -> 0 标签;出站排队 >15s -> 丢弃发原文。这是此前 27 败的主因(与 P4 正交,HEAD
// 基线同败);另两根因由同窗一并治掉:syncBridgeConfig 以真机偏好覆盖场景配置
// (displayMode/outgoingTarget/force -> applyScenarioCfg 同步后回写)、test20 旧句式
// "我看到 McGinnis" 已不在现行 loc(与 tests/quickchat_match.test.js 同口径:游戏不再
// 产生的形态一律送翻译 -> 换现行语料真模板 "Stun {s:hero_name}")。
// 等条件:配置同步完成 + 队列排空 + 无在途 + BTIPC 槽空闲,计时窗才起。
function applyScenarioCfg(env) {
  try {
    const L = globalThis.LCTNS, S = L && L.State;
    if (!S || !S.cfg || !env || !env.cfg) return;
    // boot 的 op=config 同步会以桥端(真机)偏好覆盖这些字段(displayMode/outgoingTarget/force 等),
    // 场景语义必须以场景配置为准 —— 否则 translation_only 折叠、zh-Hans 出站、中文免翻全部失效
    const c = env.cfg;
    const keys = ["enabled", "displayMode", "targetLanguage", "force", "outgoing",
      "outgoingTarget", "provider", "timeoutMs", "translateOwn", "chatLog"];
    for (const k of keys) if (c[k] !== undefined) S.cfg[k] = c[k];
  } catch (e) { console.log("[LCT-sim][dbg] applyScenarioCfg ERR " + e.message); }
}

async function waitBootSync(env, timeoutMs) {
  const t0 = Date.now();
  const snap = () => {
    try {
      const L = globalThis.LCTNS, S = L && L.State;
      return "synced=" + !!(S && S.cfgSynced) + " syncing=" + !!(S && S.cfgSyncing) +
        " q=" + ((S && S.queue && S.queue.length) || 0) +
        " act=" + ((S && S.activeRequests) || 0) +
        " busy=" + !!(L && L.BTIPC && L.BTIPC.busy && L.BTIPC.busy());
    } catch (e) { return "LCTNS-read-ERR " + e.message; }
  };
  const ok = await waitFor(() => {
    try {
      const L = globalThis.LCTNS, S = L && L.State;
      if (!S || !S.cfgSynced || S.cfgSyncing) return false;
      if (S.queue && S.queue.length > 0) return false;
      if (S.activeRequests > 0) return false;
      if (L.BTIPC && L.BTIPC.busy && L.BTIPC.busy()) return false;
      return true;
    } catch (e) { return false; }
  }, timeoutMs || 75000);
  applyScenarioCfg(env);
  console.log("[LCT-sim][dbg] waitBootSync " + (ok ? "ok" : "TIMEOUT") +
    " t=" + (Date.now() - t0) + "ms " + snap());
  return ok;
}

// ---------------- 场景 ----------------
async function test1_injectAndCollapse() {
  console.log("\n[1] translation_only: english text -> label injected + original collapsed");
  const env = freshEnv(CFG.translationOnly);
  await waitBootSync(env);
  const row = env.addRow("text", "Alice", "hello can you push mid");
  const ok = await waitFor(() => labelsOf(row).length > 0, 10000);
  await sleep(300);
  const labels = labelsOf(row);
  const contents = row.FindChildTraverse("MessageContents");
  assert("translation label injected", ok && labels.length === 1 && labels[0].text.length > 0, labels[0] && labels[0].text);
  assert("label text is Chinese (not raw English)", labels[0] && labels[0].text.indexOf("hello") === -1, labels[0] && labels[0].text);
  assert("original collapsed (translation_only)", contents.style.visibility === "collapse", contents.style.visibility);
}

async function test2_recycleToChineseQuickChat() {
  console.log("\n[2] CORE FIX: row recycled to Chinese quick chat -> visibility restored + no stale label (no vanishing)");
  const env = freshEnv(CFG.translationOnly);
  await waitBootSync(env);
  const row = env.addRow("text", "Alice", "hello can you push mid");
  await waitFor(() => labelsOf(row).length > 0, 10000);
  await sleep(300);
  assert("precondition: collapsed", row.FindChildTraverse("MessageContents").style.visibility === "collapse");
  env.recycleRow(row, "ping", "Alice", "\u53bb\u4e2d\u8def"); // Chinese -> shouldSkip
  await waitFor(() => labelsOf(row).length === 0, 8000);
  const contents = row.FindChildTraverse("MessageContents");
  assert("original visibility restored", contents.style.visibility === "visible", contents.style.visibility);
  assert("stale label removed", labelsOf(row).length === 0, labelsOf(row).length + " left");
}

async function test3_recycleToAnotherEnglish() {
  console.log("\n[3] row recycled to another english msg -> new translation replaces old, no residue");
  const env = freshEnv(CFG.translationOnly);
  await waitBootSync(env);
  const row = env.addRow("text", "Alice", "hello can you push mid");
  await waitFor(() => labelsOf(row).length > 0, 10000);
  env.recycleRow(row, "text", "Alice", "retreat please");
  const got2 = await waitFor(() => labelsOf(row).length > 0, 10000);
  if (!got2) {
    // 二次翻译静默诊断:行级状态 + 队列/在途快照(复用行重处理链哪一环断了一目了然)
    try {
      const L = globalThis.LCTNS, S = L.State;
      console.log("[LCT-sim][dbg] test3 diag: sig=" + JSON.stringify(row.__lctSig) +
        " processed=" + !!row.__lctProcessed +
        " seen=" + S.seen.size + " q=" + S.queue.length + " act=" + S.activeRequests +
        " inflight=" + S.inflight.size + " cache=" + S.cache.size +
        " busy=" + L.BTIPC.busy() + " cfg.force=" + S.cfg.force +
        " cfg.target=" + S.cfg.targetLanguage + " cfg.outgoing=" + S.cfg.outgoing);
    } catch (e) { console.log("[LCT-sim][dbg] test3 diag ERR " + e.message); }
  }
  await sleep(300);
  const labels = labelsOf(row);
  assert("exactly 1 label (no residue)", labels.length === 1, labels.length + " labels");
  assert("label is current message translation", labels[0] && labels[0].text.length > 0 && labels[0].text.indexOf("retreat") === -1, labels[0] && labels[0].text);
  assert("original collapsed (translation_only)", row.FindChildTraverse("MessageContents").style.visibility === "collapse");
}

async function test4_bilingualNoCollapse() {
  console.log("\n[4] bilingual mode: original not collapsed");
  const env = freshEnv(CFG.bilingual);
  await waitBootSync(env);
  const row = env.addRow("text", "Bob", "gg wp");
  const ok = await waitFor(() => labelsOf(row).length > 0, 10000);
  const labels = labelsOf(row);
  assert("translation label injected", ok && labels.length === 1 && labels[0].text.length > 0, labels[0] && labels[0].text);
  assert("original stays visible (bilingual)", row.FindChildTraverse("MessageContents").style.visibility === "visible");
}

async function test5_pingBubbleKept() {
  // 2026-09-17 预期同步:record.quick → skip(游戏原生快捷短语已由游戏本地化,mod 再翻是劣质重复);
  // 旧预期"Ping 行也要翻译"是 9-17 设计落地前的陈旧断言(HEAD 基线挂了 4 天的测试债)。
  console.log("\n[5] quick chat (Ping form) -> skipped by design: zero API, zero label, bubble kept");
  const env = freshEnv(CFG.translationOnly);
  const row = env.addRow("ping", "Carol", "go mid");
  await sleep(3000);
  assert("no translation label (quick skip)", labelsOf(row).length === 0, labelsOf(row).length + " labels");
  assert("ping bubble NOT collapsed", row.FindChildTraverse("MessageContents").style.visibility === "visible");
}

async function test6_ownMessageSkipped() {
  console.log("\n[6] own message (IsSelf) with translateOwn=false: not translated, not collapsed");
  const env = freshEnv(Object.assign({}, CFG.translationOnly, { translateOwn: false }));
  const row = env.addRow("text", "Me", "hello team", { own: true });
  await sleep(1500);
  assert("no label", labelsOf(row).length === 0);
  assert("original visible", row.FindChildTraverse("MessageContents").style.visibility === "visible");
}

// 新:连续出站翻译——本次 bug 的核心回归
// 快速连续发 3 条不同英文消息,全部应被翻译后发送(此前只有最后一条能翻译)
async function test7_consecutiveOutgoing() {
  console.log("\n[7] BUG FIX: rapid consecutive distinct outgoing messages -> ALL translated (no supersede)");
  const env = freshEnv(CFG.outgoingTranslation);
  await waitBootSync(env);
  // 模拟输入框(ChatInput) + 捕获 stock submit 事件
  const input = env.contextPanel.FindChildTraverse("ChatInput") ||
    env.contextPanel.addChild(new MockPanel("ChatInput"));
  const submitted = [];
  const origDispatch = globalThis.$.DispatchEvent;
  globalThis.$.DispatchEvent = (name, panel) => {
    if (name === "CitadelChatInputSubmitted" && panel) {
      submitted.push(String(panel.text || ""));
    }
    origDispatch(name, panel);
  };

  const texts = ["hello team", "push mid please", "retreat now"];
  for (const t of texts) {
    input.text = t;
    globalThis.LCTOnChatSubmit(); // 等价于游戏里回车
    await sleep(400); // 需 > 150ms 防重窗口(真实用户打字间隔远大于此)
  }

  // 等待全部 3 条出站翻译完成(串行队列 + bing 首次预热)
  const ok = await waitFor(() => submitted.length >= 3, 30000);
  await sleep(500); // 等队列排空
  assert("all 3 messages eventually submitted", ok && submitted.length >= 3, submitted.length + " submits: " + JSON.stringify(submitted));
  const chinese = submitted.filter((s) => s && /[\u4e00-\u9fff]/.test(s));
  assert("all submitted texts are translated (Chinese)", submitted.length >= 3 && chinese.length >= 3, JSON.stringify(submitted));
  assert("no raw English leaked through", submitted.every((s) => s && s.indexOf("hello") === -1 && s.indexOf("push mid") === -1 && s.indexOf("retreat now") === -1), JSON.stringify(submitted));
  globalThis.$.DispatchEvent = origDispatch;
}

async function test8_consecutiveIncoming() {
  console.log("\n[8] rapid consecutive incoming messages -> both translated, no cross-contamination");
  const env = freshEnv(CFG.translationOnly);
  await waitBootSync(env);
  const row1 = env.addRow("text", "Alice", "hello can you push mid");
  const row2 = env.addRow("text", "Bob", "gg wp");
  const ok = await waitFor(() => labelsOf(row1).length > 0 && labelsOf(row2).length > 0, 20000);
  const l1 = labelsOf(row1)[0], l2 = labelsOf(row2)[0];
  assert("both rows translated", ok && !!l1 && !!l2, l1 && l1.text + " | " + l2 && l2.text);
  assert("row1 label is translation of msg1", l1 && l1.text.indexOf("hello") === -1 && l1.text.length > 0, l1 && l1.text);
  assert("row2 label is translation of msg2", l2 && l2.text.indexOf("gg") === -1 && l2.text.length > 0, l2 && l2.text);
}

// HUD 顶栏聊天翻译(方案 A:不改布局,扫描 CitadelHudTopBarChat 的 Messages 容器)
async function test9_hudTopBarTranslation() {
  console.log("\n[9] HUD top bar chat: english bubble -> translation injected inside bubble");
  const env = freshEnv(CFG.translationOnly);
  await waitBootSync(env);
  const row = env.addHudRow("hello can you push mid");
  const ok = await waitFor(() => row.FindChildrenWithClassTraverse("LCTTranslationHud").length > 0, 10000);
  await sleep(300);
  const labels = row.FindChildrenWithClassTraverse("LCTTranslationHud");
  const bubble = row.FindChildrenWithClassTraverse("ChatBubble")[0];
  const contents = row.FindChildTraverse("MessageContents");
  assert("translation label injected in HUD bubble", ok && labels.length === 1 && labels[0].text.length > 0, labels[0] && labels[0].text);
  assert("label text is Chinese (not raw English)", labels[0] && labels[0].text.indexOf("hello") === -1, labels[0] && labels[0].text);
  // 译文挂在 MessageContents 下(ChatBubble 正下方),不能在气泡旁边横向流里
  assert("label is child of MessageContents (below bubble)", labels[0] && labels[0].GetParent() === contents, "parent=" + (labels[0] && labels[0].GetParent() && labels[0].GetParent().GetType && labels[0].GetParent().GetType()));
  assert("label NOT inside ChatBubble", !(labels[0] && labels[0].GetParent() === bubble));
  assert("HUD bubble NOT collapsed (translation_only keeps bubble)", row.FindChildTraverse("MessageContents").style.visibility === "visible", row.FindChildTraverse("MessageContents").style.visibility);
}

async function test10_hudOwnMessageSkipped() {
  console.log("\n[10] HUD top bar chat: own message (IsSelf) with translateOwn=false -> not translated");
  const env = freshEnv(Object.assign({}, CFG.translationOnly, { translateOwn: false }));
  const row = env.addHudRow("hello team", { own: true });
  await sleep(1500);
  const labels = row.FindChildrenWithClassTraverse("LCTTranslationHud");

  assert("no translation label for own HUD message", labels.length === 0, labels.length + " labels");
}

// 回归:CitadelHudTopBarChat 是 type 不是 class,必须靠 id(Team1Chat/Team2Chat)发现两个实例
async function test11_hudBothTeamsFoundById() {
  console.log("\n[11] HUD both Team1Chat + Team2Chat discovered by id (not class)");
  const env = freshEnv(CFG.translationOnly);
  await waitBootSync(env);
  // Team1Chat 已由 addHudRow 使用;现在往 Team2Chat 也加一条英文消息
  const row2 = new MockPanel(null).setClass("ChatMessage");
  const contents2 = row2.addChild(new MockPanel("MessageContents"));
  const bubble2 = contents2.addChild(new MockPanel(null).setClass("ChatBubble"));
  const tc2 = bubble2.addChild(new MockPanel(null).setClass("TextContainer"));
  tc2.addChild(new MockPanel("MessageText")).text = "enemy team push now";
  env.hudMessages2.addChild(row2);
  const ok = await waitFor(() => row2.FindChildrenWithClassTraverse("LCTTranslationHud").length > 0, 10000);
  const labels = row2.FindChildrenWithClassTraverse("LCTTranslationHud");
  assert("Team2Chat row translated (found via Team2Chat id)", ok && labels.length === 1 && labels[0].text.length > 0, labels[0] && labels[0].text);
  assert("translation is Chinese", labels[0] && labels[0].text.indexOf("enemy") === -1, labels[0] && labels[0].text);
}

// !lcttest 测试命令:输入框提交 -> 注入 HUD 行 -> 走正常翻译流程
async function test12_lcttestCommand() {
  console.log("\n[12] !lcttest command: injects HUD test row -> translation appears");
  const env = freshEnv(CFG.translationOnly);
  await waitBootSync(env);
  const input = env.contextPanel.FindChildTraverse("ChatInput") ||
    env.contextPanel.addChild(new MockPanel("ChatInput"));
  input.text = "!lcttest hello world test";
  globalThis.LCTOnChatSubmit();
  const container = env.hudMessages; // Team1Chat Messages
  const ok = await waitFor(() => {
    for (let i = 0; i < container.GetChildCount(); i += 1) {
      const r = container.GetChild(i);
      if (r && r.FindChildrenWithClassTraverse("LCTTranslationHud").length > 0) return true;
    }
    return false;
  }, 10000);
  let label = null, row = null;
  for (let i = 0; i < container.GetChildCount(); i += 1) {
    const r = container.GetChild(i);
    const ls = r && r.FindChildrenWithClassTraverse("LCTTranslationHud");
    if (ls && ls.length > 0) { row = r; label = ls[0]; break; }
  }
  assert("HUD test row translated", ok && !!label && label.text.length > 0, label && label.text);
  assert("translation is Chinese (not raw english)", label && label.text.indexOf("hello") === -1, label && label.text);
  assert("test row is ChatMessage with ChatBubble", row && row.BHasClass("ChatMessage") && !!row.FindChildrenWithClassTraverse("ChatBubble").length);
  assert("row NOT collapsed (HUD rule)", row && row.FindChildTraverse("MessageContents").style.visibility === "visible", row && row.FindChildTraverse("MessageContents").style.visibility);
}

// 回归:8/6 崩溃现场——Panorama 无全局 setTimeout(修复前 dispatchJob 裸调 setTimeout 同步抛 ReferenceError)
// 修复后走 $.Schedule,不碰全局 setTimeout,必须正常完成出站翻译
async function test13_outgoingWithoutGlobalSetTimeout() {
  console.log("\n[13] REGRESSION (8/6 crash): outgoing translate works WITHOUT global setTimeout");
  const env = freshEnv(CFG.outgoingTranslation);
  await waitBootSync(env);
  const input = env.contextPanel.FindChildTraverse("ChatInput") ||
    env.contextPanel.addChild(new MockPanel("ChatInput"));
  const submitted = [];
  const origDispatch = globalThis.$.DispatchEvent;
  globalThis.$.DispatchEvent = (name, panel) => {
    if (name === "CitadelChatInputSubmitted" && panel) submitted.push(String(panel.text || ""));
    origDispatch(name, panel);
  };

  // 模拟真实 Panorama:摘掉全局 setTimeout,只留 $.Schedule(与 8/6 崩溃环境一致)
  const saved = globalThis.setTimeout;
  delete globalThis.setTimeout;
  let threw = null;
  try {
    input.text = "hello no settimeout test";
    globalThis.LCTOnChatSubmit();
  } catch (e) {
    threw = e;
  } finally {
    globalThis.setTimeout = saved;
  }

  assert("no ReferenceError: setTimeout is not defined", threw === null, threw && threw.message);
  if (threw) { globalThis.$.DispatchEvent = origDispatch; return; }

  // 等消息提交:桥正常则译文,桥慢/失败则 4s 超时兜底发原文(两者都算通过)
  const ok = await waitFor(() => submitted.length >= 1, 15000);
  const chinese = submitted.filter((s) => /[\u4e00-\u9fff]/.test(s));
  assert("message eventually submitted (translated or fallback)", ok && submitted.length >= 1, JSON.stringify(submitted));
  assert("translation happened (bridge up)", chinese.length >= 1, JSON.stringify(submitted));
  globalThis.$.DispatchEvent = origDispatch;
}

async function test14_outgoingFailShowsTip() {
  console.log("\n[14] outgoing translate FAIL => red tip + yellow dot flash (visible feedback)");
  const env = freshEnv(CFG.outgoingTranslation);
  const tip = env.contextPanel.FindChildTraverse("LCTOutgoingFailTip");
  const dot = env.contextPanel.FindChildTraverse("LCTBridgeDot");
  assert("tip panel exists", !!tip);
  assert("dot panel exists", !!dot);
  assert("dot default red (no classes)", !dot._classes.has("LCTBridgeUp") && !dot._classes.has("LCTBridgeFail"));

  // 直接触发出站失败提示(等价于 translateOutgoing 回调 !translated 分支)
  globalThis.showOutgoingFailTip();
  assert("tip text set", tip.text.indexOf("翻译失败") >= 0, tip.text);
  assert("tip visible", tip.style.visibility === "visible", tip.style.visibility);
  assert("dot flashed fail (yellow)", dot._classes.has("LCTBridgeFail"), [...dot._classes]);

  // 4s 后提示自动消失
  await waitFor(() => tip.style.visibility === "collapse" || tip.text === "", 6000);
  assert("tip auto-hidden after 4s", tip.style.visibility === "collapse" || tip.text === "", tip.text + " / " + tip.style.visibility);
}

async function test15_bridgeUpDotGreen() {
  console.log("\n[15] bridge online => dot turns green");
  const env = freshEnv(CFG.bilingual);
  const dot = env.contextPanel.FindChildTraverse("LCTBridgeDot");
  assert("dot exists", !!dot);
  // 模拟桥上线(等价于 markBridgeUp)
  globalThis.markBridgeUp();
  assert("dot green (LCTBridgeUp)", dot._classes.has("LCTBridgeUp"), [...dot._classes]);
  assert("dot not fail", !dot._classes.has("LCTBridgeFail"));
}

async function test16_entryBlurDropsFocusOnEntryItself() {
  console.log("[16] TextEntry blur => entry DropInputFocus + stock ChatInput blur path (engine keyboard restore)");
  const env = freshEnv(CFG.bilingual);
  const entry = env.settingsPanel.FindChildTraverse("LCTApiKey");
  const chatInput = env.contextPanel.FindChildTraverse("ChatInput");
  assert("LCTApiKey entry exists", !!entry);
  assert("stock ChatInput exists in tree", !!chatInput);
  env.setFocusedPanel(entry); // 模拟点击输入框后焦点在 TextEntry 上
  env.dispatchLog.length = 0;
  globalThis.LCTEntryBlur(entry);
  const blurEvt = env.dispatchLog.filter((d) => d.name === "CitadelChatInputBlur");
  const drops = env.dispatchLog.filter((d) => d.name === "DropInputFocus");
  assert("CitadelChatInputBlur dispatched (engine keyboard restore)", blurEvt.length >= 1, "count=" + blurEvt.length);
  assert("CitadelChatInputBlur targets stock ChatInput (not our entry)",
    blurEvt.length >= 1 && blurEvt[0].target === chatInput,
    blurEvt.length ? (blurEvt[0].target && blurEvt[0].target._id) : "none");
  assert("DropInputFocus dispatched for our entry", drops.length >= 1 && drops.some((d) => d.target === entry),
    "count=" + drops.length);
  assert("DropInputFocus dispatched for stock ChatInput", drops.some((d) => d.target === chatInput),
    "count=" + drops.length);
  assert("no SetFocus to settings panel (keyboard must return to game)",
    !env.settingsPanel._focused, "panel focused=" + env.settingsPanel._focused);
}

async function test17_entryEscReleasesFocusThenClosesPanel() {
  console.log("\n[17] ESC in TextEntry => stock ChatInput blur path, close panel, no root.SetFocus");
  const env = freshEnv(CFG.bilingual);
  const entry = env.settingsPanel.FindChildTraverse("LCTTimeout");
  const chatInput = env.contextPanel.FindChildTraverse("ChatInput");
  const panel = env.contextPanel.FindChildTraverse("LCTSettingsPanel");
  assert("settings panel exists", !!panel);
  panel.AddClass("LCTVisible"); // 模拟面板已打开
  env.setFocusedPanel(entry);
  env.dispatchLog.length = 0;
  globalThis.LCTEntryKey({ key: "Escape", KeyCode: 27 }, entry);
  const blurEvt = env.dispatchLog.filter((d) => d.name === "CitadelChatInputBlur");
  const drops = env.dispatchLog.filter((d) => d.name === "DropInputFocus");
  assert("CitadelChatInputBlur dispatched before closing", blurEvt.length >= 1, "count=" + blurEvt.length);
  assert("CitadelChatInputBlur targets stock ChatInput",
    blurEvt.length >= 1 && blurEvt[0].target === chatInput,
    blurEvt.length ? (blurEvt[0].target && blurEvt[0].target._id) : "none");
  assert("DropInputFocus dispatched for entry", drops.some((d) => d.target === entry), "count=" + drops.length);
  assert("DropInputFocus dispatched for stock ChatInput", drops.some((d) => d.target === chatInput),
    "count=" + drops.length);
  assert("panel hidden after ESC", !panel._classes.has("LCTVisible"), [...panel._classes]);
  assert("no SetFocus to root after close (keyboard returns to game)",
    !env.contextPanel._focused, "root focused=" + env.contextPanel._focused);
}

// 新:混合消息(中文+英文专名,典型:英文英雄名设置下的快捷语音渲染)
// 中文部分原样保留,只把非中文片段送去翻译;原文气泡不折叠
async function test18_mixedMessageFragmentTranslation() {
  console.log("\n[18] CORE FIX: mixed message (Chinese + English name) -> only fragment translated, original kept");
  const env = freshEnv(CFG.translationOnly);
  await waitBootSync(env);
  // 非模板混合文本(真人打字含英文名):中文部分原样保留,只把非中文片段送去翻译
  // (不能用快捷语音模板文本如 "我看到 X",那会被白名单拦截,见 test20)
  const row = env.addRow("text", "Dave", "\u8fd9\u6ce2 McGinnis \u6253\u5f97\u4e0d\u9519\u554a");
  const ok = await waitFor(() => labelsOf(row).length > 0, 12000);
  await sleep(300);
  const labels = labelsOf(row);
  assert("translation label injected", ok && labels.length === 1 && labels[0].text.length > 0, labels[0] && labels[0].text);
  // 中文部分必须原样保留在译文中(不能整句被机翻改写)
  assert("Chinese part kept intact", labels[0] && labels[0].text.indexOf("\u8fd9\u6ce2") !== -1, labels[0] && labels[0].text);
  // 混合消息原文不折叠(translation_only 模式下中文部分在原文里)
  assert("original NOT collapsed (mixed message)", row.FindChildTraverse("MessageContents").style.visibility === "visible", row.FindChildTraverse("MessageContents").style.visibility);
}

// 纯中文消息照旧跳过(混合规则不得破坏原有跳过行为)
async function test19_pureChineseStillSkipped() {
  console.log("\n[19] pure Chinese message still skipped (no API call, no label)");
  const env = freshEnv(CFG.bilingual);
  const row = env.addRow("text", "Eve", "\u64a4\u9000\u5427");
  await sleep(2500);
  assert("no label for pure Chinese", labelsOf(row).length === 0, labelsOf(row).length + " labels");
  assert("original visible", row.FindChildTraverse("MessageContents").style.visibility === "visible");
}

// 新:快捷语音模板白名单——游戏本地化渲染的快捷语音(模板+已知参数)精确命中即跳过,
// 零 API 调用、零译文标签(这是"英文英雄名设置下快捷语音被误翻译"的最终修复)
async function test20_quickchatWhitelistSkip() {
  console.log("\n[20] CORE FIX: quick chat template render (Stun McGinnis) -> whitelist skip, zero API");
  const env = freshEnv(CFG.translationOnly);
  await waitBootSync(env);
  // 2026-10-12 换语料真模板:旧句式"我看到 McGinnis"已不在现行 quickchat 语料(游戏更新后
  // 该 chatwheel 句式消失;现行指纹 fnv1a-197a3523 与兜底 fnv1a-f9ec2bc3 也印证语料已换代),
  // 跳过只能靠中文规则、模板规则测不到。改用现行语料 "Stun {s:hero_name}"(纯拉丁 + 已知
  // 英雄参数):中文规则救不了它,只有模板白名单命中才零 API 零标签。
  const row = env.addRow("text", "Fay", "Stun McGinnis");
  await sleep(3000);
  assert("no translation label (whitelist hit)", labelsOf(row).length === 0, labelsOf(row).length + " labels");
  assert("original visible", row.FindChildTraverse("MessageContents").style.visibility === "visible");
  // 非快捷语音的英文消息不受白名单影响
  const row2 = env.addRow("text", "Fay", "retreat please now");
  const ok = await waitFor(() => labelsOf(row2).length > 0, 12000);
  assert("non-template english still translated", ok && labelsOf(row2).length === 1, labelsOf(row2).length + " labels");
}

// ===== https 面板通道(2026-10-15):探针定通道 + 自动降级回 BTIPC =====

function httpsState() {
  try {
    const S = globalThis.LCTNS && globalThis.LCTNS.State;
    return { ok: S ? S.httpsPanelOk : "no-state", streak: S ? S.httpsPanelStreak : -1 };
  } catch (e) { return { ok: "throw", streak: -2 }; }
}

// [21] 证书受信:开机探针判活 → 入站翻译走 https 面板(URL 里能看见 https + op=translate),
// 不再进 BTIPC 位泵。
async function test21_httpsPanelPrimary() {
  console.log("\n[21] https panel ALIVE -> translations go through the panel channel");
  const env = freshEnv(CFG.translationOnly);
  await waitBootSync(env);
  const st = httpsState();
  assert("probe decided ALIVE", st.ok === true, "httpsPanelOk=" + st.ok);
  const row = env.addRow("text", "Fay", "retreat please now");
  const ok = await waitFor(() => labelsOf(row).length > 0, 12000);
  assert("inbound translated via https panel", ok && labelsOf(row).length === 1, labelsOf(row).length + " labels");
  const httpsNavs = env.panelSim.navUrls.filter((u) => u.indexOf("https://") === 0);
  assert("navigated to https panel page", httpsNavs.length >= 2, "https navs=" + httpsNavs.length);
  assert("translate request went through https",
    env.panelSim.navUrls.some((u) => u.indexOf("https://") === 0 && u.indexOf("op=translate") !== -1),
    env.panelSim.navUrls.slice(-3).join(" | "));
}

// [22] 证书未信任 / Steam 没重启:探针拿不到 lct-alive → 判死 → 全程 BTIPC,
// 翻译照常(与本通道上线前完全一致的体感)。
async function test22_httpsPanelCertUntrusted() {
  console.log("\n[22] https panel cert UNTRUSTED -> stay on BTIPC, translations unaffected");
  const env = freshEnv(CFG.translationOnly);
  env.panelSim.httpsBroken = true; // 必须在探针(boot+1.2s)之前就位
  await waitBootSync(env);
  await sleep(1800); // 等探针窗口(BRIDGE_ALIVE_SECONDS 1.5s)走完
  const st = httpsState();
  assert("probe decided DEAD", st.ok === false, "httpsPanelOk=" + st.ok);
  const row = env.addRow("text", "Fay", "retreat please now");
  const ok = await waitFor(() => labelsOf(row).length > 0, 15000);
  assert("inbound still translated on BTIPC", ok && labelsOf(row).length === 1, labelsOf(row).length + " labels");
}

// [23] 判活后中途掉线(证书被吊销/桥重启):连续 3 次通道级失败 → 本会话永久退 BTIPC,
// 且后续请求不再试面板 —— 降级必须是"一次判死",不是"每条请求白等 1.5s"。
async function test23_httpsPanelDemotesAfterStreak() {
  console.log("\n[23] https panel dies mid-session -> 3 hard fails -> permanent BTIPC fallback");
  const env = freshEnv(CFG.translationOnly);
  await waitBootSync(env);
  assert("probe decided ALIVE first", httpsState().ok === true, "httpsPanelOk=" + httpsState().ok);
  env.panelSim.httpsBroken = true; // 此刻起页面再也加载不了
  // 三条消息,每条都必须硬失败后交回 BTIPC 并仍然出译文
  const rows = [];
  for (let i = 0; i < 3; i += 1) {
    rows.push(env.addRow("text", "Fay", "group up on mid please " + i));
    await waitFor(() => labelsOf(rows[rows.length - 1]).length > 0, 20000);
  }
  assert("streak counted hard fails", httpsState().streak >= 3, "streak=" + httpsState().streak);
  assert("demoted to BTIPC for the session", httpsState().ok === false, "httpsPanelOk=" + httpsState().ok);
  const before = env.panelSim.navUrls.length;
  const row4 = env.addRow("text", "Fay", "final push now");
  const ok = await waitFor(() => labelsOf(row4).length > 0, 20000);
  assert("post-demotion request still translated", ok && labelsOf(row4).length === 1, labelsOf(row4).length + " labels");
  // 只数本通道自己发的**翻译**请求(op=translate)。不能笼统地数"还有没有 https 导航":
  // health 检查也走面板导航,而面板是单槽共享的 —— 把 health 算进来等于断言一件
  // 与降级无关的事(实测第一次踩这个坑:抓到的"残留 https"是 exp6742 实验探针,
  // 不是生产通道,而那次恰恰暴露了实验探针不该在生产里自动开火)。
const navAfter = env.panelSim.navUrls.slice(before).filter((u) =>
  u.indexOf("https://") === 0 && u.indexOf("op=translate") !== -1);
  assert("no https translate nav after demotion", navAfter.length === 0,
    "stray=" + navAfter.length + " :: " + navAfter.join(" || ").slice(0, 400));
}

async function main() {
  // 场景表 + 过滤(2026-10-15):LCT_SIM_ONLY=21,22 只跑指定场景。
  // 动机:全量 23 场景在本机要十几分钟,而且依赖真实 console.log 与桥的实时状态,
  // 跨运行有残留 —— 出了问题只想复现一个场景时,等不起也看不清。
  // 用法(powershell): $env:LCT_SIM_ONLY="23"; node scripts\lingua_chat_simtest.js
  const SCENES = [
    ["1", test1_injectAndCollapse],
    ["2", test2_recycleToChineseQuickChat],
    ["3", test3_recycleToAnotherEnglish],
    ["4", test4_bilingualNoCollapse],
    ["5", test5_pingBubbleKept],
    ["6", test6_ownMessageSkipped],
    ["7", test7_consecutiveOutgoing],
    ["8", test8_consecutiveIncoming],
    ["9", test9_hudTopBarTranslation],
    ["10", test10_hudOwnMessageSkipped],
    ["11", test11_hudBothTeamsFoundById],
    ["12", test12_lcttestCommand],
    ["13", test13_outgoingWithoutGlobalSetTimeout],
    ["14", test14_outgoingFailShowsTip],
    ["15", test15_bridgeUpDotGreen],
    ["16", test16_entryBlurDropsFocusOnEntryItself],
    ["17", test17_entryEscReleasesFocusThenClosesPanel],
    ["18", test18_mixedMessageFragmentTranslation],
    ["19", test19_pureChineseStillSkipped],
    ["20", test20_quickchatWhitelistSkip],
    ["21", test21_httpsPanelPrimary],
    ["22", test22_httpsPanelCertUntrusted],
    ["23", test23_httpsPanelDemotesAfterStreak],
  ];
  const only = String(process.env.LCT_SIM_ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
  console.log("=== Babel Tower lingua_chat simulation tests v7 (bridge must run on 8791) ===");
  if (only.length) console.log("[LCT-sim] 只跑场景: " + only.join(","));
  for (const pair of SCENES) {
    if (only.length && only.indexOf(pair[0]) === -1) continue;
    await pair[1]();
  }
  console.log("\n=== RESULT: PASS " + passCount + " / FAIL " + failCount + " ===");
  console.log("[LCT-sim][dbg] imgSet=" + (globalThis.__imgSet || 0) +
    " http=" + (globalThis.__imgHttp || 0) + " http200=" + (globalThis.__img200 || 0) +
    " fire=" + (globalThis.__imgFire || 0));
  process.exit(failCount === 0 ? 0 : 1);
}

main();
