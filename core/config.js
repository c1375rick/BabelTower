// Contributor: Thirt927 (https://github.com/Thirt927/BabelTower), merged 2026-08-13 under GPL-3.0
// Babel Tower - 本地配置管理
// 配置只存放在本地磁盘 config/config.json(绝不进入 VPK / Git / 日志)。
// 首次运行会自动从 config.example.json 生成。
"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  port: 8791,
  provider: "bing",
  bing: {},
  microsoft: {
    apiKey: "",
    region: "",
    endpoint: "https://api.cognitive.microsofttranslator.com",
  },
  openai: {
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  deepl: {
    apiKey: "",
    endpoint: "https://api-free.deepl.com/v2/translate",
  },
  google: {
    apiKey: "",
  },
  // 主服务商失败时的自动回退顺序(可空数组表示不回退)
  // 例:["bing"] 表示 bing 失败后依次尝试 bing(仅当它是备用时才有意义)
  // 建议:["microsoft","openai","deepl","google"] (仅尝试已配置 Key 的服务商)
  fallbackProviders: [],
  // 聊天日志(按比赛 ID 划分文件)
  chatLog: {
    enabled: true,
    dir: "logs/chat",
  },
  // 自己的发言也翻译(面板开关,经桥持久化)
  translateOwn: true,
  defaults: {
    sourceLanguage: "auto",
    targetLanguage: "zh-Hans",
  },
  timeoutMs: 15000,
  maxQueue: 200,
  // 游戏面板 UI 偏好(经桥持久化,避免游戏重启丢失)
  ui: {
    enabled: true,
    provider: "bing",
    displayMode: "bilingual",
    outgoing: "off",
    outgoingTarget: "en",
    targetLanguage: "zh-Hans",
    force: false,
    timeoutMs: 15000,
  },
  // 进程监视:Deadlock 退出时桥自动关闭(设为 false 或启动参数 --no-watch 可禁用)
  watchGame: true,
  watchGameExe: "deadlock.exe",
  // 可选文件日志(相对项目根目录;留空则不落盘)
  logFile: "",
};

function configDir() {
  return path.join(__dirname, "..", "config");
}

function configPath() {
  return path.join(configDir(), "config.json");
}

function examplePath() {
  return path.join(configDir(), "config.example.json");
}

function deepMerge(base, extra) {
  const out = Object.assign({}, base);
  for (const key of Object.keys(extra || {})) {
    const v = extra[key];
    if (v && typeof v === "object" && !Array.isArray(v) && base[key] && typeof base[key] === "object") {
      out[key] = deepMerge(base[key], v);
    } else {
      out[key] = v;
    }
  }
  return out;
}

function normalize(raw) {
  const cfg = deepMerge(DEFAULTS, raw || {});
  if (!Number.isFinite(Number(cfg.port))) cfg.port = DEFAULTS.port;
  if (!Number.isFinite(Number(cfg.timeoutMs))) cfg.timeoutMs = DEFAULTS.timeoutMs;
  if (!Number.isFinite(Number(cfg.maxQueue))) cfg.maxQueue = DEFAULTS.maxQueue;
  return cfg;
}

function load() {
  try {
    if (fs.existsSync(configPath())) {
      return normalize(JSON.parse(fs.readFileSync(configPath(), "utf8")));
    }
  } catch (e) {
    // 配置损坏时回退默认值,不崩溃
  }
  // 首次运行:用默认值自动生成 config.json,方便用户后续查看/调整
  const defaults = normalize({});
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(defaults, null, 2), "utf8");
  } catch (e) {}
  return defaults;
}

function save(cfg) {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), "utf8");
}

// 返回给游戏面板的配置(apiKey 打码,绝不回传明文)
function mask(cfg) {
  const key = (cfg.microsoft && cfg.microsoft.apiKey) || "";
  const openaiKey = (cfg.openai && cfg.openai.apiKey) || "";
  const deeplKey = (cfg.deepl && cfg.deepl.apiKey) || "";
  const googleKey = (cfg.google && cfg.google.apiKey) || "";
  return {
    port: cfg.port,
    provider: cfg.provider,
    microsoft: {
      apiKey: key ? "********" : "",
      hasApiKey: !!key,
      region: (cfg.microsoft && cfg.microsoft.region) || "",
      endpoint: (cfg.microsoft && cfg.microsoft.endpoint) || DEFAULTS.microsoft.endpoint,
    },
    openai: {
      apiKey: openaiKey ? "********" : "",
      hasApiKey: !!openaiKey,
      baseUrl: (cfg.openai && cfg.openai.baseUrl) || DEFAULTS.openai.baseUrl,
      model: (cfg.openai && cfg.openai.model) || DEFAULTS.openai.model,
    },
    deepl: {
      apiKey: deeplKey ? "********" : "",
      hasApiKey: !!deeplKey,
      endpoint: (cfg.deepl && cfg.deepl.endpoint) || DEFAULTS.deepl.endpoint,
    },
    google: {
      apiKey: googleKey ? "********" : "",
      hasApiKey: !!googleKey,
    },
    fallbackProviders: Array.isArray(cfg.fallbackProviders) ? cfg.fallbackProviders : [],
    chatLog: Object.assign({ enabled: true, dir: "logs/chat" }, cfg.chatLog || {}),
    defaults: {
      sourceLanguage: (cfg.defaults && cfg.defaults.sourceLanguage) || "auto",
      targetLanguage: (cfg.defaults && cfg.defaults.targetLanguage) || "zh-Hans",
    },
    timeoutMs: cfg.timeoutMs,
    ui: Object.assign({}, DEFAULTS.ui, cfg.ui || {}),
  };
}

// 精简版 mask:只返回游戏侧实际读取的字段,
// 把响应体积压到 document.title 通道(约 512 字符)限制以内(见 2026-08-14 保存失效根因)。
function maskCompact(cfg) {
  const c = normalize(cfg);
  const out = {
    provider: c.provider,
    fallbackProviders: Array.isArray(c.fallbackProviders) ? c.fallbackProviders : [],
    ui: Object.assign({}, DEFAULTS.ui, c.ui || {}),
  };
  out.microsoft = { hasApiKey: !!(c.microsoft && c.microsoft.apiKey) };
  // region 非机密,回传给游戏面板做回填(否则每次打开都是空,用户误以为没保存)
  if (c.microsoft && c.microsoft.region) out.microsoft.region = c.microsoft.region;
  out.openai = { hasApiKey: !!(c.openai && c.openai.apiKey) };
  // baseUrl/model/endpoint 仅在非默认值时输出(游戏侧 if 存在才回填,省略=用默认,省体积)
  if (c.openai && c.openai.baseUrl && c.openai.baseUrl !== DEFAULTS.openai.baseUrl) out.openai.baseUrl = c.openai.baseUrl;
  if (c.openai && c.openai.model && c.openai.model !== DEFAULTS.openai.model) out.openai.model = c.openai.model;
  out.deepl = { hasApiKey: !!(c.deepl && c.deepl.apiKey) };
  if (c.deepl && c.deepl.endpoint && c.deepl.endpoint !== DEFAULTS.deepl.endpoint) out.deepl.endpoint = c.deepl.endpoint;
  out.google = { hasApiKey: !!(c.google && c.google.apiKey) };
  out.translateOwn = c.translateOwn !== false;
  if (c.chatLog) out.chatLog = { enabled: c.chatLog.enabled !== false };
  return out;
}

// 保存配置时处理打码回传:apiKey 为 "********" 表示保留原值;空串表示清除
// 同时兼容两种输入形态:
//   嵌套式(直接调 API):  { microsoft:{apiKey,region,endpoint}, defaults:{...}, provider, timeoutMs }
//   扁平式(游戏面板):    { provider, apiKey, region, targetLanguage, sourceLanguage, timeoutMs }
function applyMaskedUpdate(current, incoming) {
  const cfg = normalize(current);

  // 嵌套式 microsoft 块
  if (incoming.microsoft) {
    const ms = incoming.microsoft;
    if (typeof ms.apiKey === "string") {
      if (ms.apiKey && ms.apiKey !== "********") cfg.microsoft.apiKey = ms.apiKey;
      if (ms.apiKey === "") cfg.microsoft.apiKey = "";
    }
    if (typeof ms.region === "string" && ms.region) cfg.microsoft.region = ms.region;
    if (ms.clearRegion === true) cfg.microsoft.region = "";
    if (typeof ms.endpoint === "string" && ms.endpoint) cfg.microsoft.endpoint = ms.endpoint;
  }

  // 扁平式(面板)字段:apiKey 属于“当前选中的服务商”,
  // 必须按 provider 映射到对应段(DeepSeek 经 OpenAI 兼容填 openai.apiKey,不能固定写 microsoft)
  const flatKeyTarget = incoming.provider || cfg.provider;
  if (typeof incoming.apiKey === "string") {
    const key = incoming.apiKey;
    // 清空 Key 必须显式传 clearApiKey:true;空字符串不再清空,
    // 防止面板字段被清空/异步未回填时误删已保存的 Key(见第 16 轮)
    const clearKey = incoming.clearApiKey === true;
    const setKey = function (obj) {
      if (key && key !== "********") obj.apiKey = key;
      if (key === "" && clearKey) obj.apiKey = "";
    };
    if (flatKeyTarget === "openai") setKey(cfg.openai);
    else if (flatKeyTarget === "deepl") setKey(cfg.deepl);
    else if (flatKeyTarget === "google") setKey(cfg.google);
    else setKey(cfg.microsoft);
  }
  // 空 region 不再清空(面板打开时字段为空是正常态,不能当成“用户想清空”);
  // 显式 clearRegion:true 才清空 —— 修复 /tr 反复打开后 Region 被抹掉导致 Microsoft 鉴权失败。
  if (typeof incoming.region === "string" && incoming.region) cfg.microsoft.region = incoming.region;
  if (incoming.clearRegion === true) cfg.microsoft.region = "";

  if (incoming.openai) {
    const oa = incoming.openai;
    if (typeof oa.apiKey === "string") {
      if (oa.apiKey && oa.apiKey !== "********") cfg.openai.apiKey = oa.apiKey;
      if (oa.apiKey === "") cfg.openai.apiKey = "";
    }
    if (typeof oa.baseUrl === "string" && oa.baseUrl) cfg.openai.baseUrl = oa.baseUrl;
    if (typeof oa.model === "string" && oa.model) cfg.openai.model = oa.model;
  }
  if (incoming.deepl) {
    const dl = incoming.deepl;
    if (typeof dl.apiKey === "string") {
      if (dl.apiKey && dl.apiKey !== "********") cfg.deepl.apiKey = dl.apiKey;
      if (dl.apiKey === "") cfg.deepl.apiKey = "";
    }
    if (typeof dl.endpoint === "string" && dl.endpoint) cfg.deepl.endpoint = dl.endpoint;
  }
  if (incoming.google) {
    const gg = incoming.google;
    if (typeof gg.apiKey === "string") {
      if (gg.apiKey && gg.apiKey !== "********") cfg.google.apiKey = gg.apiKey;
      if (gg.apiKey === "") cfg.google.apiKey = "";
    }
  }
  if (Array.isArray(incoming.fallbackProviders)) {
    cfg.fallbackProviders = incoming.fallbackProviders.filter((x) => typeof x === "string");
  }
  if (incoming.chatLog && typeof incoming.chatLog === "object") {
    if (typeof incoming.chatLog.enabled === "boolean") cfg.chatLog.enabled = incoming.chatLog.enabled;
    if (typeof incoming.chatLog.dir === "string" && incoming.chatLog.dir) cfg.chatLog.dir = incoming.chatLog.dir;
  }
  // 面板传布尔形态的 chatLog(collectPanelConfig 返回 chatLog: bool)
  if (typeof incoming.chatLog === "boolean") cfg.chatLog.enabled = incoming.chatLog;
  // 翻译自己的消息开关(面板传布尔)
  if (typeof incoming.translateOwn === "boolean") cfg.translateOwn = incoming.translateOwn;

  // 扁平式:面板可能传 openaiBaseUrl/openaiModel/deeplEndpoint 等
  if (typeof incoming.openaiBaseUrl === "string" && incoming.openaiBaseUrl) cfg.openai.baseUrl = incoming.openaiBaseUrl;
  if (typeof incoming.openaiModel === "string" && incoming.openaiModel) cfg.openai.model = incoming.openaiModel;
  if (typeof incoming.deeplEndpoint === "string" && incoming.deeplEndpoint) cfg.deepl.endpoint = incoming.deeplEndpoint;

  if (typeof incoming.provider === "string" && incoming.provider) cfg.provider = incoming.provider;

  if (incoming.defaults) {
    if (typeof incoming.defaults.sourceLanguage === "string") cfg.defaults.sourceLanguage = incoming.defaults.sourceLanguage;
    if (typeof incoming.defaults.targetLanguage === "string") cfg.defaults.targetLanguage = incoming.defaults.targetLanguage;
  }
  if (typeof incoming.targetLanguage === "string" && incoming.targetLanguage) {
    cfg.defaults.targetLanguage = incoming.targetLanguage;
  }
  if (typeof incoming.sourceLanguage === "string" && incoming.sourceLanguage) {
    cfg.defaults.sourceLanguage = incoming.sourceLanguage;
  }

  if (Number.isFinite(Number(incoming.timeoutMs))) cfg.timeoutMs = Number(incoming.timeoutMs);

  // 游戏面板 UI 偏好(扁平字段,与面板 collectPanelConfig 对齐)
  if (incoming.ui && typeof incoming.ui === "object") {
    const u = incoming.ui;
    if (typeof u.enabled === "boolean") cfg.ui.enabled = u.enabled;
    if (typeof u.provider === "string" && u.provider) cfg.ui.provider = u.provider;
    if (typeof u.displayMode === "string" && u.displayMode) cfg.ui.displayMode = u.displayMode;
    if (typeof u.outgoing === "string" && u.outgoing) cfg.ui.outgoing = u.outgoing;
    if (typeof u.outgoingTarget === "string" && u.outgoingTarget) cfg.ui.outgoingTarget = u.outgoingTarget;
    if (typeof u.targetLanguage === "string" && u.targetLanguage) cfg.ui.targetLanguage = u.targetLanguage;
    if (typeof u.force === "boolean") cfg.ui.force = u.force;
    if (Number.isFinite(Number(u.timeoutMs))) cfg.ui.timeoutMs = Number(u.timeoutMs);
  }
  // 兼容面板旧扁平形态(直接顶层字段)
  if (typeof incoming.displayMode === "string" && incoming.displayMode) cfg.ui.displayMode = incoming.displayMode;
  if (typeof incoming.outgoing === "string" && incoming.outgoing) cfg.ui.outgoing = incoming.outgoing;
  if (typeof incoming.outgoingTarget === "string" && incoming.outgoingTarget) cfg.ui.outgoingTarget = incoming.outgoingTarget;
  if (typeof incoming.enabled === "boolean") cfg.ui.enabled = incoming.enabled;
  if (typeof incoming.force === "boolean") cfg.ui.force = incoming.force;
  return cfg;
}

module.exports = { load, save, mask, maskCompact, applyMaskedUpdate, configPath, examplePath, DEFAULTS };
