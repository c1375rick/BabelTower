// 一次性补丁:探针结算改事件驱动。
// 实证(2026-10-30 12:40 boot):panel-bound 绑定注册成功后,"bridge online" 出现
// (markBridgeUp 全仓库仅两个调用方:onBridgeEvent 的 TITLE_ALIVE 分支 + pollTitle
// 的属性分支;pollTitle 走 panel.GetTitle() 属性——属性陈旧(10-20 起实测"读属性
// 永远读不到推送包")永远读不到 → "bridge online" 只能来自事件分支)。即:
// 事件已到达、sawAlive 已置,但探针结算只认 pollTitle 的属性轮询 → 6s 必超时。
// 修法:TITLE_ALIVE 事件分支直接结算探针(与 job 的 tryResolveFromText 同一哲学)。
const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
let t = fs.readFileSync(file, "utf8");
if (t.includes("探针结算改事件驱动")) { console.log("already patched"); process.exit(0); }

const m = t.match(/    const t = String\(extractEventText\(a\) \|\| extractEventText\(b\) \|\| ""\);\r?\n    if \(t === TITLE_ALIVE\) \{\r?\n      markBridgeUp\(\);\r?\n      if \(State\.pending\) State\.pending\.sawAlive = true;\r?\n    \}/);
if (!m) { console.error("anchor missing"); process.exit(1); }

const rep = [
  '    const t = String(extractEventText(a) || extractEventText(b) || "");',
  "    if (t === TITLE_ALIVE) {",
  "      markBridgeUp();",
  "      if (State.pending) State.pending.sawAlive = true;",
  "      // 2026-10-30 12:40 boot 实证:事件已到达(bridge online 即本分支打的),但探针",
  "      // 结算只认 pollTitle 的 panel.GetTitle() 属性轮询——属性陈旧永远读不到,6s 必",
  "      // 超时。结算改事件驱动:探针 pending 在手即结算(与 job 的 tryResolveFromText",
  "      // 同一哲学;pollTitle 的属性分支保留兜底)。",
  '      if (State.pending && State.pending.id === "probe") {',
  "        State.navDeadStreak = 0;",
  "        State.navDeadUntil = 0;",
  "        State.pending = null;",
  '        settleProbe(true, "ok");',
  "      }",
  "    }",
].join("\n");

t = t.replace(m[0], rep);
fs.writeFileSync(file, t, "utf8");
console.log("patched, size=" + t.length);
