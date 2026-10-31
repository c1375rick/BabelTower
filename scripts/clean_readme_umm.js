// README 清理:UMM 集成移除(2026-10-31,配置面只留网页 /tr)
const fs = require("fs");
const f = __dirname + "/../README.md";
let lines = fs.readFileSync(f, "utf8").split("\n");
let n = 0;

// ① 安装步骤 3(推荐安装 UMM):整条删除
const i3 = lines.findIndex((l) => l.includes("（推荐）安装 [Universal Mod Manager]"));
if (i3 !== -1) {
  let count = 1;
  if ((lines[i3 + 1] || "").includes("游戏内设置窗口")) count = 2;
  lines.splice(i3, count); n++;
  console.log("安装步骤 3(UMM): 移除 " + count + " 行");
  for (let i = i3; i < lines.length; i++) {
    if (/^4\. （?Deadlock/.test(lines[i])) lines[i] = lines[i].replace(/^4\./, "3.");
    else if (/^5\. 双击/.test(lines[i])) lines[i] = lines[i].replace(/^5\./, "4.");
    else if (/^6\. 日常使用/.test(lines[i])) lines[i] = lines[i].replace(/^6\./, "5.");
  }
}

// ② 使用表:删 /tr panel 行 + ⚙ 按钮行改描述 + 删 UMM 行
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("/tr panel` 回车")) { lines.splice(i, 1); i--; continue; }
  if (lines[i].includes("输入框右侧")) {
    lines[i] = "| 输入框右侧 **⚙ 按钮** | 打开**网页设置页**(与 `/tr` 等价;游戏内旧面板已移除) |";
  }
  if (lines[i].includes("[UMM]") && lines[i].includes("设置窗口")) { lines.splice(i, 1); i--; }
}
n++;

// ③ UMM 设置联动章节
const s = lines.findIndex((l) => l.startsWith("### UMM(Universal Mod Manager)设置联动"));
if (s !== -1) {
  let e = s + 1;
  while (e < lines.length && !/^##[^#]/.test(lines[e])) e++;
  const count = e - s;
  lines.splice(s, count);
  console.log("UMM 设置联动章节: 移除 " + count + " 行");
  n++;
}

fs.writeFileSync(f, lines.join("\n"), "utf8");
console.log("done");
