// Contributor: Thirt927 (https://github.com/Thirt927/BabelTower), merged 2026-08-13 under GPL-3.0
// Babel Tower - OpenAI 兼容 Provider(可接 OpenAI / Ollama / LM Studio / OneAPI 等)
// ------------------------------------------------------------------
// 支持任何 OpenAI Chat Completions 兼容端点:
//   baseUrl 默认 https://api.openai.com/v1
//   model   默认 gpt-4o-mini(可改成任意模型名,如 ollama 的 llama3、LM Studio 的本地模型)
// 用法(设置面板或 config/config.json):
//   { "openai": { "apiKey": "...", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4o-mini" } }
"use strict";

const https = require("https");
const http = require("http");

const DEFAULT_BASE = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

function describeHttpError(status, bodyText) {
  const body = String(bodyText || "");
  let msg = "";
  try {
    const j = JSON.parse(body);
    msg = (j.error && (j.error.message || j.error.code)) || "";
  } catch (e) {}
  switch (status) {
    case 401: return "API Key 无效(401)" + (msg ? ": " + msg : "");
    case 403: return "无权限/额度问题(403)" + (msg ? ": " + msg : "");
    case 404: return "接口地址或模型不存在(404): 检查 baseUrl/model(DeepSeek 官方: https://api.deepseek.com 或 /v1 + 模型 deepseek-chat / deepseek-reasoner)" + (msg ? ": " + msg : "");
    case 429: return "请求过于频繁或额度不足(429)" + (msg ? ": " + msg : "");
    default:
      if (status >= 500) return "服务商错误(" + status + ")" + (msg ? ": " + msg : "");
      return "翻译失败(" + status + ")" + (msg ? ": " + msg : "");
  }
}

function requestJson(url, apiKey, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === "http:" ? http : https;
    const req = mod.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + String(apiKey || ""),
          "User-Agent": "BabelTower/0.1",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
      }
    );
    req.on("error", (err) => reject(err));
    req.setTimeout(timeoutMs || 15000, () => { req.destroy(new Error("provider_timeout")); });
    req.write(JSON.stringify(payload));
    req.end();
  });
}

function buildPayload(model, messages, withTemperature) {
  const payload = { model: model, messages: messages };
  if (withTemperature) payload.temperature = 0.2;
  return payload;
}

// language code -> human label used in the translation instruction
function languageLabel(code) {
  const m = {
    "zh": "Simplified Chinese",
    "zh-Hans": "Simplified Chinese",
    "zh-CN": "Simplified Chinese",
    "zh-Hant": "Traditional Chinese",
    "zh-TW": "Traditional Chinese",
    "zh-HK": "Traditional Chinese",
    "en": "English",
    "en-US": "English",
    "en-GB": "English",
    "ja": "Japanese",
    "ja-JP": "Japanese",
    "ko": "Korean",
    "ko-KR": "Korean",
    "ru": "Russian",
    "ru-RU": "Russian",
    "fr": "French",
    "fr-FR": "French",
    "de": "German",
    "de-DE": "German",
    "es": "Spanish",
    "es-ES": "Spanish",
    "pt": "Portuguese",
    "pt-BR": "Portuguese",
    "it": "Italian",
    "it-IT": "Italian",
    "pl": "Polish",
    "uk": "Ukrainian",
    "ar": "Arabic",
    "tr": "Turkish",
    "th": "Thai",
    "vi": "Vietnamese",
    "id": "Indonesian",
  };
  return m[String(code || "")] || String(code || "Simplified Chinese");
}

// Translation instruction: pulls the model back from "chat mode" to "translate mode".
// Instruction is placed in both system and user (some OpenAI-compatible endpoints ignore system).
function buildMessages(text, opts) {
  const target = languageLabel(opts.targetLanguage || "zh-Hans");
  const system = [
    "You are a translation engine for multiplayer game chat.",
    "You translate short chat messages between players.",
    "Always reply with ONLY the translated text in " + target + ".",
    "Never answer the message as a conversation, never ask questions, never add explanations, quotes, or notes.",
    "Preserve the tone (gg, glhf, ty etc.) and keep it short.",
  ].join(" ");
  const user = "Translate this game chat message to " + target + ". Reply with only the translation.\n\n" + String(text);
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// Clean model output: strip wrapping quotes/brackets and code fences, keep only the translation
function cleanTranslation(raw) {
  let s = String(raw || "").trim();
  if (/^```[\s\S]*```$/.test(s)) {
    s = s.replace(/^```[^\n]*\n?/, "").replace(/\n?```$/, "").trim();
  }
  const pairs = [['"', '"'], ["'", "'"], ["\u201c", "\u201d"], ["\u2018", "\u2019"], ["\u300c", "\u300d"], ["\u300e", "\u300f"], ["(", ")"], ["\uff08", "\uff09"]];
  let changed = true;
  while (changed && s.length >= 2) {
    changed = false;
    for (const [l, r] of pairs) {
      if (s.startsWith(l) && s.endsWith(r)) {
        s = s.slice(l.length, s.length - r.length).trim();
        changed = true;
        break;
      }
    }
  }
  return s;
}

async function translate(text, opts) {
  const base = String(opts.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
  const url = new URL(base + "/chat/completions");
  const model = String(opts.model || DEFAULT_MODEL);
  const messages = buildMessages(text, opts);
  let res = await requestJson(url, opts.apiKey, buildPayload(model, messages, true), opts.timeoutMs);
  // DeepSeek reasoner 等模型不支持 temperature/top_p(400),去掉后重试一次
  if (res.status === 400 && String(res.body).toLowerCase().indexOf("temperature") !== -1) {
    res = await requestJson(url, opts.apiKey, buildPayload(model, messages, false), opts.timeoutMs);
  }
  if (res.status !== 200) {
    const err = new Error(describeHttpError(res.status, res.body));
    err.status = res.status;
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch (e) {
    throw new Error("翻译服务返回了无法解析的数据");
  }
  const content =
    parsed &&
    parsed.choices &&
    parsed.choices[0] &&
    parsed.choices[0].message &&
    parsed.choices[0].message.content;
  if (!content) {
    throw new Error("翻译服务返回为空");
  }
  return {
    translation: cleanTranslation(content),
    detectedLanguage: null,
  };
}

module.exports = {
  id: "openai",
  label: "OpenAI 兼容(自定义)",
  translate,
  buildMessages,
  cleanTranslation,
  languageLabel,
};
