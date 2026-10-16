// fix_gb_copy.js —— 用 ASCII 锚点定点替换 gb_add_update2.js 的 TITLE / CHANGELOG / BLURB。
// 背景: edit 工具对含中文全角引号的长 oldString 匹配不上却报成功,导致改动丢失;
//       本脚本用 indexOf("const TITLE = \"") 之类纯 ASCII 锚点定位,整块替换,并回读自检。
// 排序口径(用户 2026-10-03 定): **本地桥 + 通信层放第一位**,HUD 气泡修复是次要项。
// 用法: node scripts/fix_gb_copy.js
const fs = require("fs");
const P = "F:\\BabelTower\\scripts\\gb_add_update2.js";

let s = fs.readFileSync(P, "utf8");
const before = s;

// ---- 头条:本地桥与通信层 ----
const NEW_TITLE =
  'const TITLE = "1.0.7 本地桥与通信层更新：新增 BTIPC 模块，请整包升级（含 HUD 气泡修复）";';

const NEW_CHANGELOG = `const CHANGELOG = [
  ["Feature", "本地桥与通信层(本版主要改动):新增 core/btipc/ 四个模块,bridge_server.js 由 37,809B 增至 57,524B;出站翻译、入站聊天翻译、配置读写全部改走 BTIPC 信道,替代 6726 版本后失效的 SetURL 导航。规格 docs/btipc-v1.md 已冻结。"],
  ["Bugfix", "必须整包解压覆盖,勿只导入 pak:游戏侧三类任务优先走 BTIPC,旧桥没有 /btipc/dl 端点会让它们超时后按原文发送,配置操作返回 ok:false。"],
  ["Bugfix", "次要修复——HUD 顶栏气泡不挂译文:顶栏是统一模板,PingStyleIcon 等常驻槽位被递归匹配误判成快捷语音,导致译文永远挂不上;现要求 quick 有文本侧佐证才跳过,聊天/大厅行行为一字不变。"],
  ["Feature", "沿用 1.0.6:游戏内 UMM 设置窗口出现「巴别塔」标签页,10 项常用设置直接改,即时生效并双向持久化;不装 UMM 完全不影响本 mod。"],
];`;

const NEW_BLURB =
  'const BLURB = "本版的主要改动在**本地桥与通信层**:新增 core/btipc/ 四个模块(BTIPC v1),出站翻译、入站聊天翻译、配置读写全部改走这条新信道,替代 6726 版本后失效的 SetURL 导航。因此必须整包解压覆盖、勿只导入 pak —— 只导 pak 会让翻译链路超时后按原文发送。次要修复:HUD 顶栏气泡此前因快捷语音误判而不挂译文,现已修复。安装(3 步):解压 zip → Mod Manager 导入 pak01_dir.vpk → powershell -ExecutionPolicy Bypass -File scripts\\\\autostart.ps1 -Action Install,然后游戏内 /tr → 测试 → 保存。详细说明见包内《安装使用说明.txt》。";';

function replaceBlock(src, startAnchor, endAnchor, repl) {
  const i = src.indexOf(startAnchor);
  if (i < 0) return { ok: false, why: "start not found: " + startAnchor };
  const j = src.indexOf(endAnchor, i + startAnchor.length);
  if (j < 0) return { ok: false, why: "end not found: " + endAnchor };
  const end = j + endAnchor.length;
  return { ok: true, src: src.slice(0, i) + repl + src.slice(end) };
}

// ---- 0) TITLE ----
{
  const t = replaceBlock(s, 'const TITLE = "', '";', NEW_TITLE);
  console.log("TITLE:", JSON.stringify({ ok: t.ok, why: t.why || null }));
  if (t.ok) s = t.src;
}

// ---- 1) CHANGELOG ----
let r = replaceBlock(s, "const CHANGELOG = [", "];", NEW_CHANGELOG);
console.log("CHANGELOG:", JSON.stringify({ ok: r.ok, why: r.why || null }));
if (r.ok) s = r.src;

// ---- 2) BLURB ----
r = replaceBlock(s, 'const BLURB = "', '";', NEW_BLURB);
console.log("BLURB:", JSON.stringify({ ok: r.ok, why: r.why || null }));
if (r.ok) s = r.src;

if (s === before) {
  console.log("NO CHANGE —— 未写入");
  process.exit(2);
}
fs.writeFileSync(P, s, "utf8");
console.log("WROTE", P, before.length, "->", s.length);

// ---- 3) 回读自检 ----
const chk = fs.readFileSync(P, "utf8");
const nChangelog = (chk.match(/\["(Feature|Improvement|Bugfix|Note)", /g) || []).length;
const tests = [
  ["TITLE 头条=桥/通信层", chk.includes("本地桥与通信层更新")],
  ["TITLE 非 UMM 头条", !chk.includes('const TITLE = "1.0.7 新功能：UMM')],
  ["changelog 第1条=桥/通信层", chk.indexOf('["Feature", "本地桥与通信层') > -1],
  ["HUD 条目仍在(且非首位)", chk.indexOf('["Bugfix", "次要修复') > -1],
  ["4 条 changelog", nChangelog === 4],
  ["旧桥句已删", !chk.includes("本地桥无变化")],
  ["新桥句在", chk.includes("只导 pak 会让翻译链路超时后按原文发送")],
  ["勾选 107", chk.includes("babeltower-107-win64")],
];
tests.forEach(([n, ok]) => console.log("  " + (ok ? "OK  " : "FAIL") + " " + n));
if (tests.some(([, ok]) => !ok)) process.exit(1);
console.log("ALL OK");
