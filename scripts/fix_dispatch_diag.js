// 修正派发诊断:payload.target(错) → payload.d.target(真目标字段)
const fs = require("fs");
const path = require("path");
const f = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
let lines = fs.readFileSync(f, "utf8").split("\n");
let n = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("payload.target=\" + payload.target")) {
    lines[i] = lines[i].replace("payload.target=\" + payload.target", "d.target=\" + ((payload.d && payload.d.target) || \"-\")");
    n++;
    break;
  }
}
fs.writeFileSync(f, lines.join("\n"), "utf8");
console.log("fixed " + n);
