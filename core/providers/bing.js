// Babel Tower - Bing/Microsoft Translator Provider(免 Key 公共接口)
// ------------------------------------------------------------------
// 2026-09-19 更新:Bing 网页翻译接口(ttranslatev3)被区域跳转击穿:
//   www.bing.com 现在会 302 到 cn.bing.com(区域相关),而 cn 子域页面签发的
//   token 被自己的 ttranslatev3 拒绝(401 {"ShowCaptcha":false}),刷新重试也无效。
//   改用 Edge 免费翻译端点(Edge 浏览器内置翻译同款协议):
//     POST https://edge.microsoft.com/translate/translatetext?to=..&from=..
//     JSON 数组 body,无需 IG/IID/token,天然不会有 token 失效 401。
//   响应结构与 ttranslatev3 一致({detectedLanguage, translations}),国内直连可用。
//   (协议参考 plainheart/bing-translate-api v4 的 MET 模式;该端点即
//    edge.microsoft.com/translate/translatetext,与 2026-08 下线的旧
//    edge.microsoft.com/translate/auth 授权端点无关。)
// 说明:
//   - 公共免费接口(非官方合同 API),个人聊天翻译场景足够。
//   - 若该接口不可用,可在设置面板把服务商切换为 microsoft(需 Azure Key)。
"use strict";

const https = require("https");

// keep-alive agent:复用 TLS 连接,省掉每次请求的 TCP+TLS 握手(实测每请求省 ~200-400ms)
const agent = new https.Agent({ keepAlive: true, maxSockets: 4 });

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0";
// Edge 免费翻译端点:无需任何 token/鉴权
const EDGE_TRANSLATE_URL = "https://edge.microsoft.com/translate/translatetext";

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

// 退避等待:用 Promise + setTimeout(不要用同步 sleep 阻塞事件循环)
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 轻量 info 日志(各 provider 独立,不依赖外部日志模块)
function logInfo(msg) {
  // eslint-disable-next-line no-console
  console.log("[bing] [info] " + msg);
}

function describeError(status, body) {
  const snippet = body ? ": " + String(body).slice(0, 200) : "";
  switch (status) {
    case 400:
      return "请求被拒(400)" + snippet;
    case 401:
      return "接口拒绝访问(401)" + snippet;
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
  const to = String(opts.targetLanguage || "zh-Hans");
  const from = opts.sourceLanguage && opts.sourceLanguage !== "auto" ? String(opts.sourceLanguage) : "";
  const params = new URLSearchParams({ to: to, isEnterpriseClient: "false" });
  if (from) params.set("from", from);
  const url = EDGE_TRANSLATE_URL + "?" + params.toString();

  const attempt = function () {
    const body = JSON.stringify([String(text)]);
    return request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "User-Agent": DEFAULT_UA,
      },
      body: body,
      timeoutMs: opts.timeoutMs,
    });
  };

  let res = await attempt();

  // 429 限流:指数退避重试(初始 1s,每次翻倍,最多 3 次:1s→2s→4s,总等待 ≤ 8s)
  let retry = 0;
  while (res.status === 429 && retry < 3) {
    const waitMs = 1000 * Math.pow(2, retry); // 1000, 2000, 4000
    logInfo("edge 端点 429 限流,等待 " + waitMs + "ms 后重试...");
    await sleep(waitMs);
    res = await attempt();
    retry++;
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
