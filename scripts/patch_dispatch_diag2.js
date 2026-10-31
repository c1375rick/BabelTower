// 派发时诊断:上下文 ID + hash 派发时刻的目标/flat 值
const fs = require("fs");
const path = require("path");
const f = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
let lines = fs.readFileSync(f, "utf8").split("\n");
let n = 0;

// ① loaded v 日志带 ctxId
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('log("loaded v"') && !lines[i].includes("ctx=")) {
    lines[i] = lines[i].replace(
      'log("loaded v"',
      'if (!State.ctxId) State.ctxId = Math.random().toString(36).slice(2, 6); log("loaded v"'
    );
    lines[i] = lines[i].replace(
      /watching ChatMessages"\);/,
      'watching ChatMessages [ctx=" + State.ctxId + "]");'
    );
    n++;
    break;
  }
}

// ② hash 派发:在 setPending(job.id 之前插派发日志
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('target: job.kind === "outgoing" ? resolveOutgoingTarget() : targetLanguage(),')) {
    let k = i;
    while (k < lines.length && !lines[k].includes("setPending(job.id")) k++;
    if (k < lines.length) {
      const logLines = [
        "      log(\"outgoing dispatch: ctx=\" + State.ctxId + \" flat=\" + State.cfg.outgoingTarget +",
        "        \" payload.target=\" + payload.target + \" mode=\" + (State.cfg.outgoing || \"-\"));",
      ];
      lines.splice(k, 0, ...logLines);
      n++;
    }
    break;
  }
}

fs.writeFileSync(f, lines.join("\n"), "utf8");
console.log("patched " + n);
