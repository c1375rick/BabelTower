// T2b 降级为信息输出:zh-Hans 方向的译文与桥默认值(zh-Hans)不可区分,无法硬断言;
// 方向回归锁在 T4b(中文名 + en 目标 → 译文必须是英文,旧字段名 bug 会让它变 no-op)。
const fs = require("fs");
const f = __dirname + "/../tests/lc_sim_outgoing_dirty.test.js";
let t = fs.readFileSync(f, "utf8");
const old = '    check("T2b 译文非原文(方向生效)", !!(r2 && r2.translation && r2.translation !== "hello"),\n      "translation=" + JSON.stringify(r2 && r2.translation || null).slice(0, 60));';
const neu = '    console.log("  [info] T2b zh-Hans 方向译文(信息项,与桥默认不可区分): " + JSON.stringify(r2 && r2.translation || r2 && r2.error || null));';
if (t.includes(old)) { t = t.replace(old, neu); fs.writeFileSync(f, t, "utf8"); console.log("T2b softened"); }
else console.log("T2b pattern missing");
