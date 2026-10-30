// 一次性补丁:bridgePage 的 onHash 声明 lastH(模拟环境首测抓到的致命 bug)。
// `msg.q===lastH` 读取从未声明的 lastH → ReferenceError → onHash 每次都在
// fetch 之前死掉 → hash 请求永远得不到响应(页面由桥提供,https 代理同一份,
// 属生产 bug 而非模拟器特有)。
const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "core", "bridge_server.js");
let t = fs.readFileSync(file, "utf8");
if (t.includes("var lastH=null;")) { console.log("already patched"); process.exit(0); }

const anchor = '"function onHash(){",';
if (t.indexOf(anchor) === -1) { console.error("anchor missing"); process.exit(1); }
if (t.split(anchor).length !== 2) { console.error("anchor not unique"); process.exit(1); }
t = t.replace(anchor, '"function onHash(){var lastH=null;",');
fs.writeFileSync(file, t, "utf8");
console.log("patched, size=" + t.length);
