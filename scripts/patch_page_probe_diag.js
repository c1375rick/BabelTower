// 一次性补丁:bridgePage 的 boot=1 分支加两件诊断(2026-10-30 11:27 boot 后探针仍超时):
//   ① probe-ack 回执:页面 JS 一跑就 fetch 同源 /api/v1/probe-ack —— bridge.log 出现
//      PROBE-ACK 行即实锤"页面 JS 执行了"(与 title 是否到达无关);
//   ② 延迟二次标题写入:lct-alive → lct-x → lct-alive(250ms 间隔)—— 检验
//      "首次 title 写入被吞、后续 title-change 事件正常到达"的时间窗假设。
//      游戏侧 TITLE_ALIVE 是全等匹配,中转串 lct-x 会被安全忽略。
// 判读表:
//   PROBE-ACK ✓ + ALIVE ✓        → 好了(可能 11:27 只是首次写入被吞)
//   PROBE-ACK ✓ + ALIVE ✗        → JS 活、title→Panorama 对我们的面板死 → 面板类型嫌疑(HTML vs CitadelHTMLPanel)
//   PROBE-ACK ✗                  → JS 根本没执行 → 证书/策略仍是主嫌
const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "core", "bridge_server.js");
let t = fs.readFileSync(file, "utf8");
if (t.includes("stage=boot")) { console.log("already patched"); process.exit(0); }

const anchor = "\"window.addEventListener('hashchange',onHash);\",";
if (t.indexOf(anchor) === -1) { console.error("anchor missing"); process.exit(1); }
if (t.split(anchor).length !== 2) { console.error("anchor not unique"); process.exit(1); }

const ackLine = "\"try{fetch('/api/v1/probe-ack?id='+encodeURIComponent(id)+'&ok=1&stage=boot').catch(function(e){});}catch(e){}\",";
const retryLine = "\"setTimeout(function(){try{document.title='lct-x';}catch(e){}setTimeout(function(){try{document.title='lct-alive';}catch(e){}},250);},500);\",";

t = t.replace(anchor, ackLine + "\n" + retryLine + "\n" + anchor);
fs.writeFileSync(file, t, "utf8");
console.log("patched, size=" + t.length);
