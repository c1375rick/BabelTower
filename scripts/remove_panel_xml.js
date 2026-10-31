// 移除两个布局里的游戏内设置面板(XML 部分)
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
let n = 0;

for (const rel of ["mod/panorama/layout/chat.xml", "mod/panorama/layout/hudchat.xml"]) {
  const f = path.join(ROOT, rel);
  let lines = fs.readFileSync(f, "utf8").split("\n");
  if (!lines.join("\n").includes("LCTSettingsPanel")) { console.log(rel + ": already clean"); continue; }
  // ① include
  const inc = lines.findIndex((l) => l.includes("lingua_chat_panel.vjs_c"));
  if (inc !== -1) { lines.splice(inc, 1); n++; }
  // ② 按钮 → 开网页
  const bi = lines.findIndex((l) => l.includes("LCTToggleSettings();"));
  if (bi !== -1) { lines[bi] = lines[bi].replace("LCTToggleSettings();", "LCTOpenWebSettings();"); n++; }
  // ③ 面板块
  const sIdx = lines.findIndex((l) => l.includes('<Panel id="LCTSettingsPanel"'));
  const bIdx = lines.findIndex((l) => l.includes("LCTBridgePanel"));
  if (sIdx !== -1 && bIdx !== -1 && bIdx > sIdx) {
    let end = bIdx;
    while (end > sIdx && lines[end - 1].trim() === "") end--;
    if (end > sIdx && lines[end - 1].includes("桥接 HTML 面板通道")) end--;
    const count = end - sIdx;
    lines.splice(sIdx, count);
    n++;
    console.log(rel + ": 面板块移除 " + count + " 行");
  }
  // ④ hudchat 的旧 <HTML> 桥面板 → CitadelHTMLPanel
  const hi = lines.findIndex((l) => l.includes('<HTML id="LCTBridgePanel"'));
  if (hi !== -1) {
    lines[hi] = lines[hi]
      .replace('<HTML id="LCTBridgePanel"', '<CitadelHTMLPanel id="LCTBridgePanel"')
      .replace('class="LCTBridgePanel"', 'class="LCTBridgePanel" hittest="false" acceptsfocus="false"');
    n++;
    console.log(rel + ": 桥面板 → CitadelHTMLPanel");
  }
  fs.writeFileSync(f, lines.join("\n"), "utf8");
}
console.log("done, edits=" + n);
