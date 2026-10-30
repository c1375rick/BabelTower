// 修复 append_s12.js 里残留的未转义直引号(12.3 节两处),换为中文引号。
const fs = require("fs");
const f = __dirname + "/append_s12.js";
let t = fs.readFileSync(f, "utf8");
const fixes = [
  ['届时以"区域校准向导 + Windows OCR",', "届时以「区域校准向导 + Windows OCR,"],
  ['(免费零依赖)"做降级获取的 PoC', "(免费零依赖)」做降级获取的 PoC"],
];
let n = 0;
for (const [a, b] of fixes) {
  if (t.includes(a)) { t = t.split(a).join(b); n++; }
}
fs.writeFileSync(f, t, "utf8");
console.log("fixed " + n + " spot(s)");
