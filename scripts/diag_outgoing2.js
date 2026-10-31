// 诊断:① /ui 页面的 outgoing 选项映射(UI 代码在哪、option 顺序) ② 游戏侧 cfg 同步的
// ui 块扁平化(applyConfigPayload 对 ui.outgoingTarget 的处理) ③ dispatch 的 mode 来源
const fs = require("fs");
const path = require("path");

// ① 找 /ui 页面文件
function walk(dir, out) {
  out = out || [];
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const coreFiles = walk("core").filter((p) => /\.(js|html|css)$/i.test(p));
const uiFiles = coreFiles.filter((p) => {
  const t = fs.readFileSync(p, "utf8");
  return /outgoing/i.test(t);
});
console.log("core/ 里含 outgoing 的文件:");
uiFiles.forEach((p) => console.log("  " + p));

// ② UI 页面里 outgoing 的 option 列表(顺序即 UI 显示顺序)
for (const p of uiFiles) {
  const t = fs.readFileSync(p, "utf8");
  const idx = t.search(/outgoing/i);
  if (idx < 0) continue;
  console.log("=== " + p + " (首个 outgoing 附近) ===");
  const seg = t.slice(Math.max(0, idx - 300), idx + 900);
  console.log(seg.replace(/\n{2,}/g, "\n").slice(0, 1400));
}

// ③ 游戏侧:applyConfigPayload 对 ui 块的处理 + dispatch 的 mode 来源
const main = fs.readFileSync("mod/panorama/scripts/lingua_chat.js", "utf8");
const lines = main.split("\n");
lines.forEach((l, i) => {
  if (/applyConfigPayload|cfg\.ui\s*=|State\.cfg\.ui\b/.test(l)) {
    console.log("L" + (i + 1) + ": " + l.trim().slice(0, 120));
  }
});
// dispatch 的 mode 来源(L4414 附近往回找)
const mi = lines.findIndex((l) => l.includes("outgoing mode="));
for (let k = mi - 40; k <= mi; k++) {
  if (/outgoingMode\s*=|mode\s*=/.test(lines[k] || "")) {
    console.log("L" + (k + 1) + ": " + lines[k].trim().slice(0, 130));
  }
}
