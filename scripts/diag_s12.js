// 诊断:打印 append_s12.js 第 44-47 行的 JSON 转义形式(看真实字符)
const fs = require("fs");
const lines = fs.readFileSync(__dirname + "/append_s12.js", "utf8").split("\n");
for (let i = 43; i < 47; i++) {
  console.log("L" + (i + 1) + ": " + JSON.stringify(lines[i]));
}
