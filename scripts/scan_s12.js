// 扫描 append_s12.js:逐行跟踪字符串开合状态,揪出吞掉后续行的未闭合字符串。
const fs = require("fs");
const lines = fs.readFileSync(__dirname + "/append_s12.js", "utf8").split("\n");
let inString = false, startLine = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  let j = 0;
  while (j < line.length) {
    const c = line[j];
    if (!inString) {
      if (c === '"' && line[j - 1] !== "\\") { inString = true; startLine = i + 1; }
      else if (c === "/" && line[j + 1] === "/") break; // 行注释
    } else {
      if (c === "\\") { j += 2; continue; }
      if (c === '"') inString = false;
    }
    j++;
  }
  if (inString && j >= line.length) {
    console.log("L" + (i + 1) + ": 字符串未闭合(始于 L" + startLine + ")");
    console.log("  内容: " + JSON.stringify(line.slice(0, 120)));
    inString = false; // 继续找下一处
  }
}
console.log("扫描完成");
