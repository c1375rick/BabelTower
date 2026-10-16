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

  // 429 限流:**快速失败,把回退机会让给回退链**,不在这里睡。
  //
  // 2026-10-15 实机教训:原来是「1s→2s→4s 共 7 秒」的指数退避(旧注释还写着"总等待 ≤ 8s")。
  // 那 7 秒把三件事一起饿死:① 回退链 —— provider 内部没抛错,桥根本没机会换服务商;
  // ② 用户的聊天;③ 可观测性 —— 退避提示走 console.log,而桥是隐藏窗口启动、stdout 没人接,
  // 于是 logs\bridge.log 里一行限流记录都没有,现场只剩"游戏侧 8 秒后出译文"的黑盒现象。
  // 现在:短等一次就放弃,并给错误打上 rateLimited 标记,桥据此立刻走回退。
  let retry = 0;
  while (res.status === 429 && retry < 1) {
    const waitMs = 600;
    logInfo("edge 端点 429 限流," + waitMs + "ms 后再试一次;仍限流则交给回退链");
    await sleep(waitMs);
    res = await attempt();
    retry++;
  }

  if (res.status === 429) {
    const err = new Error("接口限流(429),已让出回退机会");
    err.status = 429;
    err.rateLimited = true;
    throw err;
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
  requiresKey: false, // 回退链据此判定:没 Key 也能用(2026-10-15:原来靠 pid!=="bing" 硬编码,google 会被误跳过)
  translate,
};
