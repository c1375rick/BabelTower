// 运行: node --test tests/providers.test.js
//
// BabelTower Provider 层单元测试 (mock HTTP)
// ------------------------------------------------------------------
// 策略: 由于每个 provider 内部都通过 `https.request` (openai 还可能用 `http.request`)
// 发送请求,这里在测试里「拦截」全局的 https.request / http.request,替换为可控的
// 假实现 (fake ClientRequest / IncomingMessage)。这样既可以测试成功/错误/格式错误,
// 也能通过「不调用响应回调」来模拟超时——且不需要真实网络、也不需要自签名证书。
//
// 所有 provider 源文件均不被修改。
// 依赖: 仅 Node.js 内置模块 (node:test, node:assert, node:https, node:http, ...)。

"use strict";

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const https = require("https");
const http = require("http");
const { EventEmitter } = require("events");
const { URL } = require("url");

// ---------------------------------------------------------------------------
// Mock 核心: 拦截 https.request / http.request
// ---------------------------------------------------------------------------
function createMock() {
  let handler = null; // (reqInfo) => responseSpec | null
  const requests = [];
  let origHttpsRequest = null;
  let origHttpRequest = null;

  // 把 provider 可能传入的 url (string | URL | 选项对象) 解析成 URL 对象
  function parseUrl(urlOrOpts) {
    if (typeof urlOrOpts === "string") return new URL(urlOrOpts);
    if (urlOrOpts instanceof URL) return new URL(urlOrOpts);
    if (urlOrOpts && typeof urlOrOpts === "object") {
      const proto = urlOrOpts.protocol || "https:";
      const host = urlOrOpts.hostname || urlOrOpts.host || "localhost";
      const port = urlOrOpts.port ? ":" + urlOrOpts.port : "";
      const path = urlOrOpts.path || urlOrOpts.pathname || "/";
      return new URL(proto + "//" + host + port + path);
    }
    return new URL(String(urlOrOpts));
  }

  // 构造一个假的 IncomingMessage (EventEmitter),支持 data/end/statusCode/headers
  function makeFakeRes(spec, reqInfo) {
    const res = new EventEmitter();
    res.statusCode = spec.status || 200;
    res.headers = spec.headers || {};
    res.resume = () => {};
    res.setEncoding = () => {};
    res.finalUrl = reqInfo.url;
    const bodyStr = spec.body == null ? "" : String(spec.body);
    process.nextTick(() => {
      if (bodyStr) res.emit("data", bodyStr);
      res.emit("end");
    });
    return res;
  }

  function fakeRequest(urlOrOpts, options, callback) {
    let url, opts, cb;
    if (typeof urlOrOpts === "function") {
      // request(cb) / request(opts, cb) 形式,本测试中 providers 不会用到,做兼容
      cb = urlOrOpts;
      opts = options || {};
      url = opts;
    } else {
      url = urlOrOpts;
      opts = options || {};
      cb = callback;
    }

    const parsed = parseUrl(url);
    let body = "";
    const reqEmitter = new EventEmitter();
    let destroyed = false;
    let timeoutFn = null;
    let timeoutMs = 0;

    const fakeReq = {
      on(ev, fn) {
        reqEmitter.on(ev, fn);
        return fakeReq;
      },
      once(ev, fn) {
        reqEmitter.once(ev, fn);
        return fakeReq;
      },
      setTimeout(ms, fn) {
        if (typeof ms === "function") {
          fn = ms;
          ms = 0;
        }
        timeoutMs = ms || 0;
        if (fn) timeoutFn = fn;
        return fakeReq;
      },
      write(chunk) {
        if (!destroyed && chunk != null) body += chunk;
        return true;
      },
      end(chunk) {
        if (chunk != null && !destroyed) body += chunk;
        process.nextTick(() => {
          if (destroyed) return;
          const reqInfo = {
            method: (opts.method || "GET").toUpperCase(),
            url: parsed.toString(),
            path: parsed.pathname,
            query: parsed.search,
            hostname: parsed.hostname,
            headers: opts.headers || {},
            body: body,
          };
          requests.push(reqInfo);

          let spec;
          try {
            spec = handler ? handler(reqInfo) : { status: 200, body: "" };
          } catch (e) {
            process.nextTick(() => reqEmitter.emit("error", e));
            return;
          }

          // 超时模式: 不返回任何响应,仅在到达 timeoutMs 后触发 provider 设置的超时回调
          if (spec && spec.timeout) {
            if (timeoutFn) {
              setTimeout(() => {
                if (!destroyed) {
                  destroyed = true;
                  timeoutFn(new Error("provider_timeout"));
                }
              }, timeoutMs || 0);
            }
            return; // 永远不调用 cb -> 不响应
          }

          const res = makeFakeRes(spec || { status: 200, body: "" }, reqInfo);
          if (cb) cb(res);
        });
        return fakeReq;
      },
      destroy(err) {
        destroyed = true;
        if (err) reqEmitter.emit("error", err);
      },
    };
    return fakeReq;
  }

  return {
    install() {
      origHttpsRequest = https.request;
      origHttpRequest = http.request;
      https.request = fakeRequest;
      http.request = fakeRequest;
    },
    restore() {
      https.request = origHttpsRequest;
      http.request = origHttpRequest;
    },
    reset() {
      handler = null;
      requests.length = 0;
    },
    setHandler(fn) {
      handler = fn;
    },
    get requests() {
      return requests;
    },
  };
}

// ---------------------------------------------------------------------------
// 测试脚手架
// ---------------------------------------------------------------------------
const mock = createMock();

before(() => mock.install());
after(() => mock.restore());
beforeEach(() => mock.reset());

// Bing 首页 HTML mock: 需要包含 IG / data-iid / params_AbusePreventionHelper
const BING_PAGE_HTML = [
  "<html>",
  '<script>var IG:"ABC123IG";</script>',
  '<div data-iid="IID-456"></div>',
  '<script>params_AbusePreventionHelper = ["thekey","thetoken",3600000]</script>',
  "</html>",
].join("\n");

function ok(bodyObj) {
  return { status: 200, body: JSON.stringify(bodyObj) };
}
function httpErr(status, body) {
  return { status, body: body == null ? "" : body };
}
function badJson() {
  return { status: 200, body: "<<<not valid json<<<" };
}
function timeoutResp() {
  return { timeout: true };
}

// 加载 providers (CommonJS, 不被修改)
const openai = require("../core/providers/openai");
const deepl = require("../core/providers/deepl");
const microsoft = require("../core/providers/microsoft");
const google = require("../core/providers/google");
const bing = require("../core/providers/bing");

// ---------------------------------------------------------------------------
// OpenAI 兼容 Provider
// ---------------------------------------------------------------------------
test("openai: 成功翻译返回 translation", async () => {
  mock.setHandler(() => ok({ choices: [{ message: { content: "Hello" } }] }));
  const r = await openai.translate("你好", {
    apiKey: "k",
    baseUrl: "https://api.openai.com/v1",
    targetLanguage: "en",
  });
  assert.strictEqual(r.translation, "Hello");
  assert.strictEqual(r.detectedLanguage, null);
});

test("openai: HTTP 401 抛出带 status 的错误", async () => {
  mock.setHandler(() => httpErr(401, JSON.stringify({ error: { message: "invalid key" } })));
  await assert.rejects(
    openai.translate("你好", { apiKey: "bad", baseUrl: "https://api.openai.com/v1", targetLanguage: "en" }),
    (e) => e.status === 401
  );
});

test("openai: HTTP 429 抛出带 status 的错误", async () => {
  mock.setHandler(() => httpErr(429, ""));
  await assert.rejects(
    openai.translate("你好", { apiKey: "k", baseUrl: "https://api.openai.com/v1", targetLanguage: "en" }),
    (e) => e.status === 429
  );
});

test("openai: 返回非法 JSON 抛出解析错误", async () => {
  mock.setHandler(() => badJson());
  await assert.rejects(
    openai.translate("你好", { apiKey: "k", baseUrl: "https://api.openai.com/v1", targetLanguage: "en" }),
    /无法解析/
  );
});

test("openai: 超时抛出 provider_timeout", async () => {
  mock.setHandler(() => timeoutResp());
  await assert.rejects(
    openai.translate("你好", { apiKey: "k", baseUrl: "https://api.openai.com/v1", targetLanguage: "en", timeoutMs: 100 }),
    /provider_timeout/
  );
});

// ---------------------------------------------------------------------------
// DeepL Provider
// ---------------------------------------------------------------------------
test("deepl: 成功翻译返回 translation 与 detectedLanguage", async () => {
  mock.setHandler(() => ok({ translations: [{ text: "Hello", detected_source_language: "EN" }] }));
  const r = await deepl.translate("你好", {
    apiKey: "k",
    endpoint: "https://api-free.deepl.com/v2/translate",
    targetLanguage: "en",
  });
  assert.strictEqual(r.translation, "Hello");
  assert.strictEqual(r.detectedLanguage, "en");
});

test("deepl: HTTP 403 抛出带 status 的错误", async () => {
  mock.setHandler(() => httpErr(403, ""));
  await assert.rejects(
    deepl.translate("你好", { apiKey: "k", endpoint: "https://api-free.deepl.com/v2/translate", targetLanguage: "en" }),
    (e) => e.status === 403
  );
});

test("deepl: HTTP 456 抛出带 status 的错误", async () => {
  mock.setHandler(() => httpErr(456, ""));
  await assert.rejects(
    deepl.translate("你好", { apiKey: "k", endpoint: "https://api-free.deepl.com/v2/translate", targetLanguage: "en" }),
    (e) => e.status === 456
  );
});

test("deepl: 返回非法 JSON 抛出解析错误", async () => {
  mock.setHandler(() => badJson());
  await assert.rejects(
    deepl.translate("你好", { apiKey: "k", endpoint: "https://api-free.deepl.com/v2/translate", targetLanguage: "en" }),
    /无法解析/
  );
});

test("deepl: 超时抛出 provider_timeout", async () => {
  mock.setHandler(() => timeoutResp());
  await assert.rejects(
    deepl.translate("你好", { apiKey: "k", endpoint: "https://api-free.deepl.com/v2/translate", targetLanguage: "en", timeoutMs: 100 }),
    /provider_timeout/
  );
});

// ---------------------------------------------------------------------------
// Microsoft Translator Provider
// ---------------------------------------------------------------------------
test("microsoft: 成功翻译返回 translation 与 detectedLanguage", async () => {
  mock.setHandler(() => ok([{ translations: [{ text: "Hello" }], detectedLanguage: { language: "en" } }]));
  const r = await microsoft.translate("你好", {
    apiKey: "k",
    endpoint: "https://api.cognitive.microsofttranslator.com",
    targetLanguage: "en",
  });
  assert.strictEqual(r.translation, "Hello");
  assert.strictEqual(r.detectedLanguage, "en");
});

test("microsoft: HTTP 401 抛出带 status 的错误", async () => {
  mock.setHandler(() => httpErr(401, ""));
  await assert.rejects(
    microsoft.translate("你好", { apiKey: "bad", endpoint: "https://api.cognitive.microsofttranslator.com", targetLanguage: "en" }),
    (e) => e.status === 401
  );
});

test("microsoft: HTTP 429 抛出带 status 的错误", async () => {
  mock.setHandler(() => httpErr(429, ""));
  await assert.rejects(
    microsoft.translate("你好", { apiKey: "k", endpoint: "https://api.cognitive.microsofttranslator.com", targetLanguage: "en" }),
    (e) => e.status === 429
  );
});

test("microsoft: 返回非法 JSON 抛出解析错误", async () => {
  mock.setHandler(() => badJson());
  await assert.rejects(
    microsoft.translate("你好", { apiKey: "k", endpoint: "https://api.cognitive.microsofttranslator.com", targetLanguage: "en" }),
    /无法解析/
  );
});

test("microsoft: 超时抛出 provider_timeout", async () => {
  mock.setHandler(() => timeoutResp());
  await assert.rejects(
    microsoft.translate("你好", { apiKey: "k", endpoint: "https://api.cognitive.microsofttranslator.com", targetLanguage: "en", timeoutMs: 100 }),
    /provider_timeout/
  );
});

// ---------------------------------------------------------------------------
// Google Cloud Translation Provider
// ---------------------------------------------------------------------------
test("google: 成功翻译返回 translation 与 detectedLanguage", async () => {
  mock.setHandler(() =>
    ok({ data: { translations: [{ translatedText: "Hello", detectedSourceLanguage: "zh-CN" }] } })
  );
  const r = await google.translate("你好", { apiKey: "k", targetLanguage: "en" });
  assert.strictEqual(r.translation, "Hello");
  assert.strictEqual(r.detectedLanguage, "zh-CN");
});

test("google: HTTP 403 抛出带 status 的错误", async () => {
  mock.setHandler(() => httpErr(403, JSON.stringify({ error: { message: "disabled" } })));
  await assert.rejects(
    google.translate("你好", { apiKey: "bad", targetLanguage: "en" }),
    (e) => e.status === 403
  );
});

test("google: HTTP 500 抛出带 status 的错误", async () => {
  mock.setHandler(() => httpErr(500, ""));
  await assert.rejects(
    google.translate("你好", { apiKey: "k", targetLanguage: "en" }),
    (e) => e.status === 500
  );
});

test("google: 返回非法 JSON 抛出解析错误", async () => {
  mock.setHandler(() => badJson());
  await assert.rejects(
    google.translate("你好", { apiKey: "k", targetLanguage: "en" }),
    /无法解析/
  );
});

test("google: 超时抛出 provider_timeout", async () => {
  mock.setHandler(() => timeoutResp());
  await assert.rejects(
    google.translate("你好", { apiKey: "k", targetLanguage: "en", timeoutMs: 100 }),
    /provider_timeout/
  );
});

// ---------------------------------------------------------------------------
// Bing Translator Provider (免 Key,需先 GET 页面取 token 再 POST 翻译)
// ---------------------------------------------------------------------------
function bingSuccessHandler() {
  return (req) => {
    if (req.method === "GET" && req.path === "/translator") {
      return { status: 200, body: BING_PAGE_HTML };
    }
    if (req.method === "POST" && req.path === "/ttranslatev3") {
      return ok([{ translations: [{ text: "Hello" }], detectedLanguage: { language: "en" } }]);
    }
    return { status: 200, body: "" };
  };
}

test("bing: 成功翻译 (GET 页面 + POST 翻译) 返回 translation 与 detectedLanguage", async () => {
  mock.setHandler(bingSuccessHandler());
  const r = await bing.translate("你好", { targetLanguage: "en" });
  assert.strictEqual(r.translation, "Hello");
  assert.strictEqual(r.detectedLanguage, "en");
  // 应当先后发生 GET /translator 与 POST /ttranslatev3
  const methods = mock.requests.map((x) => x.method + " " + x.path);
  assert.ok(methods.includes("GET /translator"), "应有 GET /translator");
  assert.ok(methods.includes("POST /ttranslatev3"), "应有 POST /ttranslatev3");
});

test("bing: HTTP 401 抛出带 status 的错误 (含 token 失效刷新重试)", async () => {
  mock.setHandler((req) => {
    if (req.method === "GET" && req.path === "/translator") {
      return { status: 200, body: BING_PAGE_HTML };
    }
    return httpErr(401, ""); // POST 始终 401 -> bing 会刷新页面配置后重试一次
  });
  await assert.rejects(
    bing.translate("你好", { targetLanguage: "en" }),
    (e) => e.status === 401
  );
});

test("bing: HTTP 403 抛出带 status 的错误", async () => {
  mock.setHandler((req) => {
    if (req.method === "GET" && req.path === "/translator") {
      return { status: 200, body: BING_PAGE_HTML };
    }
    return httpErr(403, "");
  });
  await assert.rejects(
    bing.translate("你好", { targetLanguage: "en" }),
    (e) => e.status === 403
  );
});

test("bing: 返回非法 JSON 抛出解析错误", async () => {
  mock.setHandler((req) => {
    if (req.method === "GET" && req.path === "/translator") {
      return { status: 200, body: BING_PAGE_HTML };
    }
    return badJson(); // POST 返回非法 JSON
  });
  await assert.rejects(
    bing.translate("你好", { targetLanguage: "en" }),
    /无法解析/
  );
});

test("bing: 超时抛出 provider_timeout", async () => {
  mock.setHandler(() => timeoutResp()); // 所有请求(含 GET 页面)均超时
  await assert.rejects(
    bing.translate("你好", { targetLanguage: "en", timeoutMs: 100 }),
    /provider_timeout/
  );
});
