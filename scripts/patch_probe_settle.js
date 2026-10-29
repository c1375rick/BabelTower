const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
let t = fs.readFileSync(file, "utf8");
if (t.includes("pending.id === \"probe\"")) { console.log("already patched"); process.exit(0); }
const oldBlk = [
  "    if (title === TITLE_ALIVE) {",
  "      markBridgeUp();",
  "      if (pending) pending.sawAlive = true;",
].join("\r\n");
const newBlk = [
  "    if (title === TITLE_ALIVE) {",
  "      markBridgeUp();",
  "      if (pending) pending.sawAlive = true;",
  "      // 探针(统一槽):见到 lct-alive 即握手成功(boot=1 页面不发 health 单发),立即结算",
  "      if (pending && pending.id === \"probe\") {",
  "        State.pending = null;",
  "        settleProbe(true, \"ok\");",
  "        return;",
  "      }",
].join("\r\n");
if (!t.includes(oldBlk)) { console.error("anchor missing"); process.exit(1); }
t = t.replace(oldBlk, newBlk);
fs.writeFileSync(file, t, "utf8");
console.log("patched, size=" + t.length);