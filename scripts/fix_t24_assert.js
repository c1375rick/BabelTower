// 修 T2b/T4b 的 undefined.slice 崩溃
const fs = require("fs");
const f = __dirname + "/../tests/lc_sim_outgoing_dirty.test.js";
let t = fs.readFileSync(f, "utf8");
t = t.split("JSON.stringify(r2 && r2.translation).slice(0, 60)").join("JSON.stringify(r2 && r2.translation || null).slice(0, 60)");
t = t.split("JSON.stringify(r4 && r4.translation).slice(0, 60)").join("JSON.stringify(r4 && r4.translation || null).slice(0, 60)");
fs.writeFileSync(f, t, "utf8");
console.log("fixed");
