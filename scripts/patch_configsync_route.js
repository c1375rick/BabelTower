// 桥侧补丁:POST /api/v1/configsync 路由(面板通道的配置差分读取)。
// 实证(模拟+实车):游戏的 configsync 作业经 hash 通道 → 页面 POST /api/v1/configsync
// → 无路由挂起超时 → 差分退化为 BTIPC 慢帧。桥的差分读取本来就挂在
// POST /api/v1/config 的 bodyObj.get 分支——补一个同构的 configsync 路由。
const fs = require("fs");
const path = require("path");
const f = path.join(__dirname, "..", "core", "bridge_server.js");
let lines = fs.readFileSync(f, "utf8").split("\n");
let n = 0;
const anchorIdx = lines.findIndex((l) => l.includes('if (p === "/api/v1/version-check") {'));
if (anchorIdx === -1) { console.error("anchor missing"); process.exit(1); }
let insertAt = anchorIdx;
while (insertAt > 0 && lines[insertAt - 1].trim() === "") insertAt--;
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
].join("\n");
lines.splice(insertAt, 0, route.split("\n"));
n++;
fs.writeFileSync(f, lines.join("\n"), "utf8");
console.log("route added before version-check, edits=" + n);
