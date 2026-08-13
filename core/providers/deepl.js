// Contributor: Thirt927 (https://github.com/Thirt927/BabelTower), merged 2026-08-13 under GPL-3.0
// Babel Tower - DeepL Provider
// ------------------------------------------------------------------
// 使用 DeepL API v2:
//   free 端点: https://api-free.deepl.com/v2/translate
//   pro  端点: https://api.deepl.com/v2/translate
// 用法(设置面板或 config/config.json):
//   { "deepl": { "apiKey": "...", "endpoint": "https://api-free.deepl.com/v2/translate" } }
"use strict";

const https = require("https");

const DEFAULT_ENDPOINT = "https://api-free.deepl.com/v2/translate";

function mapLang(lang) {
  const main = String(lang || "zh-Hans").toLowerCase().split("-")[0];
  const map = {
    zh: "ZH", en: "EN", ja: "JA", ko: "KO", fr: "FR", de: "DE",
    es: "ES", ru: "RU", it: "IT", pt: "PT", nl: "NL", pl: "PL",
    tr: "TR", uk: "UK", ar: "AR", th: "TH", vi: "VI", id: "ID",
  };
  return map[main] || "EN";
}

function describeHttpError(status, bodyText) {
  const body = String(bodyText || "");
  switch (status) {
    case 403: return "DeepL Key 无效或额度不足(403)";
    case 429: return "DeepL 请求过于频繁(429)";
    case 456: return "DeepL 本月额度已用完(456)";
    default:
      if (status >= 500) return "DeepL 服务错误(" + status + ")";
      return "翻译失败(" + status + ")" + (body ? ": " + body.slice(0, 120) : "");
  }
}

function postForm(url, fields, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = Object.keys(fields)
      .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(String(fields[k])))
      .join("&");
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
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
    req.write(body);
    req.end();
  });
}

async function translate(text, opts) {
  const url = new URL(String(opts.endpoint || DEFAULT_ENDPOINT));
  const res = await postForm(
    url,
    {
      auth_key: String(opts.apiKey || ""),
      text: String(text),
      target_lang: mapLang(opts.targetLanguage),
      ...(opts.sourceLanguage && opts.sourceLanguage !== "auto"
        ? { source_lang: mapLang(opts.sourceLanguage) }
        : {}),
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
    parsed && parsed.translations && parsed.translations[0] && parsed.translations[0].text;
  if (!translation) {
    throw new Error("翻译服务返回为空");
  }
  return {
    translation: String(translation),
    detectedLanguage: parsed.translations[0].detected_source_language
      ? String(parsed.translations[0].detected_source_language).toLowerCase()
      : null,
  };
}

module.exports = {
  id: "deepl",
  label: "DeepL(需 Key)",
  translate,
};
