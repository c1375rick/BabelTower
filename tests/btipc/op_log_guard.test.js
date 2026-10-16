"use strict";
// tests/btipc/op_log_guard.test.js —— P2 契约钉(2026-10-11):op=log 聊天日志迁 BTIPC。
// 不变量:
//   1) 冻结信封白名单仍只有 config|test(transport.js 不为 log 开口)—— 行为钉:op=log 首行
//      经 parseTrqEnvelope 必须原样透传(op=undefined),证明桥侧识别是唯一入口;
//   2) 桥侧:matchChatLogTrq 首行形状识别(恰为 "op=log"+换行)、env 合成、runBtipcOp 的
//      log 分支与 POST /api/v1/log 逐字段同语义(bad_json/skipped/written/chat_log_write_failed);
//   3) 客户端:log 并入 BTIPC op 通道(isOp 含 log、payload="op=log\n"+raw、8s 写死线)、
//      flushChatLog 按 600B 切批(顶 680B 行预算会落死旧通道)、成功续排、失败重放一次。
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }

const bridgeSrc = read("core/bridge_server.js");
const lcSrc = read("mod/panorama/scripts/lingua_chat.js");

// ---------- 1) 冻结件不为 log 开口(行为钉) ----------
test("冻结信封白名单仍只有 config|test:op=log 原样透传", () => {
  const { parseTrqEnvelope } = require(path.join(ROOT, "core", "btipc", "transport.js"));
  const raw = 'op=log\n{"matchId":"x","lines":[]}';
  const env = parseTrqEnvelope(raw);
  assert.strictEqual(env.op, undefined, "冻结白名单不得出现 log(transport.js 只审不改)");
  assert.strictEqual(env.text, raw, "op=log 首行按裸文本一字不差透传");
});

// ---------- 2) 桥侧识别与同语义分支 ----------
test("桥侧:env 合成 + runBtipcOp log 分支逐字段镜像旧端点", () => {
  assert.ok(/function matchChatLogTrq\(raw\)/.test(bridgeSrc), "matchChatLogTrq 必须存在");
  assert.ok(/if \(!env\.op && matchChatLogTrq\(raw\)\) env = \{ text: raw\.slice\(7\)/.test(bridgeSrc),
    "env 合成:text = 信封体(op=log\\n 共 7 字符)");
  assert.ok(/if \(op === "log"\)/.test(bridgeSrc), "runBtipcOp 必须有 log 分支");
  assert.ok(/error: "bad_json"/.test(bridgeSrc) && /skipped: "chat_log_disabled"/.test(bridgeSrc),
    "bad_json / skipped 应答必须与旧端点同形");
  assert.ok(/const n = appendChatLog\(cfgL, bodyObj\);/.test(bridgeSrc) && /written: n/.test(bridgeSrc),
    "必须复用 appendChatLog(同一写盘路径);注意形参 body 不得被 let body 遮蔽(05c 教训)");
  assert.ok(/bodyObj = JSON\.parse\(body \|\| ""\)/.test(bridgeSrc),
    "log 分支必须解析形参 body(env.text 传入),不得引用不存在的变量");
  assert.ok(/error: "chat_log_write_failed"/.test(bridgeSrc), "写失败应答与旧端点同形");
});

test("桥侧:matchChatLogTrq 只认恰好的首行(不误吞)", () => {
  // 从源码抽取函数体直接跑(bridge_server.js 不能 require —— 顶层会 listen)
  const fnIdx = bridgeSrc.indexOf("function matchChatLogTrq(raw)");
  assert.ok(fnIdx > 0, "matchChatLogTrq 定位失败");
  let d = 0, end = -1;
  const start = bridgeSrc.indexOf("{", fnIdx);
  for (let i = start; i < bridgeSrc.length; i += 1) {
    const ch = bridgeSrc[i];
    if (ch === "{") d += 1;
    else if (ch === "}") { d -= 1; if (d === 0) { end = i + 1; break; } }
  }
  assert.ok(end > start, "函数体花括号配对失败");
  const m = new Function(bridgeSrc.slice(fnIdx, end) + "; return matchChatLogTrq;")();
  assert.strictEqual(m('op=log\n{"a":1}'), true);
  assert.strictEqual(m("op=log"), false, "无换行不算(聊天文本单行,永不误吞)");
  assert.strictEqual(m("op=logx\n{}"), false, "首行必须恰为 op=log");
  assert.strictEqual(m("op=login\n{}"), false);
  assert.strictEqual(m("xop=log\n{}"), false);
  assert.strictEqual(m("t=en\nhello"), false, "信封 t= 不受干扰");
  assert.strictEqual(m(123), false, "非字符串防御");
});

// ---------- 3) 客户端并入 BTIPC op 通道 ----------
test("客户端:isOp 含 log + payload=op=log\\n + 8s 写死线(链尾 config 不被破坏)", () => {
  assert.ok(/job\.op === "config" \|\| job\.op === "test" \|\| job\.op === "log"/.test(lcSrc),
    "isOp 必须含 log(走 BTIPC 而非死旧通道)");
  const ifTestIdx = lcSrc.indexOf('if (job.op === "test")');
  const logPayloadIdx = lcSrc.indexOf('payload = "op=log\\n" + raw');
  const cfgIdx = lcSrc.indexOf('payload = "op=config\\n" + raw');
  assert.ok(ifTestIdx > 0 && logPayloadIdx > ifTestIdx, "op=log payload 在 test 分支之后");
  assert.ok(cfgIdx > logPayloadIdx, "config payload 在 log 之后(else 链尾,lc_btipc_guard 配对前提)");
  const logSlice = lcSrc.slice(logPayloadIdx, cfgIdx);
  // 2026-10-15:log 死线从固定 8000 改为按载荷算。理由与 config 写完全同一条:
  // 死线当初只量了**应答**({ok,written} 1 帧),没量**上行请求**。log 批 600B → 60 帧
  // → 物理 ≈37.2s,8s 死线必超时 → 聊天日志静默丢失(没人报障,因为不报错)。
  // 现在与 config 写共用 btipcWriteDeadlineMs,按帧数算 + ×1.2 余量,地板 8000。
  assert.ok(/timeoutMs = btipcWriteDeadlineMs\(btipcUtf8Bytes\(payload\)\.length\)/.test(logSlice),
    "log 死线必须按载荷算(原来 8000 是按应答定的,600B 批 60 帧 ≈37s 必超时)");
});

test("客户端:所有 config|test op 谓词都同步含 log(防 op 集合漂移)", () => {
  // 客户端把 op 走 BTIPC 的判断散在多处:isOp(载荷构造)、dispatchJob 的
  // viaBtipc 路由谓词、outgoingViaBtipc 的 dispatch-threw 兜底。2026-10-11 实车
  // 抓获:2445 isOp 认 log(测试也钉了它),但 2655 viaBtipc 路由谓词漏补 log ——
  // log op 不满足 viaBtipc → 落 dispatchViaPanel 死通道 → 真实聊天日志 11 天
  // 从未落盘。任何一处漏补都会让 log 掉死旧通道,故钉:凡出现
  // `job.op === "config" || job.op === "test"` 的谓词,其后必须紧跟 `|| job.op === "log"`。
  const re = /job\.op === "config" \|\| job\.op === "test"/g;
  let m; let n = 0;
  while ((m = re.exec(lcSrc)) !== null) {
    n += 1;
    const tail = lcSrc.slice(m.index, m.index + m[0].length + 40);
    assert.ok(/\|\| job\.op === "log"/.test(tail),
      "第 " + n + " 处 config|test 谓词未同步含 log(会让 log 掉死旧通道),上下文:" + tail.slice(0, 60));
  }
  assert.ok(n >= 3, "至少 3 处 config|test op 谓词(isOp/dispatch-threw/viaBtipc 路由),实测 " + n);
});

test("客户端:flushChatLog 按 600B 切批 + 成功续排 + 失败重放 + 超批截断", () => {
  const batch = /const LOG_BATCH_MAX_BYTES = (\d+);/.exec(lcSrc);
  assert.ok(batch && Number(batch[1]) <= 600, "批预算 ≤600B(680B 行预算留余量)");
  const maxReq = /const BTIPC_REQ_MAX_PAYLOAD = (\d+);/.exec(lcSrc);
  assert.ok(maxReq && Number(maxReq[1]) === 680, "客户端行预算 680B 与 spec §9 一致");
  assert.ok(Number(batch[1]) + 80 <= Number(maxReq[1]), "批预算必须留出信封/JSON 结构余量");
  assert.ok(!/State\.logBuffer\.splice\(0, 50\)/.test(lcSrc), "旧 50 条直拼必须移除(可能超行预算)");
  assert.ok(/res && res\.ok && State\.logBuffer\.length/.test(lcSrc), "成功且有剩余 → 1s 续排");
  assert.ok(/__retried/.test(lcSrc) && /\$\.Schedule\(5\.0, flushChatLog\)/.test(lcSrc), "失败重放一次语义保留");
  assert.ok(/slice\(0, 300\)/.test(lcSrc), "超批单条截断 text 300 字符后重试入批");
});
