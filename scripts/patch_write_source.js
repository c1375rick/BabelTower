// 桥侧诊断:POST /api/v1/config 的写入来源记录(2026-10-31 方向错乱排查)。
const fs = require("fs");
const path = require("path");
const f = path.join(__dirname, "..", "core", "bridge_server.js");
let lines = fs.readFileSync(f, "utf8").split("\n");
let n = 0;
const si = lines.findIndex((l) => l.includes("config saved"));
if (si === -1) { console.error("config saved log line not found"); process.exit(1); }
const diag = [
  "      // 2026-10-31 诊断:写入来源(方向错乱排查——上次两次写入来源不明)",
  "      try {",
  "        const ua = String(req.headers[\"user-agent\"] || \"-\").slice(0, 60);",
  "        const ref = String(req.headers[\"referer\"] || \"-\").slice(0, 60);",
  "        const opf = obj && obj.op ? String(obj.op) : (obj && obj.config ? \"web-form\" : \"?\");",
  "        const uiFields = obj && obj.config && obj.config.ui ? Object.keys(obj.config.ui).join(\",\") : (obj && obj.config ? Object.keys(obj.config).join(\",\") : \"-\");",
  "        log(\"info\", \"config WRITE source: op=\" + opf + \" uiFields=[\" + uiFields + \"] UA=\" + ua + \" ref=\" + ref);",
  "      } catch (eD) {}",
].join("\n");
lines.splice(si, 0, diag);
n++;
fs.writeFileSync(f, lines.join("\n"), "utf8");
console.log("patched " + n + " (bridge_server.js)");
