// 修复评审发现的面板全局悬空引用 + 迁移写源诊断 + 派发日志改名
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
let n = 0;

// ---- ① 主文件:面板全局兜底 ----
const mainPath = path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat.js");
let main = fs.readFileSync(mainPath, "utf8");
if (main.includes("主文件引用的面板全局函数在此兜底")) {
  console.log("main: 兜底已存在");
} else {
  const anchor = "  function targetLanguage() {";
  const aIdx = main.indexOf(anchor);
  if (aIdx === -1) { console.error("anchor missing"); process.exit(1); }
  const L = [];
  L.push("  // 2026-10-31:游戏内设置面板已移除——主文件引用的面板全局函数在此兜底。");
  L.push("  // 面板元素不存在时自然空操作;将来面板文件恢复加载,其 exportGlobal 真实现覆盖这些兜底。");
  L.push("  function fieldValue(id) {");
  L.push("    try {");
  L.push("      const el = findChild(getRoot(), id);");
  L.push("      return el ? safeText(el) : \"\";");
  L.push("    } catch (e) { return \"\"; }");
  L.push("  }");
  L.push("  function setSelectText(id, text) {");
  L.push("    try {");
  L.push("      const el = findChild(getRoot(), id);");
  L.push("      if (el) el.text = String(text);");
  L.push("    } catch (e) {}");
  L.push("  }");
  L.push("  function setToggleText(id, val) {");
  L.push("    try {");
  L.push("      const el = findChild(getRoot(), id);");
  L.push("      if (el) el.text = val ? \"ON\" : \"OFF\";");
  L.push("    } catch (e) {}");
  L.push("  }");
  L.push("  function closeSelectMenus() {}");
  L.push("");
  main = main.slice(0, aIdx) + L.join("\n") + "\n" + main.slice(aIdx);
  n++;
  fs.writeFileSync(mainPath, main, "utf8");
  console.log("main: 面板全局兜底已定义");
}

// ---- ② 桥:死代码诊断移除 + HTTP POST 写分支插入活诊断 ----
const bridgePath = path.join(ROOT, "core", "bridge_server.js");
let bridgeLines = fs.readFileSync(bridgePath, "utf8").split("\n");
if (bridgeLines.join("\n").includes("config WRITE source")) {
  const di = bridgeLines.findIndex((l) => l.includes("config WRITE source"));
  if (di !== -1) {
    let up = di;
    while (up > 0 && !bridgeLines[up].includes("try {")) up--;
    let down = di;
    while (down < bridgeLines.length && !bridgeLines[down].includes("catch (eD)")) down++;
    if (down < bridgeLines.length) {
      bridgeLines.splice(up, down - up + 1);
      n++;
      console.log("bridge: 死代码诊断已移除");
    }
  }
  const ci = bridgeLines.findIndex((l) => l.includes('log("info", "config saved");'));
  if (ci === -1) { console.error("config saved line not found"); process.exit(1); }
  const D = [
    "        // 2026-10-31 写入来源审计(方向错乱排查):op 字段区分游戏面板中继(op=config)与网页表单",
    "        try {",
    "          const ua = String(req.headers[\"user-agent\"] || \"-\").slice(0, 60);",
    "          const ref = String(req.headers[\"referer\"] || \"-\").slice(0, 60);",
    "          const srcOp = bodyObj && bodyObj.op ? String(bodyObj.op) : \"web-form\";",
    "          const uiFields = bodyObj && bodyObj.config && bodyObj.config.ui ? Object.keys(bodyObj.config.ui).join(\",\") : \"-\";",
    "          log(\"info\", \"config WRITE source: op=\" + srcOp + \" uiFields=[\" + uiFields + \"] UA=\" + ua + \" ref=\" + ref);",
    "        } catch (eD) {}"
  ];
  bridgeLines.splice(ci, 0, ...D);
  n++;
  console.log("bridge: 活诊断已插入 HTTP POST 写分支");
  fs.writeFileSync(bridgePath, bridgeLines.join("\n"), "utf8");
}

// ---- ③ 派发日志改名 ----
let main2 = fs.readFileSync(mainPath, "utf8");
if (main2.includes('log("outgoing dispatch: ctx="')) {
  main2 = main2.split('log("outgoing dispatch: ctx="').join('log("hash dispatch: ctx="');
  fs.writeFileSync(mainPath2 = mainPath, main2, "utf8");
  n++;
  console.log("main: 派发日志改名 hash dispatch");
}
console.log("done, edits=" + n);
