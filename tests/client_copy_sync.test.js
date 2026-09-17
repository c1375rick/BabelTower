// 离线测试:客户端同步副本与 core 参考实现的行为一致性对账
// lingua_chat.js 内标注 @sync 的代码块(匹配器/握手裁决)是 core/quickchat_match.js 与
// core/quickchat_sync.js 的手工同步副本(客户端依赖 Panorama 全局,无法 require)。
// 本测试从客户端源码提取同步块,在沙箱里执行,与 core 实现逐用例比对——
// 副本漂移在此当场爆红,不再依赖"改一处必查另一处"的自觉。
// 跑法: node tests/client_copy_sync.test.js
"use strict";
const fs = require("fs");
const path = require("path");

const CLIENT_SRC = fs.readFileSync(path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js"), "utf8");
const qcMatch = require("../core/quickchat_match.js");
const { evaluateQuickChatSync: coreSync } = require("../core/quickchat_sync.js");

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS |", label); }
  else { fail++; console.log("  FAIL |", label); }
}

// ---------- 从客户端源码提取同步块 ----------
function extractBlock(beginMarker, endMarker) {
  const b = CLIENT_SRC.indexOf(beginMarker);
  const e = CLIENT_SRC.indexOf(endMarker, b);
  if (b < 0 || e < 0) return null;
  return CLIENT_SRC.slice(b, e + endMarker.length);
}

const matchBlock = extractBlock("// @sync-begin core/quickchat_match.js", "// @sync-end core/quickchat_match.js");
const syncFnSrc = (function () {
  const m = CLIENT_SRC.match(/function evaluateQuickChatSync\(res, local, st\) \{[\s\S]*?\n  \}/);
  return m ? m[0] : null;
})();

if (!matchBlock || !syncFnSrc) {
  console.error("FAIL: cannot extract @sync blocks from lingua_chat.js (markers missing?)");
  process.exit(1);
}

// 语料:与生成器产物同源
function extractArray(file) {
  const src = fs.readFileSync(file, "utf8");
  const m = src.match(/=\s*(\[[\s\S]*\])\s*;/);
  return JSON.parse(m[1]);
}
const TEMPLATES = extractArray(path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat_quickchat_fallback.js"));
const NAMES = extractArray(path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat_gamenames_fallback.js"));

// 沙箱执行客户端匹配器块(块内引用 QUICKCHAT_TEMPLATES / LCT_GAMENAMES_FALLBACK)
let clientMatch = null;
try {
  const factory = new Function(
    "QUICKCHAT_TEMPLATES",
    "LCT_GAMENAMES_FALLBACK",
    matchBlock + "\nreturn { matchesQuickTemplate: matchesQuickTemplate, norm: __qcNorm };"
  );
  clientMatch = factory(TEMPLATES, NAMES);
  ok(true, "客户端同步块沙箱执行成功");
} catch (e) {
  ok(false, "客户端同步块沙箱执行失败: " + e.message);
}
let clientSync = null;
try {
  clientSync = new Function("return (" + syncFnSrc + ")")();
  ok(true, "客户端握手裁决函数提取成功");
} catch (e) {
  ok(false, "客户端握手裁决函数提取失败: " + e.message);
}

// ---------- ① norm 一致性 ----------
console.log("--- __qcNorm vs core.norm ---");
const NORM_CASES = ["小 心", "  A B c  ", "Venator不见了！！！", "Mo & Krill", "THERE  isspaced", "灰爪 不见了", "", null, "贴！贴！贴"];
for (const s of NORM_CASES) {
  const a = clientMatch ? String(clientMatch.norm(s)) : "<crash>";
  const b = String(qcMatch.norm(s));
  ok(a === b, "norm(" + JSON.stringify(s) + ") 一致: " + JSON.stringify(a));
}

// ---------- ② 匹配判定全语料对账(含新旧两族 skip 用例与防误杀 trans 用例) ----------
console.log("--- matchesQuickTemplate 判定对账 ---");
const DECISION_CASES = [
  // 老族 skip
  "Venator不见了", "Venator不见了！", "Venator不见了！！！",
  "我看到 McGinnis", "I see McGinnis", "McGinnis is Missing",
  "疗伤幽灵还要冷却1秒", "遥控夜枭准备就绪！", "Restorative Locket is on cooldown for 6s",
  "我们去推进黄路吧", "小心！McGinnis有灵能涌动", "Mo & Krill不见了", "Lady Geist is Missing",
  "小 心", "灰爪不见了",
  // 新族保留项 skip
  "推进滑索", "Pushing Zipline", "攻击 1 级", "防守基地", "推进黄路", "Push Yellow",
  "帮我护送灵瓮", "Help me deliver the urn", "我可以治疗你，Graves",
  // 新族剔除项(手打短语,必须 trans)
  "抱歉", "sorry", "不客气", "You're Welcome", "有什么计划？", "What's the plan",
  "有治疗", "请治疗", "需要治疗", "Heal Please", "去商店", "去商店！", "Going to Shop",
  // 防误杀 trans
  "撤退吧兄弟", "攻击中路", "他们去中路了", "小心对面隐身", "gg wp", "loot mid now",
  "Venator 不见了吗？", "我们推进黄路吧好不好", "join our party please", "123456",
  "他也不见了", "人不见了！！", "攻中路", "灭了", "买活了我",
];
let mismatch = 0;
for (const t of DECISION_CASES) {
  const a = clientMatch ? clientMatch.matchesQuickTemplate(t) : !qcMatch.matchesQuickTemplate(t);
  const b = qcMatch.matchesQuickTemplate(t);
  if (a !== b) { mismatch++; console.log("  DIFF | " + JSON.stringify(t) + " client=" + a + " core=" + b); }
}
ok(mismatch === 0, "匹配判定 " + DECISION_CASES.length + " 用例全部一致(差异 " + mismatch + ")");

// ---------- ③ 握手裁决对账(复刻 quickchat_handshake 决策矩阵) ----------
console.log("--- evaluateQuickChatSync 决策对账 ---");
const LOCAL = { fingerprint: "fnv1a-aaaa1111" };
const SCENARIOS = [
  { name: "桥不可达", res: null },
  { name: "ok=false", res: { ok: false, error: "x" } },
  { name: "空模板", res: { ok: true, templates: [] } },
  { name: "指纹同", res: { ok: true, fingerprint: "fnv1a-aaaa1111", templates: ["x"] } },
  { name: "指纹异-首次", res: { ok: true, fingerprint: "fnv1a-bbbb2222", templates: ["x"] } },
  { name: "无指纹-首次", res: { ok: true, templates: ["x"] } },
];
for (const sc of SCENARIOS) {
  const st1 = { reloadTried: false, warnedOffline: false, warnedMismatch: false };
  const st2 = { reloadTried: false, warnedOffline: false, warnedMismatch: false };
  const v1 = clientSync(sc.res, LOCAL, st1);
  const v2 = coreSync(sc.res, LOCAL, st2);
  const sig = (v) => JSON.stringify({ adopt: Array.isArray(v.adopt), synced: v.synced, reload: v.reload, warn: !!v.warn, state: v.state });
  ok(sig(v1) === sig(v2), sc.name + ": 裁决一致 [" + sig(v1) + "]");
  // 第二轮(重拉后/重复告警)
  const v1b = clientSync(sc.res, LOCAL, v1.state);
  const v2b = coreSync(sc.res, LOCAL, v2.state);
  ok(sig(v1b) === sig(v2b), sc.name + ": 第二轮裁决一致 [" + sig(v1b) + "]");
}
// 本地无指纹(旧兜底)路径
const st3 = { reloadTried: false, warnedOffline: false, warnedMismatch: false };
const st4 = { reloadTried: false, warnedOffline: false, warnedMismatch: false };
const lv1 = clientSync({ ok: true, fingerprint: "fnv1a-aaaa1111", templates: ["x"] }, { fingerprint: null }, st3);
const lv2 = coreSync({ ok: true, fingerprint: "fnv1a-aaaa1111", templates: ["x"] }, { fingerprint: null }, st4);
ok(lv1.reload === lv2.reload && lv1.reload === true, "本地无指纹:两侧都走重拉路径");

// ---------- ④ @sync 标记完整性 ----------
console.log("--- @sync 标记 ---");
ok(CLIENT_SRC.indexOf("// @sync-begin core/quickchat_match.js") >= 0, "匹配器块有 @sync-begin 标记");
ok(CLIENT_SRC.indexOf("// @sync-end core/quickchat_match.js") >= 0, "匹配器块有 @sync-end 标记");
ok(CLIENT_SRC.indexOf("// @sync core/quickchat_sync.js") >= 0, "握手裁决有 @sync 标记");
ok(qcMatch.getWalkCount() >= 0, "core 匹配器可独立加载(副 本对账不污染 core 状态)");

console.log("RESULT: PASS " + pass + " / FAIL " + fail);
process.exit(fail > 0 ? 1 : 0);
