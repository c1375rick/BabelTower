// 修复:hash 出站载荷的字段名 target → targetLanguage(桥读 bodyObj.targetLanguage)。
// 同步修诊断日志的 d.target 读取(字段名改了,诊断跟着改)。
const fs = require("fs");
const path = require("path");
const f = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
let t = fs.readFileSync(f, "utf8");
let n = 0;

const old1 = 'target: job.kind === "outgoing" ? resolveOutgoingTarget() : targetLanguage(),';
if (t.includes(old1)) {
  t = t.replace(old1, 'targetLanguage: job.kind === "outgoing" ? resolveOutgoingTarget() : targetLanguage(),');
  n++;
  console.log("hash payload: target → targetLanguage");
} else console.log("payload anchor missing(可能已改)");

// 诊断日志同步:d.target 读取保持一致(读 payload.d.targetLanguage)
const old2 = 'd.target=" + ((payload.d && payload.d.target) || "-")';
if (t.includes(old2)) {
  t = t.replace(old2, 'd.targetLanguage=" + ((payload.d && payload.d.targetLanguage) || "-")');
  n++;
  console.log("dispatch 诊断: d.target → d.targetLanguage");
}

fs.writeFileSync(f, t, "utf8");
console.log("done, edits=" + n);
