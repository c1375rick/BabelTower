// 修复:撤掉刚才的坏插入行,用展开符重新插入
const fs = require("fs");
const path = require("path");
const f = path.join(__dirname, "..", "core", "bridge_server.js");
let lines = fs.readFileSync(f, "utf8").split("\n");
// 找到坏行(以 "  if (p === \"/api/v1/configsync\") {," 开头的那一行)
const badIdx = lines.findIndex((l) => l.includes('if (p === "/api/v1/configsync") {,'));
if (badIdx === -1) { console.error("bad line not found"); process.exit(1); }
const route = [
  "  if (p === \"/api/v1/configsync\") {",
  "    // 2026-10-31:hash 通道的配置差分读取(此前只有 BTIPC op=config 的 get 分支,",
  "    // 面板通道的 configsync POST 落在无路由端点挂起超时,差分退化为 BTIPC 慢帧)。",
  "    // 与 POST /api/v1/config 的 bodyObj.get 分支同构:get 优先、只读不落盘。",
  "    if (req.method !== \"POST\") {",
  "      sendJson(res, 405, { ok: false, error: \"method_not_allowed\" });",
  "      return;",
  "    }",
  "    if (!bodyObj) return sendJson(res, 400, { ok: false, error: \"bad_json\" });",
  "    if (bodyObj && typeof bodyObj.get === \"string\") {",
  "      sendJson(res, 200, runBtipcGet(bodyObj));",
  "      return;",
  "    }",
  "    sendJson(res, 400, { ok: false, error: \"bad_configsync\" });",
  "    return;",
  "  }",
  ""
];
lines.splice(badIdx, 1, ...route);
fs.writeFileSync(f, lines.join("\n"), "utf8");
console.log("route re-inserted properly at line " + (badIdx + 1));
