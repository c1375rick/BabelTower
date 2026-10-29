// 一次性补丁:bridgePage 页面 JS 的 fetch 透传 query(含 id=probe)——否则
// 桥侧探针轻量分支(id=probe)永不触发,返回全量 1030 字符,title 超限截断。
const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "core", "bridge_server.js");
let t = fs.readFileSync(file, "utf8");
if (t.includes("+'?'+q.toString()")) { console.log("already patched"); process.exit(0); }

const oldJs = "var path='/api/v1/'+(op==='translate'?'translate':op);";
const newJs = "var path='/api/v1/'+(op==='translate'?'translate':op)+(q.toString()?'?'+q.toString():'');";
if (!t.includes(oldJs)) { console.error("anchor missing"); process.exit(1); }
t = t.replace(oldJs, newJs);
fs.writeFileSync(file, t, "utf8");
console.log("patched, size=" + t.length);
