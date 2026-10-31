// 修复 /tr 段:删孤儿 else + trArg + 更新注释
const fs = require("fs");
const f = require("path").join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
let lines = fs.readFileSync(f, "utf8").split("\n");
let n = 0;
for (let i = 0; i < lines.length; i++) {
  if (!lines[i].includes("panel 别名到网页")) continue;
  if ((lines[i + 1] || "").trim().startsWith("else log(")) { lines.splice(i + 1, 1); n++; }
  if ((lines[i + 1] || "").includes("const trArg =")) { lines.splice(i + 1, 1); n++; }
  for (let k = i - 1; k >= i - 5 && k >= 0; k--) {
    if (lines[k].includes("/tr panel  只开旧面板")) {
      lines[k] = lines[k].replace("只开旧面板(调试/兜底),不发 UI_OPEN、不拉网页", "旧面板已移除(2026-10-31):别名到网页设置(与 /tr 等价)");
      n++;
    }
  }
  break;
}
fs.writeFileSync(f, lines.join("\n"), "utf8");
console.log("fixed " + n);
