// 一次性补丁:ensureBridgeEvents 的总线守卫与面板绑定守卫解耦。
// 实证(2026-10-30 12:20 boot):boot() 先调 ensureBridgeEvents()(无 panel,
// L4930"双保险通道")→ State.eventsRegistered=true;探针路径 startHttpsProbe
// 随后调 ensureBridgeEvents(panel) 被 early-return → QOL 同款面板绑定
// (RegisterEventHandler)从未注册。10-29 更新砍掉总线派发后,这条被挡死的
// 绑定是唯一活着的 title 回程通道——必须独立守卫、可补挂。
const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
let t = fs.readFileSync(file, "utf8");
if (t.includes("State.panelBound")) { console.log("already patched"); process.exit(0); }

// 锚定整个函数体(换行无关)
const m = t.match(/function ensureBridgeEvents\(panel\) \{[\s\S]*?\r?\n  \}/);
if (!m) { console.error("function anchor missing"); process.exit(1); }

const rep = [
  "function ensureBridgeEvents(panel) {",
  "    // 总线注册:一次即可(10-29 后总线派发已死,保留兜底)",
  "    if (!State.eventsRegistered) {",
  "      State.eventsRegistered = true;",
  "      for (let i = 0; i < BRIDGE_EVENT_CANDIDATES.length; i += 1) {",
  "        try {",
  "          $.RegisterForUnhandledEvent(BRIDGE_EVENT_CANDIDATES[i], onBridgeEvent);",
  "        } catch (e) {}",
  "      }",
  "      log(\"bridge events registered\");",
  "    }",
  "    // 面板专属绑定:与总线守卫解耦(2026-10-30 12:20 boot 实证)——boot() 先调",
  "    // ensureBridgeEvents()(无 panel)锁死 eventsRegistered,探针路径带 panel",
  "    // 再到时被 early-return 挡死,QOL 同款绑定从未注册。独立守卫 + 可补挂。",
  "    if (panel && typeof $.RegisterEventHandler === \"function\" && !State.panelBound) {",
  "      State.panelBound = true;",
  "      try {",
  "        $.RegisterEventHandler(\"HTMLTitle\", panel, onBridgeEvent);",
  "        log(\"bridge: panel-bound HTMLTitle registered\");",
  "      } catch (eR) {",
  "        log(\"bridge: panel-bound HTMLTitle register FAILED: \" + expErr(eR));",
  "      }",
  "    }",
  "  }",
].join("\n");

t = t.replace(m[0], rep);
fs.writeFileSync(file, t, "utf8");
console.log("patched, size=" + t.length);
