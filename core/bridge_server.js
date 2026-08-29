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

const http = require("http");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

const configStore = require("./config");
const providerRegistry = require("./providers/registry");
const dictionary = require("./dictionary");
const nameProtect = require("./name_protect");
// 首次运行生成词典文件;桥启动后自动落盘高频词(自适应学习)
dictionary.ensureFile();
dictionary.startAutoFlush();
nameProtect.load();
nameProtect.watchLocalization();

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

function log(level, msg) {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  const line = "[" + ts + "] [" + level + "] " + msg;
  // 任何日志都不允许包含 apiKey;调用方自行保证
  console.log(line);
  try {
    if (activeConfig && activeConfig.logFile) {
      fs.appendFileSync(path.resolve(__dirname, "..", activeConfig.logFile), line + "\n", "utf8");
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
  res.setHeader("Access-Control-Allow-Origin", "*");
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
// GET 兼容:游戏侧 $.AsyncWebRequest 只能发 GET,请求体通过 ?d=<JSON> 传递;
// 无 d 时 translate/test 用 query 参数(text/source/target/provider)构造。
function bodyFromRequest(url, bodyObj) {
  if (bodyObj) return bodyObj;
  const d = url.searchParams.get("d");
  if (d) {
    try { return JSON.parse(d); } catch (e) {}
  }
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
    sendJson(res, 200, {
      ok: true,
      name: "Babel Tower Bridge",
      version: "1.0.0-beta.2",
      provider: cfgH.provider,
      providers: providerRegistry.listProviders(),
      fallbackProviders: Array.isArray(cfgH.fallbackProviders) ? cfgH.fallbackProviders : [],
      chatLog: Object.assign({ enabled: true, dir: "logs/chat" }, cfgH.chatLog || {}),
    });
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
      // GET + d 参数:游戏侧 AsyncWebRequest 保存配置(读配置保持无 d)
      const d = url.searchParams.get("d");
      if (d) {
        let saveBody = null;
        try { saveBody = JSON.parse(d); } catch (e) {}
        if (saveBody && saveBody.config) {
          const current = configStore.load();
          const next = configStore.applyMaskedUpdate(current, saveBody.config || {});
          configStore.save(next);
          log("info", "config saved (GET)");
          // 保存响应最小化:游戏侧只读 res.ok;但保持带精简 config 以兼容加载分支
          sendJson(res, 200, { ok: true, config: configStore.maskCompact(next) });
          return;
        }
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

  sendJson(res, 404, { ok: false, error: "not_found" });
}

// ---------- 服务器(双回环监听) ----------
// 同一个请求处理器创建两个 http.Server:一个绑 IPv4 回环(127.0.0.1),一个绑 IPv6 回环(::1)。
// 原因:游戏客户端用 BRIDGE_HOST="localhost",而 Windows 上 localhost 优先解析为 IPv6 回环 ::1;
// 若只绑 127.0.0.1,游戏连 localhost 会落到 ::1 被拒 => bridgeUp 永远 false => 面板显示"未运行"。
// 双回环后无论 localhost 解析到哪个都连得上,且两者均不暴露到局域网。
const requestHandler = (req, res) => {
  let url;
  try {
    url = new URL(req.url, "http://127.0.0.1");
  } catch (e) {
    res.statusCode = 400;
    res.end("bad request");
    return;
  }

  if (url.pathname === "/bridge") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
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
