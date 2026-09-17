// 离线测试:quickchat 内容指纹握手(evaluateQuickChatSync 决策表) + 指纹跨文件一致性
// 跑法: node tests/quickchat_handshake.test.js
"use strict";
const fs = require("fs");
const path = require("path");
const { evaluateQuickChatSync } = require("../core/quickchat_sync.js");
const { fnv1a32, fingerprintTemplates } = require("../core/quickchat.js");

let pass = 0, fail = 0, skipped = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS |", label); }
  else { fail++; console.log("  FAIL |", label); }
}
function skip(label) {
  skipped++;
  console.log("  SKIP |", label, "(文件不存在;真实语料用例需要本地 Deadlock 安装)");
}

// ---------- FNV-1a 已知向量 ----------
console.log("--- FNV-1a 32 位已知向量 ---");
ok(fnv1a32("") === "811c9dc5", "fnv1a32('') = 811c9dc5");
ok(fnv1a32("a") === "e40c292c", "fnv1a32('a') = e40c292c");
ok(fnv1a32("foobar") === "bf9cf968", "fnv1a32('foobar') = bf9cf968");
ok(fingerprintTemplates([]) === null, "空模板表 -> null");
ok(fingerprintTemplates(null) === null, "null 模板表 -> null");

const A = ["攻击{s:hero_name}", "Attack {s:hero_name}", "马上回来"];
const A2 = A.slice();
const B = A.slice(); B[1] = "Attack {s:hero_name}!"; // 改中间条目
ok(fingerprintTemplates(A) === fingerprintTemplates(A2), "同表同序 -> 同指纹");
ok(fingerprintTemplates(A) !== fingerprintTemplates(B), "改中间条目 -> 指纹变(防首尾未变漏判)");
ok(fingerprintTemplates(A) !== fingerprintTemplates(A.slice().reverse()), "改顺序 -> 指纹变");

// ---------- evaluateQuickChatSync 决策表 ----------
console.log("--- evaluateQuickChatSync 决策表 ---");
const LOCAL = { fingerprint: "fnv1a-aaaa1111", count: 3 };
const RES_SAME = { ok: true, fingerprint: "fnv1a-aaaa1111", count: 3, templates: ["x", "y", "z"] };
const RES_DIFF = { ok: true, fingerprint: "fnv1a-bbbb2222", count: 3, templates: ["x2", "y", "z"] };
const RES_NOFP = { ok: true, count: 3, templates: ["x", "y", "z"] }; // 旧桥:无指纹字段

// ① 桥不可达/响应无效 -> 保留兜底 + 告警一次
let st = { reloadTried: false, warnedOffline: false, warnedMismatch: false };
let v = evaluateQuickChatSync(null, LOCAL, st);
ok(v.adopt === null && v.synced === false && v.warn !== null, "桥不可达:保留兜底+告警");
v = evaluateQuickChatSync(null, LOCAL, v.state);
ok(v.warn === null, "桥不可达第二次:不重复告警(不刷屏)");
v = evaluateQuickChatSync({ ok: false, error: "x" }, LOCAL, v.state);
ok(v.adopt === null && v.warn === null, "ok=false:保留兜底,且不再告警");
v = evaluateQuickChatSync({ ok: true, templates: [] }, LOCAL, v.state);
ok(v.adopt === null, "空模板数组:视为无效响应");

// ② 指纹相同 -> 采纳
st = { reloadTried: false, warnedOffline: false, warnedMismatch: false };
v = evaluateQuickChatSync(RES_SAME, LOCAL, st);
ok(v.adopt !== null && v.synced === true && v.warn === null, "指纹相同:采纳,无告警");

// ③ 指纹缺失(旧桥) -> 首次重拉
st = { reloadTried: false, warnedOffline: false, warnedMismatch: false };
v = evaluateQuickChatSync(RES_NOFP, LOCAL, st);
ok(v.reload === true && v.adopt === null, "指纹缺失:先重拉一次,不直接采纳");
// ④ 重拉后仍缺失 -> 采纳(桥是更新的一方)
v = evaluateQuickChatSync(RES_NOFP, LOCAL, v.state);
ok(v.adopt !== null && v.synced === true && v.warn !== null, "重拉后仍无指纹:采纳+告警(旧桥)");
v = evaluateQuickChatSync(RES_NOFP, LOCAL, v.state);
ok(v.warn === null, "旧桥第三次:不重复告警");

// ③' 指纹不一致 -> 首次重拉
st = { reloadTried: false, warnedOffline: false, warnedMismatch: false };
v = evaluateQuickChatSync(RES_DIFF, LOCAL, st);
ok(v.reload === true && v.adopt === null, "指纹不一致:先重拉一次");
// ④' 重拉后仍不一致 -> 采纳 + 告警一次
v = evaluateQuickChatSync(RES_DIFF, LOCAL, v.state);
ok(v.adopt !== null && v.synced === true && v.warn !== null, "重拉后仍不一致:采纳桥语料+告警(兑底过期)");
v = evaluateQuickChatSync(RES_DIFF, LOCAL, v.state);
ok(v.warn === null, "不一致第三次:不重复告警");

// 本地兜底无指纹(旧兜底文件) -> 走缺失路径,不因 local.fingerprint=null 误判相同
st = { reloadTried: false, warnedOffline: false, warnedMismatch: false };
v = evaluateQuickChatSync(RES_SAME, { fingerprint: null, count: 3 }, st);
ok(v.reload === true, "本地无指纹:即使模板数相同也走重拉路径(不误判同源)");

// ---------- 生成产物跨文件指纹一致性(需真实生成文件;缺文件 skip+warning) ----------
console.log("--- 生成产物指纹一致性 ---");
const qcJsonPath = path.join(__dirname, "..", "config", "quickchat.json");
const fbJsPath = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat_quickchat_fallback.js");
if (fs.existsSync(qcJsonPath) && fs.existsSync(fbJsPath)) {
  const qcJson = JSON.parse(fs.readFileSync(qcJsonPath, "utf8"));
  const fbSrc = fs.readFileSync(fbJsPath, "utf8");
  const m = fbSrc.match(/LCT_QUICKCHAT_FALLBACK_FINGERPRINT = "([^"]+)"/);
  if (m) {
    ok(!!qcJson.fingerprint, "quickchat.json 含 fingerprint 字段");
    ok(m[1] === qcJson.fingerprint, "兜底文件指纹 === quickchat.json 指纹(" + qcJson.fingerprint + ")");
    // 指纹可从语料重建(生成器口径:数组 join 后 FNV-1a)
    const arrM = fbSrc.match(/=\s*(\[[\s\S]*\])\s*;/);
    const arr = JSON.parse(arrM[1]);
    ok(fingerprintTemplates(arr) === qcJson.fingerprint, "指纹可由兜底语料重建(同口径)");
  } else {
    fail++;
    console.log("  FAIL | 兜底文件缺少 LCT_QUICKCHAT_FALLBACK_FINGERPRINT(生成器版本过旧:重跑 node core/quickchat.js)");
  }
} else {
  skip("quickchat.json / 兑底语料文件");
}

console.log("RESULT: PASS " + pass + " / FAIL " + fail + " / SKIP " + skipped);
process.exit(fail > 0 ? 1 : 0);
