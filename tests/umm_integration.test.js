// UMM 集成离线测试:客户端同步块与 core 参考实现的行为对账 + 协议语义断言。
// 客户端 lingua_chat.js 内 @sync umm-manifest / umm-apply / umm-bus 块在沙箱执行,
// 与 core/umm_bridge.js 逐用例比对 —— 副本漂移当场爆红。
// 跑法: node tests/umm_integration.test.js
"use strict";
const fs = require("fs");
const path = require("path");

const CLIENT_SRC = fs.readFileSync(
  path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js"), "utf8");
const umm = require("../core/umm_bridge.js");

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS |", label); }
  else { fail++; console.log("  FAIL |", label); }
}

// ---------- 从客户端源码提取 @sync 块 ----------
function extractBlock(beginMarker, endMarker) {
  const b = CLIENT_SRC.indexOf(beginMarker);
  const e = CLIENT_SRC.indexOf(endMarker, b);
  if (b < 0 || e < 0) return null;
  return CLIENT_SRC.slice(b, e + endMarker.length);
}

// 剥掉标记行(整行删除,行尾的说明文字不能残留在沙箱代码里)
function stripMarkers(block) {
  return block.replace(/^.*\/\/ @sync-(begin|end)[^\n]*\n/gm, "");
}

const manifestBlock = extractBlock("// @sync-begin umm-manifest", "// @sync-end umm-manifest");
const i18nBlock = extractBlock("// @sync-begin umm-i18n", "// @sync-end umm-i18n");
const applyBlock = extractBlock("// @sync-begin umm-apply", "// @sync-end umm-apply");
const busBlock = extractBlock("// @sync-begin umm-bus", "// @sync-end umm-bus");

if (!manifestBlock || !applyBlock || !busBlock || !i18nBlock) {
  console.error("FAIL: cannot extract @sync umm blocks from lingua_chat.js (markers missing?)");
  process.exit(1);
}

// 客户端 UI_DEFAULTS 桩(与 lingua_chat.js 内实际声明同值)
const UI_DEFAULTS_STUB = {
  enabled: true, provider: "bing", displayMode: "bilingual", outgoing: "off",
  outgoingTarget: "en", targetLanguage: "zh-Hans", force: false, timeoutMs: 15000,
  chatLog: true, translateOwn: true, uiLang: "zh",
};

// ---------- 1. manifest 对账 ----------
console.log("\n== manifest 对账 ==");
let clientConsts = null;
try {
  const mf = new Function(
    "State", "UI_DEFAULTS", "log",
    stripMarkers(manifestBlock) +
    "\nreturn { UMM_CHANNEL, UMM_PROTOCOL, UMM_ID, UMM_NAME, UMM_SETTINGS, UMM_MANAGED_KEYS, ummCurrentValues };"
  );
  clientConsts = mf({ cfg: UI_DEFAULTS_STUB }, UI_DEFAULTS_STUB, function () {});
  ok(true, "客户端 manifest 块沙箱执行成功");
} catch (e) {
  ok(false, "客户端 manifest 块沙箱执行失败: " + e.message);
}
ok(clientConsts && JSON.stringify(clientConsts.UMM_SETTINGS) === JSON.stringify(umm.UMM_SETTINGS),
  "UMM_SETTINGS 与 core 副本逐字一致(JSON.stringify 相等)");
ok(clientConsts && clientConsts.UMM_ID === umm.UMM_ID && clientConsts.UMM_CHANNEL === umm.UMM_CHANNEL,
  "UMM_ID / UMM_CHANNEL 与 core 一致");
// 清单合法性: id 唯一、select 有 options 且 default 在 options 里、group 无 id
(function validateManifest() {
  const seen = {};
  let valid = true;
  const list = umm.UMM_SETTINGS;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.type === "group") { if (s.id || s.default) valid = false; continue; }
    if (!s.id || seen[s.id]) { valid = false; break; }
    seen[s.id] = true;
    if (s.type === "select") {
      if (!Array.isArray(s.options) || !s.options.length) { valid = false; break; }
      const vals = s.options.map((o) => o.value);
      if (vals.indexOf(s.default) === -1) { valid = false; break; }
    }
  }
  ok(valid, "清单结构合法: id 唯一 / select default 在 options 内 / group 无值");
})();
ok(!Object.prototype.hasOwnProperty.call(umm.UMM_MANAGED_KEYS, "apiKey"),
  "API Key 不在 UMM 托管键内(机密不进明文广播通道)");

// ---------- 2. evaluateUmmBus 对账(协议裁决) ----------
console.log("\n== 总线裁决 ==");
const CASES = [
  [JSON.stringify({ umm: 1, t: "hello" }), { kind: "announce" }],
  [JSON.stringify({ umm: 1, t: "set", id: "babeltower", key: "enabled", value: false }),
    { kind: "apply", key: "enabled", value: false }],
  [JSON.stringify({ umm: 2, t: "hello" }), null],                // 协议版本不符
  [JSON.stringify({ t: "hello" }), null],                        // 无 umm 字段(其它 mod 流量)
  ["not json", null],                                            // 非 JSON
  [JSON.stringify({ umm: 1, t: "set", id: "other_mod", key: "enabled", value: true }), null], // 他人 mod 的 set
  [JSON.stringify({ umm: 1, t: "reset", id: "babeltower" }), null], // 未知类型忽略
];
for (const [payload, expected] of CASES) {
  const c = umm.evaluateUmmBus(payload);
  ok(JSON.stringify(c) === JSON.stringify(expected), "core 裁决: " + payload.slice(0, 46) + "...");
}
ok(umm.evaluateUmmBus(JSON.stringify({ t: "set", id: "babeltower", key: "enabled", value: 1 })) === null,
  "无 umm 标记的他人消息不进解析");

// 客户端 onUmmBus 同输入同裁决(用可观察副作用: announce/apply 调用桩)
(function () {
  const saved = [], posts = [];
  const bus = new Function(
    "UMM_PROTOCOL", "UMM_ID", "ummAnnounce", "applyUmmSetting", "log",
    stripMarkers(busBlock) + "\nreturn onUmmBus;"
  )(
    1, "babeltower",
    function () { saved.push("announce"); },
    function (key, value) { posts.push([key, value]); return true; },
    function () {}
  );
  bus(JSON.stringify({ umm: 1, t: "hello" }));
  bus(JSON.stringify({ umm: 1, t: "set", id: "babeltower", key: "timeoutMs", value: 9000 }));
  ok(saved.length === 1 && posts.length === 1 && posts[0][0] === "timeoutMs" && posts[0][1] === 9000,
    "客户端 onUmmBus: hello 触发重报 / set 交给 apply");
  bus("plain text");
  bus(JSON.stringify({ umm: 9, t: "hello" }));
  bus(JSON.stringify({ umm: 1, t: "set", id: "other_mod", key: "enabled", value: true }));
  ok(saved.length === 1 && posts.length === 1, "客户端 onUmmBus: 非 UMM 流量与他人 set 零副作用");
})();

// ---------- 3. applyUmmSettingCore 行为(core 侧) ----------
console.log("\n== 单键应用 ==");
(function () {
  const cfg = { enabled: true, provider: "bing", targetLanguage: "zh-Hans", displayMode: "bilingual",
    outgoing: "off", outgoingTarget: "en", force: false, timeoutMs: 15000,
    translateOwn: true, chatLog: true };
  let r = umm.applyUmmSettingCore(cfg, "enabled", false);
  ok(r.accepted && cfg.enabled === false && r.patch.enabled === false, "toggle: enabled=false 落位并产出桥补丁");
  ok(r.patch.ui && r.patch.ui.enabled === false, "toggle: ui 镜像形态同时产出(防面板 GET 覆盖)");
  r = umm.applyUmmSettingCore(cfg, "targetLanguage", "ja");
  ok(r.accepted && cfg.targetLanguage === "ja" && r.patch.targetLanguage === "ja" && r.patch.ui.targetLanguage === "ja",
    "select: targetLanguage 双形态补丁(扁平 + ui 子对象)");
  r = umm.applyUmmSettingCore(cfg, "chatLog", false);
  ok(r.accepted && !r.patch.ui, "chatLog: 桥端无 ui 镜像,仅布尔形态");
  r = umm.applyUmmSettingCore(cfg, "provider", "deepl");
  ok(r.accepted && cfg.provider === "deepl", "select: provider 枚举内值接受");
  r = umm.applyUmmSettingCore(cfg, "provider", "nonsense");
  ok(!r.accepted && cfg.provider === "deepl", "select: 枚举外值拒绝且不改状态");
  r = umm.applyUmmSettingCore(cfg, "timeoutMs", 8000);
  ok(r.accepted && cfg.timeoutMs === 8000, "slider: 合法范围接受");
  r = umm.applyUmmSettingCore(cfg, "timeoutMs", 100);
  ok(!r.accepted && cfg.timeoutMs === 8000, "slider: 越下界拒绝");
  r = umm.applyUmmSettingCore(cfg, "timeoutMs", 999999);
  ok(!r.accepted, "slider: 越上界拒绝");
  r = umm.applyUmmSettingCore(cfg, "unknownKey", 1);
  ok(!r.accepted, "未知键拒绝");
  r = umm.applyUmmSettingCore(cfg, "enabled", undefined);
  ok(!r.accepted, "undefined 值拒绝");
  r = umm.applyUmmSettingCore(cfg, "provider", 42);
  ok(!r.accepted, "select 值类型校验(非字符串拒绝)");
})();

// ---------- 4. 客户端 applyUmmSetting 同行为 + 桥推送 ----------
console.log("\n== 客户端应用(含桥推送) ==");
(function () {
  const st = { cfg: null };
  const posts = [];
  const apply = new Function(
    "State", "UI_DEFAULTS", "saveUiConfig", "bridgePost", "log", "nowMs",
    stripMarkers(manifestBlock) + "\n" + stripMarkers(applyBlock) + "\nreturn applyUmmSetting;"
  )(
    st, UI_DEFAULTS_STUB,
    function () { st.saved = true; },
    function (op, data, cb) { posts.push({ op, cfg: (data && data.config) || null }); if (cb) cb({ ok: true }); },
    function () {},
    function () { return st.__now || 0; }
  );
  ok(apply("enabled", false) === true && st.cfg.enabled === false && st.saved === true,
    "客户端: enabled=false 落位并持久化(saveUiConfig 被调)");
  ok(posts.length === 1 && posts[0].op === "config" && posts[0].cfg.enabled === false,
    "客户端: 单键补丁经 bridgePost(config) 推桥");
  ok(apply("timeoutMs", 12000) === true && st.cfg.timeoutMs === 12000 && posts[1].cfg.timeoutMs === 12000,
    "客户端: timeoutMs 推桥值一致");
  ok(apply("chatLog", false) === true && posts[2].cfg.chatLog === false,
    "客户端: chatLog 布尔形态推桥(applyMaskedUpdate 布尔分支)");
  ok(apply("targetLanguage", "ja") === true && posts[3].cfg.targetLanguage === "ja" && posts[3].cfg.ui && posts[3].cfg.ui.targetLanguage === "ja",
    "客户端: targetLanguage 双形态推桥(扁平 + ui 子对象)");
  ok(apply("provider", "not_a_provider") === false && st.cfg.provider === "bing" && posts.length === 4,
    "客户端: 枚举外值拒绝且不推桥");
  ok(apply("apiKey", "sk-evil") === false && posts.length === 4,
    "客户端: apiKey 不受 UMM set 影响(托管键白名单)");
  st.cfg = null; // cfg 未初始化时 set 不应崩(boot 极早期到达的 set)
  ok(apply("force", true) === true, "客户端: State.cfg 未初始化时 set 也能落位");
  // 吸收窗: UMM 每次 announce 后的存档回放扫荡,整体忽略 ——
  // 否则每次 hello 都会用 UMM 存档刷掉 State.cfg,行为只跟 UMM 不跟 /tr(2026-09-25 实锢)
  const before = posts.length;
  const beforeCfgJson = JSON.stringify(st.cfg);
  st.__now = 1000; st.ummEchoUntil = 5000;
  ok(apply("targetLanguage", "ja") === true && JSON.stringify(st.cfg) === beforeCfgJson,
    "吸收窗: 回放 set 完全忽略(状态不变)");
  ok(posts.length === before, "吸收窗: 不回推桥");
  st.__now = 6000;
  ok(apply("targetLanguage", "ko") === true && st.cfg.targetLanguage === "ko" && posts.length === before + 1 && posts[posts.length - 1].cfg.targetLanguage === "ko",
    "窗口外: 正常应用并双形态推桥");
})();

// ---------- 5. values 上报(当前值收编,不跑默认值循环) ----------
console.log("\n== values 上报 ==");
(function () {
  const values = umm.ummCurrentValuesCore({ enabled: false, provider: "deepl", timeoutMs: 8000, uiLang: "zh" });
  ok(values.enabled === false && values.provider === "deepl" && values.timeoutMs === 8000,
    "core: values 反映当前配置而非声明默认值");
  ok(!Object.prototype.hasOwnProperty.call(values, "uiLang"),
    "core: 清单外键不上报");
  ok(Object.keys(umm.ummCurrentValuesCore(null)).length === 0, "core: cfg 为空返回空 values");
  const cf = new Function(
    "State", "UI_DEFAULTS",
    stripMarkers(manifestBlock) + "\nreturn ummCurrentValues;"
  )({ cfg: { enabled: false, provider: "deepl", timeoutMs: 8000 } }, UI_DEFAULTS_STUB);
  const cv = cf();
  ok(cv.enabled === false && cv.provider === "deepl" && cv.timeoutMs === 8000,
    "客户端: ummCurrentValues 同语义");
})();

// ---------- 6. registerUmmSettings 不套默认值 ----------
console.log("\n== 注册语义 ==");
(function () {
  // 静态确认: registerUmmSettings 函数体内不得出现默认值应用循环的特征。
  // LCT 有自己的持久化,未装 UMM 时跑默认值循环 = 每次启动打回出厂(设计红线)。
  const m = CLIENT_SRC.match(/function registerUmmSettings\(\)[\s\S]*?\n  \}/);
  ok(!!m, "registerUmmSettings 存在");
  ok(m && m[0].indexOf("default") === -1 && m[0].indexOf("applySetting(") === -1,
    "注册路径不套声明默认值(未装 UMM 时不覆盖用户配置)");
  ok(m && m[0].indexOf("ummAnnounce") !== -1 && m[0].indexOf("RegisterForUnhandledEvent") !== -1,
    "注册路径只做: 事件注册 + manifest 广播");
})();

// ---------- 7. 标签本地化(中文界面显示中文,存储不随 label 变) ----------
console.log("\n== 标签本地化 ==");
(function () {
  // core 侧行为断言
  const zh = umm.localizeUmmManifest(umm.UMM_SETTINGS, "zh");
  const en = umm.localizeUmmManifest(umm.UMM_SETTINGS, "en");
  ok(en === umm.UMM_SETTINGS, "core: 非中文语言直接返回原清单(无克隆)");
  const g = zh.find((s) => s.type === "group");
  ok(g && g.label === "翻译", "core: group 标签中文化");
  const prov = zh.find((s) => s.id === "provider");
  ok(prov.label === "服务商", "core: 设置标签中文化");
  ok(prov.default === "bing" && prov.options.some((o) => o.value === "bing" && o.label === "Bing(免费)"),
    "core: option 值/默认不变,仅换展示文本");
  const origProv = umm.UMM_SETTINGS.find((s) => s.id === "provider");
  ok(origProv.label === "Provider", "core: 原清单未被修改(纯函数)");
  // 客户端副本同行为(注意中文映射表里 targetLanguage/outgoingTarget 的 option 不做翻译,
  // 本身就是各语言自称,与 core 同源)
  const cf = new Function(
    stripMarkers(i18nBlock) + "\nreturn localizeUmmManifest;"
  )();
  const czh = cf(clientConsts ? clientConsts.UMM_SETTINGS : umm.UMM_SETTINGS, "zh");
  const cprov = czh.find((s) => s.id === "provider");
  ok(cprov && cprov.label === "服务商" && cprov.options.some((o) => o.label === "Bing(免费)"),
    "客户端: localizeUmmManifest 同语义");
  ok(clientConsts && JSON.stringify(cf(umm.UMM_SETTINGS, "zh")) === JSON.stringify(zh),
    "客户端副本与 core 输出逐字一致");
})();

console.log("\nRESULT: PASS " + pass + " / FAIL " + fail);
process.exit(fail ? 1 : 0);
