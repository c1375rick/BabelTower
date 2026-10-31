// 诊断增强:outgoing 派发日志带方向来源(tgt/cfg.tgt/ui.tgt 三个来源同框)
const fs = require("fs");
const path = require("path");
const f = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
let lines = fs.readFileSync(f, "utf8").split("\n");
let n = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('"outgoing mode=" + outgoingMode') && lines[i].includes("send.slice(0, 80)")) {
    lines[i] = lines[i].replace(
      '" -> " + send.slice(0, 80));',
      '" -> " + send.slice(0, 80) + " [tgt=" + (State.cfg.outgoingTarget || "-") + " ui.tgt=" + ((State.cfg.ui && State.cfg.ui.outgoingTarget) || "-") + " res=" + resolveOutgoingTarget() + "]");'
    );
    n++;
    break;
  }
}
fs.writeFileSync(f, lines.join("\n"), "utf8");
console.log("patched " + n);
