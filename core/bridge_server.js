// Contributor: Thirt927 (https://github.com/Thirt927/BabelTower), merged 2026-08-13 under GPL-3.0
// Babel Tower - 本地翻译桥服务器
//
// 职责(只做翻译相关的事,不做通用代理):
//   1. 为游戏内隐藏 HTML 面板提供桥页面(/bridge)
//      - 页面在同源下调用 /api/v1/* ,再把结果写回 document.title 供 Panorama 轮询读取
//   2. 提供受限 API:
//      - POST /api/v1/translate  翻译一段文本
//      - POST /api/v1/test       用当前配置测试连通性
//      - GET  /api/v1/config     读取配置(apiKey 打码)
//      - POST /api/v1/config     保存配置(支持打码回传)
//      - GET  /api/v1/health     健康检查
//
// 安全原则:
//   - 只监听 127.0.0.1,不对外暴露
//   - 没有任意 URL 代理能力(与通用 /proxy 方案不同)
//   - Provider 请求目标由配置/代码限定(allowlist 思路)
//   - 请求体大小限制 64KB
//   - 日志不输出 apiKey
//
// 用法: node bridge_server.js   (默认端口 8791,可用 config.json 修改)
"use strict";

// ---------- 启动期崩溃兜底(必须最先注册) ----------
// 2026-09-20 教训: require 阶段崩溃(发布包漏 loc_parser.js/quickchat.js)发生在本文件
// 剩余部分执行之前,console 输出随窗口关闭消失,用户侧表现为"窗口开几秒就挂"且无日志。
// 兜底必须落盘到 logs/bridge.log,让用户能拿到可反馈的错误现场。
const _crashFs = require("fs");
const _crashPath = require("path");
function _crashLogFilePath() {
  return _crashPath.join(__dirname, "..", "logs", "bridge.log");
}
function writeCrashLog(kind, err) {
  try {
    const logPath = _crashLogFilePath();
    _crashFs.mkdirSync(_crashPath.dirname(logPath), { recursive: true });
    const stamp = new Date().toString();
    _crashFs.appendFileSync(
      logPath,
      "[" + stamp + "] [crash] " + kind + ": " + (err && err.stack ? err.stack : String(err)) + "\n",
      "utf8"
    );
  } catch (e) {
    // 日志都写不进去时(磁盘/权限)只能放弃,不能因此再抛
  }
}
process.on("uncaughtException", function (err) {
  writeCrashLog("uncaughtException", err);
  console.error("[LCT] 发生未捕获错误,日志已写入 logs\\bridge.log,请将该文件反馈给开发者。");
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
process.on("unhandledRejection", function (err) {
  writeCrashLog("unhandledRejection", err);
});

const http = require("http");
const https = require("https");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
// 打包/安装完整性自检: 缺任一必需内部模块立即给出可读错误并退出,
// 避免 "Cannot find module" 原始堆栈吓用户(且现在的 uncaughtException 会把堆栈落盘)。
for (const _m of ["./config", "./providers/registry", "./dictionary", "./name_protect", "./quickchat", "./loc_parser.js", "./steam_paths.js", "./sync_data.js"]) {
  try { require(_m); } catch (e) {
    console.error("[LCT] 安装不完整: 加载 " + _m + " 失败。请重新解压完整安装包,不要手动删除 core 内任何文件。");
    writeCrashLog("module-load-failed", e);
    process.exit(1);
  }
}

const configStore = require("./config");
const providerRegistry = require("./providers/registry");
const dictionary = require("./dictionary");
const nameProtect = require("./name_protect");
const quickchat = require("./quickchat");
// Steam 库发现(2026-10-03 修「桥漏查 D 盘游戏日志」:不再写死两个盘符)
const steamPaths = require("./steam_paths.js");
// btipc07:health / gamenames / quickchat 的载荷编码(指纹协商 + gzip 分片 + delta)
const syncData = require("./sync_data.js");
// ---------- BTIPC v1(规格 docs/btipc-v1.md)----------
// 窗口表(§6 状态机/§14.2 隔离)+ console.log tail 的 REQ/TRQ/CAN 解析(§14.1 校验,非法静默 drop 只记 WARN)。
// 两条传输路径完全分离,共用同一套帧/窗口/重试核心:
//   REQ(③/⑤)回声 conformance —— 同步 setFrames(原文),/bt6736 走这条,不碰翻译 API。
//   TRQ(⑥)翻译            —— 先建窗(frames=null → BUSY),翻译完成后异步 setFrames。
// 翻译层只见 BTIPC 的 window/frames,不见 Image panel、200/404、round、CRC、STORM。
// P1(2026-10-11):耦合面收口 —— 桥业务只经 GameChannel 壳触达 BTIPC(壳零逻辑转发,
// 四个冻结模块与线上帧格式不变;契约钉 tests/btipc/index_surface_guard.test.js)。
// 壳内只许转发;发现 btipc 内部缺陷 → 记独立问题 + 申请解冻,禁止在壳里绕改。
const { GameChannel } = require("./transport/game_channel.js");
const btipcCh = new GameChannel();

// 翻译失败时的信号:空 END 帧(len=0)。协议零改动(§3 无新位段),客户端 translate 模式下
// 收到空串即判定 translate_error。回声模式不做此判定 —— "" 是合法回声。
const btipcTrqInflight = new Set();

function onBtipcGameLine(line) {
  const parsed = btipcCh.parseGameLine(line);
  if (!parsed.ok) {
    if (parsed.skip) return; // 普通 [LCT] 行,与 BTIPC 无关
    log("warn", "BTIPC drop (" + parsed.reason + ")"); // §14.1:静默 drop + 一行 WARN
    return;
  }
  if (parsed.cmd === "REQ") {
    const tr = btipcCh.acceptReq(parsed.win, parsed.id, parsed.payload);
    try {
      tr.frames = btipcCh.encode(parsed.id, parsed.payload);
      log("info", "BTIPC REQ w=" + parsed.win + " id=" + parsed.id + " len=" + parsed.len + " echo frames=" + tr.frames.length);
    } catch (e) {
      log("warn", "BTIPC encode failed: " + e.message);
    }
  } else if (parsed.cmd === "TRQ") {
    onBtipcTranslateReq(parsed);
  } else if (parsed.cmd === "CAN") {
    btipcTrqInflight.delete(parsed.win);
    btipcCh.cancel(parsed.win);
    log("info", "BTIPC CAN w=" + parsed.win);
  }
}

// ---------- btipc07:health / gamenames / quickchat(op=config 的 JSON body "get" 字段)----------
// 为什么复用 op=config:TRQ 信封白名单冻结(core/btipc/transport.js 只认 config|test),
// 动信封 = 动协议;body 语义由桥端解释,信封层/帧格式/状态机零改动。
// 下行只有 ~12.6 B/s → 先握手(指纹),相同 1 帧级秒回;不同才分片,能走 delta 就不走全量。
// 编码/指纹/delta/切片全在 core/sync_data.js(纯函数,tests/btipc07_sync.test.js 对拍)。
const SYNC_KINDS = {
  gamenames: { cfg: "gamenames.json", fallback: "lingua_chat_gamenames_pairs_fallback.js", name: "LCT_GAMENAMES_PAIRS" },
  quickchat: { cfg: "quickchat.json", fallback: "lingua_chat_quickchat_fallback.js", name: "LCT_QUICKCHAT_FALLBACK_TEMPLATES" },
};

function readSyncConfig(kind) {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", SYNC_KINDS[kind].cfg), "utf8"));
  } catch (e) {
    return null;
  }
}

// 读客户端那一版兜底:发布包里单独带了一份 mod\panorama\scripts\*_fallback.js
// (package_release.ps1 补的),桥据此知道客户端手上是什么 → 把「全量」降级成「增删改」。
// 读不到(老包 / 手工部署)→ 退全量,慢但正确。
function readSyncBaseline(kind) {
  try {
    const p = path.join(__dirname, "..", "mod", "panorama", "scripts", SYNC_KINDS[kind].fallback);
    const src = fs.readFileSync(p, "utf8");
    const data = syncData.extractAssignment(src, SYNC_KINDS[kind].name);
    if (!data) return null;
    const fingerprint = kind === "gamenames"
      ? syncData.namesFingerprint(data)
      : syncData.extractAssignment(src, "LCT_QUICKCHAT_FALLBACK_FINGERPRINT");
    if (typeof fingerprint !== "string" || !fingerprint) return null;
    return { fingerprint: fingerprint, data: data };
  } catch (e) {
    return null;
  }
}

function runBtipcGet(o) {
  const kind = String(o.get || "");
  if (kind === "health") {
    const cfgH = configStore.load();
    const r = { ok: true, provider: cfgH.provider, version: readLocalVersion() || "unknown" };
    if (cachedVersionInfo && cachedVersionInfo.ok && cachedVersionInfo.hasUpdate) {
      r.updateInfo = {
        hasUpdate: true,
        currentVersion: cachedVersionInfo.currentVersion,
        latestVersion: cachedVersionInfo.latestVersion,
        releaseUrl: cachedVersionInfo.releaseUrl || GITHUB_REPO_URL + "/releases",
      };
    }
    return r;
  }
  if (kind !== "gamenames" && kind !== "quickchat") return { ok: false, error: "unknown_get" };
  const current = readSyncConfig(kind);
  if (!current) return { ok: false, error: kind + "_not_found" };
  const clientFp = typeof o.fp === "string" && o.fp ? o.fp : null;
  const expect = typeof o.exp === "string" && o.exp ? o.exp : null;
  return syncData.syncGet(kind, current, readSyncBaseline(kind), clientFp, o.off, o.lim, expect);
}

// btipc05:TRQ op 通道 —— 设置面板「保存/测试」+ 开机读配置(旧通道 6726 后已死,迁移)。
// 载荷/响应回路与 HTTP /api/v1/config、/api/v1/test 同语义(同一 configStore/runTranslate)。
// 响应恒为 JSON:空响应会被游戏侧判 translate_error,掩盖真实错误。
async function runBtipcOp(op, body, timeoutMs) {
  if (op === "config") {
    let obj = null;
    try { obj = JSON.parse(body || "{}"); } catch (e) { return { ok: false, error: "bad_json" }; }
    // btipc07:数据接口("get" 字段)优先于配置读写;两者互斥(config 写只在有 obj.config 时发生)
    if (obj && typeof obj.get === "string") return runBtipcGet(obj);
    const current = configStore.load();
    if (obj.config) {
      const next = configStore.applyMaskedUpdate(current, obj.config);
      configStore.save(next);
      log("info", "config saved (btipc)");
      // btipc05b:写应答只回 {ok:true}。原先回 maskCompact(≈400B=40 帧)在真机
      // 600ms/帧节拍下要 24s+ —— 游戏侧 8s 死线必超时,实车 34 连败(UI 报假失败,
      // 其实已落盘)。保存方用本地收集的 p 回填,不需要回执里的 config。
      return { ok: true };
    }
    // 读:与 GET /api/v1/config 同形(精简 mask)。体积 ≈400B=40 帧 ×600ms/帧 ≈24s,
    // 游戏侧 op=config 读分支已配 35s 死线(btipc05b),此处只管给全量。
    return { ok: true, config: configStore.maskCompact(current) };
  }
  if (op === "test") {
    let obj = null;
    try { obj = JSON.parse(body || "{}"); } catch (e) { obj = null; }
    const cfg = configStore.load();
    try {
      const result = await runTranslate(cfg, {
        text: (obj && obj.text) || "hello",
        targetLanguage: (obj && obj.targetLanguage) || "zh-Hans",
        sourceLanguage: (obj && obj.sourceLanguage) || "auto",
        timeoutMs: timeoutMs,
      });
      log("info", "test ok (btipc)");
      // btipc05b:去掉 message(≈30B≈3 帧)——游戏侧只读 translation,瘦身让应答
      // 稳落 3 帧内,免 CRC 重试偶发顶到 8s 死线。
      return { ok: true, translation: result.translation };
    } catch (e) {
      log("info", "test failed (btipc): " + ((e && e.message) || String(e)));
      return { ok: false, error: (e && e.message) || "unknown_error" };
    }
  }
  if (op === "log") {
    // P2(2026-10-11):与 POST /api/v1/log 逐字段同语义(bad_json / skipped / written /
    // chat_log_write_failed),复用 appendChatLog —— 迁移只换通道,不换契约。
    // 注意:形参名是 body(env.text 传入的 JSON 字符串),不得再 let body 遮蔽(05c 教训:
    // 同名遮蔽 + 引用不存在的变量,strict 下 ReferenceError 被 catch 吞成 bad_json 假象)。
    let bodyObj = null;
    try { bodyObj = JSON.parse(body || ""); } catch (e) { return { ok: false, error: "bad_json" }; }
    const cfgL = configStore.load();
    if (!(cfgL.chatLog && cfgL.chatLog.enabled)) return { ok: true, skipped: "chat_log_disabled" };
    try {
      const n = appendChatLog(cfgL, bodyObj);
      log("info", "chat log written (btipc): " + n + " lines");
      return { ok: true, written: n };
    } catch (e) {
      log("warn", "chat log write failed (btipc): " + (e && e.message ? e.message : String(e)));
      return { ok: false, error: "chat_log_write_failed" };
    }
  }
  return { ok: false, error: "unknown_op" };
}

// ⑥ 翻译请求:窗口先存在(frames=null → 客户端拿 BUSY),数据帧后填充。
// 翻译耗时(100ms~8s/超时)完全落在窗口等待期,不污染 BTIPC 传输状态机。
// P2(2026-10-11):op=log 聊天日志迁 BTIPC(旧面板 HTTP 通道 6726 后死,日志静默丢失)。
// 冻结信封白名单只有 config|test(transport.js 冻结,不为 log 开口),日志载荷由桥侧按首行
// 形状识别:首行恰为 "op=log"(6 字符 + 换行)。聊天/出站文本单行无换行,不存在误吞;
// 形状不符 → false → 照旧按裸文本翻译(向后兼容)。
function matchChatLogTrq(raw) {
  if (typeof raw !== "string") return false;
  const nl = raw.indexOf("\n");
  if (nl !== 6) return false;
  return raw.slice(0, nl) === "op=log";
}

async function onBtipcTranslateReq(parsed) {
  const win = parsed.win;
  const raw = parsed.payload.toString("utf8");
  // ⑥-整合信封(checklist §14):首行 t=<target>[;tm=<ms>] 携带出站目标语言与翻译超时。
  // 无信封(/bt6737 冒烟、E2E 裸文本)→ undefined,回退 config 默认(向后兼容)。
  let env = btipcCh.parseTrqEnvelope(raw);
  // P2:op=log 合成 env —— 复用 op 通道全链路(BUSY 窗/应答帧/异常收敛),text = 信封体(JSON)。
  if (!env.op && matchChatLogTrq(raw)) env = { text: raw.slice(7), target: undefined, timeoutMs: undefined, op: "log" };
  const text = env.text;
  const targetLanguage = env.target;
  const tReq = Date.now();
  // acceptReq 建窗;frames 保持 null → serveDL 返 BUSY。setFrames 失败(窗口已 GC)时静默丢弃。
  const tr = btipcCh.acceptReq(win, parsed.id, parsed.payload);
  tr.translate = true;
  btipcTrqInflight.add(win);
  log("info", "BTIPC TRQ w=" + win + " id=" + parsed.id + " len=" + parsed.len +
      (env.op ? " op=" + env.op : " target=" + (targetLanguage || "(default)")) +
      " text=" + JSON.stringify(text.slice(0, 60)) + " (BUSY until " + (env.op ? "op handled" : "translated") + ")");

  let out = null;
  let errMsg = null;
  try {
    if (env.op) {
      out = JSON.stringify(await runBtipcOp(env.op, env.text, env.timeoutMs));
    } else {
      const cfg = configStore.load();
      const result = await runTranslate(cfg, {
        text: text,
        targetLanguage: targetLanguage,
        timeoutMs: env.timeoutMs,
      });
      out = String(result.translation == null ? "" : result.translation);
      // 缓存非词典命中结果 + 自适应学习(与 /api/v1/translate 同语义)
      if (result && !result.viaDictionary && !result.viaCache) {
        const tl = targetLanguage || cfg.defaults.targetLanguage || "zh-Hans";
        transCacheSet(result._protectedText || text, tl, result.translation, result.detectedLanguage);
        dictionary.record(result._protectedText || text, tl, result.translation, result.detectedLanguage);
      }
    }
  } catch (e) {
    if (env.op) out = JSON.stringify({ ok: false, error: (e && e.message) || String(e) });
    else errMsg = (e && e.message) || String(e);
  }

  btipcTrqInflight.delete(win);
  const dt = Date.now() - tReq;
  let frames;
  try {
    // 失败也 setFrames:空 END 帧让客户端走到 Promise 结算,而不是耗到 REQ_TIMEOUT。
    frames = btipcCh.encode(parsed.id, out == null ? "" : out);
  } catch (e) {
    log("warn", "BTIPC TRQ encode failed w=" + win + ": " + e.message);
    return; // 留在 BUSY,由客户端 REQ_TIMEOUT 兜底
  }
  if (!btipcCh.setFrames(win, frames)) {
    log("info", "BTIPC TRQ w=" + win + " dropped: window gone (GC/CAN)");
    return;
  }
  if (errMsg !== null) {
    log("warn", "BTIPC TRQ w=" + win + " translate failed after " + dt + "ms: " + errMsg.slice(0, 120) +
        " -> empty END frame (client rejects as translate_error)");
  } else {
    log("info", "BTIPC TRQ w=" + win + " ok dt=" + dt + "ms out=" + out.length + "B frames=" + frames.length);
  }
}

// 窗口 GC(§6):END 帧服务后 END_GC_MS(45s),或 60s 无活动。
// 曾用 10s → 桥在客户端仍在重试时删窗 → 128 面板全 404 → 20 连发 4 次 crc_dead(2026-10-02 实车)。
// 改动这两个常量前先看 tests/btipc/window_gc.test.js 钉的不变量。
setInterval(function () {
  const n = btipcCh.gc();
  if (n > 0) log("info", "BTIPC GC removed=" + n + " remain=" + btipcCh.size());
}, 10000);
// 首次运行生成词典文件;桥启动后自动落盘高频词(自适应学习)
// (顶部 for 循环已逐个 require 过五个模块,这里直接拿句柄用,不重复 require)
dictionary.ensureFile();
dictionary.startAutoFlush();
nameProtect.load();
nameProtect.watchLocalization();
// 快捷语音模板:启动时从游戏本地化生成(失败不阻塞桥启动,客户端用兑底语料)
// 2026-09-17 v3:原始模板字典(免正则),客户端 token 走查匹配
try {
  const qcBuilt = quickchat.build();
  if (qcBuilt.ok) {
    // 唯一写入口 core/quickchat.js writeBridgeConfig(fingerprint 随写随传,漏写 = 客户端握手永远告警)
    const qcPath = quickchat.writeBridgeConfig(qcBuilt);
    console.log("[quickchat] templates generated:", qcBuilt.count, "keys, fingerprint:", qcBuilt.fingerprint);
  } else {
    console.log("[quickchat] templates build failed (client fallback in effect):", qcBuilt.error);
  }
} catch (e) {
  console.log("[quickchat] templates build error (non-fatal):", e.message);
}

const MAX_BODY_BYTES = 64 * 1024;
const MAX_TEXT_CHARS = 4000; // 单条聊天文本长度上限

// ---------- 翻译结果缓存(同文本二次秒回,避免重复走 Bing) ----------
// 聊天场景重复度高(gg/glhf/thanks 等高频短语),缓存命中直接返回,零网络开销。
const TRANS_CACHE_LIMIT = 1000;
const TRANS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 分钟,覆盖多局短时间内的重复聊天
const transCache = new Map(); // key: text + target -> { translation, detectedLanguage, ts }

function cacheKey(text, target) {
  const normalizedText = String(text || "").trim().replace(/\s+/g, " ").toLowerCase();
  return normalizedText.slice(0, 200) + "\x00" + String(target || "").toLowerCase();
}

function transCacheGet(text, target) {
  const key = cacheKey(text, target);
  const hit = transCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > TRANS_CACHE_TTL_MS) {
    transCache.delete(key);
    return null;
  }
  return hit;
}

function transCacheSet(text, target, translation, detectedLanguage) {
  if (transCache.size >= TRANS_CACHE_LIMIT) {
    const oldestKey = transCache.keys().next().value;
    if (oldestKey !== undefined) transCache.delete(oldestKey);
  }
  transCache.set(cacheKey(text, target), {
    translation: translation,
    detectedLanguage: detectedLanguage,
    ts: Date.now(),
  });
}

// ---------- 日志(可选落盘,绝不含 apiKey) ----------
let activeConfig = null;

// 本地时间戳(2026-09-17:由 UTC toISOString 改为本地时区。
// UTC 时间戳比文件时间慢 8 小时,排查问题时会误判日志时段)
function pad2(n) { return n < 10 ? "0" + n : String(n); }
function localTimestamp() {
  const d = new Date();
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
    " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
}

// 日志目录自动创建(2026-10-03 修「日志目录不会自动创建」):
// 发布包与 git clone 里都没有 logs/(.gitignore 排除),旧代码直接 appendFileSync 会被
// ENOENT 静默吞掉 → 桥跑得起来但 logs\bridge.log 永远不存在,而 restart_bridge.ps1、
// run-bridge.bat、排障文档全都在让用户"把 logs\bridge.log 发过来"。
// 首次写日志补建目录;建成功后置位不再探测,免得每行日志都做一次 existsSync。
let logDirOk = false;
function ensureLogDir(file) {
  if (logDirOk) return;
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    logDirOk = fs.existsSync(dir);
  } catch (e) {}
}

function log(level, msg) {
  const ts = localTimestamp();
  const line = "[" + ts + "] [" + level + "] " + msg;
  // 任何日志都不允许包含 apiKey;调用方自行保证
  console.log(line);
  try {
    if (activeConfig && activeConfig.logFile) {
      const file = path.resolve(__dirname, "..", activeConfig.logFile);
      ensureLogDir(file);
      fs.appendFileSync(file, line + "\n", "utf8");
    }
  } catch (e) {}
}

// ---------- 进程监视:记录游戏开关状态;桥常驻,不随游戏退出 ----------
// 2026-08-12 修复(0.1.3-beta.5):原逻辑游戏退出后 process.exit(0) 自杀,
// 导致"关游戏再开就没桥"。改为常驻:游戏退出后桥保持运行,下次游戏启动直接可用。
// 2026-08-13 合并 Thirt927 贡献:tasklist 偶发失败/空输出跳过本轮;
// 游戏"消失"需连续确认 WATCH_CONFIRM_MISSES 次(约 6 秒)才判定退出(仍不自杀)。
const WATCH_INTERVAL_MS = 2000;
const WATCH_CONFIRM_MISSES = 3;
let gameProcessSeen = false;
let watchMissCount = 0;
let watchTimer = null;

function checkGameProcess() {
  const gameExe = String((activeConfig && activeConfig.watchGameExe) || "deadlock.exe").toLowerCase();
  execFile(
    "tasklist",
    ["/FI", "IMAGENAME eq " + gameExe, "/FO", "CSV", "/NH"],
    { windowsHide: true },
    function (err, stdout) {
      if (err) {
        // tasklist 执行失败(系统繁忙/被杀软拦截):跳过本轮,不改变状态,避免误判
        if (!process.exitCode) watchTimer = setTimeout(checkGameProcess, WATCH_INTERVAL_MS);
        return;
      }
      const running = String(stdout || "").toLowerCase().indexOf(gameExe) !== -1;
      if (running) {
        if (!gameProcessSeen) {
          log("info", "检测到 " + gameExe + " 运行,监视其退出(需连续 " + WATCH_CONFIRM_MISSES + " 次未检测到才记录退出)");
        }
        gameProcessSeen = true;
        watchMissCount = 0;
      } else if (gameProcessSeen) {
        watchMissCount += 1;
        if (watchMissCount >= WATCH_CONFIRM_MISSES) {
          // 桥常驻:游戏退出后桥保持运行,等待下次游戏启动
          log("info", gameExe + " 已退出,桥保持运行(等待下次游戏启动)");
          gameProcessSeen = false;
          watchMissCount = 0;
        } else {
          log("info", "未检测到 " + gameExe + " (" + watchMissCount + "/" + WATCH_CONFIRM_MISSES + "),等待确认...");
        }
      }
      if (!process.exitCode) watchTimer = setTimeout(checkGameProcess, WATCH_INTERVAL_MS);
    }
  );
}

function startGameWatch() {
  if (process.argv.indexOf("--no-watch") !== -1) return;
  if (activeConfig && activeConfig.watchGame === false) return;
  checkGameProcess();
}

// ---------- GitHub 新版本检测 ----------
// 启动时不阻塞、异步请求 GitHub releases/latest,与本地 VERSION 比较。
// 仅使用 Node 内置 https 模块;任何失败都降级为"无更新"而非抛错。
// GitHub 对未带 User-Agent 的请求返回 403,故必须设置。
const GITHUB_API_URL = "https://api.github.com/repos/c1375rick/BabelTower/releases/latest";
const GITHUB_REPO_URL = "https://github.com/c1375rick/BabelTower";
const VERSION_CHECK_TIMEOUT_MS = 5000;

// 语义化版本比较:返回 -1(a<b) / 0(相等) / 1(a>b)
// 处理 v 前缀、beta 后缀(1.0.0-beta.2 > 1.0.0-beta > 1.0.0)
function compareVersions(a, b) {
  const strip = (s) => String(s || "").replace(/^v/i, "");
  const pa = strip(a).split(".");
  const pb = strip(b).split(".");
  const maxLen = Math.max(pa.length, pb.length);
  for (let i = 0; i < maxLen; i++) {
    const na = pa[i] || "0";
    const nb = pb[i] || "0";
    const da = parseInt(na, 10);
    const db = parseInt(nb, 10);
    if (!isNaN(da) && !isNaN(db)) {
      if (da !== db) return da < db ? -1 : 1;
    } else {
      const cmp = na.localeCompare(nb, undefined, { numeric: true, sensitivity: "base" });
      if (cmp !== 0) return cmp < 0 ? -1 : 1;
    }
  }
  return 0;
}

function readLocalVersion() {
  try {
    return fs.readFileSync(path.join(__dirname, "..", "VERSION"), "utf8").trim();
  } catch (e) {
    return null;
  }
}

// 请求 GitHub releases/latest;成功返回 { ok:true, latestVersion, releaseUrl },失败返回 { ok:false, error }
function fetchGitHubRelease() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; resolve(r); } };
    let req;
    try {
      req = https.get(
        GITHUB_API_URL,
        {
          headers: {
            "User-Agent": "BabelTower/1.0",
            "Accept": "application/vnd.github+json",
          },
          timeout: VERSION_CHECK_TIMEOUT_MS,
        },
        (resp) => {
          let data = "";
          resp.setEncoding("utf8");
          resp.on("data", (c) => { data += c; });
          resp.on("end", () => {
            try {
              if (resp.statusCode !== 200) {
                finish({ ok: false, error: "github_api_status_" + resp.statusCode });
                return;
              }
              const json = JSON.parse(data);
              const tag = json.tag_name;
              if (!tag) {
                finish({ ok: false, error: "no_tag_in_response" });
                return;
              }
              finish({
                ok: true,
                latestVersion: String(tag).replace(/^v/i, ""),
                releaseUrl: json.html_url || (GITHUB_REPO_URL + "/releases/" + tag),
              });
            } catch (e) {
              finish({ ok: false, error: "parse_error: " + (e && e.message ? e.message : String(e)) });
            }
          });
        }
      );
    } catch (e) {
      finish({ ok: false, error: (e && e.message ? e.message : String(e)) });
      return;
    }
    req.on("timeout", () => {
      try { req.destroy(new Error("timeout")); } catch (e) {}
      finish({ ok: false, error: "request_timeout" });
    });
    req.on("error", (e) => {
      finish({ ok: false, error: (e && e.message ? e.message : String(e)) });
    });
  });
}

// 汇总:返回 version-check 端点与启动检测共用的结果对象
async function doVersionCheck() {
  const currentVersion = readLocalVersion();
  const gh = await fetchGitHubRelease();
  if (!gh.ok) {
    return { ok: true, currentVersion: currentVersion, hasUpdate: false, error: gh.error };
  }
  const latest = gh.latestVersion;
  return {
    ok: true,
    currentVersion: currentVersion,
    latestVersion: latest,
    hasUpdate: !!currentVersion && !!latest && compareVersions(latest, currentVersion) > 0,
    releaseUrl: gh.releaseUrl,
  };
}

// 缓存版本检测结果:health 端点直接返回,不每次查 GitHub
let cachedVersionInfo = null;
const VERSION_CHECK_REFRESH_MS = 30 * 60 * 1000; // 30 分钟刷新一次

function refreshVersionCache() {
  doVersionCheck()
    .then((r) => {
      cachedVersionInfo = r;
      if (r && r.ok && r.hasUpdate) {
        log("info", "发现新版本: " + r.currentVersion + " -> " + r.latestVersion +
          " (" + (r.releaseUrl || GITHUB_REPO_URL + "/releases") + ")");
      }
    })
    .catch(() => {});
}

// 启动时检测一次,之后每 30 分钟刷新
function startVersionCheckOnBoot() {
  refreshVersionCache();
  setInterval(refreshVersionCache, VERSION_CHECK_REFRESH_MS);
}

// ---------- 请求体解析 ----------
function readBody(req, onDone) {
  let raw = "";
  let size = 0;
  let tooBig = false;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      tooBig = true;
      req.destroy();
      return;
    }
    raw += chunk;
  });
  req.on("end", () => {
    if (tooBig) {
      onDone(new Error("body_too_large"));
      return;
    }
    onDone(null, raw);
  });
  req.on("error", (e) => onDone(e));
}

function parseJson(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch (e) {
    return null;
  }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  // ACAO 收敛(B1 2026-10-10):本函数不再无条件发 `*`;跨源回显统一走 requestHandler
  // 顶部的 applyCors(仅回显本地同源 Origin)。无 CORS 头 = 浏览器默认阻读。
  res.end(body);
}

// ---------- 聊天日志(按比赛 ID 划分) ----------
// ---------- 聊天日志轮转与清理 ----------
// 单文件写入上限: 超过则把当前 .jsonl 整体重命名为带时间戳的备份,
// 后续写入落到全新文件(标准日志滚动思路, 不丢任何已写内容)。
const CHAT_LOG_MAX_BYTES = 5 * 1024 * 1024;        // 5MB
const CHAT_LOG_ROTATE_KEEP_DAYS = 7;              // 轮转备份(*.jsonl.rotated)保留 7 天
const CHAT_LOG_CLEANUP_DAYS = 30;                // 启动时清理: 活动日志(*.jsonl)超 30 天删除
const CHAT_LOG_ROTATED_SUFFIX = ".jsonl.rotated"; // 轮转备份后缀(前面再拼时间戳)

// 轮转: 若当前 <matchId>.jsonl 超过 CHAT_LOG_MAX_BYTES, 整体重命名为
// <matchId>.<时间戳>.jsonl.rotated, 后续 appendFileSync 会重新创建空的 .jsonl。
// 已写入的内容全部保留在备份里, 不影响 API 返回值(written=本次写入行数)。
function rotateChatLogIfNeeded(dir, matchId) {
  const file = path.join(dir, matchId + ".jsonl");
  let stat;
  try { stat = fs.statSync(file); } catch (e) { return; } // 文件不存在则无需轮转
  if (!stat.isFile() || stat.size <= CHAT_LOG_MAX_BYTES) return;
  // 时间戳精确到秒并替换文件系统非法字符(: .), 避免同秒多次轮转互相覆盖
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rotated = path.join(dir, matchId + "." + stamp + CHAT_LOG_ROTATED_SUFFIX);
  try {
    fs.renameSync(file, rotated);
    log("info", "chat log rotated: " + path.basename(file) + " (" + stat.size + " bytes) -> " + path.basename(rotated));
  } catch (e) {
    // 轮转失败不致命: 下次写入仍会触发, 不影响本次日志记录
    log("warn", "chat log rotate failed: " + (e && e.message ? e.message : String(e)));
  }
}

// 启动清理: 扫描日志目录, 删除超龄文件(只处理聊天日志相关文件, 不碰其他)。
//   活动日志 (*.jsonl)            超 CHAT_LOG_CLEANUP_DAYS   (30) 天 -> 删除
//   轮转备份 (*.jsonl.rotated)    超 CHAT_LOG_ROTATE_KEEP_DAYS (7) 天 -> 删除
function cleanupOldChatLogs(dir) {
  let entries;
  try { entries = fs.readdirSync(dir); } catch (e) { return; }
  const now = Date.now();
  for (const name of entries) {
    const full = path.join(dir, name);
    let stat;
    try { stat = fs.statSync(full); } catch (e) { continue; }
    if (!stat.isFile()) continue;
    let maxAgeDays = 0;
    if (name.endsWith(CHAT_LOG_ROTATED_SUFFIX)) {
      maxAgeDays = CHAT_LOG_ROTATE_KEEP_DAYS;
    } else if (name.endsWith(".jsonl")) {
      maxAgeDays = CHAT_LOG_CLEANUP_DAYS;
    } else {
      continue; // 不碰无关文件
    }
    const ageMs = now - stat.mtimeMs;
    if (ageMs > maxAgeDays * 24 * 60 * 60 * 1000) {
      try {
        fs.unlinkSync(full);
        log("info", "chat log cleaned (>" + maxAgeDays + "d): " + name);
      } catch (e) {
        log("warn", "chat log cleanup failed: " + name + " " + (e && e.message ? e.message : String(e)));
      }
    }
  }
}

function safeMatchId(id) {
  // 只保留字母数字与 - _ . 防止路径穿越
  return String(id || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64) || "unknown";
}

function appendChatLog(cfg, body) {
  const matchId = safeMatchId(body.matchId || (body.lines && body.lines[0] && body.lines[0].matchId) || "");
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) return 0;
  const dir = path.resolve(__dirname, "..", String((cfg.chatLog && cfg.chatLog.dir) || "logs/chat"));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, matchId + ".jsonl");
  const out = [];
  for (const ln of lines) {
    out.push(JSON.stringify({
      t: String(ln.t || new Date().toISOString()),
      matchId: matchId,
      sender: String(ln.sender || ""),
      hero: String(ln.hero || ""),
      heroId: String(ln.heroId || ""),
      steamid: String(ln.steamid || ""),
      channel: String(ln.channel || ""),
      isOwn: !!ln.isOwn,
      text: String(ln.text || "").slice(0, 2000),
    }));
  }
  fs.appendFileSync(file, out.join("\n") + "\n", "utf8");
  // 写入后检查单文件大小, 超 5MB 则滚动(重命名旧文件为带时间戳备份)
  rotateChatLogIfNeeded(dir, matchId);
  return out.length;
}

// ---------- 翻译执行 ----------
async function runTranslate(cfg, payload) {
  const provider = providerRegistry.getProvider(payload.provider || cfg.provider);
  if (!provider) {
    throw Object.assign(new Error("未知翻译服务商: " + (payload.provider || cfg.provider)), { status: 400 });
  }
  const text = String(payload.text || "").trim();
  if (!text) throw Object.assign(new Error("空文本"), { status: 400 });
  if (text.length > MAX_TEXT_CHARS) throw Object.assign(new Error("文本过长"), { status: 400 });

  // 词典直译优先:短词/常用语不走在线翻译,结果稳定(修复 gg 等短词译文=原文的抖动)
  const dictHit = dictionary.lookup(text, payload.targetLanguage || cfg.defaults.targetLanguage || "zh-Hans");
  if (dictHit) return dictHit;

  // 英雄/物品名占位符保护:翻译前把游戏专有名词换成 {{GAME_i}},翻译后还原为目标语言译名,
  // 避免被 API 意译/乱译(holliday 等不在客户端硬编码名单里的英雄也能被覆盖)。
  // 数据来自游戏本地化(285 条全量),由 name_protect 监听游戏更新自动刷新。
  const alreadyProtected = /LCTPH\d/.test(text);
  const protected0 = alreadyProtected ? { text: text, nameMap: null } : nameProtect.protect(text);
  const nameMap = protected0.nameMap;
  const textForTranslate = protected0.text;
  const toZh = (payload.targetLanguage || cfg.defaults.targetLanguage || "zh-Hans").toLowerCase().startsWith("zh");
  const restoreBack = (translation) => nameMap ? nameProtect.restore(translation, nameMap, toZh) : translation;

  // 缓存命中:同文本直接返回上次结果(词典未覆盖的长句/短语重复出现时,零网络延迟)
  const targetLang = payload.targetLanguage || cfg.defaults.targetLanguage || "zh-Hans";
  const cached = transCacheGet(textForTranslate, targetLang);
  if (cached) {
    log("info", "cache hit: " + String(textForTranslate).slice(0, 60).replace(/\s+/g, " "));
    return { translation: restoreBack(cached.translation), detectedLanguage: cached.detectedLanguage, viaCache: true };
  }

  const providerCfg = (cfg[provider.id] || {});
  const baseOpts = {
    sourceLanguage: payload.sourceLanguage || cfg.defaults.sourceLanguage || "auto",
    targetLanguage: payload.targetLanguage || cfg.defaults.targetLanguage || "zh-Hans",
    timeoutMs: Number(payload.timeoutMs) || cfg.timeoutMs,
  };
  const errors = [];
  try {
    const result = await provider.translate(textForTranslate, Object.assign({}, baseOpts, {
      apiKey: providerCfg.apiKey,
      region: providerCfg.region,
      endpoint: providerCfg.endpoint,
      baseUrl: providerCfg.baseUrl,
      model: providerCfg.model,
    }));
    return Object.assign(result, { provider: provider.id, translation: restoreBack(result.translation), _protectedText: textForTranslate });
  } catch (e) {
    errors.push(provider.id + ": " + (e && e.message ? e.message : String(e)));
  }

  // 回退链:按配置依次尝试备用服务商(只尝试已配置 Key 的,避免连环失败浪费时间)
  const fallbacks = Array.isArray(cfg.fallbackProviders) ? cfg.fallbackProviders : [];
  for (const pid of fallbacks) {
    if (pid === provider.id) continue;
    const fb = providerRegistry.getProvider(pid);
    if (!fb) continue;
    const fc = (cfg[pid] || {});
    // 需要 Key 的服务商没配 Key 就跳过
    if (pid !== "bing" && !fc.apiKey) continue;
    try {
      const fbResult = await fb.translate(text, Object.assign({}, baseOpts, {
        apiKey: fc.apiKey,
        region: fc.region,
        endpoint: fc.endpoint,
        baseUrl: fc.baseUrl,
        model: fc.model,
      }));
      log("info", "fallback -> " + pid + " (primary " + provider.id + " failed: " + (errors[0] || "").slice(0, 80) + ")");
      return Object.assign(fbResult, { provider: pid, viaFallback: true, translation: restoreBack(fbResult.translation), _protectedText: textForTranslate });
    } catch (e2) {
      errors.push(pid + ": " + (e2 && e2.message ? e2.message : String(e2)));
    }
  }

  const last = new Error(errors.join(" | "));
  last.status = 502;
  throw last;
}

// ---------- 桥页面(供游戏内隐藏 HTML 面板加载) ----------
function bridgePage(query) {
  const id = String(query.get("id") || "x");
  const op = String(query.get("op") || "translate");
  const safeId = JSON.stringify(id);

  // 页面 JS:同源调用受限 API,结果写回 document.title(前缀 LCT + 请求 id)。
  // Panorama 侧轮询 panel.title 读取,按 id 前缀匹配响应。
  return [
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>lct-bridge</title></head><body>",
    "<script>",
    "(function(){",
    "var id=" + safeId + ";",
    "var q=new URLSearchParams(location.search);",
    "var op='" + String(op).replace(/[^a-z]/g, "") + "';",
    "var done=false;",
    "function out(p){var s='LCT'+id+JSON.stringify(p);",
    "try{document.title=s;}catch(e){}",
    "try{location.hash='#'+encodeURIComponent(s);}catch(e){}",
    "}",
    "try{document.title='lct-alive';}catch(e){}",
    "var t=Math.max(Number(q.get('timeoutMs'))||8000,8000);",
    "setTimeout(function(){if(!done){done=true;out({ok:false,error:'bridge_timeout'});}},t);",
    "var req={operation:op,text:q.get('text')||'',sourceLanguage:q.get('source')||'auto',targetLanguage:q.get('target')||'zh-Hans',timeoutMs:Number(q.get('timeoutMs'))||undefined};",
    "var d=q.get('d');if(d){try{req=JSON.parse(d);}catch(e){}}",
    "var path='/api/v1/'+(op==='translate'?'translate':op);",
    "var fetchOpts={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(req)};",
    "if(op==='health'){fetchOpts={method:'GET'};}",
    "fetch(path,fetchOpts)",
    ".then(function(r){return r.json();})",
    ".then(function(j){if(done)return;done=true;out(j);})",
    ".catch(function(e){if(done)return;done=true;out({ok:false,error:String(e)});});",
    "})();",
    "</script></body></html>",
  ].join("");
}

// ---------- API 路由 ----------
// GET 兼容:translate/test 无 body 时用 query 参数(text/source/target/provider)构造。
// 2026-10-10 B1:?d=<JSON> 请求体通道整体删除 —— 那是 AsyncWebRequest 时代的无鉴权
// 写面(config 保存可改 baseUrl/endpoint → 下一次翻译把 Key 发去攻击者服务器)。
// 写操作只剩 POST 与 BTIPC op=config 两条受控路径。
function bodyFromRequest(url, bodyObj) {
  if (bodyObj) return bodyObj;
  if (url.pathname === "/api/v1/translate") {
    return {
      text: url.searchParams.get("text") || "",
      sourceLanguage: url.searchParams.get("source") || "auto",
      targetLanguage: url.searchParams.get("target") || "zh-Hans",
      provider: url.searchParams.get("provider") || undefined,
      timeoutMs: Number(url.searchParams.get("timeoutMs")) || undefined,
    };
  }
  return null;
}

async function handleApi(req, res, url, bodyObj) {
  const p = url.pathname;

  if (p === "/api/v1/log" && (req.method === "POST" || req.method === "GET")) {
    bodyObj = bodyFromRequest(url, bodyObj);
    if (!bodyObj) return sendJson(res, 400, { ok: false, error: "bad_json" });
    const cfgL = configStore.load();
    if (!(cfgL.chatLog && cfgL.chatLog.enabled)) return sendJson(res, 200, { ok: true, skipped: "chat_log_disabled" });
    try {
      const n = appendChatLog(cfgL, bodyObj);
      sendJson(res, 200, { ok: true, written: n });
    } catch (e) {
      log("warn", "chat log write failed: " + (e && e.message ? e.message : String(e)));
      sendJson(res, 500, { ok: false, error: "chat_log_write_failed" });
    }
    return;
  }

  if (p === "/api/v1/health") {
    const cfgH = configStore.load();
    const healthResp = {
      ok: true,
      name: "Babel Tower Bridge",
      version: readLocalVersion() || "unknown",
      provider: cfgH.provider,
      providers: providerRegistry.listProviders(),
      fallbackProviders: Array.isArray(cfgH.fallbackProviders) ? cfgH.fallbackProviders : [],
      chatLog: Object.assign({ enabled: true, dir: "logs/chat" }, cfgH.chatLog || {}),
    };
    // 有缓存的版本检测结果时附带更新信息(游戏面板据此显示更新提示)
    if (cachedVersionInfo && cachedVersionInfo.ok && cachedVersionInfo.hasUpdate) {
      healthResp.updateInfo = {
        hasUpdate: true,
        currentVersion: cachedVersionInfo.currentVersion,
        latestVersion: cachedVersionInfo.latestVersion,
        releaseUrl: cachedVersionInfo.releaseUrl || GITHUB_REPO_URL + "/releases",
      };
    }
    sendJson(res, 200, healthResp);
    return;
  }

  if (p === "/api/v1/gamenames") {
    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "method_not_allowed" });
      return;
    }
    const gamenamesPath = path.join(__dirname, "..", "config", "gamenames.json");
    try {
      const data = JSON.parse(fs.readFileSync(gamenamesPath, "utf8"));
      // btipc07:补 fingerprint(与 BTIPC get=gamenames 同源),客户端可离线判断兜底是否过期
      sendJson(res, 200, { ok: true, count: Object.keys(data).length, fingerprint: syncData.namesFingerprint(data), names: data });
    } catch (e) {
      sendJson(res, 200, { ok: false, error: "gamenames_not_found" });
    }
    return;
  }

  if (p === "/api/v1/quickchat") {
    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "method_not_allowed" });
      return;
    }
    const quickchatPath = path.join(__dirname, "..", "config", "quickchat.json");
    try {
      const data = JSON.parse(fs.readFileSync(quickchatPath, "utf8"));
      // v3(2026-09-17): 原始模板数组(免正则,客户端分段比对);兼容读取旧 v2 patterns 字段
      let templates = [];
      if (Array.isArray(data.templates)) {
        templates = data.templates;
      } else if (data.templates && typeof data.templates === "object") {
        for (const k of Object.keys(data.templates)) {
          for (const t of data.templates[k]) templates.push(t);
        }
      } else if (Array.isArray(data.patterns)) {
        templates = data.patterns; // 旧版桥配置尚持 v2 时,发正则串无意义,但不至于报错
      }
      // fingerprint(内容指纹)透传:客户端 syncQuickChat 与兑底指纹比对,防"模板变了 version 忘 bump"
      sendJson(res, 200, { ok: true, version: data.version || 3, fingerprint: data.fingerprint || null, count: templates.length, templates: templates });
    } catch (e) {
      sendJson(res, 200, { ok: false, error: "quickchat_not_found" });
    }
    return;
  }

  if (p === "/api/v1/translate" && (req.method === "POST" || req.method === "GET")) {
    bodyObj = bodyFromRequest(url, bodyObj);
    if (!bodyObj || !String(bodyObj.text || "").trim()) return sendJson(res, 400, { ok: false, error: "bad_json" });
    const cfg = configStore.load();
    try {
      const result = await runTranslate(cfg, bodyObj);
      // 缓存非词典命中结果(词典结果本身零延迟,无需缓存;缓存命中已直接返回)
      if (result && !result.viaDictionary && !result.viaCache) {
        transCacheSet(
          result._protectedText || String(bodyObj.text || "").trim(),
          bodyObj.targetLanguage || cfg.defaults.targetLanguage || "zh-Hans",
          result.translation,
          result.detectedLanguage
        );
      }
      // 自适应学习:每次成功翻译都记录(含缓存命中——缓存命中同样是"该文本又出现一次"),
      // 高频词(同一译文 >= 3 次)自动固化进词典。词典内部会跳过已在表内的词。
      if (result && !result.viaDictionary) {
        dictionary.record(
          String(bodyObj.text || "").trim(),
          bodyObj.targetLanguage || cfg.defaults.targetLanguage || "zh-Hans",
          result.translation,
          result.detectedLanguage
        );
      }
      log("info", "translate ok: " + String(bodyObj.text || "").slice(0, 60).replace(/\s+/g, " ") + " [target=" + (bodyObj.targetLanguage || cfg.defaults.targetLanguage || "zh-Hans") + "]");
      sendJson(res, 200, {
        ok: true,
        translation: result.translation,
        detectedLanguage: result.detectedLanguage,
      });
    } catch (e) {
      log("warn", "translate failed: " + (e && e.message ? e.message : String(e)));
      sendJson(res, e && e.status ? e.status : 502, { ok: false, error: (e && e.message) || "unknown_error" });
    }
    return;
  }

  if (p === "/api/v1/test" && (req.method === "POST" || req.method === "GET")) {
    const cfg = configStore.load();
    const tBody = bodyFromRequest(url, bodyObj);
    try {
      const result = await runTranslate(cfg, {
        text: (tBody && tBody.text) || "hello",
        targetLanguage: (tBody && tBody.targetLanguage) || "zh-Hans",
        sourceLanguage: (tBody && tBody.sourceLanguage) || "auto",
      });
      log("info", "test ok");
      sendJson(res, 200, { ok: true, translation: result.translation, message: "连接成功" });
    } catch (e) {
      log("warn", "test failed: " + (e && e.message ? e.message : String(e)));
      sendJson(res, 200, { ok: false, error: (e && e.message) || "unknown_error" });
    }
    return;
  }

  if (p === "/api/v1/config") {
    if (req.method === "GET") {
      // 2026-10-10 B1:GET + ?d= 保存配置通道删除(无鉴权写 → 恶意网页可改 baseUrl
      // 等端点,下一次翻译把 API Key 外泄)。保存走 POST 或 BTIPC op=config(游戏现用)。
      if (url.searchParams.get("d")) {
        log("warn", "B1 rejected legacy GET config write, host=" + String(req.headers.host || "-"));
        sendJson(res, 410, { ok: false, error: "config_write_removed_use_post_or_op_config" });
        return;
      }
      // 读取用精简 mask:完整 mask 约 700 字符会超出 title 通道(约 512)上限,
      // 导致游戏侧 JSON 解析失败(2026-08-14 保存失效根因)
      sendJson(res, 200, { ok: true, config: configStore.maskCompact(configStore.load()) });
      return;
    }
    if (req.method === "POST") {
      if (!bodyObj) return sendJson(res, 400, { ok: false, error: "bad_json" });
      const current = configStore.load();
      const next = configStore.applyMaskedUpdate(current, bodyObj.config || {});
      configStore.save(next);
      // body 带 config = 保存;不带 = 加载(面板通道下两者都走 POST)。
      // 统一回精简 config(约 366 字符,远低于 title 通道 ~512 上限;2026-08-14 保存失效根因)
      if (bodyObj.config) log("info", "config saved");
      sendJson(res, 200, { ok: true, config: configStore.maskCompact(next) });
      return;
    }
  }

  if (p === "/api/v1/version-check") {
    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "method_not_allowed" });
      return;
    }
    doVersionCheck()
      .then((r) => sendJson(res, 200, r))
      .catch((e) => sendJson(res, 200, {
        ok: true,
        currentVersion: readLocalVersion(),
        hasUpdate: false,
        error: (e && e.message ? e.message : String(e)),
      }));
    return;
  }

  sendJson(res, 404, { ok: false, error: "not_found" });
}

// ---------- 服务器(双回环监听) ----------
// 同一个请求处理器创建两个 http.Server:一个绑 IPv4 回环(127.0.0.1),一个绑 IPv6 回环(::1)。
// 原因:游戏客户端用 BRIDGE_HOST="localhost",而 Windows 上 localhost 优先解析为 IPv6 回环 ::1;
// 若只绑 127.0.0.1,游戏连 localhost 会落到 ::1 被拒 => bridgeUp 永远 false => 面板显示"未运行"。
// 双回环后无论 localhost 解析到哪个都连得上,且两者均不暴露到局域网。
// ---------- EXP-6726g:最小 PNG 编码器(尺寸编码信道的回传载体) ----------
// RGB 真8位,单 IDAT,filter 全 0;尺寸即数据(游戏侧读面板固有宽高解码)
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function pngCrc(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc(body), 0);
  return Buffer.concat([len, body, crc]);
}
function makeRgbPng(w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const raw = Buffer.alloc((w * 3 + 1) * h); // 每行前置 filter byte 0
  const idat = require("zlib").deflateSync(raw, { level: 1 });
  return Buffer.concat([PNG_SIG, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
}

// B1 安全取证(游戏内实测 2026-10-10):每个 method+path+origin+host 组合首次落一行,
// 上限 30 —— 目的是拿到游戏 Panorama 实际发出的 Origin/Host(决定端点校验与 ACAO 收敛
// 怎么写),不是全量访问日志。去重后 /btipc/dl 高频轮询也只占 1 行。
const REQ_HDR_SEEN = new Set();
const REQ_HDR_CAP = 30;
function logReqHdr(req, pathname) {
  try {
    const org = req.headers.origin || "-";
    const hst = req.headers.host || "-";
    const key = req.method + "|" + pathname + "|" + org + "|" + hst;
    if (REQ_HDR_SEEN.has(key) || REQ_HDR_SEEN.size >= REQ_HDR_CAP) return;
    REQ_HDR_SEEN.add(key);
    log("info", "REQHDR method=" + req.method + " path=" + pathname + " origin=" + org + " host=" + hst);
  } catch (e) {}
}

// B1(2026-10-10):跨站请求守卫。见 requestHandler 内的三道闸说明。
const LOOPBACK_HOST_RE = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;
function crossSiteBlockReason(req) {
  try {
    const host = String(req.headers.host || "");
    if (!LOOPBACK_HOST_RE.test(host)) return "host:" + host.slice(0, 60);
    const sfs = req.headers["sec-fetch-site"];
    const org = req.headers.origin;
    if (sfs == null && org == null) return null; // 游戏 / 本地工具:零浏览器元数据
    if (sfs != null && sfs !== "same-origin" && sfs !== "none") {
      return "sec-fetch-site:" + String(sfs).slice(0, 40);
    }
    if (org != null) {
      const o = String(org);
      const ok = o === "http://127.0.0.1:" + PORT || o === "http://localhost:" + PORT || o === "http://[::1]:" + PORT;
      if (!ok) return "origin:" + o.slice(0, 80);
    }
    return null; // 同源元数据(未来复活的 bridgePage 场景):放行
  } catch (e) {
    return "guard_error";
  }
}
// B1:ACAO 收敛 —— 只对本地同 Origin 回显,其余请求不发 CORS 头(浏览器默认阻读)。
// 游戏不读跨域响应(实测零 Origin),回显仅服务于未来同源 bridgePage 复活。
function applyCors(req, res) {
  try {
    const org = req.headers.origin;
    if (org == null) return;
    const o = String(org);
    if (o === "http://127.0.0.1:" + PORT || o === "http://localhost:" + PORT || o === "http://[::1]:" + PORT) {
      res.setHeader("Access-Control-Allow-Origin", o);
    }
  } catch (e) {}
}

const requestHandler = (req, res) => {
  let url;
  try {
    url = new URL(req.url, "http://127.0.0.1");
  } catch (e) {
    res.statusCode = 400;
    res.end("bad request");
    return;
  }
  logReqHdr(req, url.pathname);
  // ---------- B1 安全边界(2026-10-10 游戏内实测取证后落地) ----------
  // 实测(REQHDR):游戏 Panorama 请求不带 Origin / Sec-Fetch-* 元数据,Host 恒为
  // 127.0.0.1:8791;游戏 HTTP 只打 /btipc/dl + /test.png + /dim.png。
  // 恶意网页的 fetch/img 必带 Sec-Fetch-Site: cross-site(或跨源 Origin);
  // DNS rebinding 则 Host 变成攻击者域名。三道闸:
  //   ① Host 非回环前缀 → 拒(DNS rebinding);
  //   ② 带浏览器元数据但非同源 → 拒(恶意网页);
  //   ③ 无元数据 → 放行(游戏 / 本地工具,与实测一致)。
  // 配套:GET ?d= 写通道整体删除(config 保存 → 410;translate/test/log 不再解析 ?d=),
  // 写操作只剩 POST 与 BTIPC op=config 两条受控路径。
  const _csReason = crossSiteBlockReason(req);
  if (_csReason) {
    log("warn", "B1 blocked: " + req.method + " " + url.pathname + " reason=" + _csReason);
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "forbidden_cross_site" }));
    return;
  }
  applyCors(req, res);

  // EXP6729: 图片响应状态码差分 — 200/404/500/204 验证 ImageLoaded 是否只在成功时触发。
  // 若触发与状态码相关 = 响应状态即入站位元通道(事件驱动,J4 天然异步)。
  if (url.pathname === "/probe_img") {
    const code = parseInt(url.searchParams.get("code"), 10) || 200;
    const n = url.searchParams.get("n") || "-";
    log("info", "PROBE-IMG code=" + code + " n=" + n);
    res.statusCode = (code >= 200 && code < 600) ? code : 200;
    res.setHeader("Cache-Control", "no-store, max-age=0");
    /* ACAO 已收敛到 requestHandler 顶部 applyCors(B1 2026-10-10) */
    if (code === 204) { res.end(); return; }
    if (code >= 200 && code < 300) {
      res.setHeader("Content-Type", "image/png");
      res.end(makeRgbPng(1, 1));
    } else {
      res.setHeader("Content-Type", "text/plain");
      res.end("error " + code);
    }
    return;
  }

  // EXP6734-B/D: 位元延迟端点 — 固定 200 PNG,逐条落底(服务端视角算丢失/乱序;
  // URL 带 round 参数保证每轮唯一,无跨轮缓存;6734-D 增带 c=<cfg>@<run> 按配置分组,
  // 无 c 时保持旧格式 BIT id=.. round=.. (6734-B 分析器兼容)
  if (url.pathname === "/probe_bit") {
    const bitId = url.searchParams.get("id") || "-";
    const bitRound = url.searchParams.get("round") || "-";
    const bitCfg = url.searchParams.get("c") || "-";
    if (bitCfg === "-") log("info", "BIT id=" + bitId + " round=" + bitRound);
    else log("info", "BIT c=" + bitCfg + " id=" + bitId + " round=" + bitRound);
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    /* ACAO 已收敛到 requestHandler 顶部 applyCors(B1 2026-10-10) */
    res.end(makeRgbPng(1, 1));
    return;
  }

  // EXP6734-E: 多值符号判别实验 —— 一个 Image 面板能否承载 >1 bit?
  // 状态机: 2xx(200/201/204/206)→空 PNG=200;3xx(301/302/304/307)→302 到 /rdata?f=E<code>;
  // 4xx(400/401/403/404)→对应 statusCode+短 HTML;5xx(500/503)→同上。
  // 每符号每轮仅首次落底,服务端无状态;判读只看游戏侧行为差异(loaded / loaded-late / 静默)。
  if (url.pathname === "/probe_e") {
    const eId = url.searchParams.get("id") || "-";
    const eRound = url.searchParams.get("round") || "-";
    const eCode = parseInt(url.searchParams.get("code") || "0", 10) || 0;
    log("info", "EIT id=" + eId + " round=" + eRound + " code=" + eCode);
    /* ACAO 已收敛到 requestHandler 顶部 applyCors(B1 2026-10-10) */
    res.setHeader("Cache-Control", "no-store, max-age=0");
    if (eCode >= 200 && eCode < 300) {
      res.statusCode = eCode;
      res.setHeader("Content-Type", "image/png");
      res.end(makeRgbPng(1, 1));
    } else if (eCode >= 300 && eCode < 400) {
      res.statusCode = eCode;
      res.setHeader("Location", "/rdata?f=E" + eCode + "&o=E" + eCode);
      res.setHeader("Content-Type", "text/html");
      res.end("<html><body>302</body></html>");
    } else if (eCode >= 400) {
      res.statusCode = eCode;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end("<html><body>E" + eCode + "</body></html>");
    } else {
      // code=0 兜底: 与 200 同形(防手滑打错 code 时把样本误判为 2xx)
      res.statusCode = 200;
      res.setHeader("Content-Type", "image/png");
      res.end(makeRgbPng(1, 1));
    }
    return;
  }

  // EXP6733: 302 重定向高带宽入站实验。
  // /redir302?o=<原标记>&f=<最终标记> -> 302 Location=/rdata?f=<最终标记>
  // /rdata 到达 = 引擎跟随了重定向;若 ImageLoaded 回读到 f 标记 = 最终 URL 可读 = 文本入站成立。
  if (url.pathname === "/redir302") {
    const o = url.searchParams.get("o") || "";
    const f = url.searchParams.get("f") || "";
    log("info", "PROBE-REDIR o=" + o + " f=" + f);
    res.statusCode = 302;
    res.setHeader("Location", "/rdata?f=" + encodeURIComponent(f));
    res.setHeader("Cache-Control", "no-store");
    res.end();
    return;
  }
  if (url.pathname === "/rdata") {
    const f = url.searchParams.get("f") || "";
    log("info", "PROBE-RDATA f=" + f + " (engine FOLLOWED the redirect)");
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    /* ACAO 已收敛到 requestHandler 顶部 applyCors(B1 2026-10-10) */
    res.end(makeRgbPng(1, 1));
    return;
  }

  // EXP6727: 探针信标路由 — Panorama Image.SetImage("/probe?seq=..&d=..") 到达即记录。
  // 双重用途: ① 验证 Image 出站通道仍活; ② 把诊断结果(console.log 同步双路上报)回传落盘。
  if (url.pathname === "/probe") {
    const seq = url.searchParams.get("seq") || "-";
    const part = url.searchParams.get("p") || "";
    const data = url.searchParams.get("d") || "";
    log("info", "PROBE seq=" + seq + (part ? " p=" + part : "") + " " + data);
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    /* ACAO 已收敛到 requestHandler 顶部 applyCors(B1 2026-10-10) */
    res.end(makeRgbPng(1, 1));
    return;
  }

  // EXP-6726g:尺寸回读探针 — 固定 133x77 RGB PNG,验证 Image 面板固有尺寸可经 actuallayoutwidth 读回
  if (url.pathname === "/dim.png") {
    log("info", "IMG-HIT id=" + (url.searchParams.get("id") || "?") + " dim-route");
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    /* ACAO 已收敛到 requestHandler 顶部 applyCors(B1 2026-10-10) */
    res.end(makeRgbPng(133, 77));
    return;
  }

  // EXP-6726f:图片通道探针 — 游戏 Image 面板 SetImage(http://...) 的请求是否到达桥。
  // 到达即记 IMG-HIT 日志(带 id 参数区分探测来源);返回 1x1 透明 PNG + 禁缓存。
  if (url.pathname === "/test.png") {
    log("info", "IMG-HIT id=" + (url.searchParams.get("id") || "?") + " (Image panel request REACHED bridge)");
    const PNG1x1 = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64"
    );
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    /* ACAO 已收敛到 requestHandler 顶部 applyCors(B1 2026-10-10) */
    res.end(PNG1x1);
    return;
  }

  // BTIPC v1 下行(规格 docs/btipc-v1.md §3.1/§6):每面板一位 —— 位=1 → 200 PNG,位=0 → 404。
  // 帧号只由轮号现算 idx = r - frameStartRound(§4.0 幂等),未知窗口 → 404。
  if (url.pathname === "/btipc/dl") {
    const out = btipcCh.serveDL({
      w: url.searchParams.get("w") || "",
      r: url.searchParams.get("r") || "",
      p: url.searchParams.get("p") || "",
      t: url.searchParams.get("t") || "",
    });
    res.statusCode = out.status;
    res.setHeader("Cache-Control", "no-store, max-age=0");
    /* ACAO 已收敛到 requestHandler 顶部 applyCors(B1 2026-10-10) */
    if (out.status === 200) {
      res.setHeader("Content-Type", "image/png");
      res.end(makeRgbPng(1, 1));
    } else {
      res.end();
    }
    return;
  }

  if (url.pathname === "/bridge") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    /* ACAO 已收敛到 requestHandler 顶部 applyCors(B1 2026-10-10) */
    res.end(bridgePage(url.searchParams));
    return;
  }

  if (url.pathname.indexOf("/api/v1/") === 0) {
    readBody(req, (err, raw) => {
      if (err) return sendJson(res, 413, { ok: false, error: "body_too_large" });
      const bodyObj = req.method === "POST" ? parseJson(raw) : null;
      handleApi(req, res, url, bodyObj).catch((e) => {
        log("error", "api crash: " + (e && e.stack ? e.stack : String(e)));
        sendJson(res, 500, { ok: false, error: "internal_error" });
      });
    });
    return;
  }

  res.statusCode = 404;
  res.end("not found");
};

const cfg = configStore.load();
activeConfig = cfg;
const PORT = Number(cfg.port) || 8791;
const HOST_V4 = "127.0.0.1";
const HOST_V6 = "::1";

// 启动清理: 删除 logs/chat 中超 30 天的活动日志 / 超 7 天的轮转备份
(() => {
  const dir = path.resolve(__dirname, "..", String((cfg.chatLog && cfg.chatLog.dir) || "logs/chat"));
  cleanupOldChatLogs(dir);
})();

startGameWatch();
startVersionCheckOnBoot();
startGameLogTail();

// ---------- EXP6727: 游戏 console.log 尾随(B 通道) ----------
// 链路: Panorama $.Msg / ConsoleCommand("echo ...") -> 游戏 console.log(-condebug)
//      -> 桥轮询尾随 -> logs/bridge.log(命中 gameLogMarkers 的行)。
// 这是已证实的出站信道(console.log 实测有 [PanoramaScript] [LCT] 行),
// 用于: ① 自动采集游戏内诊断探针结果; ② 评估 B 通道作为长期出站方案的吞吐/截断/编码表现。
// 设计要点:
//   - 游戏通常在桥之后启动,文件不存在时静默重试(每秒),找到后才开始尾随;
//   - 游戏重启会截断/轮转文件(size < pos -> 归零重来);
//   - 行过滤靠 marker([LCT] / BT_),防引擎日志刷屏;命中行的后续行(同批最多 3 行)
//     作为多行消息续行一并转发(测 B6 换行完整性);
function startGameLogTail() {
  if (cfg.gameLogTail === false) return;
  const markers = Array.isArray(cfg.gameLogMarkers) && cfg.gameLogMarkers.length
    ? cfg.gameLogMarkers
    : ["[LCT]", "BT_"];
  const GAME_LOG_REL = "game/citadel/console.log";
  // 候选顺序:显式配置 > DEADLOCK_ROOT > Steam 注册表安装路径 + libraryfolders.vdf
  // 登记的【全部】库(2026-10-03 修「漏查 D 盘游戏日志」:旧代码只写死 F: 与
  // C:\Program Files (x86)\Steam 两条,库在 D:/E:/G: 或自定义 Steam 路径的用户
  // 永远找不到文件 → tail 起不来 → BTIPC 上行全断)> 老写死路径兜底。
  function buildCandidates() {
    const head = [cfg.gameLogPath];
    try {
      if (process.env.DEADLOCK_ROOT) head.push(path.join(process.env.DEADLOCK_ROOT, GAME_LOG_REL));
    } catch (e) {}
    let c;
    try {
      c = steamPaths.gameFileCandidates("Deadlock", GAME_LOG_REL, head);
    } catch (e) {
      c = [];
      (head || []).forEach(function (p) { if (p) c.push(p); });
    }
    // 放最后而不是最前:注册表/vdf 意外读不到时保底,又不会让残留的旧安装目录挤掉新装
    ["F:/SteamLibrary", "D:/SteamLibrary", "C:/Program Files (x86)/Steam", "C:/Program Files/Steam"]
      .forEach(function (lib) {
        const p = lib + "/steamapps/common/Deadlock/" + GAME_LOG_REL;
        if (c.indexOf(p) === -1) c.push(p);
      });
    return c;
  }

  let candidates = buildCandidates();
  let foundPath = null;
  let filePos = 0;
  let partial = "";
  let probeTicks = 0;

  function emit(line) {
    if (line.length > 4000) line = line.slice(0, 4000) + "...<truncated>";
    log("game", line.replace(/\r$/, ""));
  }

  setInterval(function () {
    try {
      if (!foundPath) {
        // 库是后来才加的 / 注册表当时读不到:没找到就每 60s 重扫一次候选,
        // 免得启动时机不对就永远停在第一份候选上。
        probeTicks += 1;
        if (probeTicks % 60 === 0) candidates = buildCandidates();
        for (let i = 0; i < candidates.length; i += 1) {
          const c = candidates[i];
          try {
            if (c && fs.existsSync(c)) { foundPath = c; break; }
          } catch (e) {}
        }
        if (!foundPath) return;
        partial = "";
        // 从文件末尾开始: 只采集启动后的新行,不重放历史会话(否则旧 [LCT] 行混入难分辨)
        try { filePos = fs.statSync(foundPath).size; } catch (e) { filePos = 0; }
        log("info", "game console.log found: " + foundPath + " (tail started at pos " + filePos + ", markers: " + markers.join(", ") + ")");
      }
      let st;
      try { st = fs.statSync(foundPath); } catch (e) { return; }
      if (st.size < filePos) { filePos = 0; partial = ""; } // 游戏重启截断/轮转
      if (st.size === filePos) return;
      const len = st.size - filePos;
      const buf = Buffer.alloc(len);
      const fd = fs.openSync(foundPath, "r");
      fs.readSync(fd, buf, 0, len, filePos);
      fs.closeSync(fd);
      filePos = st.size;
      let text = partial + buf.toString("utf8");
      const lastNl = text.lastIndexOf("\n");
      if (lastNl === -1) { partial = text; return; }
      partial = text.slice(lastNl + 1);
      text = text.slice(0, lastNl);
      const lines = text.split(/\r?\n/);
      let contBudget = 0;
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line) continue;
        let hit = false;
        for (let m = 0; m < markers.length; m += 1) {
          if (line.indexOf(markers[m]) !== -1) { hit = true; break; }
        }
        if (hit) {
          emit(line);
          onBtipcGameLine(line); // BTIPC REQ/CAN(非 BTIPC 行在解析内静默忽略)
          contBudget = 3; // 命中行之后同批的后续行视作多行消息续行
        } else if (contBudget > 0) {
          contBudget -= 1;
          emit("  (cont) " + line);
        }
      }
    } catch (e) {
      // 尾随失败不能影响桥本体
    }
  }, 1000);

  // ---------- -condebug 缺失告警 ----------
  // 游戏必须带 -condebug 启动才会写 game/citadel/console.log;没有它,BTIPC 上行
  // (游戏→桥唯一的通路,AsyncWebRequest 已被移除、面板导航已失效)整个断掉,
  // mod 表现为"装了完全没反应"。该参数是玩家/启动器启动项,mod 侧无法强制,
  // 只能明确报警并给出修复步骤,免得用户对着静默失败排查一小时。
  const CONDEBUG_WARN_MS = 90000; // 游戏起来 90s 还没有本次启动的 console.log 才判缺失
  let condebugGameAt = 0;
  let condebugChecked = false;
  setInterval(function () {
    try {
      if (!gameProcessSeen) { condebugGameAt = 0; condebugChecked = false; return; }
      if (condebugChecked) return;
      const now = Date.now();
      if (!condebugGameAt) condebugGameAt = now;
      if (now - condebugGameAt < CONDEBUG_WARN_MS) return;
      let fresh = false;
      if (foundPath) {
        try { fresh = fs.statSync(foundPath).mtimeMs >= condebugGameAt; } catch (e) { fresh = false; }
      }
      condebugChecked = true; // 每次游戏启动只判一次,判过就不再重复
      if (fresh) return;
      log("warn", "游戏已运行 " + Math.round(CONDEBUG_WARN_MS / 1000) +
        "s,仍没有本次启动产生的 console.log => 缺少 -condebug 启动参数," +
        "BTIPC 上行(游戏→桥)不通,mod 会完全不工作。" +
        "修复:Steam 库 → Deadlock 右键 → 属性 → 常规 → 启动选项填 -condebug(设一次即可);" +
        "或改用 StartDeadlock.bat 启动(已自动带 -condebug)。");
    } catch (e) {}
  }, 5000);
}

// 端口被占用 = 已有实例在运行,静默退出(与启动器/开机自启场景兼容)。
// 两台 server 都 EADDRINUSE 才说明确有实例在跑;单台绑定失败(如该回环未启用)忽略。
let listenErrors = 0;
function onServerError(e) {
  if (e && e.code === "EADDRINUSE") {
    listenErrors += 1;
    if (listenErrors >= 2) process.exit(0);
    return;
  }
  log("error", "server error: " + ((e && e.message) || String(e)));
  process.exit(1);
}

function makeServer(host) {
  const s = http.createServer(requestHandler);
  s.on("error", onServerError);
  s.listen(PORT, host, () => {
    log("info", "Babel Tower bridge listening on http://" + host + ":" + PORT);
    log("info", "provider: " + cfg.provider + ", target: " + cfg.defaults.targetLanguage + " (key set: " + (!!(cfg.microsoft && cfg.microsoft.apiKey)) + ")");
  });
  return s;
}

// 先绑 IPv4,再绑 IPv6(任一成功即可服务;两者都成功则双栈可达)
makeServer(HOST_V4);
makeServer(HOST_V6);
