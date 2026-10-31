// 模拟测试配置模板补 ui.outgoing=bilingual(缺了它 mode=off,出站流程不启用)
const fs = require("fs");
const f = __dirname + "/../tests/lc_sim_outgoing_dirty.test.js";
let t = fs.readFileSync(f, "utf8");
const needle = 'outgoingTarget: "en", targetLanguage: "zh-Hans", force: false, timeoutMs: 15000 },';
if (!t.includes(needle)) { console.error("needle missing"); process.exit(1); }
if (t.includes('outgoing: "bilingual", outgoingTarget: "en"')) { console.log("already present"); process.exit(0); }
t = t.split(needle).join('outgoing: "bilingual", ' + needle);
fs.writeFileSync(f, t, "utf8");
console.log("template fixed");
