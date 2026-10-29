const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
let t = fs.readFileSync(file, "utf8");
const oldBlk = [
  "  function settleProbe(ok, err) {",
  "    const probe = State.probePending;",
  "    State.probePending = null;",
  "    State.httpsPanelStreak = 0;",
].join("\r\n");
const newBlk = [
  "  function settleProbe(ok, err) {",
  "    State.httpsPanelStreak = 0;",
].join("\r\n");
if (!t.includes(oldBlk)) { console.error("settleProbe anchor missing"); process.exit(1); }
t = t.replace(oldBlk, newBlk);
t = t.replace("      State.hashBase = (State.probePending && State.probePending.navUrl) || State.hashBase;",
              "      State.hashBase = (State.pending && State.pending.navUrl) || State.hashBase;");
t = t.replace(/    probeLastAt: 0, [^\r\n]*\r?\n/, "");
t = t.replace("      State.probeLastAt = nowMs();", "");
t = t.replace("    if (!HTTPS_PANEL_ENABLED || State.probePending) return;", "    if (!HTTPS_PANEL_ENABLED) return;");
fs.writeFileSync(file, t, "utf8");
console.log("settleProbe unified, size=" + t.length);