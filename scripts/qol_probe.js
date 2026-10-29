const { execSync } = require("child_process");
function gh(path) { return JSON.parse(execSync('gh api "' + path + '"', { encoding: "utf8", maxBuffer: 20e6 })); }
// ① QOLLOCK 最新 issues
const issues = gh("repos/civo7/QOLLOCK/issues?state=all&per_page=6&sort=created&direction=desc");
console.log("=== QOLLOCK 最新 issues ===");
issues.forEach(i => console.log("#" + i.number + " [" + i.state + "] " + i.title + " (" + i.created_at.slice(0,10) + ")  PR:" + !!i.pull_request));
// ② qollock-updates 的 bridge.html 提交史
const ch = gh("repos/Predi-i/qollock-updates/commits?path=bridge.html&per_page=5");
console.log("=== bridge.html 提交史 ===");
ch.forEach(c => console.log(c.commit.committer.date + "  " + c.sha.slice(0,8)));
// ③ bridge.html 当前内容的关键特征(ready 信号/协议版本)
const files = gh("repos/Predi-i/qollock-updates/contents/bridge.html");
const html = Buffer.from(files.content, "base64").toString("utf8");
console.log("=== bridge.html 特征 ===");
console.log("大小: " + html.length);
console.log("含 QOL_BRIDGE_READY:frag1: " + html.includes("QOL_BRIDGE_READY:frag1"));
console.log("含 hashchange: " + html.includes("hashchange"));
console.log("含 serviceWorker: " + html.includes("serviceWorker"));
const tm = html.match(/document\.title\s*=\s*'([^']{0,60})/);
console.log("首条 title 写入: " + (tm ? tm[1] : "?"));