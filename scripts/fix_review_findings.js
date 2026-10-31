// 评审修复(行定位版,CRLF 容错):
//   ① 面板全局兜底:fieldValue/setSelectText/setToggleText/closeSelectMenus
//      (面板文件不再加载——fieldValue 悬空会让 legacy custom 目标的出站流程抛 ReferenceError)
//   ② resolveOutgoingTarget:convar 优先(双上下文下另一上下文的 State 滞后 60-120s,
//      convar 是全局共享的新鲜源;同上下文时 convar==State.cfg 无风险)
//   ③ 陈旧差分丢弃后 2s 重同步(不干等 60s 兜底)
const fs = require("fs");
const path = require("path");
const f = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
let lines = fs.readFileSync(f, "utf8").split("\n");
let n = 0;
const EOL = lines[0].includes("\r") ? "\r\n" : "\n";

// ---- ① 面板全局兜底:插在 function targetLanguage 之前 ----
if (!lines.join("\n").includes("主文件引用的面板全局函数在此兜底")) {
  const ai = lines.findIndex((l) => l.includes("function targetLanguage() {"));
  if (ai === -1) { console.error("targetLanguage not found"); process.exit(1); }
  const shims = [
    "  // 2026-10-31:游戏内设置面板已移除——主文件引用的面板全局函数在此兜底。",
    "  // 面板元素不存在时自然空操作;将来面板文件恢复加载,其 exportGlobal 真实现覆盖这些兜底。",
    "  function fieldValue(id) {",
    "    try {",
    "      const el = findChild(getRoot(), id);",
    "      return el ? safeText(el) : \"\";",
    "    } catch (e) { return \"\"; }",
    "  }",
    "  function setSelectText(id, text) {",
    "    try {",
    "      const el = findChild(getRoot(), id);",
    "      if (el) el.text = String(text);",
    "    } catch (e) {}",
    "  }",
    "  function setToggleText(id, val) {",
    "    try {",
    "      const el = findChild(getRoot(), id);",
    "      if (el) el.text = val ? \"ON\" : \"OFF\";",
    "    } catch (e) {}",
    "  }",
    "  function closeSelectMenus() {}",
    ""
  ];
  lines.splice(ai, 0, ...shims);
  n++;
  console.log("① 面板全局兜底已插入(L" + (ai + 1) + "起)");
}

// ---- ② resolveOutgoingTarget:convar 优先 ----
const joined = lines.join("\n");
if (!joined.includes("convar 优先")) {
  const fi = lines.findIndex((l) => l.trim() === "function resolveOutgoingTarget() {");
  if (fi === -1) { console.error("resolveOutgoingTarget not found"); process.exit(1); }
  // 函数体到匹配的 "  }"(3 行:body 4 行 + 闭括号)
  const bodyLines = [
    "  function resolveOutgoingTarget() {",
    "    // 2026-10-31 评审修复(conc-1/conc-5):convar 优先——双上下文下,差分应用发生在",
    "    // 拉取的上下文,另一上下文的 State.cfg.outgoingTarget 滞后 60-120s;",
    "    // convar(lct_ui)是全局共享的,saveUiConfig 在差分应用时立即写入——它是唯一",
    "    // 的跨上下文新鲜源。同上下文时 convar==State.cfg,顺序无回退风险。",
    "    try {",
    "      if (typeof Convars !== \"undefined\" && Convars.GetStr) {",
    "        const raw = Convars.GetStr(UI_CONVAR, \"\");",
    "        if (raw) {",
    "          const j = JSON.parse(raw);",
    "          if (j && typeof j.outgoingTarget === \"string\" && j.outgoingTarget) return j.outgoingTarget;",
    "        }",
    "      }",
    "    } catch (e) {}",
    "    let lang = State.cfg.outgoingTarget || \"en\";",
    "    if (lang === \"custom\") {",
    "      lang = fieldValue(\"LCTOutgoingTargetCustom\") || \"en\";",
    "    }",
    "    return lang;",
    "  }"
  ];
  // 找函数的结束行(从 fi 向下找第一个 trim()==="  }" 且缩进为 2 空格的行)
  let ei = fi;
  for (let k = fi; k < lines.length; k++) {
    if (lines[k] === "  }") { ei = k; break; }
  }
  lines.splice(fi, ei - fi + 1, ...bodyLines);
  n++;
  console.log("② resolveOutgoingTarget: convar 优先已替换");
}

// ---- ③ 陈旧差分丢弃后 2s 重同步 ----
const joined2 = lines.join("\n");
if (!joined2.includes("丢弃后 2s 立即重同步")) {
  const di = lines.findIndex((l) => l.includes('log("cfg sync: stale delta discarded'));
  if (di === -1) { console.error("stale discard log not found"); process.exit(1); }
  // 其后的 return false 行
  let ri = di;
  for (let k = di; k < Math.min(di + 3, lines.length); k++) {
    if (lines[k].trim() === "return false;") { ri = k; break; }
  }
  const retry = [
    "          // conc-2 评审修复:丢弃后 2s 立即重同步(携带已推进的 rev,一次即收敛),",
    "          // 不干等 60s 兜底轮询。重试发送的是当前 rev → 桥历史必有基线 → 一轮收敛。",
    "          try { $.Schedule(2.0, function () { try { syncConfigDelta(onDone); } catch (eR) {} }); } catch (eR2) {}"
  ];
  lines.splice(ri, 0, ...retry);
  n++;
  console.log("③ 陈旧差分丢弃后 2s 重同步已插入");
}

fs.writeFileSync(f, lines.join(EOL), "utf8");
console.log("done, edits=" + n);
