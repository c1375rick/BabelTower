// Babel Tower Community 0.1.0 无桥化手术 v2(开关式,安全模式)
// 与被废弃的 patch_bridgeless_ce.js(1372 行全面摘除)的区别:
//   不删 BTIPC 代码——加 BTIPC_ENABLED 总开关关死(hash-only),死代码 prune 留 0.2;
//   所有锚点用 lineOf() 运行时实测提取(零臆想——废弃脚本的事故根因);
//   全部编辑在内存完成,journal 记录,DRY 模式干跑,最后一次性写入。
// 用法: node scripts/patch_bridgeless_v2.js [--check]
"use strict";
const fs = require("fs");
const path = require("path");

const DRY = process.argv.indexOf("--check") !== -1;
const outPath = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
let raw = fs.readFileSync(outPath, "utf8");
const hasCRLF = raw.indexOf("\r\n") !== -1;
let t = hasCRLF ? raw.replace(/\r\n/g, "\n") : raw;
const before = t;
let edits = 0;
const journal = [];

function fail(msg) {
  console.error("✗ " + msg);
  console.error("✗ 中止(未写入)。工作树未受影响。");
  process.exit(1);
}
function count(h, n) { return n === "" ? 0 : h.split(n).length - 1; }

// ---- lineOf:运行时实测锚点(对臆想锚点的制度性防御) ----
function lineOf(sub, from) {
  const i = t.indexOf(sub, from || 0);
  if (i === -1) return null;
  const ls = t.lastIndexOf("\n", i) + 1;
  const le = t.indexOf("\n", i);
  return { line: t.slice(ls, le === -1 ? t.length : le), index: ls, no: t.slice(0, i).split("\n").length };
}
// 行级替换:定位含 sub 的行 → 用新行替换整行(锚文本 = 实测整行,零臆想)
function replaceLine(sub, newLine, label) {
  const hit = lineOf(sub);
  if (!hit) fail("行缺失 [" + label + "]: " + JSON.stringify(sub.slice(0, 100)));
  if (count(t, hit.line) !== 1) fail("行不唯一 [" + label + "] x" + count(t, hit.line) + ": " + JSON.stringify(hit.line.slice(0, 100)));
  t = t.replace(hit.line, function () { return newLine; });
  edits++;
  journal.push("REPLACE-LINE " + label + " (L" + hit.no + ")");
  return hit;
}
// 在含 sub 的行之后插入若干行
function insertAfterLine(sub, newLines, label) {
  const hit = lineOf(sub);
  if (!hit) fail("行缺失 [" + label + "]: " + JSON.stringify(sub.slice(0, 100)));
  t = t.replace(hit.line, function (m) { return m + "\n" + newLines.join("\n"); });
  edits++;
  journal.push("INSERT-AFTER " + label + " (L" + hit.no + ")");
}
// 在含 sub 的行之前插入
function insertBeforeLine(sub, newLines, label) {
  const hit = lineOf(sub);
  if (!hit) fail("行缺失 [" + label + "]: " + JSON.stringify(sub.slice(0, 100)));
  t = t.replace(hit.line, function (m) { return newLines.join("\n") + "\n" + m; });
  edits++;
  journal.push("INSERT-BEFORE " + label + " (L" + hit.no + ")");
}
// 区间删除:startSub 行(含)到 endSub 行(不含)——end 行必须唯一且在 start 之后
function cutLines(startSub, endSub, label) {
  const s = lineOf(startSub);
  if (!s) fail("起点行缺失 [" + label + "]: " + JSON.stringify(startSub.slice(0, 100)));
  const e = lineOf(endSub, s.index + s.line.length);
  if (!e) fail("终点行缺失 [" + label + "]: " + JSON.stringify(endSub.slice(0, 100)));
  t = t.slice(0, s.index) + t.slice(e.index);
  edits++;
  journal.push("CUT " + label + " (L" + s.no + "-L" + e.no + ", " + (e.index - s.index) + " chars)");
}
// 精确替换(短锚全文唯一校验)
function replaceExact(oldStr, newStr, label) {
  const n = count(t, oldStr);
  if (n === 0) fail("锚点缺失 [" + label + "]: " + JSON.stringify(oldStr.slice(0, 100)));
  if (n > 1) fail("锚点不唯一 [" + label + "] x" + n + ": " + JSON.stringify(oldStr.slice(0, 100)));
  t = t.replace(oldStr, function () { return newStr; });
  edits++;
  journal.push("REPLACE " + label);
}

// =====================================================================
// E1 版本
// =====================================================================
replaceLine('const VERSION = "1.2.5', '  const VERSION = "0.1.0-ce"; // community bridgeless edition (pure CEF + hosted page)', "E1 VERSION");

// =====================================================================
// E2 BTIPC 总开关 + 托管页常量(插在 HTTPS_PANEL_ENABLED 定义行后)
// =====================================================================
insertAfterLine("const HTTPS_PANEL_ENABLED = true;", [
  "  // COMMUNITY 0.1.0:无桥形态——BTIPC 层代码保留但不激活(0.2 prune);",
  "  // 翻译走 CEF 面板直载托管页(GitHub Pages,公开证书,零本地进程)。",
  "  const BTIPC_ENABLED = false;",
  "  // 托管页(Pages):hash 通道 base 与设置面板均指向它;POC 真机已验证(见 poc/RESULTS.md)。",
  '  const PAGE_URL = "https://c1375rick.github.io/babeltower-community-pages/";',
], "E2 constants");

// =====================================================================
// E3 healthCheck 的 BTIPC 分支关死(15s 回声会写 console.log 帧+位泵)
// =====================================================================
replaceLine("if (BTIPC) {", "    if (BTIPC_ENABLED && BTIPC) {", "E3 healthCheck guard");

// =====================================================================
// E4 demoteToBtipc 守卫:hash 失败不再交接 BTIPC,走发原文
// =====================================================================
insertAfterLine("function demoteToBtipc(job) {", [
  "    if (!BTIPC_ENABLED) {",
  '      log("demote: BTIPC off (community bridgeless) — hash failed, job settles to original text");',
  "      return false;",
  "    }",
], "E4 demote guard");

// =====================================================================
// E5 探针 URL → 托管页(hashBase 随探针捕获,自动指向 Pages)
// =====================================================================
replaceLine('const probeUrl = "https://" + HTTPS_PANEL_HOST', '    const probeUrl = PAGE_URL + "?boot=1&lang=" + gameUiLang(); // COMMUNITY: 探针即页面加载,title 含 lct-alive 即 ALIVE', "E5 probe URL");

// =====================================================================
// E6 删桥对照 imgProbe 段(桥不在了,对照无意义)
// =====================================================================
cutLines('const imgProbe = "http://" + BRIDGE_HOST', "    } catch (eI) {}", "E6 imgProbe");

// =====================================================================
// E7 cfg 同步改道页面 localStorage(权威)——startCfgSync 里换入口
// =====================================================================
replaceLine("    syncBridgeConfig();", "    startPageCfgSync(); // COMMUNITY: 配置权威 = 托管页 localStorage,经 hash cfg get 同步", "E7 cfg sync entry");

// =====================================================================
// E8 新函数块(插在 trOpenSummary 定义前)
// =====================================================================
insertBeforeLine("function trOpenSummary", [
  "  // ============================================================",
  "  // COMMUNITY 0.1.0:无桥配置同步 + 游戏内可见设置面板 + 配置码导入",
  "  // 权威 = 托管页 localStorage(跨游戏重启持久,POC 真机已验证);",
  "  // 游戏侧 State.cfg/convar 保持只读镜像,applyBridgeConfig 机制原样复用。",
  "  // ============================================================",
  "  function hashCfgSync() {",
  '    // 拉取页面配置:hash {op:"cfg"} → 页面回 {cfg:{...扁平}} → 包成 {ui:{...}} 喂 applyBridgeConfig',
  "    if (!State.hashReady || !State.hashBase) return;",
  '    const jobId = "cfg" + (++State.requestSeq).toString(36);',
  '    const payload = { q: "cfg_" + nowMs(), id: jobId, op: "cfg", d: {} };',
  "    setPending(jobId, function (payload2) {",
  "      try {",
  '        if (!payload2 || !payload2.ok || !payload2.cfg) { log("page cfg: no cfg in response"); return; }',
  "        const mask = { ui: payload2.cfg };",
  '        applyBridgeConfig(mask, "page-cfg");',
  "      } catch (eC) { log(\"page cfg apply failed: \" + expErr(eC)); }",
  "    }, 12000);",
  "    try {",
  "      const hp = ensurePanel();",
  '      if (isValid(hp) && typeof hp.SetURL === "function") {',
  '        hp.SetURL(State.hashBase + "#LCTQ:" + encodeURIComponent(JSON.stringify(payload)));',
  "      }",
  "    } catch (e) {}",
  "  }",
  "  function startPageCfgSync() {",
  "    if (State.pageCfgStarted) return;",
  "    State.pageCfgStarted = true;",
  "    hashCfgSync();",
  "    try {",
  "      $.Schedule(30.0, function pageCfgLoop() {",
  "        hashCfgSync();",
  "        $.Schedule(30.0, pageCfgLoop);",
  "      });",
  "    } catch (e) {}",
  "  }",
  "  // 游戏内可见设置面板:动态创建 CitadelHTMLPanel(独立于隐藏翻译面板,互不干扰)",
  "  function showPagePanel() {",
  "    try {",
  "      let p = findChild(getRoot(), \"LCTSettingsPage\");",
  "      if (!isValid(p)) {",
  '        p = $.CreatePanel("CitadelHTMLPanel", getRoot(), "LCTSettingsPage");',
  '        p.style.width = "640px";',
  '        p.style.height = "520px";',
  '        p.style.horizontalAlignment = "center";',
  '        p.style.verticalAlignment = "center";',
  "      }",
  '      p.hittest = true;',
  '      p.acceptsfocus = true;',
  "      p.visible = true;",
  '      p.SetURL(PAGE_URL + "#settings");',
  '      try { if (typeof p.Activate === "function") p.Activate(); } catch (eA) {}',
  '      log("settings page opened in-game (click to interact; /tr again to close)");',
  "      return true;",
  "    } catch (e) {",
  '      log("settings panel failed: " + expErr(e) + " — 浏览器打开 " + PAGE_URL);',
  "      return false;",
  "    }",
  "  }",
  "  function hidePagePanel() {",
  "    try {",
  '      const p = findChild(getRoot(), "LCTSettingsPage");',
  "      if (isValid(p)) { p.visible = false; p.DeleteAsync(0); }",
  "      return true;",
  "    } catch (e) { return false; }",
  "  }",
  "  function togglePagePanel() {",
  '    const p = findChild(getRoot(), "LCTSettingsPage");',
  "    if (isValid(p) && p.visible) { hidePagePanel(); return; }",
  "    showPagePanel();",
  "  }",
  '  function importCfgCode(code) {',
  "    // 配置码兜底:浏览器 Pages「导出配置码」→ /tr code <base64> → 经 hash 让页面写自己的 localStorage",
  "    if (!code) {",
  '      log("/tr code: empty");',
  '      setStatus("/tr code: 配置码为空");',
  "      return;",
  "    }",
  '    const jobId = "cfgc" + (++State.requestSeq).toString(36);',
  '    const payload = { q: "cfgc_" + nowMs(), id: jobId, op: "cfgcode", d: { code: String(code) } };',
  "    setPending(jobId, function (payload2) {",
  "      try {",
  "        if (payload2 && payload2.ok) {",
  '          log("cfg code imported: keys=" + JSON.stringify(payload2.keys || []));',
  '          setStatus("配置已导入: " + JSON.stringify(payload2.keys || []));',
  "          hashCfgSync(); // 立即拉新配置",
  "        } else {",
  '          log("cfg code import failed: " + ((payload2 && payload2.error) || "?"));',
  '          setStatus("/tr code: 导入失败(检查配置码)");',
  "        }",
  "      } catch (eC) { log(\"cfg code settle threw: \" + expErr(eC)); }",
  "    }, 12000);",
  "    try {",
  "      const hp = ensurePanel();",
  '      if (isValid(hp) && typeof hp.SetURL === "function") {',
  '        hp.SetURL(State.hashBase + "#LCTQ:" + encodeURIComponent(JSON.stringify(payload)));',
  "      }",
  "    } catch (e) {}",
  "  }",
  "",
], "E8 new functions");

// =====================================================================
// E9 /tr 命令改造(整块替换,锚=实测行区间)
// =====================================================================
{
  const s = lineOf('    // /tr:设置已经搬到桌面浏览器');
  if (!s) fail("E9 /tr 块起点缺失");
  // 终点 = /tr if 块结束后的 return; 行(该块固定 6 行,直接用行区间:起点行到含 'return;' 的块尾)
  const e = lineOf('    if (trimmed === "/tr" || trimmed.indexOf("/tr ") === 0) {');
  if (!e) fail("E9 /tr if 行缺失");
  // 找 if 块的结束(return; 之后紧跟的 '    }')
  let endIdx = e.index;
  const after = t.slice(e.index);
  const blockEnd = after.indexOf("    }\n");
  if (blockEnd === -1) fail("E9 /tr 块尾未找到");
  endIdx = e.index + blockEnd + "    }\n".length;
  const newBlock = [
    "    // COMMUNITY 0.1.0:无桥设置入口。主路径=游戏内可见设置面板(动态 CitadelHTMLPanel,",
    "    // 交互待真机验证);兜底=/tr code <base64>(浏览器 Pages「导出配置码」粘贴导入)。",
    '    if (trimmed === "/tr" || trimmed.indexOf("/tr ") === 0) {',
    "      clearInput();",
    '      const trArg = trimmed.slice(3).trim();',
    '      if (trArg.indexOf("code") === 0) { importCfgCode(trArg.slice(4).trim()); return; }',
    "      togglePagePanel();",
    '      log("UI_OPEN " + trOpenSummary()); // 无桥:设置面板在游戏内;或浏览器打开 ' + "PAGE_URL" + " 的值",
    "      return;",
    "    }",
    "",
  ].join("\n");
  t = t.slice(0, s.index) + newBlock + t.slice(endIdx);
  edits++;
  journal.push("REPLACE-BLOCK E9 /tr (L" + s.no + ")");
}

// =====================================================================
// E10 /bt6736 与 /bt6737 命令块删除(BTIPC 关闭后无意义;lcttest 保留)
// =====================================================================
cutLines(
  "    // /bt6736 [n] [text]: BTIPC v1 回声 conformance",
  "    if (trimmed === \"!lcttest\" || trimmed.indexOf(\"!lcttest \") === 0) {",
  "E10 btipc commands"
);

// =====================================================================
// E11 boot 的 checkBridgeMissing 调度删除(无桥无"桥缺失"概念)
// =====================================================================
replaceLine("$.Schedule(12.0, checkBridgeMissing);", "    // COMMUNITY: checkBridgeMissing 已移除(无桥形态,无桥缺失指引概念)", "E11 checkBridgeMissing");

// =====================================================================
// 终检
// =====================================================================
const mustHave = [
  "const BTIPC_ENABLED = false;",
  'const PAGE_URL = "https://c1375rick.github.io/babeltower-community-pages/";',
  "function hashCfgSync() {",
  "function startPageCfgSync() {",
  "function togglePagePanel() {",
  "function importCfgCode(code) {",
  "startPageCfgSync(); // COMMUNITY",
  '0.1.0-ce',
  "if (BTIPC_ENABLED && BTIPC) {",
];
const mustNotHave = [
  "    syncBridgeConfig();",
  "$.Schedule(12.0, checkBridgeMissing);",
  '"/bt6736"',
  '"/bt6737"',
];
const missingHave = mustHave.filter((m) => t.indexOf(m) === -1);
if (missingHave.length) fail("终检失败(mustHave 缺失): " + missingHave.join(" | "));
const badHave = mustNotHave.filter((m) => t.indexOf(m) !== -1);
if (badHave.length) fail("终检失败(mustNotHave 仍存在): " + badHave.join(" | "));

// DRY 预览先行(括号诊断需要产物;不触碰源文件)
if (DRY) {
  console.log("✓ DRY RUN 通过: " + edits + " 处编辑全部锚点命中,journal 如下(未写入)");
  journal.forEach((j) => console.log("   " + j));
  if (process.env.BTC_TRACE) {
    fs.writeFileSync(path.join(__dirname, "patched_preview.js"), t, "utf8");
    console.log("✓ 预览已写 scripts/patched_preview.js");
  }
  process.exit(0);
}

// 括号/圆括号平衡(仅正式写入前)
const bal = (s, a, b) => {
  let x = 0;
  const src = s.split("\n");
  for (const line of src) {
    const l2 = line.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/\/\/.*$/, "");
    for (const ch of l2) { if (ch === a) x++; if (ch === b) x--; }
  }
  return x;
};
if (bal(t, "{", "}") !== 0) fail("花括号不平衡: {" + bal(t, "{", "}") + ")");
if (bal(t, "(", ")") !== 0) fail("圆括号不平衡: (" + bal(t, "(", ")") + ")");

if (DRY) {
  console.log("✓ DRY RUN 通过: " + edits + " 处编辑全部锚点命中,journal 如下(未写入)");
  journal.forEach((j) => console.log("   " + j));
  process.exit(0);
}

fs.writeFileSync(outPath, hasCRLF ? t.replace(/\n/g, "\r\n") : t, "utf8");
console.log("✓ 已写入: " + edits + " 处编辑," + t.split("\n").length + " 行(" + before.split("\n").length + " 行 → )");
journal.forEach((j) => console.log("   " + j));
