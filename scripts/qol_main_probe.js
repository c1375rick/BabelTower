const { execSync } = require("child_process");
function gh(p) { return JSON.parse(execSync('gh api "' + p + '"', { encoding: "utf8", maxBuffer: 20e6 })); }
// 该分支头 = 10-01 的 5db85d54(已合并进 main? compare behind=83 说明分支落后 main 83 个提交)
// 关键:看分支上 ql_storage_bridge.js 的 fragment 传输实现(main 也已合并)
// 拉 main 的 ql_storage_bridge.js 官方源码,看 title/fragment 协议的最新形态
const f = gh("repos/civo7/QOLLOCK/contents/panorama/scripts/core/ql_storage_bridge.js?ref=main");
const src = Buffer.from(f.content, "base64").toString("utf8");
console.log("main 的 ql_storage_bridge.js: " + src.length + " 字符");
// ① 响应通道(title)
const titleLines = src.split("\n").filter(l => /document\.title|RegisterEventHandler|HTMLTitle/i.test(l));
console.log("=== title 相关行 ===");
titleLines.forEach(l => console.log("  " + l.trim().slice(0, 130)));
// ② fragment 请求构造
const fragLines = src.split("\n").filter(l => /#\s*["']|encodeURIComponent|hashchange/i.test(l));
console.log("=== fragment/hash 相关行 ===");
fragLines.slice(0, 10).forEach(l => console.log("  " + l.trim().slice(0, 130)));
// ③ 有没有 10-28 后的断裂适配(关键词)
console.log("=== 断裂适配关键词检查 ===");
["2026-10-2", "consecutive", "title sync", "title lost", "fallback nav", "HTMLTitle removed"].forEach(k => {
  const hit = src.toLowerCase().includes(k.toLowerCase());
  console.log("  " + k + ": " + hit);
});
// ④ issues 10-25 后的报告
const issues = gh("repos/civo7/QOLLOCK/issues?state=open&per_page=10");
console.log("=== open issues ===");
issues.forEach(i => console.log("  #" + i.number + " " + i.title + " (" + i.created_at.slice(0,10) + ")"));