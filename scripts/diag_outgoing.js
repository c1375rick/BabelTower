// 诊断:outgoing 选项的三处状态源——UI_OPEN 构造 / OUTGOING_MODES 取值 / cfg 映射
const fs = require("fs");
const main = fs.readFileSync("mod/panorama/scripts/lingua_chat.js", "utf8");
const i18n = fs.readFileSync("mod/panorama/scripts/lingua_chat_i18n.js", "utf8");
const lines = main.split("\n");

function show(tag, idx, before, after) {
  console.log("=== " + tag + " (L" + (idx + 1) + ") ===");
  for (let i = Math.max(0, idx - before); i <= Math.min(lines.length - 1, idx + after); i++) {
    console.log("L" + (i + 1) + ": " + lines[i].replace(/\s+$/, ""));
  }
}

// ① UI_OPEN 构造
const uiOpen = lines.findIndex((l) => l.includes("UI_OPEN"));
if (uiOpen >= 0) show("UI_OPEN 构造", uiOpen, 8, 3);
else console.log("UI_OPEN 未在主文件(可能在 panel 文件)");

// ② OUTGOING_MODES 在 i18n 的取值
const m = i18n.match(/OUTGOING_MODES[\s\S]{0,200}/);
console.log("=== i18n OUTGOING_MODES ===\n" + (m ? m[0] : "(未找到)"));

// ③ 主文件里所有 .outgoing / outgoing 的读写点
console.log("=== outgoing 引用点 ===");
lines.forEach((l, i) => {
  if (/outgoing/i.test(l) && !/^\s*\/\//.test(l)) {
    console.log("L" + (i + 1) + ": " + l.trim().slice(0, 110));
  }
});
