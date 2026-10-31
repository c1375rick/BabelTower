// T4b 改确定性断言:读最近的 outgoing dispatch 日志的 d.targetLanguage
// (不依赖 bing 成败——bing 只影响译文内容,不影响请求方向)
const fs = require("fs");
const f = __dirname + "/../tests/lc_sim_outgoing_dirty.test.js";
let t = fs.readFileSync(f, "utf8");
const old1 = [
  '    const r4 = await settleOutgoing("你好", "en");',
  '    check("T4b 译文是英文(非 no-op)", !!(r4 && r4.translation && r4.translation !== "你好"),',
  '      "translation=" + JSON.stringify(r4 && r4.translation || null).slice(0, 60));',
].join("\n");
const new1 = [
  '    await settleOutgoing("你好", "en"); // 冒烟:作业走完整链(译文内容依赖 provider,不作断言)',
  "    // 确定性方向锁:派发日志的 d.targetLanguage(en)——字段名回归时它变 -(undefined)",
  "    const lastDispatch = sim.logs.filter(function (l) { return l.indexOf(\"outgoing dispatch\") >= 0; }).pop() || \"\";",
  '    check("T4b 派发载荷 d.targetLanguage=en", lastDispatch.indexOf("d.targetLanguage=en") !== -1,',
  '      lastDispatch.slice(0, 140));',
].join("\n");
if (t.includes(old1)) { t = t.replace(old1, new1); fs.writeFileSync(f, t, "utf8"); console.log("T4b hardened"); }
else { console.log("T4b pattern missing"); process.exit(1); }
