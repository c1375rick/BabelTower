// Babel Tower - Bing Translator Provider(无密钥公共接口)
// ------------------------------------------------------------------
// 2026-08-03 更新:微软下线了旧的免Key授权端点(edge.microsoft.com/translate/auth,404),
// 现改用 Bing 网页翻译(ttranslatev3)同款协议:
//   1. GET https://www.bing.com/translator(跟随重定向到 cn.bing.com)
//      从页面 HTML 提取:IG、IID、以及 params_AbusePreventionHelper 数组
//      [key, token, tokenExpiryInterval]
//   2. POST https://<sub>.bing.com/ttranslatev3?isVertical=1&IG=..&IID=..
//      表单字段:fromLang / text / to / token / key
// 说明:
//   - 公共免费接口(非官方合同 API),有隐形限流;个人聊天翻译场景足够。
//   - token 约 1 小时有效(由页面返回的 interval 决定),缓存到期自动刷新。
//   - 若该接口不可用,可在设置面板把服务商切回 microsoft(需 Azure Key)。
"use strict";

const https = require("https");

// keep-alive agent:复用 TLS 连接,省掉每次请求的 TCP+TLS 握手(实测每请求省 ~200-400ms)
const agent = new https.Agent({ keepAlive: true, maxSockets: 4 });

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/151.0.4129.59";
const TRANSLATOR_PAGE = "https://www.bing.com/translator";
const MIN_CACHE_MS = 60000;

let pageConfig = null; // { ig, iid, key, token, subdomain, fetchedAt, interval }

function match1(text, re) {
  const m = re.exec(String(text || ""));
  return m ? m[1] : "";
}

function request(url, { method = "GET", headers = {}, body = null, timeoutMs = 15000, redirects = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: method, headers: headers, agent: agent }, (res) => {
      // 跟随重定向(最多 3 跳)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 3) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        request(next, { method: method, headers: headers, body: body, timeoutMs: timeoutMs, redirects: redirects + 1 })
          .then(resolve, reject);
        return;
      }
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode || 0, body: data, finalUrl: url }));
    });
    req.on("error", (err) => reject(err));
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("provider_timeout"));
    });
    if (body !== null) req.write(body);
    req.end();
  });
}

async function fetchPageConfig(timeoutMs) {
  const res = await request(TRANSLATOR_PAGE, {
    headers: { "User-Agent": DEFAULT_UA },
    timeoutMs: timeoutMs,
  });
  if (res.status !== 200) {
    throw new Error("bing 页面获取失败(" + res.status + ")");
  }
  const html = res.body;
  const ig = match1(html, /IG:"([^"]+)"/);
  const iid = match1(html, /data-iid="([^"]+)"/);
  const arrRaw = match1(html, /params_AbusePreventionHelper\s?=\s?([^\]]+\])/);
  let fields = null;
  try {
    fields = JSON.parse(arrRaw);
  } catch (e) {}
  if (!ig || !iid || !fields || fields.length < 3 || !fields[1]) {
    throw new Error("bing 页面参数解析失败");
  }
  let subdomain = "www";
  try {
    const host = new URL(res.finalUrl).hostname;
    const m = host.match(/^([a-z0-9-]+)\.bing\.com$/i);
    if (m) subdomain = m[1].toLowerCase();
  } catch (e) {}
  pageConfig = {
    ig: ig,
    iid: iid,
    key: String(fields[0]),
    token: String(fields[1]),
    interval: Number(fields[2]) || 3600000,
    subdomain: subdomain,
    fetchedAt: Date.now(),
  };
  return pageConfig;
}

async function getPageConfig(timeoutMs) {
  if (pageConfig && Date.now() - pageConfig.fetchedAt < Math.max(MIN_CACHE_MS, pageConfig.interval - MIN_CACHE_MS)) {
    return pageConfig;
  }
  return fetchPageConfig(timeoutMs);
}

function describeError(status, body) {
  const snippet = body ? ": " + String(body).slice(0, 200) : "";
  switch (status) {
    case 400:
      return "请求被拒(400,已自动刷新参数重试)" + snippet;
    case 401:
      return "token 失效(401,已自动刷新重试)" + snippet;
    case 403:
      return "接口拒绝访问(403)" + snippet;
    case 429:
      return "请求过于频繁(429),稍后自动重试" + snippet;
    case 408:
      return "请求超时(408)" + snippet;
    default:
      if (status >= 500) return "翻译服务错误(" + status + ")" + snippet;
      return "翻译失败(" + status + ")" + snippet;
  }
}

/**
 * 翻译一段文本(无需 apiKey)。
 * @param {string} text
 * @param {object} opts { sourceLanguage, targetLanguage, timeoutMs }
 * @returns {Promise<{translation:string, detectedLanguage:string|null}>}
 */
async function translate(text, opts) {
  let cfg = await getPageConfig(opts.timeoutMs);

  const attempt = async function (c) {
    const base =
      "https://" + c.subdomain + ".bing.com/ttranslatev3?isVertical=1" +
      "&IG=" + encodeURIComponent(c.ig) +
      "&IID=" + encodeURIComponent(c.iid);
    const form = new URLSearchParams();
    form.set("fromLang", opts.sourceLanguage && opts.sourceLanguage !== "auto" ? opts.sourceLanguage : "auto-detect");
    form.set("text", String(text));
    // BUGFIX 2026-08-14:bing 免费接口对裸 "en" 目标的中文短词语言检测失败直接返回原文
    // (detectedLanguage:null,实测:你好/在吗/收到/打团/上单/撤退→en 均返回原文),
    // 映射为区域代码 en-GB 后稳定正常(你好→Hello/早上好→Good morning 等)。
    // en-US 实测被拒(400),故不用 en-US。
    const TO_TARGET_OVERRIDES = { "en": "en-GB" };
    form.set("to", TO_TARGET_OVERRIDES[String(opts.targetLanguage || "zh-Hans")] || String(opts.targetLanguage || "zh-Hans"));
    form.set("token", c.token);
    form.set("key", c.key);
    form.set("tryFetchingGenderDebiasedTranslations", "true");
    return request(base, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": DEFAULT_UA,
        "Referer": "https://" + c.subdomain + ".bing.com/translator",
      },
      body: form.toString(),
      timeoutMs: opts.timeoutMs,
    });
  };

  let res = await attempt(cfg);
  // token/参数异常时刷新页面配置重试一次
  if (res.status === 400 || res.status === 401) {
    pageConfig = null;
    cfg = await fetchPageConfig(opts.timeoutMs);
    res = await attempt(cfg);
  }

  if (res.status !== 200) {
    const err = new Error(describeError(res.status, res.body));
    err.status = res.status;
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(res.body);
  } catch (e) {
    throw new Error("翻译服务返回了无法解析的数据");
  }
  if (parsed && parsed.ShowCaptcha) {
    throw new Error("bing 触发了验证码,请稍后再试或切换服务商");
  }
  if (parsed && parsed.statusCode) {
    throw new Error("bing 请求被拒(" + parsed.statusCode + ")");
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
  id: "bing",
  label: "Bing Translator(免 Key)",
  translate,
};
