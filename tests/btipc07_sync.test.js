// 离线测试:btipc07 数据同步(op=config + {"get"})—— 指纹协商 / delta / 分片 / 预算
// 跑法: node tests/btipc07_sync.test.js
//
// 为什么是纯函数测试:下行只有 ~12.6 B/s(16B/帧 × 真机 0.79s/帧),全量同步要十几分钟,
// 无法靠"起桥再拉一次"做集成测试;而这些逻辑全是纯函数(输入数据 → 输出载荷),
// 在 Node 里逐项对拍即可覆盖真车会跑的所有分支。
"use strict";
const fs = require("fs");
const path = require("path");
const syncData = require("../core/sync_data.js");
const quickchat = require("../core/quickchat.js");

let pass = 0, fail = 0, skipped = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS |", label); }
  else { fail++; console.log("  FAIL |", label); }
}
function skip(label) {
  skipped++;
  console.log("  SKIP |", label);
}
function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }

const DATA_DIR = path.join(__dirname, "..", "data");
const MOD_DIR = path.join(__dirname, "..", "mod", "panorama", "scripts");

// ---------- 与 core/quickchat.js 的指纹同源(sync_data 刻意内联了一份,防循环依赖) ----------
console.log("--- fnv1a32 / fingerprintTemplates 同源对拍 ---");
for (const s of ["", "a", "foobar", "亚伯兰", "Hollow Point"]) {
  ok(syncData.fnv1a32(s) === quickchat.fnv1a32(s), "fnv1a32 同源(" + JSON.stringify(s) + ")");
}
const listA = ["攻击{s:hero}", "Attack {s:hero}", "马上回来", "危"];
ok(syncData.fingerprintTemplates(listA) === quickchat.fingerprintTemplates(listA),
  "fingerprintTemplates 同源(含中文 + 结构键)");
ok(syncData.fingerprintTemplates([]) === null, "空表 -> null");
ok(syncData.fingerprintTemplates(listA) !== syncData.fingerprintTemplates(listA.concat(["x"])),
  "追加条目 -> 指纹变");

// ---------- extractAssignment:从打包兜底里抽 JSON 字面量 ----------
console.log("--- extractAssignment(打包兜底解析) ---");
ok(syncData.extractAssignment("var X = {\"a\":1, \"b\":\"c;[}\"};", "X") &&
   JSON.stringify(syncData.extractAssignment("var X = {\"a\":1, \"b\":\"c;[}\"};", "X")) === '{"a":1,"b":"c;[}"}',
  "值里含 ; [ ] 不截断");
ok(syncData.extractAssignment("var X = [1,2,3];", "Y") === null, "名字不存在 -> null");
ok(syncData.extractAssignment("var X = notjson;", "X") === null, "非 JSON 字面量 -> null(不抛)");

const pairsPath = path.join(MOD_DIR, "lingua_chat_gamenames_pairs_fallback.js");
const qcFbPath = path.join(MOD_DIR, "lingua_chat_quickchat_fallback.js");
const gnPath = path.join(DATA_DIR, "gamenames.json");
const qcPath = path.join(DATA_DIR, "quickchat.json");

let pairs = null, pairsFp = null, qcTpl = null, qcFp = null;
let gn = null, qc = null;
if (fs.existsSync(pairsPath) && fs.existsSync(qcFbPath) && fs.existsSync(gnPath) && fs.existsSync(qcPath)) {
  const pairsSrc = fs.readFileSync(pairsPath, "utf8");
  const qcFbSrc = fs.readFileSync(qcFbPath, "utf8");
  pairs = syncData.extractAssignment(pairsSrc, "LCT_GAMENAMES_PAIRS");
  qcTpl = syncData.extractAssignment(qcFbSrc, "LCT_QUICKCHAT_FALLBACK_TEMPLATES");
  qcFp = syncData.extractAssignment(qcFbSrc, "LCT_QUICKCHAT_FALLBACK_FINGERPRINT");
  gn = readJson(gnPath);
  qc = readJson(qcPath);
} else {
  skip("打包兜底 / config 数据文件(需要 node core/game_names.js 与 node core/quickchat.js 生成)");
}

if (pairs && gn) {
  // ---------- 基线同源:常态握手必须 same=true(一条数据都不传) ----------
  console.log("--- 基线同源(常态 = 零传输) ---");
  pairsFp = syncData.namesFingerprint(pairs);
  ok(Object.keys(pairs).length === syncData.namesCount(gn), "打包名单条数 === 配置条数");
  ok(pairsFp === syncData.namesFingerprint(gn), "打包名单指纹 === 配置指纹(握手 same 才成立)");
  const hs = syncData.syncGet("gamenames", gn, { fingerprint: pairsFp, data: pairs }, pairsFp, undefined, 90);
  ok(hs.ok === true && hs.same === true && hs.total === 0,
    "同指纹握手 -> same=true, total=0(零传输):" + JSON.stringify(hs));
  // 玩家包里没有 mod\ 目录(基线缺失)时也必须能走通,只是退全量。
  // 注意 same 只看指纹、与基线无关 —— 所以这里必须用一个对不上的指纹才谈得上 full。
  const hs2 = syncData.syncGet("gamenames", gn, null, "fnv1a-00000000", undefined, 90);
  ok(hs2.ok === true && hs2.same === false && hs2.mode === "full" && hs2.total > 0,
    "指纹不同 + 无基线 -> same=false, mode=full(慢但正确)");
  ok(syncData.syncGet("gamenames", gn, null, pairsFp, undefined, 90).same === true,
    "指纹相同即使无基线也 same=true(本来就没东西要传)");
  ok(syncData.syncGet("gamenames", gn, null, null, undefined, 90).same === false,
    "客户端无指纹(旧包) -> same=false");
}

if (qcTpl && qcFbPath && qc) {
  console.log("--- quickchat 基线同源 ---");
  ok(qcTpl.length > 0 && typeof qcFp === "string", "兜底语料与指纹可解析");
  ok(qcFp === qc.fingerprint, "兜底指纹 === quickchat.json 指纹(握手 same 才成立)");
  const q = syncData.syncGet("quickchat", qc, { fingerprint: qcFp, data: qcTpl }, qcFp, undefined, 90);
  ok(q.ok === true && q.same === true && q.total === 0, "quickchat 同指纹握手 -> zero transfer");
}

// ---------- 分片协议(与游戏侧 syncViaBtipc 同一套动作) ----------
function pullAll(kind, current, baseline, clientFp, expect, lim, maxChunks) {
  let acc = "", off = 0, n = 0, last = null;
  for (;;) {
    const p = syncData.syncGet(kind, current, baseline, clientFp, off, lim, expect);
    if (!p.ok) return { error: p.error, acc: acc, n: n };
    if (p.same) return { error: "unexpected_same_during_pull", acc: acc, n: n };
    if (typeof p.part !== "string") return { error: "bad_chunk", acc: acc, n: n };
    acc += p.part;
    off = p.off + p.part.length;
    n++;
    last = p;
    if (p.done) return { acc: acc, n: n, last: last };
    if (n > maxChunks) return { error: "too_many_chunks", acc: acc, n: n };
  }
}

if (pairs && gn) {
  console.log("--- delta 路径(游戏更新后桥只下发增删改) ---");
  const mut = JSON.parse(JSON.stringify(gn));
  delete mut.Abrams;
  mut.NewHero = "新英雄";
  mut.Holliday = "哈雷黛X";
  const hs = syncData.syncGet("gamenames", mut, { fingerprint: pairsFp, data: pairs }, pairsFp, undefined, 90);
  ok(hs.same === false && hs.mode === "delta" && hs.total < 1200,
    "基线命中 -> mode=delta, 体量小(total=" + hs.total + ")");
  const r = pullAll("gamenames", mut, { fingerprint: pairsFp, data: pairs }, pairsFp, hs.fingerprint, 90, 400);
  ok(!r.error && r.n >= 1 && r.acc.length === hs.total,
    "分片收齐: chunks=" + r.n + " chars=" + r.acc.length + "/" + hs.total);
  const delta = JSON.parse(r.acc);
  ok(delta.delta === true && delta.fingerprint === hs.fingerprint, "delta 载荷带 fingerprint(delta:true)");
  // 与游戏侧 applyNamesPayload 同逻辑
  const merged = Object.assign({}, pairs, delta.added, delta.changed);
  for (const k of delta.removed) delete merged[k];
  ok(syncData.namesFingerprint(merged) === syncData.namesFingerprint(mut),
    "施加 delta 后与桥侧指纹一致(名单可用)");
  // 幂等:delta 的目标值是绝对值,重复施加结果不变
  const again = Object.assign({}, merged, delta.added, delta.changed);
  for (const k of delta.removed) delete again[k];
  ok(JSON.stringify(again) === JSON.stringify(merged), "delta 重复施加幂等");

  console.log("--- full 路径(基线缺失) ---");
  const hs2 = syncData.syncGet("gamenames", gn, null, "fnv1a-00000000", undefined, 90);
  const r2 = pullAll("gamenames", gn, null, "fnv1a-00000000", hs2.fingerprint, 90, 400);
  ok(!r2.error && r2.acc.length === hs2.total, "full 收齐: chunks=" + r2.n + "/" + hs2.total);
  const full = JSON.parse(r2.acc);
  ok(full.ok === true && full.fingerprint === hs2.fingerprint &&
     Object.keys(full.names).length === syncData.namesCount(gn),
    "full 载荷与 HTTP /api/v1/gamenames 同形且完整");
  ok(syncData.namesFingerprint(full.names) === hs2.fingerprint, "full 载荷可重建指纹");

  console.log("--- 配置在拉取中途被重建(fp_changed) ---");
  const mid = JSON.parse(JSON.stringify(mut));
  mid.Zzz = "中途新增";
  const p = syncData.syncGet("gamenames", mid, { fingerprint: pairsFp, data: pairs }, pairsFp, 0, 90, hs.fingerprint);
  ok(p.ok === false && p.error === "fp_changed", "expect 与桥侧现值不符 -> fp_changed");
  ok(syncData.syncGet("gamenames", gn, null, null, 0, 90, null).ok === true,
    "不带 exp 时不做 expect 校验(兼容老客户端)");
}

// ---------- off=0 不能被当成握手 ----------
console.log("--- off=0 语义 ---");
if (pairs && gn) {
  const hs = syncData.syncGet("gamenames", gn, { fingerprint: pairsFp, data: pairs }, pairsFp, undefined, 90);
  ok(hs.same === true, "前置:同指纹握手 same");
  // 指纹不同但 off=0:必须回分片而不是握手
  const mut = JSON.parse(JSON.stringify(gn)); mut.X1 = "甲";
  const hs2 = syncData.syncGet("gamenames", mut, { fingerprint: pairsFp, data: pairs }, pairsFp, undefined, 90);
  const c0 = syncData.syncGet("gamenames", mut, { fingerprint: pairsFp, data: pairs }, pairsFp, 0, 90, hs2.fingerprint);
  ok(c0.ok === true && typeof c0.part === "string" && c0.off === 0,
    "off=0 是取片(0 是合法偏移,不能用 falsy 判握手)");
}

// ---------- 分片预算:单片 JSON 编码后不得超过 lim ----------
console.log("--- 分片预算(sliceByJsonBytes) ---");
if (qc) {
  const heavy = syncData.quickchatFullPayload(qc).slice(0, 900); // 大量中文,最坏情况
  let allOk = true;
  let detail = "";
  for (let lim = 4; lim <= 200; lim += 6) {
    let o = 0, n = 0, acc = "";
    for (;;) {
      const p = syncData.sliceByJsonBytes(heavy, o, lim);
      const bytes = Buffer.byteLength(JSON.stringify(p.part), "utf8");
      // 允许"一片恰好装不下一个字符"的余量(最多 6 字节转义 + 2 字节引号)
      if (bytes > lim && bytes > 8) { allOk = false; detail = "lim=" + lim + " bytes=" + bytes; break; }
      if (!p.part.length && !p.done) { allOk = false; detail = "stuck at " + o; break; }
      acc += p.part;
      o = p.off + p.part.length;
      n++;
      if (p.done) break;
      if (n > 5000) { allOk = false; detail = "no progress"; break; }
    }
    if (!allOk) break;
    if (acc !== heavy) { allOk = false; detail = "reassembly mismatch at lim=" + lim; break; }
  }
  ok(allOk, "lim 4..200 全部不超预算且可完整重组" + (detail ? " (" + detail + ")" : ""));
  ok(syncData.clampLim(0) === syncData.DEFAULT_LIM, "clampLim(0) -> 默认值");
  ok(syncData.clampLim(99999) === syncData.MAX_LIM, "clampLim 超上限 -> 上限");
  ok(syncData.clampLim("junk") === syncData.DEFAULT_LIM, "clampLim 非法 -> 默认值");
  ok(syncData.MAX_LIM <= 360, "MAX_LIM 受读死线 50s 约束(<=360)");
}

// ---------- 缓存:同一 (kind,fp,mode) 反复取内容一致 ----------
console.log("--- 载荷缓存 ---");
if (pairs && gn) {
  const a = syncData.encodeFor("gamenames", gn, { fingerprint: pairsFp, data: pairs }, pairsFp);
  const b = syncData.encodeFor("gamenames", gn, { fingerprint: pairsFp, data: pairs }, pairsFp);
  ok(a.text === b.text && a.fp === b.fp, "重复 encode 结果一致(缓存不改变语义)");
}

console.log("RESULT: PASS " + pass + " / FAIL " + fail + " / SKIP " + skipped);
process.exit(fail > 0 ? 1 : 0);
