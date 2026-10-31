// 一次性补丁:移除 UMM 集成(2026-10-31 用户决定——配置面只留网页 /tr)。
// 范围:① 主文件 UMM 区块(manifest/i18n/apply/bus + registerUmmSettings)
//      ② State.ummRegistered/ummEchoUntil ③ boot 的 registerUmmSettings() 调用
//      ④ tests/umm_integration.test.js + core/umm_bridge.js(仅被该测试引用)
//      ⑤ run-tests.js 条目 ⑥ i18n 头注释更新
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
let n = 0;

// ---- ① 主文件 UMM 区块 ----
const mainPath = path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat.js");
let lines = fs.readFileSync(mainPath, "utf8").split("\n");
const sIdx = lines.findIndex((l) => l.includes("UMM (Universal Mod Manager) 设置联动"));
const eIdx = lines.findIndex((l) => l.includes("消息读取与过滤"));
if (sIdx === -1 || eIdx === -1 || eIdx <= sIdx) { console.error("UMM 区块边界未找到"); process.exit(1); }
const removed = eIdx - sIdx;
lines.splice(sIdx, removed); n++;
console.log("主文件: UMM 区块移除 " + removed + " 行(L" + (sIdx + 1) + "起)");

// ---- ② State 字段 ----
for (const frag of ["ummRegistered: false,", "ummEchoUntil: 0,"]) {
  const i = lines.findIndex((l) => l.includes(frag));
  if (i !== -1) { lines.splice(i, 1); n++; }
}

// ---- ③ boot 调用 ----
const bi = lines.findIndex((l) => l.trim().startsWith("registerUmmSettings();"));
if (bi !== -1) { lines.splice(bi, 1); n++; console.log("boot: registerUmmSettings() 调用已移除"); }

fs.writeFileSync(mainPath, lines.join("\n"), "utf8");

// ---- 残留检查 ----
const after = fs.readFileSync(mainPath, "utf8");
const left = (after.match(/UMM_|onUmmBus|ummCurrent|registerUmmSettings|ummEcho|ummRegistered/g) || []).length;
console.log("主文件 UMM 标识残留: " + left + (left ? " (需人工核查)" : " OK"));
if (left > 0) {
  after.split("\n").forEach((l, i) => {
    if (/UMM_|onUmmBus|ummCurrent|registerUmmSettings|ummEcho|ummRegistered/.test(l)) console.log("  L" + (i + 1) + ": " + l.trim().slice(0, 110));
  });
}

// ---- ④ 测试与参考实现 ----
for (const f of ["tests/umm_integration.test.js", "core/umm_bridge.js"]) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) { fs.unlinkSync(p); n++; console.log("deleted: " + f); }
}

// ---- ⑤ run-tests.js 条目 ----
const rtPath = path.join(ROOT, "tests", "run-tests.js");
let rt = fs.readFileSync(rtPath, "utf8");
if (rt.includes('"tests/umm_integration.test.js",')) {
  rt = rt.replace('  "tests/umm_integration.test.js",\n', "");
  fs.writeFileSync(rtPath, rt, "utf8"); n++;
  console.log("run-tests.js: entry removed");
}

// ---- ⑥ i18n 头注释 ----
const i18nPath = path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat_i18n.js");
let i18n = fs.readFileSync(i18nPath, "utf8");
if (i18n.includes("UMM_SETTINGS")) {
  i18n = i18n.replace(
    /\/\/ 注意:UMM_SETTINGS[\s\S]*?umm_integration\.test\.js[^\n]*\n?/g,
    ""
  );
  fs.writeFileSync(i18nPath, i18n, "utf8"); n++;
  console.log("i18n: header comment updated");
}
console.log("done, edits=" + n);
