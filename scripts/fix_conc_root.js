// convar_seed 实证的根修 + labelFor 兜底:
//   ① saveUiConfig 根修:json 原声明在首个 try 块内,第二个 try 的 SetValue 引用它必抛
//      ReferenceError 且被空 catch 吞掉——convar 从未被写入(存量 bug,mock 种子暴露)。
//      同批按评审要求加幂等:值相同不写,防 OnConVarChanged 事件风暴。
//      死循环核查:saveUiConfig 纯本地写入(属性字符串 + convar),无 markCfgDirty/无网络。
//   ② labelFor 兜底:主文件 applyUILang 引用面板全局 labelFor(面板文件不再加载),
//      boot 日志 "applyUILang failed: labelFor is not defined" ×2——加入 shims 区。
// 全程严格锚点,任一缺失即退出不写入。
const fs = require("fs");
const path = require("path");
const f = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
let t = fs.readFileSync(f, "utf8");
let edits = 0;

// ---- ① saveUiConfig 根修 + 幂等 ----
const oldSave = [
  "  function saveUiConfig() {",
  "    try {",
  "      const json = JSON.stringify(State.cfg);",
  "      $.GetContextPanel().SetAttributeString(UI_CONVAR, json);",
  "    } catch (e) {}",
  "    try {",
  "      if (typeof Convars !== \"undefined\") {",
  "        if (Convars.RegisterConVar) Convars.RegisterConVar(UI_CONVAR, \"{}\", 0, \"LinguaChat UI settings\");",
  "        if (Convars.SetValue) Convars.SetValue(UI_CONVAR, json);",
  "      }",
  "    } catch (e) {}",
  "  }",
].join("\n");
const newSave = [
  "  function saveUiConfig() {",
  "    // 2026-10-31 评审修复(convar_seed 实证):json 原声明在首个 try 块内,第二个 try 的",
  "    // SetValue 引用它必抛 ReferenceError 且被空 catch 吞掉——convar 从未被写入(存量 bug)。",
  "    // 同批加幂等:值相同不写,防 OnConVarChanged 事件风暴。纯本地写入,无 dirty/无网络副作用。",
  "    let json = \"\";",
  "    try { json = JSON.stringify(State.cfg); } catch (e) { return; }",
  "    try {",
  "      const panel = $.GetContextPanel();",
  "      if (panel.GetAttributeString) {",
  "        if (panel.GetAttributeString(UI_CONVAR, \"\") !== json) panel.SetAttributeString(UI_CONVAR, json);",
  "      } else {",
  "        panel.SetAttributeString(UI_CONVAR, json);",
  "      }",
  "    } catch (e) {}",
  "    try {",
  "      if (typeof Convars !== \"undefined\") {",
  "        if (Convars.RegisterConVar) Convars.RegisterConVar(UI_CONVAR, \"{}\", 0, \"LinguaChat UI settings\");",
  "        if (Convars.SetValue) {",
  "          const cur = Convars.GetStr ? Convars.GetStr(UI_CONVAR, \"\") : \"\";",
  "          if (cur !== json) Convars.SetValue(UI_CONVAR, json);",
  "        }",
  "      }",
  "    } catch (e) {}",
  "  }",
].join("\n");
if (t.includes("convar 从未被写入(存量 bug)")) {
  console.log("① 已存在,跳过");
} else if (t.includes(oldSave)) {
  t = t.replace(oldSave, newSave);
  edits++;
  console.log("① saveUiConfig: 作用域根修 + 幂等 ✓(精确替换)");
} else {
  console.error("① saveUiConfig 锚点缺失!中止(未写入)"); process.exit(1);
}

// ---- ② labelFor 兜底(加在 closeSelectMenus 之后) ----
if (t.includes("function labelFor(options, value) {")) {
  console.log("② labelFor 已存在,跳过");
} else {
  const anchor = "  function closeSelectMenus() {}";
  if (!t.includes(anchor)) { console.error("② closeSelectMenus 锚点缺失!中止(未写入)"); process.exit(1); }
  const shim = [
    anchor,
    "  function labelFor(options, value) {",
    "    // 兜底版:面板文件不再加载;查表返回 key,不命中回退原值(签名与面板真实现一致)。",
    "    try {",
    "      const arr = options || [];",
    "      for (let i = 0; i < arr.length; i += 1) {",
    "        if (arr[i] && arr[i].value === value) return String(arr[i].key || arr[i].value || \"\");",
    "      }",
    "    } catch (e) {}",
    "    return String(value || \"\");",
    "  }",
  ].join("\n");
  t = t.replace(anchor, shim);
  edits++;
  console.log("② labelFor 兜底 ✓(加于 closeSelectMenus 后)");
}

// ---- 终检 ----
const must = [
  "const BTIPC = LCTBTIPC.BTIPC;",
  "function handleChatSubmit(input) {",
  "function clearDirtyForPaths",
  "convar 优先",
  "丢弃后 2s 立即重同步",
  "convar 从未被写入(存量 bug)",
  "function labelFor(options, value) {",
];
const missing = must.filter((m) => !t.includes(m));
if (missing.length) { console.error("终检失败,缺: " + missing.join(" | ") + "(未写入)"); process.exit(1); }

fs.writeFileSync(f, t, "utf8");
console.log("已写入 " + edits + " 处编辑,共 " + t.split("\n").length + " 行");
