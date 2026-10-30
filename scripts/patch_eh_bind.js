// 一次性补丁:补 RegisterEventHandler("HTMLTitle", panel, ...) 面板专属绑定。
// 根因(10-29 实车):未处理事件总线(RegisterForUnhandledEvent)的 HTMLTitle 派发
// 在 10-29 游戏更新后不再到达;QOL 4.0.5 用的面板专属绑定(RegisterEventHandler)
// 仍工作(其设置保存实证)。两个注册并存:总线兜底 + 面板专属主路。
const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
let t = fs.readFileSync(file, "utf8");
if (t.includes('RegisterEventHandler("HTMLTitle"')) { console.log("already patched"); process.exit(0); }

// ① ensureBridgeEvents 签名加 panel 参数
const oldSig = [
  "  function ensureBridgeEvents() {",
  "  if (State.eventsRegistered) return;",
  "  State.eventsRegistered = true;",
  "  for (let i = 0; i < BRIDGE_EVENT_CANDIDATES.length; i += 1) {",
  "  try {",
  "  $.RegisterForUnhandledEvent(BRIDGE_EVENT_CANDIDATES[i], onBridgeEvent);",
  "  } catch (e) {}",
  "  }",
].join("\r\n");
const newSig = [
  "  function ensureBridgeEvents(panel) {",
  "  if (State.eventsRegistered) return;",
  "  State.eventsRegistered = true;",
  "  for (let i = 0; i < BRIDGE_EVENT_CANDIDATES.length; i += 1) {",
  "  try {",
  "  $.RegisterForUnhandledEvent(BRIDGE_EVENT_CANDIDATES[i], onBridgeEvent);",
  "  } catch (e) {}",
  "  }",
  "  // 面板专属事件绑定(2026-10-30 补,QOL 4.0.5 同款):未处理总线的 HTMLTitle",
  "  // 派发在 10-29 更新后不再到达;RegisterEventHandler 绑定面板对象仍工作。",
  "  if (panel && typeof $.RegisterEventHandler === \"function\") {",
  "    try {",
  "      $.RegisterEventHandler(\"HTMLTitle\", panel, onBridgeEvent);",
  "    } catch (eR) {}",
  "  }",
].join("\r\n");
if (!t.includes(oldSig)) { console.error("sig anchor missing"); process.exit(1); }
t = t.replace(oldSig, newSig);

// ② startHttpsProbe 里传 panel(ensurePanel 之后)
const spAnchor = "    ensureBridgeEvents();\r\n    // 顺序要紧:probePending 先落再启动轮询";
const spAnchor2 = "    ensureBridgeEvents();";
if (t.includes(spAnchor)) {
  t = t.replace(spAnchor, "    ensureBridgeEvents(panel);\r\n    // 顺序要紧:probePending 先落再启动轮询", 1);
} else if (t.includes(spAnchor2)) {
  // 兜底:替换 ensureBridgeEvents(); 的第一处(探针路径)
  const i = t.indexOf("    ensureBridgeEvents();");
  t = t.slice(0, i) + "    ensureBridgeEvents(panel);" + t.slice(i + "    ensureBridgeEvents();".length);
} else { console.error("startHttpsProbe anchor missing"); process.exit(1); }

fs.writeFileSync(file, t, "utf8");
console.log("patched, size=" + t.length);
