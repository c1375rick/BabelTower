// 一次性补丁:hash 分支先于 buildBridgeUrl 执行,job.id 未赋值——JSON.stringify
// 把 undefined 的 id 整个丢掉,页面守卫 typeof msg.id!=='string' 静默拒收,
// 作业必超时(模拟环境首测实证:frag 里只有 q/op/d,没有 id)。
// 补:hash 分支入口处生成 id(与 buildBridgeUrl 同规则 "r"+seq36)。
const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
let t = fs.readFileSync(file, "utf8");
if (t.includes("hash 分支先于 buildBridgeUrl")) { console.log("already patched"); process.exit(0); }

const m = t.match(/if \(State\.hashReady && State\.hashBase && !forceHttp\) \{\r?\n      const payload = \{/);
if (!m) { console.error("anchor missing"); process.exit(1); }
t = t.replace(m[0],
  "if (State.hashReady && State.hashBase && !forceHttp) {\n" +
  "      // 2026-10-30 模拟环境首测:hash 分支先于 buildBridgeUrl 执行,job.id 尚未赋值,\n" +
  "      // JSON.stringify 会把 undefined 的 id 丢掉 → 页面静默拒收 → 作业必超时。\n" +
  "      if (!job.id) job.id = \"r\" + (++State.requestSeq).toString(36);\n" +
  "      const payload = {");
fs.writeFileSync(file, t, "utf8");
console.log("patched, size=" + t.length);
