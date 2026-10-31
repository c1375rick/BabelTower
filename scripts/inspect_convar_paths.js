// 只读:convar 读写点与配置应用路径的写 convar 情况
const fs = require("fs");
const path = require("path");
const t = fs.readFileSync(path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js"), "utf8");
const lines = t.split("\n");
const show = (from, to, tag) => {
  console.log("\n--- " + tag + " ---");
  for (let k = from - 1; k < to; k++) console.log("L" + (k + 1) + ": " + lines[k].replace(/\s+$/, "").slice(0, 120));
};
// 1) saveUiConfig / loadUiConfig 定义
const su = lines.findIndex((l) => l.includes("function saveUiConfig"));
const lu = lines.findIndex((l) => l.includes("function loadUiConfig"));
show(su - 2, su + 14, "saveUiConfig @L" + (su + 1));
show(lu - 2, lu + 16, "loadUiConfig @L" + (lu + 1));
// 2) 所有 saveUiConfig 调用点
console.log("\n--- saveUiConfig 调用点 ---");
lines.forEach((l, i) => { if (l.includes("saveUiConfig(") && !l.includes("function saveUiConfig")) console.log("L" + (i + 1) + ": " + l.trim().slice(0, 110)); });
// 3) applyBridgeConfig 定义与结尾(应用后有没有写 convar)
const ab = lines.findIndex((l) => l.includes("function applyBridgeConfig"));
show(ab - 1, ab + 40, "applyBridgeConfig @L" + (ab + 1));
