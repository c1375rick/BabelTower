// 一次性补丁:outgoing 目标语言菜单重排(English 置顶)+ 面板选择推桥 + dirty 清理。
// 实证(2026-10-31 用户实车):outgoing 目标语言被设成 zh-Hans(菜单首项就是它,
// 中文用户极易误点)→ 出站方向 zh→no-op / en→zh,用户视角"整反了"。
// 且面板选择只写游戏本地(saveUiConfig 存 convar,不推桥),网页 /tr 显示桥配置(en),
// 两个 UI 分叉;dirty.outgoingTarget 还会拦住网页修正(直到重启)。
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
let n = 0;

// ---- ① chat.xml:菜单重排(en 置顶,其余原序) ----
const xmlPath = path.join(ROOT, "mod", "panorama", "layout", "chat.xml");
let x = fs.readFileSync(xmlPath, "utf8");
const itemZh = "<Button class=\"LCTMenuOption\" onactivate=\"LCTPickLang('outgoingTarget','zh-Hans');\"><Label id=\"LCTMenuOutLangZhHans\" text=\"简体中文 (zh-Hans)\" /></Button>";
const itemZhHant = "<Button class=\"LCTMenuOption\" onactivate=\"LCTPickLang('outgoingTarget','zh-Hant');\"><Label id=\"LCTMenuOutLangZhHant\" text=\"繁體中文 (zh-Hant)\" /></Button>";
const itemEn = "<Button class=\"LCTMenuOption\" onactivate=\"LCTPickLang('outgoingTarget','en');\"><Label id=\"LCTMenuOutLangEn\" text=\"English 英语 (en)\" /></Button>";
const oldMenu = [itemZh, itemZhHant, itemEn].join("\r\n\t\t\t\t\t\t\t");
const newMenu = [itemEn, itemZh, itemZhHant].join("\r\n\t\t\t\t\t\t\t");
if (x.includes(newMenu)) {
  console.log("chat.xml already reordered");
} else if (x.includes(oldMenu)) {
  x = x.replace(oldMenu, newMenu); n++;
  fs.writeFileSync(xmlPath, x, "utf8");
  console.log("chat.xml: outgoing 目标菜单 English 置顶");
} else {
  // 换行风格兜底:用正则做行级重排(找三行各自的完整 Button)
  const reZh = new RegExp("^\\s*" + itemZh.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\r?$", "m");
  if (reZh.test(x) && x.includes(itemEn)) {
    // 删三行,再按新序插回 zh-Hans 原位置前
    x = x.replace(itemZh + "\r\n", "").replace(itemZh + "\n", "");
    x = x.replace(itemEn, itemEn + "\r\n\t\t\t\t\t\t\t" + itemZh);
    n++;
    fs.writeFileSync(xmlPath, x, "utf8");
    console.log("chat.xml(regex 路线): en 置顶");
  } else {
    console.error("chat.xml anchor missing"); process.exit(1);
  }
}

// ---- ② 面板 LCTPickLang:推桥 + 成功清 dirty ----
const panelPath = path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat_panel.js");
let p = fs.readFileSync(panelPath, "utf8");
if (p.includes("pick persist: 推桥同步")) {
  console.log("panel already patched");
} else {
  const oldPick = [
    "    syncCustomInputs();",
    "    markCfgDirty(field);",
    "    saveUiConfig();",
    "    closeSelectMenus();",
  ].join("\n");
  if (!p.includes(oldPick)) { console.error("panel anchor missing"); process.exit(1); }
  const newPick = [
    "    syncCustomInputs();",
    "    markCfgDirty(field);",
    "    saveUiConfig();",
    "    // 2026-10-31:选择即推桥(与 LCTPickUILang 同款)——否则面板选择只改游戏本地,",
    "    // 网页 /tr 显示桥配置,两个 UI 分叉;且 dirty 会拦住网页修正(方向整反实证)。",
    "    try {",
    "      bridgePost(\"config\", { config: { ui: (function () { const o = {}; o[field] = value; return o; })() } }, function (res) {",
    "        log(\"pick persist: 推桥同步 \" + field + \" -> \" + value + \" \" + (res && res.ok ? \"ok\" : (res && res.error) || \"failed\"));",
    "        if (res && res.ok && State.cfgDirty) delete State.cfgDirty[field]; // 意图已落桥,清 dirty 让后续回填畅通",
    "      });",
    "    } catch (ePP) { log(\"pick persist THREW \" + expErr(ePP)); }",
    "    closeSelectMenus();",
  ].join("\n");
  p = p.replace(oldPick, newPick); n++;
  fs.writeFileSync(panelPath, p, "utf8");
  console.log("panel LCTPickLang: 推桥 + 成功清 dirty");
}

// ---- ③ 主文件 applyConfigPayload:应用路径清 dirty ----
const mainPath = path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat.js");
let m = fs.readFileSync(mainPath, "utf8");
if (m.includes("应用路径清 dirty")) {
  console.log("main already patched");
} else {
  const oldApply = [
    "    if (d.delta) {",
    "      mask = JSON.parse(JSON.stringify(State.cfgMask || {}));",
    "      const set = d.set || {};",
    "      for (const p of Object.keys(set)) cfgPathApply(mask, p, set[p]);",
    "      for (const p of (d.unset || [])) cfgPathApply(mask, p, undefined);",
    "    } else if (d.config && typeof d.config === \"object\") { mask = d.config; }",
  ].join("\n");
  if (!m.includes(oldApply)) { console.error("main anchor missing"); process.exit(1); }
  const newApply = [
    "    if (d.delta) {",
    "      mask = JSON.parse(JSON.stringify(State.cfgMask || {}));",
    "      const set = d.set || {};",
    "      for (const p of Object.keys(set)) cfgPathApply(mask, p, set[p]);",
    "      for (const p of (d.unset || [])) cfgPathApply(mask, p, undefined);",
    "      // 2026-10-31 应用路径清 dirty(发送方向整反实证):桥侧变更是更新的用户意图",
    "      // (网页保存);面板未保存的编辑被显式保存覆盖时,不得再拦后续回填。",
    "      clearDirtyForPaths(Object.keys(set).concat(d.unset || []));",
    "    } else if (d.config && typeof d.config === \"object\") {",
    "      mask = d.config;",
    "      if (State.cfgDirty) for (const k of Object.keys(State.cfgDirty)) delete State.cfgDirty[k];",
    "    }",
  ].join("\n");
  m = m.replace(oldApply, newApply);
  const helperAnchor = "  function applyConfigPayload(text, res) {";
  const helper = [
    "  function clearDirtyForPaths(paths) {",
    "    if (!State.cfgDirty) return;",
    "    for (const p of paths || []) {",
    "      const key = String(p).split(\".\").pop();",
    "      delete State.cfgDirty[key];",
    "    },",
  ].join("\n").replace("},", "}");
  if (!m.includes("function clearDirtyForPaths")) {
    m = m.replace(helperAnchor, helper + "\n  }\n" + helperAnchor);
  }
  n++;
  fs.writeFileSync(mainPath, m, "utf8");
  console.log("main applyConfigPayload: 应用路径清 dirty + helper");
}
console.log("done, edits=" + n);
