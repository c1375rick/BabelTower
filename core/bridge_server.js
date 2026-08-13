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
// 首次运行生成词典文件;桥启动后自动落盘高频词(自适应学习)
dictionary.ensureFile();
dictionary.startAutoFlush();

const MAX_BODY_BYTES = 64 * 1024;
const MAX_TEXT_CHARS = 4000; // 单条聊天文本长度上限

// ---------- 翻译结果缓存(同文本二次秒回,避免重复走 Bing) ----------
// 聊天场景重复度高(gg/glhf/thanks 等高频短语),缓存命中直接返回,零网络开销。
const TRANS_CACHE_LIMIT = 500;
const TRANS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 分钟,覆盖整局对局
const transCache = new Map(); // key: text + target -> { translation, detectedLanguage, ts }

function cacheKey(text, target) {
  return String(text).toLowerCase().slice(0, 200) + "\x00" + String(target || "").toLowerCase();
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

// ---------- 进程监视:记录游戏开关状态(桥常驻,不随游戏退出) ----------
const WATCH_INTERVAL_MS = 2000;
let gameProcessSeen = false;
let watchTimer = null;

function checkGameProcess() {
  const gameExe = String((activeConfig && activeConfig.watchGameExe) || "deadlock.exe").toLowerCase();
  execFile(
    "tasklist",
    ["/FI", "IMAGENAME eq " + gameExe, "/FO", "CSV", "/NH"],
    { windowsHide: true },
    function (err, stdout) {
      const running = !err && String(stdout || "").toLowerCase().indexOf(gameExe) !== -1;
      if (running) {
        if (!gameProcessSeen) log("info", "检测到 " + gameExe + " 运行,监视退出中");
        gameProcessSeen = true;
      } else if (gameProcessSeen) {
        // 2026-08-12 修复: 原来这里 process.exit(0) 导致"关游戏再开就没桥"
        // (桥退出后没有任何机制重新拉起)。改为常驻: 游戏退出后桥保持运行,
        // 下次游戏启动时直接可用。
        log("info", gameExe + " 已退出,桥保持运行(等待下次游戏启动)");
        gameProcessSeen = false;
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

  // 缓存命中:同文本直接返回上次结果(词典未覆盖的长句/短语重复出现时,零网络延迟)
  const targetLang = payload.targetLanguage || cfg.defaults.targetLanguage || "zh-Hans";
  const cached = transCacheGet(text, targetLang);
  if (cached) {
    log("info", "cache hit: " + String(text).slice(0, 60).replace(/\s+/g, " "));
    return { translation: cached.translation, detectedLanguage: cached.detectedLanguage, viaCache: true };
  }

  const providerCfg = (cfg[provider.id] || {});
  const result = await provider.translate(text, {
    apiKey: providerCfg.apiKey,
    region: providerCfg.region,
    endpoint: providerCfg.endpoint,
    sourceLanguage: payload.sourceLanguage || cfg.defaults.sourceLanguage || "auto",
    targetLanguage: payload.targetLanguage || cfg.defaults.targetLanguage || "zh-Hans",
    timeoutMs: Number(payload.timeoutMs) || cfg.timeoutMs,
  });
  return result;
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
    "setTimeout(function(){if(!done){done=true;out({ok:false,error:'bridge_timeout'});}},8000);",
    "var req={operation:op,text:q.get('text')||'',sourceLanguage:q.get('source')||'auto',targetLanguage:q.get('target')||'zh-Hans'};",
    "var d=q.get('d');if(d){try{req=JSON.parse(d);}catch(e){}}",
    "var path='/api/v1/'+(op==='translate'?'translate':op);",
    "fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(req)})",
    ".then(function(r){return r.json();})",
    ".then(function(j){if(done)return;done=true;out(j);})",
    ".catch(function(e){if(done)return;done=true;out({ok:false,error:String(e)});});",
    "})();",
    "</script></body></html>",
  ].join("");
}

// ---------- API 路由 ----------
async function handleApi(req, res, url, bodyObj) {
  const p = url.pathname;

  if (p === "/api/v1/health") {
    sendJson(res, 200, { ok: true, name: "Babel Tower Bridge", version: "0.1.0" });
    return;
  }

  if (p === "/api/v1/translate" && req.method === "POST") {
    if (!bodyObj) return sendJson(res, 400, { ok: false, error: "bad_json" });
    const cfg = configStore.load();
    try {
      const result = await runTranslate(cfg, bodyObj);
      // 缓存非词典命中结果(词典结果本身零延迟,无需缓存;缓存命中已直接返回)
      if (result && !result.viaDictionary && !result.viaCache) {
        transCacheSet(
          String(bodyObj.text || "").trim(),
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
      log("info", "translate ok: " + String(bodyObj.text || "").slice(0, 60).replace(/\s+/g, " "));
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

  if (p === "/api/v1/test" && req.method === "POST") {
    const cfg = configStore.load();
    try {
      const result = await runTranslate(cfg, { text: "hello", targetLanguage: "zh-Hans", sourceLanguage: "auto" });
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
      sendJson(res, 200, { ok: true, config: configStore.mask(configStore.load()) });
      return;
    }
    if (req.method === "POST") {
      if (!bodyObj) return sendJson(res, 400, { ok: false, error: "bad_json" });
      const current = configStore.load();
      const next = configStore.applyMaskedUpdate(current, bodyObj.config || {});
      configStore.save(next);
      log("info", "config saved");
      sendJson(res, 200, { ok: true, config: configStore.mask(next) });
      return;
    }
  }

  sendJson(res, 404, { ok: false, error: "not_found" });
}

// ---------- 服务器 ----------
const server = http.createServer((req, res) => {
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
});

const cfg = configStore.load();
activeConfig = cfg;
const PORT = Number(cfg.port) || 8791;
const HOST = "127.0.0.1";

startGameWatch();

// 端口被占用 = 已有实例在运行,静默退出(与启动器/开机自启场景兼容)
server.on("error", (e) => {
  if (e && e.code === "EADDRINUSE") {
    process.exit(0);
  }
  log("error", "server error: " + ((e && e.message) || String(e)));
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  log("info", "Babel Tower bridge listening on http://" + HOST + ":" + PORT);
  log("info", "provider: " + cfg.provider + ", target: " + cfg.defaults.targetLanguage + " (key set: " + (!!(cfg.microsoft && cfg.microsoft.apiKey)) + ")");
});
