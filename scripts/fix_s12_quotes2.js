// 精准修 append_s12.js 残留的两处内嵌闭引号(按行定位,不碰其他合法的字符串终止符)。
const fs = require("fs");
const f = __dirname + "/append_s12.js";
let lines = fs.readFileSync(f, "utf8").split("\n");
let n = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("Windows OCR\",") && lines[i].includes("区域校准向导")) {
    lines[i] = lines[i].replace("Windows OCR\",", "Windows OCR」,"); n++;
  }
  if (lines[i].includes("(免费零依赖)\"做降级获取")) {
    lines[i] = lines[i].replace("(免费零依赖)\"做降级获取", "(免费零依赖)」做降级获取"); n++;
  }
}
fs.writeFileSync(f, lines.join("\n"), "utf8");
console.log("fixed " + n + " line(s)");
