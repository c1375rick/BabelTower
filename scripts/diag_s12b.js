// 判定:第 45 行(JSON 形式 + 「」 附近码点)——找出 node --check 报错的真凶字节
const fs = require("fs");
const f = __dirname + "/append_s12.js";
const buf = fs.readFileSync(f);
const lines = buf.toString("utf8").split("\n");
const l = lines[44];
console.log("L45 JSON: " + JSON.stringify(l));
const arr = [...l];
const idx = arr.findIndex((c) => c === "「");
if (idx >= 0) {
  console.log("「 附近码点: " + arr.slice(idx - 2, idx + 14).map((c) => c.codePointAt(0).toString(16)).join(" "));
}
// 全文件非 ASCII 可疑字符统计(U+FFFD 或 C1 控制区)
const bad = [];
for (const [i, ch] of [...buf.toString("utf8")].entries()) {
  const cp = ch.codePointAt(0);
  if (cp === 0xfffd || (cp >= 0x80 && cp <= 0x9f)) bad.push(i.toString(16) + ":" + cp.toString(16));
}
console.log("可疑字符数: " + bad.length + (bad.length ? "  前5: " + bad.slice(0, 5).join(" ") : ""));
