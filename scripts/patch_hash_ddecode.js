// 一次性补丁:hash 分支的 d 解析缺 decodeURIComponent。
// bridgePost 把 payload encodeURIComponent 进 job.data(nav 路径靠 URL 参数自动
// 解码);hash 分支直接 JSON.parse(job.data) → 解析必炸 → d={} → 页面 POST 空
// 体 → 桥回 bad_json(模拟环境首测实证)。解码后解析,对未编码输入同样安全。
const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
let t = fs.readFileSync(file, "utf8");
if (t.includes("JSON.parse(decodeURIComponent(job.data)")) { console.log("already patched"); process.exit(0); }

const old1 = "d: job.kind === \"bridge\" ? (function () { try { return JSON.parse(job.data || \"{}\"); } catch (eD) { return {}; } })() :";
const m = t.indexOf(old1);
if (m === -1) { console.error("anchor missing"); process.exit(1); }
const rep = "d: job.kind === \"bridge\" ? (function () { try { return JSON.parse(decodeURIComponent(job.data) || \"{}\"); } catch (eD) { return {}; } })() :";
t = t.replace(old1, rep);
fs.writeFileSync(file, t, "utf8");
console.log("patched, size=" + t.length);
