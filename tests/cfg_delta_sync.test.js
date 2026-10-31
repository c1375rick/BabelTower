// 离线测试:btipc11 配置差分同步(op=config + {"get":"configsync"})
// 跑法: node tests/cfg_delta_sync.test.js
//
// 要解决的旧问题(BTIPС 慢通道,下行 ~15 B/s):
//   旧路 = revOnly 指纹读(≈2s)+ 变了再拉**全量** maskCompact(≈400B = 40 帧 ≈26s)
//        + 20s 轮询间隔 → "网页改了游戏不认"最坏 ≈46s。
// 新路 = 与 gamenames/quickchat 同一套两段式:握手报本地指纹 → same(1 帧)或**只传增删改**。
//
// 为什么是纯函数测试 + 接线正则:配置同步的载荷构造是纯函数(core/sync_data.js),
// 在 Node 里逐项对拍即可覆盖真车会跑的所有分支;游戏侧接线用正则钉死(同其它护栏的做法)。
"use strict";
const fs = require("fs");
const path = require("path");
const syncData = require("../core/sync_data.js");

let pass = 0, fail = 0, skipped = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS |", label); }
  else { fail++; console.log("  FAIL |", label); }
}
function skip(label) { skipped++; console.log("  SKIP |", label); }

const ROOT = path.join(__dirname, "..");
const LC = path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat.js");
const BRIDGE = path.join(ROOT, "core", "bridge_server.js");
const lc = fs.existsSync(LC) ? fs.readFileSync(LC, "utf8") : "";
const bridge = fs.existsSync(BRIDGE) ? fs.readFileSync(BRIDGE, "utf8") : "";
if (!lc || !bridge) {
  skip("lingua_chat.js / bridge_server.js");
  console.log("RESULT: PASS " + pass + " / FAIL " + fail + " / SKIP " + skipped);
  process.exit(0);
}

// ---------- ① 扁平化:路径 <-> 值 ----------
console.log("--- flattenConfig(嵌套配置 -> 路径表) ---");
const visible = {
  provider: "bing",
  ui: { displayMode: "bilingual", outgoing: true, fontSize: 14 },
  translateOwn: true,
  chatLog: { enabled: true },
  fallbackProviders: ["google"],
};
const flat = syncData.flattenConfig(visible);
ok(flat["ui.displayMode"] === "bilingual", "嵌套字段 -> 点路径(ui.displayMode)");
ok(flat["chatLog.enabled"] === true, "两层嵌套 -> 点路径(chatLog.enabled)");
ok(Array.isArray(flat["fallbackProviders"]) && flat["fallbackProviders"][0] === "google",
  "数组当叶子(整体替换,不逐项差分)");
ok(Object.keys(flat).length === 7, "扁平后共 7 个叶子(实际 " + Object.keys(flat).length + ")");

// ---------- ② 差分载荷:只含变了的字段 ----------
console.log("--- configDeltaPayload(只传增删改) ---");
const oldVis = {
  provider: "bing",
  ui: { displayMode: "bilingual", outgoing: true, fontSize: 14 },
  translateOwn: true,
  chatLog: { enabled: true },
};
const newVis = {
  provider: "openai",
  ui: { displayMode: "translation_only", outgoing: true },
  translateOwn: false,
};
const delta = JSON.parse(syncData.configDeltaPayload(oldVis, newVis, "abcd1234"));
ok(delta.delta === true && delta.fingerprint === "abcd1234", "载荷带 delta 标记与新指纹");
ok(delta.set["ui.displayMode"] === "translation_only", "改了的字段进 set");
ok(delta.set["provider"] === "openai", "改了的顶层字段进 set");
ok(delta.set["translateOwn"] === false, "布尔值改动进 set");
ok(!Object.prototype.hasOwnProperty.call(delta.set, "ui.outgoing"), "没变的字段不进 set");
ok(!Object.prototype.hasOwnProperty.call(delta.set, "ui.fontSize"), "被删掉的字段不进 set");
ok(delta.unset.indexOf("ui.fontSize") >= 0, "被删掉的字段进 unset");
ok(delta.unset.indexOf("chatLog") >= 0,
  "整棵子树没了 -> unset 报顶层字段(游戏侧直接删整块,不留空壳)");
// 只掉了一个叶子 -> 报叶子路径(父对象还有别的字段,不能整块删)
const partDelta = JSON.parse(syncData.configDeltaPayload(
  { microsoft: { hasApiKey: true, region: "us" } },
  { microsoft: { hasApiKey: true } }, "y"));
ok(partDelta.unset.indexOf("microsoft.region") >= 0, "部分叶子没了 -> unset 报叶子路径");
ok(partDelta.unset.indexOf("microsoft") < 0, "父对象还有别的字段 -> 不整块删");
// 值是绝对值 → 差分可重复施加(幂等)
const again = JSON.parse(syncData.configDeltaPayload(oldVis, newVis, "abcd1234"));
ok(JSON.stringify(again.set) === JSON.stringify(delta.set), "差分是绝对值(可重复施加)");

// ---------- ③ 两段式:握手 / same / 分片 ----------
console.log("--- syncGet(config):握手与分片 ---");
// 用**真实体量**的可见配置(maskCompact ≈400B):差分要真的比全量小才有意义。
const realistic = {
  provider: "bing",
  ui: {
    displayMode: "bilingual", outgoing: true, outgoingTarget: "en", targetLanguage: "zh-Hans",
    enabled: true, force: false, provider: "bing", timeoutMs: 15000,
  },
  fallbackProviders: ["google", "deepl"],
  microsoft: { hasApiKey: true, region: "global" },
  openai: { hasApiKey: false },
  deepl: { hasApiKey: false },
  google: { hasApiKey: false },
  translateOwn: true,
  chatLog: { enabled: true },
};
const cur = { visible: realistic, fp: "abcd1234" };
// 基线 = 客户端手上那一版(与当前只差一个字段:displayMode)
const baseline = {
  fingerprint: "oldfp01",
  visible: Object.assign({}, realistic, { ui: Object.assign({}, realistic.ui, { displayMode: "translation_only" }) }),
};
const hs = syncData.syncGet("config", cur, baseline, "oldfp01", undefined, 90, null);
ok(hs.ok === true && hs.same === false, "指纹不同 -> 不是 same");
ok(hs.mode === "delta", "有基线且指纹对得上 -> delta 模式(实际 " + hs.mode + ")");
ok(hs.total > 0, "握手给出总长");
ok(hs.fingerprint === "abcd1234", "握手回当前指纹");
// 差分载荷必须显著小于全量(这才是"只传增删改"的意义)
const fullLen = syncData.configFullPayload(realistic, "abcd1234").length;
ok(hs.total < fullLen, "差分比全量小(" + hs.total + "B < " + fullLen + "B)");
// 指纹相同 -> same(1 帧级开销,不发载荷)
const sameHs = syncData.syncGet("config", cur, baseline, "abcd1234", undefined, 90, null);
ok(sameHs.same === true && sameHs.total === 0, "指纹相同 -> same 且不传载荷");
// 客户端没有基线(首次/桥重启) -> 全量
const noBase = syncData.syncGet("config", cur, null, "oldfp01", undefined, 90, null);
ok(noBase.mode === "full", "无基线 -> 全量");
// 差分比全量还大(字段删得多) -> 退回全量
const bigOld = { visible: { a: "1", b: "2", c: "3", d: "4", e: "5", f: "6", g: "7", h: "8" }, fingerprint: "x" };
const smallNew = { visible: { a: "9" }, fingerprint: "y" };
const bigDelta = syncData.syncGet("config", smallNew, bigOld, "x", undefined, 90, null);
ok(bigDelta.mode === "full", "差分不比全量小 -> 退全量(实际 " + bigDelta.mode + ")");
// 分片:按 JSON 字节预算切,拼起来等于载荷
let acc = "";
let off = 0;
let guard = 0;
for (;;) {
  const part = syncData.syncGet("config", cur, baseline, "oldfp01", off, 90, "abcd1234");
  ok(part.ok === true, "分片 ok");
  acc += part.part;
  off = part.off + part.part.length;
  if (part.done) break;
  guard += 1;
  if (guard > 50) { ok(false, "分片预算护栏触发"); break; }
}
const rebuilt = JSON.parse(acc);
ok(rebuilt.delta === true && rebuilt.set["ui.displayMode"] === "bilingual",
  "分片拼回来 == 差分载荷");
// 拉一半配置被重建 -> 桥回 fp_changed
const changed = syncData.syncGet("config", cur, baseline, "oldfp01", 0, 90, "OTHERFP");
ok(changed.ok === false && changed.error === "fp_changed", "exp 不匹配 -> fp_changed(中途被重建)");

// ---------- ④ 桥侧:版本历史 + get 分发 ----------
console.log("--- 桥侧:配置版本历史与 get 分发 ---");
ok(/const CONFIG_HISTORY_MAX = \d+;/.test(bridge), "桥侧有配置版本历史上限");
ok(/function configHistoryBaseline\(fp\)/.test(bridge), "桥侧按指纹查基线");
ok(/configHistoryPush\(visible, fp\)/.test(bridge), "桥侧把当前版记进历史");
ok(/kind === "config" \|\| kind === "configsync"/.test(bridge), "get 分发认 config/configsync");
ok(/syncData\.syncGet\("config", \{ visible: visible, fp: fp \}/.test(bridge),
  "桥侧用 syncGet 造配置载荷(两段式)");
ok(/function configHistoryNote\(\)/.test(bridge) && /configHistoryNote\(\);/.test(bridge),
  "保存后记一版历史(onConfigSaved 调)");
// 写路径不能被 get 分支吃掉:op=config 的 body 带 config 时必须先写
const opBody = bridge.slice(bridge.indexOf("async function runBtipcOp(op, body, timeoutMs)"));
const iGet = opBody.indexOf('typeof obj.get === "string"');
const iWrite = opBody.indexOf("if (obj.config)");
ok(iGet > 0 && iWrite > 0, "op=config 分支既有 get 也有写");

// ---------- ⑤ 游戏侧接线 ----------
console.log("--- 游戏侧:差分同步接线 ---");
ok(/const BTIPC_GET_OPS = \{ health: 1, gamenames: 1, quickchat: 1, configsync: 1 \};/.test(lc),
  "configsync 是 get 类 op(走 50s 读死线)");
ok(/function syncConfigDelta\(onDone\)/.test(lc), "syncConfigDelta 已定义");
ok(/function applyConfigPayload\(text, res\)/.test(lc), "applyConfigPayload 已定义");
ok(/function cfgPathApply\(obj, path, value\)/.test(lc), "cfgPathApply 已定义(路径合并/删除)");
ok(/const reqRev = State\.cfgRev \|\| ""/.test(lc) && /syncViaBtipc\("configsync", reqRev\b/.test(lc),
  "握手上报本地指纹(reqRev 捕获 State.cfgRev;陈旧差分防护)");
ok(/State\.cfgMask = c;/.test(lc), "applyBridgeConfig 留存差分基准 cfgMask");
ok(/cfgMask: null,/.test(lc), "State.cfgMask 已声明");
// 轮询走差分(不再 revOnly + 全量二次拉)
const tickBody = lc.slice(lc.indexOf("function startCfgWatch()"), lc.indexOf("// ================= 配置变更推送"));
ok(/syncConfigDelta\(function \(ok\)/.test(tickBody), "配置轮询走差分同步");
ok(!/bridgePost\("config", \{ revOnly: true \}/.test(lc),
  "轮询不再用 revOnly 指纹读(差分握手已含指纹判定)");
// 推送路径:不能先改 State.cfgRev(否则差分没基准,桥会回 same)
const pushBody = lc.slice(lc.indexOf("function onWatchPayload(raw)"), lc.indexOf("function onBridgeEvent("));
ok(/syncConfigDelta\(function \(ok\)/.test(pushBody), "推送唤醒走差分同步");
const iSetRev = pushBody.indexOf("State.cfgRev = rev;");
ok(iSetRev < 0, "推送不预先改写 State.cfgRev(改了差分就没有基准了)");
ok(/State\.cfgRev = d\.fingerprint/.test(lc), "指纹由差分载荷落地时更新");

// ---------- ⑥ 游戏侧合并逻辑:把函数从脚本里抽出来真跑一遍 ----------
// 为什么抽出来跑:游戏脚本是 Panorama 脚本(依赖 $ / $.Schedule),require 不了;
// 但差分合并是纯逻辑,抽出来就能真验 —— 桥侧产的差分载荷能不能被游戏侧正确合并,
// 这是"只传增删改"能不能成立的关键一环,只靠正则钉不住。
console.log("--- 游戏侧:差分载荷 → 合并后的 mask(跨模块对拍) ---");
function extractFn(src, name) {
  const at = src.indexOf("function " + name + "(");
  if (at < 0) return null;
  let depth = 0, i = src.indexOf("{", at);
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth += 1;
    else if (src[j] === "}") { depth -= 1; if (depth === 0) return src.slice(at, j + 1); }
  }
  return null;
}
const fnPath = extractFn(lc, "cfgPathApply");
const fnApply = extractFn(lc, "applyConfigPayload");
const fnClear = extractFn(lc, "clearDirtyForPaths");
ok(!!fnPath, "抽出 cfgPathApply");
ok(!!fnApply, "抽出 applyConfigPayload");
if (fnPath && fnApply) {
  // 沙箱:只给这三个依赖
  const sandbox = {
    State: { cfgRev: "oldfp01", cfgMask: null, cfg: {} },
    log: function () {},
    applied: null,
    applyBridgeConfig: function (c, tag) { sandbox.applied = { mask: c, tag: tag }; return true; },
  };
  const fns = new Function("State", "log", "applyBridgeConfig",
    "var cfgPathApply = " + fnPath + ";\nvar applyConfigPayload = " + fnApply + ";\n" +
    "var clearDirtyForPaths = " + (fnClear || "function () {}") + ";\n" +
    "return { cfgPathApply: cfgPathApply, applyConfigPayload: applyConfigPayload };");
  let api = null;
  try { api = fns(sandbox.State, sandbox.log, sandbox.applyBridgeConfig); }
  catch (e) { ok(false, "沙箱装载失败:" + (e && e.message)); }
  if (api) {
    ok(typeof api.cfgPathApply === "function" && typeof api.applyConfigPayload === "function", "两个函数可用");
    // 单点路径合并/删除
    const o = { ui: { displayMode: "a", fontSize: 14 } };
    api.cfgPathApply(o, "ui.displayMode", "b");
    ok(o.ui.displayMode === "b", "点路径改值");
    api.cfgPathApply(o, "ui.fontSize", undefined);
    ok(!("fontSize" in o.ui), "点路径删除");
    api.cfgPathApply(o, "chatLog.enabled", true);
    ok(o.chatLog && o.chatLog.enabled === true, "缺失子树自动建");
    // 端到端:桥侧产的差分载荷 → 游戏侧合并
    const base = {
      provider: "bing",
      ui: { displayMode: "bilingual", outgoing: true },
      translateOwn: true,
      chatLog: { enabled: true },
    };
    const next = {
      provider: "openai",
      ui: { displayMode: "translation_only", outgoing: true },
      translateOwn: false,
    };
    sandbox.State.cfgMask = base;
    sandbox.State.cfgRev = "oldfp01";
    const payload = syncData.configDeltaPayload(base, next, "newfp99");
    const applied = api.applyConfigPayload(payload, {});
    ok(applied === true, "applyConfigPayload 返回 true");
    const m = sandbox.applied.mask;
    ok(m.provider === "openai", "合并后 provider 是新值");
    ok(m.ui.displayMode === "translation_only", "合并后 displayMode 是新值");
    ok(m.ui.outgoing === true, "没变的字段保留");
    ok(m.translateOwn === false, "合并后 translateOwn 是新值");
    ok(!("chatLog" in m), "被删掉的子树消失(unset 生效)");
    ok(sandbox.State.cfgRev === "newfp99", "指纹由载荷更新");
    ok(sandbox.State.cfgMask === m, "合并结果留作下一次差分的基准");
    // 全量载荷也走同一条路
    sandbox.State.cfgMask = null;
    const fullPayload = syncData.configFullPayload(next, "newfp99");
    const applied2 = api.applyConfigPayload(fullPayload, {});
    ok(applied2 === true, "全量载荷也能落地");
    ok(sandbox.State.cfgMask.provider === "openai", "全量落地后基准 = 全量内容");
    // 坏载荷不崩、返回 false
    ok(api.applyConfigPayload("not json", {}) === false, "坏载荷返回 false(不抛)");
  }
}

console.log("RESULT: PASS " + pass + " / FAIL " + fail + " / SKIP " + skipped);
process.exit(fail > 0 ? 1 : 0);
