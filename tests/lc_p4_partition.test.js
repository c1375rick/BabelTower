// P4a 分区护栏:探针区分家(lingua_chat.js -> lingua_chat_exp.js)的边界、LCTNS 契约、
// 装载与构建链、晚绑定接线(2026-10-12)。评审与证据:docs/p4-partition-review.md。
//
// 分家要点(违反任一即红):
//   ① 边界:核心不再含实验区横幅;探针文件横幅齐全;行数域防再混入;VERSION 只在核心;
//   ② LCTNS 契约双向对账:核心发布名单 == 探针别名导入名单(必须同一份计算,漂移即红);
//      每个导入名必须是核心 indent-2 顶层声明(否则解构得 undefined,运行期才炸);
//      6 个 /bt* 派发入口必须在探针侧发布;
//   ③ 装载与构建链:双 XML 探针 include 晚于主脚本;simtest 双文件 require;build 关键资产在;
//   ④ 晚绑定:核心零裸调探针函数(裸调 = 拆分后 ReferenceError),仅 expCall 字符串派发 ×6;
//      expErr 留核心(settle/boot 路径引用),探针侧只导入不定义。
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const core = fs.readFileSync(path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat.js"), "utf8");
const exp = fs.readFileSync(path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat_exp.js"), "utf8");
const coreLines = core.split(/\r?\n/);
const expLines = exp.split(/\r?\n/);

test("P4a-① 边界:核心无实验区横幅,探针文件横幅齐全,VERSION 留核心", () => {
  assert.ok(core.indexOf("============ EXP") === -1,
    "核心 lingua_chat.js 残留实验区横幅(探针应全部在 lingua_chat_exp.js)");
  const expBanners = (exp.match(/============ EXP/g) || []).length;
  assert.ok(expBanners >= 13, "探针文件实验区横幅不足:" + expBanners + " < 13");
  assert.ok(coreLines.length < 6000,
    "核心行数 " + coreLines.length + " >= 6000,疑被重新混入大块非产品代码");
  assert.ok(expLines.length > 1500,
    "探针文件行数 " + expLines.length + " <= 1500,疑被掏空/截断");
  assert.ok(/^  const VERSION = "/m.test(core), "VERSION 必须留核心(lc_btipc_guard 读此文件)");
  assert.ok(!/^  const VERSION/m.test(exp), "探针文件不得重复声明 VERSION");
});

function parseCorePub() {
  const set = new Set();
  for (const m of core.matchAll(/^  LCTNS\.([A-Za-z_$][\w$]*) = ([A-Za-z_$][\w$]*);\r?$/gm)) {
    assert.strictEqual(m[1], m[2], "核心发布必须同名:" + m[0]);
    set.add(m[1]);
  }
  return set;
}
function parseExpImports() {
  const m = exp.match(/^  const \{ ([^}]+) \} = L;\r?$/m);
  assert.ok(m, "探针文件缺少别名导入行 const { ... } = L;");
  return m[1].split(",").map(s => s.trim()).filter(Boolean);
}
// 2026-10-28(任务②C-1 设置面板拆分):面板文件与探针同法 —— 头部 `const { ... } = L;` 导入宿主符号
function parsePanelImports() {
  const panel = fs.readFileSync(path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat_panel.js"), "utf8");
  const m = panel.match(/^  const \{ ([^}]+) \} = L;\r?$/m);
  assert.ok(m, "面板文件缺少别名导入行 const { ... } = L;");
  return m[1].split(",").map(s => s.trim()).filter(Boolean);
}

test("P4a-② 核心 LCTNS 发布 ⊇ 各消费方别名导入(子集语义,漂移即红)", () => {
  const pub = parseCorePub();
  const imp = parseExpImports();
  const impPanel = parsePanelImports();
  // 2026-10-28(任务②C-1):原断言是"核心发布名单 == 探针导入名单"(deepStrictEqual 双向对账)。
  // 设置面板拆出 lingua_chat_panel.vjs_c 后,核心要向两份消费方发布(面板额外需要
  // saveUiConfig/setStatus/bridgePost/SETTINGS_PANEL_ID/选项表 …),导出名单必然大于单侧导入,
  // 故改为子集语义:① 发布 ⊇ 探针导入;② 发布 ⊇ 面板导入;两侧导入名单各自做顶层声明校验。
  // 漂移(发布漏名字 / 导入写了没发布的名字)仍然当场红。
  assert.ok(pub.size >= 25, "核心发布数过少:" + pub.size);
  const consumers = [["探针", imp], ["面板", impPanel]];
  for (const [who, list] of consumers) {
    for (const n of list) {
      assert.ok(pub.has(n), "核心 LCTNS 未发布 " + n + "(" + who + "文件有导入)");
    }
  }
  for (const [who, list] of consumers) {
    for (const n of list) {
      const reFn = new RegExp("^  (?:async\\s+)?function\\s*\\*?\\s+" + n.replace(/\$/g, "\\$") + "\\b");
      const reVar = new RegExp("^  (?:const|let|var)\\s+" + n.replace(/\$/g, "\\$") + "\\b");
      const isDecl = coreLines.some(l => reFn.test(l) || reVar.test(l));
      assert.ok(isDecl, "导入名 " + n + "(" + who + ")不是核心 indent-2 顶层声明(解构将得到 undefined)");
    }
  }
});

test("P4a-②b 6 个 /bt* 派发入口探针侧全发布且同名", () => {
  const map = new Map();
  for (const m of exp.matchAll(/^  globalThis\.LCTNS\.([A-Za-z_$][\w$]*) = ([A-Za-z_$][\w$]*);\r?$/gm)) {
    map.set(m[1], m[2]);
  }
  const need = ["exp6734cSubmitHook", "runExp6734B", "runExp6734C",
    "runExp6734D", "runExp6734E", "runExp6738"];
  for (const n of need) {
    assert.ok(map.has(n), "探针侧未发布派发入口:" + n);
    assert.strictEqual(map.get(n), n, "发布必须同名:" + n);
  }
});

test("P4a-③ 装载与构建链:双 XML 顺序 / simtest 双文件 / build 关键资产", () => {
  for (const xml of ["chat.xml", "hudchat.xml"]) {
    const s = fs.readFileSync(path.join(ROOT, "mod", "panorama", "layout", xml), "utf8");
    const iMain = s.indexOf("scripts/lingua_chat.vjs_c");
    const iExp = s.indexOf("scripts/lingua_chat_exp.vjs_c");
    assert.ok(iMain > 0, xml + " 缺主脚本 include");
    assert.ok(iExp > iMain,
      xml + ": 探针 include(" + iExp + ")必须晚于主脚本(" + iMain + "),核心先发布 LCTNS");
  }
  const sim = fs.readFileSync(path.join(ROOT, "scripts", "lingua_chat_simtest.js"), "utf8");
  assert.ok(sim.indexOf("require(SCRIPT_EXP)") !== -1,
    "simtest 必须双文件装载(对齐游戏 include 顺序)");
  const build = fs.readFileSync(path.join(ROOT, "scripts", "build.ps1"), "utf8");
  assert.ok(build.indexOf("lingua_chat_exp.vjs_c") !== -1,
    "build.ps1 VPK 关键资产清单须含 lingua_chat_exp.vjs_c");
});

test("P4a-④ 晚绑定:核心零裸调探针函数,expCall 六处,expErr 留核心", () => {
  assert.ok(!/\b(?:runExp67\d+[A-E]?|exp6734cSubmitHook)\s*\(/.test(core),
    "核心仍裸调探针函数(拆分后 = ReferenceError),必须走 expCall 字符串晚绑定");
  const callSites = core.match(/expCall\("/g) || [];
  assert.strictEqual(callSites.length, 6,
    "expCall 派发点应为 6 处,实为 " + callSites.length);
  assert.ok(/function expCall\(name, a, b\)/.test(core), "核心缺 expCall 定义");
  assert.ok(/function expErr\(e\)/.test(core), "expErr 必须留核心(settle/boot 路径引用)");
  assert.ok(!/function expErr\(e\)/.test(exp), "expErr 不应在探针侧定义(应已移入核心)");
});
