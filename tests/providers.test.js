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

// ===========================================================================
// 边界 Case 补充 (不修改上方已有测试)
// ---------------------------------------------------------------------------
// 覆盖: 空文本 / 超长文本 / 特殊字符 / 并发调用 /
//       OpenAI 温度参数重试 / Bing token 刷新重试 /
//       Microsoft region 头 / DeepL 自定义 endpoint
// ===========================================================================

// 一个通用的 handler: 根据 hostname 返回各 provider 的成功结构。
// 用于「不崩溃」类的边界测试 (空文本 / 超长文本 / 特殊字符)。
function genericSuccessHandler() {
  return (req) => {
    const h = req.hostname || "";
    const p = req.path || "";
    // Bing 需要先 GET 页面取 token,再 POST 翻译
    if (h.includes("bing.com") && req.method === "GET" && p === "/translator") {
      return { status: 200, body: BING_PAGE_HTML };
    }
    if (h.includes("bing.com")) {
      return ok([{ translations: [{ text: "OK" }], detectedLanguage: { language: "en" } }]);
    }
    if (h.includes("microsofttranslator")) {
      return ok([{ translations: [{ text: "OK" }], detectedLanguage: { language: "en" } }]);
    }
    if (h.includes("deepl.com")) {
      return ok({ translations: [{ text: "OK", detected_source_language: "EN" }] });
    }
    if (h.includes("googleapis.com")) {
      return ok({ data: { translations: [{ translatedText: "OK", detectedSourceLanguage: "zh-CN" }] } });
    }
    // 默认当作 OpenAI 兼容
    return ok({ choices: [{ message: { content: "OK" } }] });
  };
}

const ALL_PROVIDER_CASES = [
  ["openai", openai, { apiKey: "k", baseUrl: "https://api.openai.com/v1", targetLanguage: "en", timeoutMs: 2000 }],
  ["deepl", deepl, { apiKey: "k", endpoint: "https://api-free.deepl.com/v2/translate", targetLanguage: "en", timeoutMs: 2000 }],
  ["microsoft", microsoft, { apiKey: "k", endpoint: "https://api.cognitive.microsofttranslator.com", targetLanguage: "en", timeoutMs: 2000 }],
  ["google", google, { apiKey: "k", targetLanguage: "en", timeoutMs: 2000 }],
  ["bing", bing, { targetLanguage: "en", timeoutMs: 2000 }],
];

// 1. 空文本处理: 各 provider 行为可能不同,但都应「不崩溃」并返回结果或抛出 Error
test("边界: 空文本 translate('') 不崩溃,返回有效结果", async () => {
  mock.setHandler(genericSuccessHandler());
  for (const [name, p, opts] of ALL_PROVIDER_CASES) {
    const r = await p.translate("", opts);
    assert.ok(r && typeof r.translation === "string", name + ": 空文本应返回 string translation");
  }
});

// 2. 超长文本: 5000 字符不应崩溃,且完整发送
test("边界: 超长文本(5000 字符) 不崩溃且请求体完整发送", async () => {
  const longText = "a".repeat(5000);
  mock.setHandler(genericSuccessHandler());
  for (const [name, p, opts] of ALL_PROVIDER_CASES) {
    mock.requests.length = 0;
    const r = await p.translate(longText, opts);
    assert.ok(typeof r.translation === "string", name + ": 超长文本应返回 string translation");
    const sent = mock.requests.some((x) => x.body.includes(longText));
    assert.ok(sent, name + ": 请求体应包含完整 5000 字符");
  }
});

// 3. 特殊字符: emoji / HTML 标签 / Unicode 不应破坏请求与结果
test("边界: 特殊字符(emoji/HTML/Unicode) 经 JSON 往返完整保留", async () => {
  const special = "Hello \u{1F600} <b>test</b> \u4f60\u597d";
  // OpenAI: 回显原文,验证特殊字符经 JSON 完整保留
  mock.setHandler(() => ok({ choices: [{ message: { content: special } }] }));
  const r = await openai.translate(special, {
    apiKey: "k", baseUrl: "https://api.openai.com/v1", targetLanguage: "en", timeoutMs: 2000,
  });
  assert.strictEqual(r.translation, special, "openai 应原样回显特殊字符");
  const sentBody = mock.requests[0].body;
  assert.ok(
    sentBody.includes("\u{1F600}") && sentBody.includes("<b>test</b>") && sentBody.includes("\u4f60\u597d"),
    "openai 请求体应包含 emoji / HTML / Unicode"
  );

  // 其余 provider 仅验证不崩溃且返回翻译
  mock.reset();
  mock.setHandler(genericSuccessHandler());
  const others = ALL_PROVIDER_CASES.filter(([n]) => n !== "openai");
  for (const [name, p, opts] of others) {
    const rr = await p.translate(special, opts);
    assert.ok(typeof rr.translation === "string", name + ": 特殊字符应返回 string translation");
  }
});

// 4. 并发调用: 同时发起 3 个请求,互不干扰(各自拿到对应结果)
test("边界: 并发 3 个 openai 请求互不干扰,各自拿到对应结果", async () => {
  let n = 0;
  mock.setHandler(() => {
    const idx = n++;
    return ok({ choices: [{ message: { content: "R" + idx } }] });
  });
  const opts = { apiKey: "k", baseUrl: "https://api.openai.com/v1", targetLanguage: "en", timeoutMs: 2000 };
  const results = await Promise.all([
    openai.translate("a", opts),
    openai.translate("b", opts),
    openai.translate("c", opts),
  ]);
  assert.deepStrictEqual(
    results.map((r) => r.translation),
    ["R0", "R1", "R2"],
    "并发请求应各自获得独立、正确的结果"
  );
});

// 5. OpenAI 温度参数重试: 第一次 400 含 temperature 错误,第二次成功(去掉 temperature)
test("openai: 温度参数 400 自动去掉 temperature 重试并成功", async () => {
  let calls = 0;
  mock.setHandler(() => {
    calls++;
    if (calls === 1) {
      return httpErr(400, JSON.stringify({ error: { message: "temperature is not supported by this model" } }));
    }
    return ok({ choices: [{ message: { content: "Hello" } }] });
  });
  const r = await openai.translate("你好", {
    apiKey: "k", baseUrl: "https://api.openai.com/v1", targetLanguage: "en", timeoutMs: 2000,
  });
  assert.strictEqual(r.translation, "Hello");
  assert.strictEqual(calls, 2, "应触发一次重试");
  // 验证第一次请求带 temperature,第二次请求不带 temperature
  const firstBody = JSON.parse(mock.requests[0].body);
  const secondBody = JSON.parse(mock.requests[1].body);
  assert.strictEqual(typeof firstBody.temperature, "number", "首次请求应带 temperature");
  assert.strictEqual(secondBody.temperature, undefined, "重试请求不应带 temperature");
});

// 6. Bing token 刷新: 第一次翻译 POST 400/401,刷新 pageConfig 后重试成功
test("bing: 翻译 400 后刷新 pageConfig 重试并成功", async () => {
  // bing 的 pageConfig 为模块级缓存,为了 deterministic 地验证「刷新重试」,
  // 重新加载一个全新的 bing 模块实例(pageConfig 初始为 null)。
  const bingPath = require.resolve("../core/providers/bing");
  const originalBingModule = require.cache[bingPath];
  delete require.cache[bingPath];
  const bingFresh = require(bingPath);

  let postCount = 0;
  let pageFetches = 0;
  mock.setHandler((req) => {
    if (req.method === "GET" && req.path === "/translator") {
      pageFetches++;
      return { status: 200, body: BING_PAGE_HTML };
    }
    if (req.method === "POST" && req.path === "/ttranslatev3") {
      postCount++;
      if (postCount === 1) {
        return httpErr(400, "token invalid"); // 触发刷新重试
      }
      return ok([{ translations: [{ text: "Hello" }], detectedLanguage: { language: "en" } }]);
    }
    return { status: 200, body: "" };
  });
  const r = await bingFresh.translate("你好", { targetLanguage: "en", timeoutMs: 2000 });
  assert.strictEqual(r.translation, "Hello");
  assert.strictEqual(postCount, 2, "应重试一次 POST 翻译");
  assert.strictEqual(pageFetches, 2, "刷新后应再次 GET 页面取 token(首次取 + 刷新取)");

  // 还原模块缓存,避免影响其它测试
  require.cache[bingPath] = originalBingModule;
});

// 7. Microsoft region 头: opts.region 有值时请求头包含 Ocp-Apim-Subscription-Region
test("microsoft: opts.region 存在时请求头包含 Ocp-Apim-Subscription-Region", async () => {
  mock.setHandler(() => ok([{ translations: [{ text: "Hello" }], detectedLanguage: { language: "en" } }]));
  await microsoft.translate("你好", {
    apiKey: "k", endpoint: "https://api.cognitive.microsofttranslator.com", region: "eastus", targetLanguage: "en", timeoutMs: 2000,
  });
  const req = mock.requests.find((x) => x.method === "POST" && x.path === "/translate");
  assert.ok(req, "应有 POST /translate 请求");
  assert.strictEqual(req.headers["Ocp-Apim-Subscription-Region"], "eastus", "应带上 region 头");

  // 无 region 时不带该头
  mock.requests.length = 0;
  await microsoft.translate("你好", {
    apiKey: "k", endpoint: "https://api.cognitive.microsofttranslator.com", targetLanguage: "en", timeoutMs: 2000,
  });
  const req2 = mock.requests.find((x) => x.method === "POST" && x.path === "/translate");
  assert.strictEqual(req2.headers["Ocp-Apim-Subscription-Region"], undefined, "无 region 时不应带该头");
});

// 8. DeepL 自定义 endpoint: 请求发往用户提供的地址
test("deepl: 自定义 endpoint 请求发往正确地址", async () => {
  const custom = "https://my-deepl.example.com/v2/translate";
  mock.setHandler(() => ok({ translations: [{ text: "Hello", detected_source_language: "EN" }] }));
  await deepl.translate("你好", { apiKey: "k", endpoint: custom, targetLanguage: "en", timeoutMs: 2000 });
  const req = mock.requests.find((x) => x.method === "POST");
  assert.ok(req, "应有 POST 请求");
  assert.strictEqual(req.url, custom, "请求 URL 应为自定义 endpoint");
  assert.strictEqual(req.hostname, "my-deepl.example.com");
  assert.strictEqual(req.path, "/v2/translate");
});
