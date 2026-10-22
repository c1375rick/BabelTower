// Babel Tower - Microsoft Translator provider
// 使用 Microsoft Translator Text API v3 (Azure Cognitive Services)。
// 文档: https://learn.microsoft.com/azure/ai-services/translator/reference/v3-0-translate
// 独立实现,不依赖任何第三方 npm 包(仅使用 Node 内置模块)。
"use strict";

const https = require("https");
const tlsGuard = require("../tls_guard");

const DEFAULT_ENDPOINT = "https://api.cognitive.microsofttranslator.com";

// 常见错误码 -> 人类可读提示(用于游戏内红字显示)
function describeHttpError(status, bodyText) {
  const body = String(bodyText || "");
  switch (status) {
    case 401:
      return "API Key 无效(401)";
    case 403:
      return "Key 无权限或缺少区域(403),若 Key 绑定了区域请在配置里填写 Region";
    case 404:
      return "接口地址错误(404)";
    case 408:
      return "请求超时(408)";
    case 429:
      return "请求过于频繁(429),稍后自动重试";
    case 400:
      return "请求参数错误(400)";
    case 402:
      return "额度不足(402)";
    default:
      if (status >= 500) return "翻译服务错误(" + status + ")";
      return "翻译失败(" + status + ")" + (body ? ": " + body.slice(0, 120) : "");
  }
}

function buildTranslateUrl(opts) {
  const base = String(opts.endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, "");
  const url = new URL(base + "/translate");
  url.searchParams.set("api-version", "3.0");
  // 不传 from 时 Microsoft 会自动检测源语言
  if (opts.sourceLanguage && opts.sourceLanguage !== "auto") {
    url.searchParams.set("from", String(opts.sourceLanguage));
  }
  url.searchParams.set("to", String(opts.targetLanguage || "zh-Hans"));
  return url;
}

function postJson(url, apiKey, region, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        checkServerIdentity: tlsGuard.checkServerIdentity,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Ocp-Apim-Subscription-Key": String(apiKey || ""),
          ...(region ? { "Ocp-Apim-Subscription-Region": String(region) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
      }
    );
    req.on("error", (err) => reject(err));
    req.setTimeout(timeoutMs || 15000, () => {
      req.destroy(new Error("provider_timeout"));
    });
    req.write(JSON.stringify(payload));
    req.end();
  });
}

/**
 * 翻译一段文本。
 * @param {string} text
 * @param {object} opts { apiKey, region, endpoint, sourceLanguage, targetLanguage, timeoutMs }
 * @returns {Promise<{translation:string, detectedLanguage:string|null}>}
 */
async function translate(text, opts) {
  const url = buildTranslateUrl(opts);
  const res = await postJson(
    url,
    opts.apiKey,
    opts.region,
    [{ Text: String(text) }],
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
  const entry = Array.isArray(parsed) ? parsed[0] : null;
  const translation =
    entry && entry.translations && entry.translations[0] && entry.translations[0].text;
  if (!translation) {
    throw new Error("翻译服务返回为空");
  }
  return {
    translation: String(translation),
    detectedLanguage: entry.detectedLanguage ? String(entry.detectedLanguage.language) : null,
  };
}

module.exports = {
  requiresKey: true,
id: "microsoft",
  label: "Microsoft Translator",
  translate,
};
