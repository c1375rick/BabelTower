// 日志打码护栏:core/bridge_https.js 的 redactUrl + 游戏侧 diag-nav(2026-10-15)
// ------------------------------------------------------------------
// 起因:设置面板的「保存」改走 https 面板通道后,整份请求 JSON(含用户 API Key)
// 会经 URL 查询串 `?d=...` 进来。于是"这条 URL 会不会被原样打进日志"从排障问题
// 升格为**安全边界**问题 —— 本仓有硬规矩「任何日志都不允许包含 apiKey」,
// 而安装包自带"导出诊断"会把日志发出去。
//
// 这里钉的是"必须打码",不是"截断长度恰好够安全"。后者已被实测否掉:Key 落在
// 第 ~132 个字符、日志取 96,看着安全 —— 但那是**算术余量**,字段顺序或服务商名
// 一变短余量就没了。余量不是防线。
//
// 三个坑,每个都真踩过:
//   ① 用 indexOf("d=") 会命中 "id=" 里的那个 d= —— 自测直接报 LEAK,眼看是看不出来的;
//   ② 切片忘了带上 ?/& 分隔符,日志里印出 "op=configd=<redacted>" 这种畸形串;
//      日志畸形就是坏日志,它得能被当证据读;
//   ③ 只测"值被打掉了"不够,还要测"其余部分原样保留",否则会顺手把 op/id 也吃掉,
//      排障时看不出这条请求到底是什么。
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const HTTPS_SRC = fs.readFileSync(path.join(ROOT, "core", "bridge_https.js"), "utf8");
const BS_SRC = fs.readFileSync(path.join(ROOT, "core", "bridge_server.js"), "utf8");
const LC_SRC = fs.readFileSync(path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat.js"), "utf8");
const TRANSPORT_SRC = fs.readFileSync(path.join(ROOT, "core", "btipc", "transport.js"), "utf8");

// 从源码里把 redactUrl 抽出来直接跑 —— 不复制一份实现,
// 否则测试和实现会各写各的,互相掩护同一个错误。
function loadRedactUrl() {
  const m = HTTPS_SRC.match(/function redactUrl\([\s\S]*?\n\}/);
  assert.ok(m, "core/bridge_https.js 里必须存在 redactUrl(日志打码函数)");
  // 注意:这里只包一层括号,**不要**在后面加 ()。
  // 加了就变成"立即调用该函数",拿到的是打码后的字符串而不是函数本身,
  // 报出来是 `redactUrl is not a function` —— 看着像实现坏了,其实是 harness 坏了。
  return eval("(" + m[0] + ")");
}

const SECRET = "sk-proj-THISisTHEusersREALkey0123456789";
const redactUrl = loadRedactUrl();

function assertNoKey(name, url) {
  const out = redactUrl(url);
  assert.ok(
    out.indexOf(SECRET) === -1 && !/sk-[A-Za-z0-9]{8,}/.test(out),
    name + ":输出里不得出现 Key,实测 " + out
  );
  return out;
}

test("打码-① 带 Key 的保存 URL 必须打码", () => {
  assertNoKey("保存(带 Key,后面还有参数)",
    "/bridge?id=r1&op=config&d=%7B%22config%22%3A%7B%22provider%22%3A%22openai%22%2C" +
    "%22apiKey%22%3A%22" + SECRET + "%22%7D%7D&x=1");
  assertNoKey("保存(带 Key,d= 在末尾)",
    "/bridge?id=r2&op=config&d=%7B%22apiKey%22%3A%22" + SECRET + "%22%7D");
  assertNoKey("d= 是第一个参数",
    "/bridge?d=%7B%22apiKey%22%3A%22" + SECRET + "%22%7D&id=r3");
  assertNoKey("Key 在 URL 最末尾(无 & 分隔)",
    "/bridge?id=r4&op=log&d=" + SECRET);
});

test("打码-② 不得命中 id= 里的那个 d=(第一次就踩了)", () => {
  const out = redactUrl("/bridge?id=r5&op=translate&text=%E6%B5%8B%E8%AF%95");
  assert.ok(out.indexOf("id=r5") !== -1, "id= 必须保留,实测 " + out);
  assert.ok(out.indexOf("op=translate") !== -1, "op= 必须保留,实测 " + out);
  assert.ok(out.indexOf("redacted") === -1, "无 d= 时不该打码,实测 " + out);
});

test("打码-③ 打码后仍是合法可读的 URL 形状", () => {
  const out = redactUrl("/bridge?id=r1&op=config&d=%7B%22apiKey%22%3A%22" + SECRET + "%22%7D&x=1");
  assert.ok(/[?&]d=<redacted \d+B>/.test(out), "必须保留 ?/& 分隔符,实测 " + out);
  assert.ok(!/[^?&]d=<redacted/.test(out), "不得印出 op=configd= 这种畸形串,实测 " + out);
  assert.ok(out.indexOf("id=r1") !== -1, "id= 必须原样保留,实测 " + out);
  assert.ok(out.indexOf("&x=1") !== -1, "d= 之后的参数必须原样保留,实测 " + out);
});

test("打码-④ 空值与畸形输入不得抛", () => {
  assert.ok(/d=<redacted 0B>/.test(redactUrl("/bridge?id=r6&op=config&d=")), "空 d= 应打成 0B");
  assert.strictEqual(redactUrl(""), "");
  assert.strictEqual(redactUrl(null), "");
  assert.strictEqual(redactUrl(undefined), "");
});

test("打码-⑤ 日志调用点必须真的用了打码函数(不许各写各的)", () => {
  assert.ok(/log\("info", "REQ " \+ req\.method \+ " " \+ redactUrl\(req\.url\)/.test(HTTPS_SRC),
    "https 请求日志必须走 redactUrl,不许直接打 req.url");
});

test("打码-⑥ 游戏侧 diag-nav 同样不许原样打 d=", () => {
  // 2026-10-15 实车踩过:这里用 indexOf("d="),命中了 "id=" 里的那个 d=
  // → 日志里出现 "id=<redacted 2B>&op=config&d=%...",id 被打码、真正的 d= 反而没打上。
  // 改为按参数边界匹配(?d= 或 &d=),与 core/bridge_https.js 的 redactUrl 同一纪律。
  assert.ok(/navM = navQ\.match\(\/\[\?&\]d=\/\)/.test(LC_SRC), "diag-nav 必须按参数边界找 d=(不能 indexOf,那会命中 id=)");
  assert.ok(/navM\.index \+ navM\[0\]\.length/.test(LC_SRC), "diag-nav 必须用匹配结果的 index(否则取到的是 id= 的位置)");
  assert.ok(/d=<redacted /.test(LC_SRC), "diag-nav 缺打码标记");
  assert.ok(!/log\("diag-nav[^\n]*url\.split\("\?"\)\[1\][^\n]*slice\(0, 30\)/.test(LC_SRC),
    "diag-nav 仍在只靠 30 字符截断保安全 —— 那是余量,不是防线");
});

// ---------------------------------------------------------------------------
// 另一处:Bridge 把游戏 console.log 的行抄进 logs/bridge.log 时的 b64 打码。
//
// 关键约束(搞错就断产品):BTIPC 上行载荷就是靠 console.log 里那一行的 b64 传输的
// (core/btipc/transport.js 的 REQ_RE 从这里解析)。所以**源头一行都不能改**,
// 只能改"抄进我们日志"这一步 —— 否则整个 BTIPC 当场断。
// 而 logs\bridge.log 正是随安装包"导出诊断"发出去的那个文件,base64 又不是加密。
test("打码-⑦ BTIPC 载荷抄进 bridge.log 时按值打码(协议那一侧不动)", () => {
  const m = BS_SRC.match(/function redactBtipcPayload\(line\) \{[\s\S]*?\n {2}\}/);
  assert.ok(m, "core/bridge_server.js 里必须存在 redactBtipcPayload");
  const redactBtipcPayload = eval("(" + m[0] + ")");

  const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
  // **必须用真实行形状**:游戏写出来的一行前面有时间戳 + [PanoramaScript] + [LCT] + BTIPC。
  // 2026-10-15 踩过:测试用例写的是裸 "TRQ w=…" ,实现用 ^ 锚行首 → 真实行一个都匹配不上,
  // 而测试全绿。**测试数据长得不像真实数据,测试就等于没测。**
  const PREFIX = "10/15 23:50:00 [PanoramaScript] [LCT] ";
  const line = (cmd, payload) =>
    PREFIX + "BTIPC " + cmd + " w=0a1b2c id=1a2b len=" + payload.length + " crc=1111 b64=" + b64(payload);

  // 断言方式:**解码后比对**,绝不 grep 明文 —— Key 在 base64 里,明文搜索永远搜不到,
  // "没搜到"会被误当成"已打码"(当天就是这么被骗过去的)。
  const decodedHasKey = (out) => {
    const b = out.match(/b64=(\S+)/);
    if (!b) return false;
    try { return /sk-REALSECRETKEY123/.test(Buffer.from(b[1], "base64").toString("utf8")); }
    catch (e) { return false; }
  };

  // 真 Key 必须打码
  const withKey = redactBtipcPayload(line("TRQ", 'op=config\n{"config":{"apiKey":"sk-REALSECRETKEY123"}}'));
  assert.ok(!decodedHasKey(withKey), "带真 Key 的载荷必须打码(解码后比对),实测 " + withKey);
  assert.ok(/b64=<redacted \d+B/.test(withKey), "实测 " + withKey);
  assert.ok(withKey.indexOf("w=0a1b2c") !== -1 && withKey.indexOf("len=") !== -1,
    "排障字段(w/len/crc)必须保留 —— 实测 " + withKey);

  // 占位符不是机密,留着有排障价值(能看出"Key 没变")
  const ph = redactBtipcPayload(line("TRQ", 'op=config\n{"config":{"apiKey":"********"}}'));
  assert.ok(ph.indexOf("b64=") !== -1 && !/redacted/.test(ph),
    "占位符 ******** 不该被打码(它是打码回传标记,不是机密),实测 " + ph);

  // 心跳 / 读配置 / 翻译:不打码(它们没有 Key,打码只会白丢排障信息)
  for (const [cmd, payload] of [
    ["REQ", "hello"],
    ["TRQ", 'op=config\n{"get":"quickchat","fp":"fnv1a-abc"}'],
    ["TRQ", "t=en;tm=16000\n测试文本"],
  ]) {
    const out = redactBtipcPayload(line(cmd, payload));
    assert.ok(out.indexOf("b64=") !== -1 && !/redacted/.test(out),
      cmd + " 无 Key 载荷不该被打码,实测 " + out);
  }

  // 分段必须与 transport.js 一致:没有 "[LCT] " 的行,协议那边本来就跳过(no_lct),
  // 我们也不该去动它 —— 只碰能证明是游戏 BTIPC 行的文本。
  const bare = "TRQ w=0a1b2c id=1a2b len=72 crc=1111 b64=" +
    b64('op=config\n{"config":{"apiKey":"sk-REALSECRETKEY123"}}');
  assert.strictEqual(redactBtipcPayload(bare), bare,
    "无 [LCT] 前缀的行应原样放过(与 transport.js 的 no_lct 跳过保持一致)");
  assert.ok(/skip.*no_lct|no_lct/.test(TRANSPORT_SRC),
    "前提:协议解析确实对无 [LCT] 的行跳过 —— 两边分段必须同源");

  // 非 BTIPC 行原样返回
  assert.strictEqual(redactBtipcPayload("[LCT] translated …"), "[LCT] translated …");
  assert.strictEqual(redactBtipcPayload(""), "");
  assert.strictEqual(redactBtipcPayload("10/15 23:50:00 [LCT] diag-title #1 valid=1"), "10/15 23:50:00 [LCT] diag-title #1 valid=1");
  assert.strictEqual(
    redactBtipcPayload("10/15 23:50:00 [LCT] BTIPC REQ w=0a1b2c id=1a2b len=6 crc=8e9e b64=" + b64("hello")),
    "10/15 23:50:00 [LCT] BTIPC REQ w=0a1b2c id=1a2b len=6 crc=8e9e b64=" + b64("hello"),
    "心跳行必须原样(否则最频繁的日志全被搅乱)");
});

test("打码-⑧ 打码只发生在抄日志这一侧,不得碰喂给协议的那一行", () => {
  // onBtipcGameLine 必须仍拿原始行;只有 emit() 走打码
  assert.ok(/log\("game", redactBtipcPayload\(line\)/.test(BS_SRC),
    "emit() 必须打码后再写日志");
  assert.ok(/onBtipcGameLine\(line\)/.test(BS_SRC),
    "onBtipcGameLine 必须仍收到原封不动的 line —— 它是 BTIPC 的运输来源,改了通道就断");
  assert.ok(!/onBtipcGameLine\(redactBtipcPayload/.test(BS_SRC),
    "绝不能把打码后的行喂给协议解析器");
});