// 一次性补丁:hash 通道接线(模拟环境首测发现的两处断线)。
//   ① hashBase 捕获永远失败:settleProbe 读 State.pending.navUrl 时 pending 已被置
//      null → hashBase 恒为空串。改为在探针派发处直接捕获(此时 URL 就在手边)。
//   ② hash 派发分支只 setPending 不导航:全仓库没有任何代码构造 #LCTQ: 请求 URL,
//      页面永远收不到 hash → 作业必超时连击降级。补上 SetURL(hashBase#LCTQ:payload),
//      分支守卫加 State.hashBase(无 base 自动落 nav 兜底,不挂死)。
const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
let t = fs.readFileSync(file, "utf8");
if (t.includes("hash 通道接线")) { console.log("already patched"); process.exit(0); }

// ---- ① hashBase 捕获(探针派发处) ----
const m1 = t.match(/const probeUrl = "https:\/\/" \+ HTTPS_PANEL_HOST \+ ":" \+ HTTPS_PANEL_PORT \+\r?\n      "\/bridge\?op=health&id=probe&boot=1&lang=" \+ gameUiLang\(\);/);
if (!m1) { console.error("anchor1 missing"); process.exit(1); }
t = t.replace(m1[0], m1[0] + "\n    // 2026-10-30 模拟环境首测:hash 通道 base 在派发处捕获——settleProbe 读\n" +
  "    // State.pending.navUrl 时 pending 已置 null,原捕获路径永远拿空串。\n" +
  "    State.hashBase = probeUrl;");

// ---- ② 分支守卫加 hashBase ----
const m2 = t.match(/if \(State\.hashReady && !forceHttp\) \{/);
if (!m2) { console.error("anchor2 missing"); process.exit(1); }
t = t.replace(m2[0], "if (State.hashReady && State.hashBase && !forceHttp) {");

// ---- ③ hash 分支补 SetURL ----
const m3 = t.match(/(      try \{ if \(State\.pending\) State\.pending\.sawAlive = true; \} catch \(eSA\) \{\}\r?\n      try \{ if \(State\.pending\) State\.pending\.navUrl = null; \} catch \(eNU\) \{\}\r?\n)(      return;)/);
if (!m3) { console.error("anchor3 missing"); process.exit(1); }
const insert = [
  "      // 2026-10-30 模拟环境首测:此分支原先只 setPending 不导航,页面永远收不到",
  "      # hash,作业必超时连击降级(hash 通道从未接线)。真正把请求送到常驻页面:",
  "      try {",
  "        const hp = ensurePanel();",
  "        if (isValid(hp) && typeof hp.SetURL === \"function\") {",
  "          hp.SetURL(State.hashBase + \"#LCTQ:\" + encodeURIComponent(JSON.stringify(payload)));",
  "        }",
  "      } catch (eHU) {}",
].join("\n").replace("      # hash", "      // hash");
t = t.replace(m3[0], m3[1] + insert + "\n" + m3[2]);

fs.writeFileSync(file, t, "utf8");
console.log("patched, size=" + t.length);
