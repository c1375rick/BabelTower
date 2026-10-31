// 诊断:主文件里裸 BTIPC 引用(非 LCTBTIPC/非注释/非字符串)的精确位置
const fs = require("fs");
const path = require("path");
const t = fs.readFileSync(path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js"), "utf8");
const lines = t.split("\n");
lines.forEach((l, i) => {
  const stripped = l.replace(/\/\/.*$/, "").replace(/"[^"]*"/g, '""');
  if (/\bBTIPC\b/.test(stripped) && !/LCTBTIPC/.test(stripped)) {
    console.log("L" + (i + 1) + ": " + l.trim().slice(0, 120));
  }
});
