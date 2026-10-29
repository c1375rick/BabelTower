const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
let t = fs.readFileSync(file, "utf8");
const re = /(if \(title === TITLE_ALIVE\) \{\r\n      markBridgeUp\(\);\r\n      if \(pending\) pending\.sawAlive = true;\r\n)([\s\S]*?)(      \/\/ [^\r\n]*成功[^\r\n]*\r\n      State\.navDeadStreak = 0;\r\n      State\.navDeadUntil = 0;)/;
if (!re.test(t)) { console.error("pattern missing"); process.exit(1); }
t = t.replace(re, "$1$3\r\n" + [
  "      // 探针(统一槽):见到 lct-alive 即握手成功(boot=1 页面不发 health 单发),立即结算",
  "      if (pending && pending.id === \"probe\") {",
  "        State.pending = null;",
  "        settleProbe(true, \"ok\");",
  "        return;",
  "      }",
].join("\r\n"));
fs.writeFileSync(file, t, "utf8");
console.log("reordered, size=" + t.length);