// no-op 分支的 UX 防呆:detected == outgoingTarget 时,给出可行动提示
// (2026-10-31 实证:用户把发送目标语言设成 zh-Hans 后打中文,静默 no-op 被当成"失效/整反")
const fs = require("fs");
const f = require("path").join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
let lines = fs.readFileSync(f, "utf8").split("\n");
let n = 0;
for (let i = 0; i < lines.length; i++) {
  if (!lines[i].includes('log("outgoing: no-op (translation === original), sending original");')) continue;
  // 找到该分支的 setStatus 行(其后的 "翻译结果与原文相同,按原文发送")
  const si = lines.findIndex((l, k) => k > i && l.includes("翻译结果与原文相同") && k < i + 4);
  if (si === -1) continue;
  const indent = "          ";
  const repl = [
    "          // 2026-10-31 UX 防呆:detected == 发送目标语言时,静默 no-op 会被当成\"失效\"。",
    "          // 给出可行动提示,让用户知道去改「发送目标语言」。",
    "          const ot = resolveOutgoingTarget();",
    "          if (detected && ot && detected === ot) {",
    "            setStatus(\"发送目标语言(\" + ot + \")与输入语言相同,未翻译——要译成其他语言请在设置改「发送目标语言」\");",
    "          } else {",
    "            setStatus(\"翻译结果与原文相同,按原文发送\");",
    "          }",
  ].join("\n");
  lines[si] = repl;
  n++;
  break;
}
fs.writeFileSync(f, lines.join("\n"), "utf8");
console.log("patched " + n + " spot(s)");
