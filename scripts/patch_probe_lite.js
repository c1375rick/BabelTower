// 一次性补丁脚本:在 /api/v1/health 端点加"探针轻量响应"分支后即删。
// 背景:CEF document.title 容量 ~1024 字符,全量 health 响应(1030+)超限,
// 探针 title 写回截断 → 游戏 JSON.parse 失败 → 探针恒 bridge_nav_failed(10-29 全天实车)。
const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "core", "bridge_server.js");
let t = fs.readFileSync(file, "utf8");
if (t.includes("探针轻量响应")) { console.log("already patched"); process.exit(0); }
if (!t.includes('if (p === "/api/v1/health") {')) { console.error("anchor missing"); process.exit(1); }

const probeBranch = [
  'if (p === "/api/v1/health") {',
  '    // 探针轻量响应(2026-10-29):CEF 的 document.title 容量 ~1024 字符——全量 health',
  '    // 响应(1030+ 字符,加 sysLang/foreignPaks 后)超限,title 写回被截断 → 游戏',
  '    // JSON.parse 失败 → 探针恒 bridge_nav_failed(10-29 全天实车)。探针只需',
  '    // ok + sysLang + foreignPaks 摘要,≤300 字符安全。完整响应仍服务 /ui。',
  '    if (url.searchParams.get("id") === "probe") {',
  '      const pakL = foreignPakSummary(false);',
  '      return sendJson(res, 200, {',
  '        ok: true,',
  '        version: readLocalVersion() || "unknown",',
  '        sysLang: sysLangPulse.value,',
  '        foreignPaks: { count: pakL.count, duplicates: pakL.duplicates },',
  '      });',
  '    }',
].join("\r\n");

t = t.replace('if (p === "/api/v1/health") {', probeBranch);
fs.writeFileSync(file, t, "utf8");
console.log("patched, size=" + t.length);
