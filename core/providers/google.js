// Contributor: Thirt927 (https://github.com/Thirt927/BabelTower), merged 2026-08-13 under GPL-3.0
// Babel Tower - Google Cloud Translation Provider(v2,需 API Key)
// ------------------------------------------------------------------
// 文档: https://cloud.google.com/translate/docs/reference/rest/v2/translate
// 用法(设置面板或 config/config.json):
//   { "google": { "apiKey": "..." } }
"use strict";

const https = require("https");

function mapLang(lang) {
  const main = String(lang || "zh-Hans").toLowerCase().split("-")[0];
  const map = {
    zh: "zh-CN", en: "en", ja: "ja", ko: "ko", fr: "fr", de: "de",
    es: "es", ru: "ru", it: "it", pt: "pt", nl: "nl", pl: "pl",
    tr: "tr", uk: "uk", ar: "ar", th: "th", vi: "vi", id: "id",
  };
  return map[main] || "en";
}

// Google v2 返回的译文会把 HTML 实体转义(如 \u003c),这里还原
function decodeHtmlEntities(s) {
  return String(s || "")
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">")
    .replace(/\\u0026/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&");
}

function describeHttpError(status, bodyText) {
  const body = String(bodyText || "");
  let msg = "";
  try {
    const j = JSON.parse(body);
    msg = (j.error && j.error.message) || "";
  } catch (e) {}
  switch (status) {
    case 400: return "请求参数错误(400)" + (msg ? ": " + msg : "");
    case 403: return "Key 无效或未启用 Translation API(403)" + (msg ? ": " + msg : "");
    case 429: return "请求过于频繁或额度不足(429)";
    default:
      if (status >= 500) return "Google 服务错误(" + status + ")";
      return "翻译失败(" + status + ")" + (msg ? ": " + msg : "");
  }
}

function postJson(url, apiKey, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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

async function translate(text, opts) {
  const url = new URL("https://translation.googleapis.com/language/translate/v2");
  url.searchParams.set("key", String(opts.apiKey || ""));
  const res = await postJson(
    url,
    opts.apiKey,
    {
      q: String(text),
      target: mapLang(opts.targetLanguage),
      ...(opts.sourceLanguage && opts.sourceLanguage !== "auto"
        ? { source: mapLang(opts.sourceLanguage) }
        : {}),
      format: "text",
    },
    opts.timeoutMs
  );
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
  const translation =
    parsed && parsed.data && parsed.data.translations &&
    parsed.data.translations[0] && parsed.data.translations[0].translatedText;
  if (!translation) {
    throw new Error("翻译服务返回为空");
  }
  return {
    translation: decodeHtmlEntities(translation),
    detectedLanguage: (parsed.data.translations[0] && parsed.data.translations[0].detectedSourceLanguage) || null,
  };
}

module.exports = {
  id: "google",
  label: "Google Cloud(需 Key)",
  translate,
};
