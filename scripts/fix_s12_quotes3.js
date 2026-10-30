// 恢复 L45 的数组字符串终止符:fix2 误将 "OCR", 的定界符换成了 」,。
const fs = require("fs");
const f = __dirname + "/append_s12.js";
let lines = fs.readFileSync(f, "utf8").split("\n");
let n = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("Windows OCR」,") && lines[i].includes("层做的事")) {
    lines[i] = lines[i].replace("Windows OCR」,", "Windows OCR\","); n++;
  }
}
fs.writeFileSync(f, lines.join("\n"), "utf8");
console.log("fixed " + n + " line(s)");
