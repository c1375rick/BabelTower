// 主文件:/tr panel 改道 + LCTOpenWebSettings
const fs = require("fs");
const mainPath = require("path").join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
let main = fs.readFileSync(mainPath, "utf8");
let n = 0;
if (!main.includes("LCTOpenWebSettings")) {
  const aIdx = main.indexOf("  function trOpenSummary() {");
  if (aIdx === -1) { console.error("anchor missing"); process.exit(1); }
  const rel = main.slice(aIdx).indexOf("\n  function ");
  const at = aIdx + rel + 1;
  const glob = [
    "  // 2026-10-31:游戏内设置面板已移除(双 UI 分叉导致方向错乱),齿轮按钮改开网页。",
    "  globalThis.LCTOpenWebSettings = function () { log(\"UI_OPEN \" + trOpenSummary()); };",
    ""
  ].join("\n");
  main = main.slice(0, at) + glob + main.slice(at);
  n++;
}
const lines = main.split("\n");
const pi = lines.findIndex((l) => l.includes("openSettingsPanel();"));
if (pi !== -1) {
  lines[pi] = "      log(\"UI_OPEN \" + trOpenSummary()); // 旧面板已移除:panel 别名到网页";
  n++;
  main = lines.join("\n");
}
if (n > 0) fs.writeFileSync(mainPath, main, "utf8");
console.log("done, edits=" + n);
