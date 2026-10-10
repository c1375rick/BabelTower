// 离线护栏:chat 任务在 BTIPC 传输型失败 / dispatch 抛出路径上必须结算 group
// 背景(审查 2026-10-10):
//   chat 任务没有 job.done(enqueue 不设)。旧通道失败走 handleBridgePayload→failJob→
//   deliverError(settled/inflight/seen 三态收敛);BTIPC 化后 transport 型失败(timeout/
//   crc_dead/bridge_down/deadman/settle_threw)改走 doneFail——原实现对 chat 只有一句
//   `job.done(null,null)`,undefined 调用被 try/catch 静默吞掉,结果:
//     ① State.inflight 留下 settled=false 的僵尸组 → 同文本新行永远合并进去不再翻译;
//     ② seen 不释放 → 同 sig 行重扫时 restoreFromCache 落空后静默 return;
//     ③ 队列槽位正常释放(finishJob 在 doneFail 之外),所以队列不死、只有翻译黑洞。
//   pumpQueue 的 dispatch 二次抛出丢弃分支同因:只删 seen 不清 inflight。
// 修复:两处就地调 deliverError(job.group)(带 !settled 守卫;deliverError 自身抛出
//   也要保证 settled/inflight 收敛)。本测试锁死这两个结算点。
// 跑法: node tests/lc_chat_settle_guard.test.js
"use strict";
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js"),
  "utf8"
);

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS |", label); }
  else { fail++; console.log("  FAIL |", label); }
}

// 提取 outgoingViaBtipc 内的 doneFail(闭包体,6 空格缩进 `};` 结束;内层更深不误配)
function extractDoneFail() {
  const m = SRC.match(/const doneFail = function \(errCode\) \{[\s\S]*?\n      \};/);
  if (!m) { console.error("FAIL: cannot extract doneFail from lingua_chat.js"); process.exit(1); }
  return m[0];
}

function makeDoneFail(overrides) {
  const o = overrides || {};
  const seenDeleted = [];
  const State = o.State || {
    inflight: new Map(),
    seen: { delete: function (k) { seenDeleted.push(k); } },
  };
  const job = o.job;
  const isOp = !!o.isOp;
  const deliverError = o.deliverError || function (group, msg) {
    group.settled = true;
    group._delivered = { msg: msg };
    State.inflight.delete(group.key);
  };
  const finishJob = o.finishJob || function () {};
  const log = o.log || function () {};
  const tag = o.tag || "chat btipc";
  const body = extractDoneFail() + "\nreturn doneFail;";
  const doneFail = new Function(
    "job", "isOp", "State", "deliverError", "finishJob", "log", "tag", body
  )(job, isOp, State, deliverError, finishJob, log, tag);
  return { doneFail: doneFail, State: State, seenDeleted: seenDeleted };
}

console.log("--- ① chat + 未结算 group:就地 deliverError(僵尸组根修) ---");
{
  const group = { key: "k1", settled: false };
  const r = makeDoneFail({
    job: { kind: "chat", sig: "sig1", group: group },
    State: { inflight: new Map([["k1", group]]), seen: { delete: function () {} } },
  });
  r.doneFail("timeout");
  ok(group.settled === true, "group.settled 置位");
  ok(!!group._delivered && group._delivered.msg === "timeout", "deliverError 收到 errCode");
  ok(r.State.inflight.has("k1") === false, "僵尸 inflight 条目已删");
}

console.log("--- ② chat + group 已结算:不重复投递,只放开行级去重 ---");
{
  const group = { key: "k2", settled: true, _delivered: null };
  const seen2 = [];
  const r = makeDoneFail({
    job: { kind: "chat", sig: "sig2", group: group },
    State: { inflight: new Map([["k2", group]]), seen: { delete: function (k) { seen2.push(k); } } },
  });
  r.doneFail("btipc_fail");
  ok(group._delivered === null, "deliverError 未被再次调用");
  ok(seen2.indexOf("sig2") >= 0, "seen 已释放该 sig");
}

console.log("--- ③ outgoing / op 语义不变 ---");
{
  let doneArgs = null;
  const r1 = makeDoneFail({ job: { kind: "outgoing", done: function (a, b) { doneArgs = [a, b]; } } });
  r1.doneFail("timeout");
  ok(doneArgs !== null && doneArgs[0] === null && doneArgs[1] === null, "outgoing → done(null,null) 发原文");

  let opArgs = null;
  const r2 = makeDoneFail({
    job: { kind: "bridge", op: "config", done: function (a) { opArgs = a; } },
    isOp: true,
  });
  r2.doneFail("btipc_fail");
  ok(opArgs !== null && opArgs.ok === false && opArgs.error === "btipc_fail", "op → {ok:false,error}");
}

console.log("--- ④ deliverError 自身抛出:三态仍收敛且不向外抛 ---");
{
  const group = { key: "k4", settled: false };
  const seen4 = [];
  const State = { inflight: new Map([["k4", group]]), seen: { delete: function (k) { seen4.push(k); } } };
  const r = makeDoneFail({
    job: { kind: "chat", sig: "sig4", group: group },
    State: State,
    deliverError: function () { throw new Error("inject died"); },
  });
  let threw = false;
  try { r.doneFail("crc_dead"); } catch (e) { threw = true; }
  ok(threw === false, "异常不外泄");
  ok(group.settled === true, "fallback 置 settled=true");
  ok(State.inflight.has("k4") === false, "fallback 删 inflight 条目");
  ok(seen4.indexOf("sig4") >= 0, "fallback 放开 seen");
}

console.log("--- ⑤ 源码断言:pumpQueue 丢弃分支必须清 group ---");
{
  ok(/job\.kind === "chat"[\s\S]{0,400}?deliverError\(job\.group, "dispatch_threw"\)/.test(SRC),
    "pumpQueue drop 分支调用 deliverError(job.group, \"dispatch_threw\")");
  ok((SRC.match(/job\.group && !job\.group\.settled/g) || []).length >= 2,
    "两个结算点都带 !settled 守卫");
  ok(SRC.indexOf("deliverError(job.group, String(errCode || \"btipc_fail\"))") >= 0,
    "doneFail chat 分支走 deliverError 而非 job.done");
  ok(SRC.indexOf("settle chat group err=") >= 0,
    "doneFail chat 结算点有日志留痕(游戏内 E2E 可观测)");
}

console.log("--- ⑥ F6:$.Schedule 取消走官方 CancelScheduled(2026-10-10 实测修复) ---");
{
  ok(SRC.indexOf("function cancelSched(h)") >= 0, "cancelSched 助手必须存在");
  ok(SRC.indexOf("$.CancelScheduled") >= 0, "必须调用官方取消器 $.CancelScheduled");
  ok(/if \(job\._timeout\) \{ cancelSched\(job\._timeout\); job\._timeout = null; \}/.test(SRC),
    "旧通道超时取消点必须走 cancelSched(不再裸调 clearTimeout)");
  ok(SRC.indexOf("ctprobe2:") >= 0, "ctprobe-v2(CancelScheduled 语义游戏内探针)存在");
  ok(SRC.indexOf("function cancelSched(h)") < SRC.indexOf("cancelSched(job._timeout)"),
    "助手定义先于调用点(提升顺序安全)");
}

console.log("");
console.log("pass=" + pass + " fail=" + fail);
process.exit(fail ? 1 : 0);
