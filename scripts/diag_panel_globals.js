// 诊断:主文件引用的 panel-only 全局函数(面板文件不再加载后的悬空引用清单)
const fs = require("fs");
const path = require("path");
const t = fs.readFileSync(path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js"), "utf8");
const names = ["fieldValue", "setSelectText", "setToggleText", "closeSelectMenus", "labelFor", "cycleValue", "openSettingsPanel", "closeSettingsPanel", "syncPanelFromConfig", "syncCustomInputs", "collectPanelConfig"];
const lines = t.split("\n");
for (const n of names) {
  const hits = [];
  lines.forEach((l, i) => {
    if (new RegExp("\\b" + n + "\\b").test(l) && !l.trim().startsWith("//")) hits.push("L" + (i + 1) + ": " + l.trim().slice(0, 95));
  });
  if (hits.length) {
    console.log("== " + n + " (" + hits.length + " 处) ==");
    hits.slice(0, 6).forEach((x) => console.log("   " + x));
  }
}
