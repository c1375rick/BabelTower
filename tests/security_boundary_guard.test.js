// 回归护栏:本地服务安全边界(2026-10-09 源码审计产出)。
// 两个不变量:
//   1) 桥只监听回环 —— HOST_V4/HOST_V6 必须是字面量 127.0.0.1 / ::1,
//      且 core/ 全域不得出现 0.0.0.0(一旦绑 0.0.0.0,写接口的零鉴权 + ACAO:* 就从本机风险变成内网风险)。
//   2) mask()/maskCompact() 深扫不得外泄明文 apiKey —— 它们是游戏面板和 HTML 通道的配置回读出口。
// 说明:sendJson 的 `Access-Control-Allow-Origin: *` 目前仍是无条件的(bridge_server.js sendJson),
//      收敛它需要先实测游戏 Panorama 实际发出的 Origin,故本文件不断言该行为,只锁已成立的部分。
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const configStore = require("../core/config.js");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}
function listJs(dir, out) {
  out = out || [];
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = dir + "/" + ent.name;
    if (ent.isDirectory()) listJs(rel, out);
    else if (ent.isFile() && ent.name.endsWith(".js")) out.push(rel);
  }
  return out;
}

// ---------- 1) 只监听回环 ----------

test("监听地址必须是回环字面量 127.0.0.1 / ::1", () => {
  const src = read("core/bridge_server.js");
  const v4 = /const\s+HOST_V4\s*=\s*"([^"]+)"/.exec(src);
  const v6 = /const\s+HOST_V6\s*=\s*"([^"]+)"/.exec(src);
  assert.ok(v4 && v6, "HOST_V4/HOST_V6 常量必须存在(绑定地址不得内联在 listen 调用里)");
  assert.strictEqual(v4[1], "127.0.0.1", "HOST_V4 必须是 127.0.0.1");
  assert.strictEqual(v6[1], "::1", "HOST_V6 必须是 ::1");
});

test("core/ 全域不含 0.0.0.0", () => {
  const files = listJs("core");
  assert.ok(files.length > 0, "core/*.js 应存在");
  const bad = [];
  for (const rel of files) {
    const src = read(rel);
    if (src.indexOf("0.0.0.0") !== -1) bad.push(rel);
  }
  assert.deepStrictEqual(bad, [], "以下文件出现 0.0.0.0:" + bad.join(", "));
});

test("listen 调用只经 makeServer(HOST_V4/HOST_V6) 走,不内联地址", () => {
  const src = read("core/bridge_server.js");
  const listens = src.match(/\.listen\([^)]*\)/g) || [];
  assert.strictEqual(listens.length, 1, "应只有一处 .listen(),实得 " + listens.length);
  assert.ok(/\.listen\(\s*PORT\s*,\s*host\b/.test(listens[0]),
    "listen 必须是 (PORT, host) 形式,host 由 makeServer 传入;实得: " + listens[0]);
  assert.ok(/makeServer\(\s*HOST_V4\s*\)/.test(src) && /makeServer\(\s*HOST_V6\s*\)/.test(src),
    "两个回环地址都必须被实际启用");
});

// ---------- 2) mask / maskCompact 不外泄明文 key ----------

const SENTINELS = [
  ["openai", "sk-SENTINEL_OPENAI_aaaa1111bbbb2222"],
  ["deepl", "SENTINEL_DEEPL_3f6c9a0e7b14"],
  ["google", "AIzaSENTINEL_GOOGLE_5d82f1c4"],
  ["microsoft", "SENTINEL_MICROSOFT_9e07b3d6"],
];

function syntheticConfig() {
  const cfg = {
    provider: "openai",
    port: 8791,
    timeoutMs: 15000,
    defaults: { sourceLanguage: "auto", targetLanguage: "zh-Hans" },
    chatLog: { enabled: true, dir: "logs/chat" },
  };
  for (const [p, k] of SENTINELS) {
    cfg[p] = Object.assign({ apiKey: k }, cfg[p]);
  }
  cfg.openai = Object.assign(cfg.openai, { baseUrl: "https://x/v1", model: "gpt-x" });
  cfg.deepl = Object.assign(cfg.deepl, { endpoint: "https://d/v2" });
  cfg.microsoft = Object.assign(cfg.microsoft, { region: "global" });
  return cfg;
}

test("mask() 深扫不含任何明文 apiKey", () => {
  const cfg = syntheticConfig();
  const s = JSON.stringify(configStore.mask(cfg));
  for (const [p, k] of SENTINELS) {
    assert.strictEqual(s.indexOf(k), -1, "mask() 泄漏了 " + p + " 的明文 key");
  }
  // 打码出口必须仍在:有 key 时给掩码,无 key 时给空串 + hasApiKey 布尔
  const m = configStore.mask(cfg);
  assert.strictEqual(m.openai.apiKey, "********", "有 key 时应打码为 8 个星号");
  assert.strictEqual(m.openai.hasApiKey, true, "hasApiKey 应为 true");
  assert.strictEqual(m.deepl.hasApiKey, true);
  assert.strictEqual(m.google.hasApiKey, true);
  assert.strictEqual(m.microsoft.hasApiKey, true);
});

test("maskCompact() 深扫不含任何明文 apiKey", () => {
  const cfg = syntheticConfig();
  const s = JSON.stringify(configStore.maskCompact(cfg));
  for (const [p, k] of SENTINELS) {
    assert.strictEqual(s.indexOf(k), -1, "maskCompact() 泄漏了 " + p + " 的明文 key");
  }
  const mc = configStore.maskCompact(cfg);
  assert.strictEqual(mc.openai.hasApiKey, true);
  assert.strictEqual(mc.deepl.hasApiKey, true);
  assert.strictEqual(mc.google.hasApiKey, true);
  assert.strictEqual(mc.microsoft.hasApiKey, true);
  assert.strictEqual("apiKey" in mc.openai, false, "maskCompact 不应带 apiKey 字段(连打码值都不带)");
});

test("无 key 时 mask 不得出现掩码字样(避免把空配置说成已配置)", () => {
  const blank = { provider: "bing", port: 8791, timeoutMs: 15000, defaults: {}, chatLog: {} };
  const s = JSON.stringify(configStore.mask(blank));
  assert.strictEqual(s.indexOf("********"), -1, "空 key 不应输出打码掩码");
  const m = configStore.mask(blank);
  assert.strictEqual(m.openai.hasApiKey, false);
  assert.strictEqual(m.openai.apiKey, "");
});

// ---------- 3) B1(2026-10-10 游戏内取证后落地):跨站写面收敛 ----------

test("GET ?d= 写通道已整体删除(config 保存→410;translate/test/log 不再解析 ?d=)", () => {
  const src = read("core/bridge_server.js");
  assert.ok(src.indexOf("config_write_removed_use_post_or_op_config") >= 0,
    "config GET 保存必须显式 410 删除标记");
  const bfr = /function bodyFromRequest[\s\S]*?\n}/.exec(src);
  assert.ok(bfr, "bodyFromRequest 应存在");
  assert.ok(bfr[0].indexOf('searchParams.get("d")') === -1,
    "bodyFromRequest 不得再解析 ?d= 请求体");
  assert.strictEqual((src.match(/applyMaskedUpdate/g) || []).length, 2,
    "applyMaskedUpdate 只应剩 2 处调用:BTIPC op=config + POST /api/v1/config");
});

test("跨站守卫挂在 requestHandler 内且早于 handleApi,三道闸齐备", () => {
  const src = read("core/bridge_server.js");
  assert.ok(/function crossSiteBlockReason\(req\)/.test(src), "crossSiteBlockReason 必须存在");
  assert.ok(/LOOPBACK_HOST_RE/.test(src), "Host 回环校验必须存在(DNS rebinding 闸)");
  assert.ok(src.indexOf("sec-fetch-site") >= 0 && src.indexOf("req.headers.origin") >= 0,
    "Sec-Fetch-Site / Origin 闸必须存在");
  assert.ok(src.indexOf("sfs == null && org == null") >= 0,
    "零元数据(游戏/本地工具)必须放行 —— 与 REQHDR 实测一致");
  const rh = src.indexOf("const requestHandler");
  assert.ok(rh > 0, "requestHandler 必须存在");
  const guardAt = src.indexOf("crossSiteBlockReason(req)", rh);
  const apiAt = src.indexOf("handleApi(req, res, url, bodyObj)", rh);
  assert.ok(guardAt > rh, "requestHandler 内必须调用守卫");
  assert.ok(apiAt > guardAt, "守卫必须早于 handleApi 调用");
});

test("ACAO 已收敛:全域不得出现 Access-Control-Allow-Origin: *", () => {
  const src = read("core/bridge_server.js");
  assert.strictEqual(src.indexOf('Access-Control-Allow-Origin", "*"'), -1,
    "ACAO:* 会让恶意网页读走任何响应,必须收敛为本地同源回显");
  assert.ok(/function applyCors\(req, res\)/.test(src), "applyCors 必须存在");
  assert.ok(src.indexOf("applyCors(req, res)") > 0, "requestHandler 必须调用 applyCors");
});
