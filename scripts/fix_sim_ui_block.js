// 模拟测试配置模板补 ui 块(缺了它 ui.outgoing 默认 off,出站流程不启用)
const fs = require("fs");
const f = __dirname + "/../tests/lc_sim_outgoing_dirty.test.js";
let t = fs.readFileSync(f, "utf8");
const needle = '    port: PORT, provider: "bing", logFile: simLog, chatLog: { enabled: false },';
if (!t.includes(needle)) { console.error("needle missing"); process.exit(1); }
if (t.includes('ui: { outgoing: "bilingual"')) { console.log("already"); process.exit(0); }
t = t.replace(needle, needle + "\n    ui: { outgoing: \"bilingual\", outgoingTarget: \"en\", targetLanguage: \"zh-Hans\" },");
fs.writeFileSync(f, t, "utf8");
console.log("template: ui block added");
