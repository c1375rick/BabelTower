// 测试适配:① cfg_sync_guard 的 pickLang 行序断言容忍新增的推桥块 ② cfg_delta_sync
// 沙箱补 clearDirtyForPaths 注入(applyConfigPayload 的新依赖)。
const fs = require("fs");
let n = 0;

// ① cfg_sync_guard.test.js
const guardF = __dirname + "/../tests/cfg_sync_guard.test.js";
let g = fs.readFileSync(guardF, "utf8");
const oldGuard = 'ok(/markCfgDirty\\(field\\);\\s*\\n\\s*saveUiConfig\\(\\);\\s*\\n\\s*closeSelectMenus\\(\\);\\s*\\n\\s*log\\("pickLang:/.test(lc), "pickLang 置脏");';
const newGuard = '// 2026-10-31:pickLang 在 saveUiConfig 后新增推桥块(推桥+清 dirty),行序断言放宽\nok(/markCfgDirty\\(field\\);\\s*\\n\\s*saveUiConfig\\(\\);\\s*\\n[\\s\\S]*?closeSelectMenus\\(\\);\\s*\\n\\s*log\\("pickLang:/.test(lc), "pickLang 置脏(含推桥块)");\nok(/pick persist: 推桥同步/.test(lc), "pickLang 推桥块存在");';
if (g.includes(oldGuard)) { g = g.replace(oldGuard, newGuard); n++; console.log("guard: pickLang 断言已放宽"); }
else console.log("guard: pickLang 断言未匹配(跳过)");
fs.writeFileSync(guardF, g, "utf8");

// ② cfg_delta_sync.test.js
const deltaF = __dirname + "/../tests/cfg_delta_sync.test.js";
let d = fs.readFileSync(deltaF, "utf8");
const old1 = 'const fnApply = extractFn(lc, "applyConfigPayload");';
const new1 = 'const fnApply = extractFn(lc, "applyConfigPayload");\nconst fnClear = extractFn(lc, "clearDirtyForPaths");';
if (d.includes(old1) && !d.includes("fnClear")) { d = d.replace(old1, new1); n++; }
const old2 = '  const fns = new Function("State", "log", "applyBridgeConfig",\n    "var cfgPathApply = " + fnPath + ";\\nvar applyConfigPayload = " + fnApply + ";\\n" +\n    "return { cfgPathApply: cfgPathApply, applyConfigPayload: applyConfigPayload };");';
const new2 = '  const fns = new Function("State", "log", "applyBridgeConfig",\n    "var cfgPathApply = " + fnPath + ";\\nvar applyConfigPayload = " + fnApply + ";\\n" +\n    "var clearDirtyForPaths = " + (fnClear || "function () {}") + ";\\n" +\n    "return { cfgPathApply: cfgPathApply, applyConfigPayload: applyConfigPayload };");';
if (d.includes(old2)) { d = d.replace(old2, new2); n++; console.log("delta: 沙箱已注入 clearDirtyForPaths"); }
else console.log("delta: Function 构造未匹配(跳过)");
fs.writeFileSync(deltaF, d, "utf8");
console.log("done, edits=" + n);
