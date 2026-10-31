// 更新 lc_sim_outgoing_dirty.test.js:加载面板文件 + 步骤 1 走真实 LCTPickLang
const fs = require("fs");
const f = __dirname + "/../tests/lc_sim_outgoing_dirty.test.js";
let t = fs.readFileSync(f, "utf8");
let n = 0;

// ① SCRIPTS 加面板文件
if (!t.includes("lingua_chat_panel.js")) {
  t = t.replace(
    '  path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat.js"),\n];',
    '  path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat.js"),\n  path.join(ROOT, "mod", "panorama", "scripts", "lingua_chat_panel.js"),\n];'
  );
  n++;
}

// ② 步骤 1 换成真实 LCTPickLang(含推桥断言)
const oldStep = [
  "    LCTNS.State.cfg.outgoingTarget = \"zh-Hans\";",
  "    LCTNS.markCfgDirty(\"outgoingTarget\");",
  "    LCTNS.saveUiConfig();",
  "    await sim.sleep(500);",
  "    check(\"S1 面板选择后 flat=zh-Hans\", LCTNS.State.cfg.outgoingTarget === \"zh-Hans\");",
  "    check(\"S2 dirty.outgoingTarget 已置位\", !!(LCTNS.State.cfgDirty && LCTNS.State.cfgDirty.outgoingTarget));",
].join("\n");
const newStep = [
  "    if (typeof sim.sandbox.LCTPickLang !== \"function\") throw new Error(\"LCTPickLang not exported\");",
  "    sim.sandbox.LCTPickLang(\"outgoingTarget\", \"zh-Hans\");",
  "    await sim.sleep(800); // 推桥(bridgePost)落地",
  "    check(\"S1 面板选择后 flat=zh-Hans\", LCTNS.State.cfg.outgoingTarget === \"zh-Hans\");",
  "    const afterPick = await getJson(BASE + \"/api/v1/config?full=1\", 4000);",
  "    check(\"S1b 选择已推桥(桥配置=zh-Hans)\", !!(afterPick && afterPick.config && afterPick.config.ui && afterPick.config.ui.outgoingTarget === \"zh-Hans\"));",
].join("\n");
if (t.includes(oldStep)) { t = t.replace(oldStep, newStep); n++; }
else { console.error("step1 anchor missing"); process.exit(1); }

fs.writeFileSync(f, t, "utf8");
console.log("updated, edits=" + n);
