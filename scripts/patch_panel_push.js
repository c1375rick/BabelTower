// 面板补丁(行定位版):在 LCTPickLang 的 saveUiConfig() 之后插入推桥 + 清 dirty。
const fs = require("fs");
const path = require("path");
const f = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat_panel.js");
let lines = fs.readFileSync(f, "utf8").split("\n");
const di = lines.findIndex((l) => l.trim() === "markCfgDirty(field);");
if (di === -1) { console.error("markCfgDirty(field) not found"); process.exit(1); }
let si = -1;
for (let k = di + 1; k < Math.min(di + 4, lines.length); k++) {
  if (lines[k].trim() === "saveUiConfig();") { si = k; break; }
}
if (si === -1) { console.error("saveUiConfig() not adjacent"); process.exit(1); }
const push = [
  "    // 2026-10-31:选择即推桥(与 LCTPickUILang 同款)——否则面板选择只改游戏本地,",
  "    // 网页 /tr 显示桥配置,两个 UI 分叉;且 dirty 会拦住网页修正(方向整反实证)。",
  "    try {",
  "      bridgePost(\"config\", { config: { ui: (function () { const o = {}; o[field] = value; return o; })() } }, function (res) {",
  "        log(\"pick persist: 推桥同步 \" + field + \" -> \" + value + \" \" + (res && res.ok ? \"ok\" : (res && res.error) || \"failed\"));",
  "        if (res && res.ok && State.cfgDirty) delete State.cfgDirty[field]; // 意图已落桥,清 dirty 让后续回填畅通",
  "      });",
  "    } catch (ePP) { log(\"pick persist THREW \" + expErr(ePP)); }",
];
lines.splice(si + 1, 0, push.join("\n"));
fs.writeFileSync(f, lines.join("\n"), "utf8");
console.log("panel patched at line " + (si + 2));
