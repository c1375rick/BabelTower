// 回归护栏:面板通道(SetURL 导航)判死冷却 + 日志限流。
// 教训来源:2026-10-03 —— 6726 后 $.AsyncWebRequest 被移除、面板 SetURL 导航也整条失效,
// 每次 nav 都是 src="" 页面从未加载,而 health(每 5s)+ chat log flush 会不断重试,
// 于是 `bridge nav failed: panel dead (no lct-alive within 1.5s)` 每 15s 刷一条死链日志。
// 本护栏锁死三件事,任一被改回去都会复发:
//   1. 硬死签名(src 为空)累计判死,够 PANEL_NAV_DEAD_STREAK 次进冷却(加载慢不计数)
//   2. 冷却内 dispatchViaPanel 不导航直接快速失败(不打日志)
//   3. 细节日志全程只打一次,离线复探直连通道限流 CANHTTP_REPROBE_MS
//
// 2026-10-15 增补(https 面板通道上线):第 2 条的适用范围被收窄为 **http 面板通道**。
// navDeadUntil 是 http 通道的判死结论,而 config/test/log 三个 op 至今仍走 http,
// 在当前 build 上必然连撞 src="" 而进冷却 —— 若 https 通道也受它约束,一次 http 判死
// 会顺手压掉能用的 https 通道 10 分钟,且日志里只看得到 http 的死链记录,极难归因。
// 因此 navSuppressedFor(hooks) 给 httpsChannel 一个显式豁免;护栏改为同时钉死
// 「http 仍受冷却约束」与「豁免必须显式声明」两侧,防止豁免被扩大到所有通道。
"use strict";
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
const src = fs.readFileSync(SRC, "utf8");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  [" + extra + "]" : "")); }
}

// ---- 1. 常量与 State 字段 ----
const streakM = src.match(/const PANEL_NAV_DEAD_STREAK = (\d+)/);
check("判死门槛 PANEL_NAV_DEAD_STREAK 定义", !!streakM && Number(streakM[1]) >= 2,
  streakM ? "got=" + streakM[1] : "缺失 → 一次抖动就长期禁用面板通道");
const coolM = src.match(/const PANEL_NAV_COOLDOWN_MS = (\d+)/);
check("冷却 PANEL_NAV_COOLDOWN_MS ≥5min(冷却到点自动复探)", !!coolM && Number(coolM[1]) >= 300000,
  coolM ? "got=" + coolM[1] : "缺失 → 冷却过短则死链日志又变密");
check("离线复探直连限流 CANHTTP_REPROBE_MS 定义",
  /const CANHTTP_REPROBE_MS = \d+/.test(src));
check("State 字段齐全", /navDeadStreak: 0/.test(src) && /navDeadUntil: 0/.test(src) &&
  /navDeadLogged: false/.test(src) && /canHttpLastProbe: 0/.test(src));

// ---- 2. panelNavSuppressed 存在且被 dispatchViaPanel 使用 ----
const supIdx = src.indexOf("function panelNavSuppressed()");
check("panelNavSuppressed 已定义", supIdx > 0, "idx=" + supIdx);
// 2026-10-15:入口判定改成 navSuppressedFor(hooks)(https 通道显式豁免 http 的冷却),
// 冷却本身仍必须由 panelNavSuppressed 决定 —— 护栏钉死这条因果链不被绕过。
const gateIdx = src.indexOf("navSuppressedFor(hooks) ? null : ensurePanel()");
check("dispatchViaPanel 经 navSuppressedFor 决定是否导航",
  gateIdx > supIdx && gateIdx > 0, "gateIdx=" + gateIdx);
const gateSrc = (src.match(/const navSuppressedFor = \(hooks\) =>[^\n]*/) || [])[0] || "";
check("navSuppressedFor 只给 httpsChannel 豁免(不得无条件放行)",
  /hooks && hooks\.httpsChannel \? false : panelNavSuppressed\(\)/.test(gateSrc), gateSrc);
check("https 豁免必须由 dispatchJob 显式声明",
  /httpsChannel: true/.test(src));
const useIdx = gateIdx;
check("dispatchViaPanel 冷却内不导航(直接走 !panel 快速失败分支)",
  useIdx > supIdx && useIdx > 0, "useIdx=" + useIdx);
// 2026-10-30:ensureBridgeEvents 现在带 panel 参数,锚点放宽为前缀匹配
const ebStart = src.indexOf("ensureBridgeEvents(", useIdx);
const branchEnd = ebStart > useIdx ? src.indexOf(");", ebStart) + 2 : -1;
const branchBody = useIdx > 0 && branchEnd > useIdx ? src.slice(useIdx, branchEnd) : "";
check("冷却内快速失败不打日志(复用原 !panel 分支,零 log)",
  !!branchBody && !/log\(/.test(branchBody), branchBody ? "" : "未切到 !panel 分支");
check("降级钩子走 handOff 包装(异常日志不在热路径)",
  /function handOff\(hooks, payload\)/.test(src) &&
  /if \(handOff\(hooks, \{ ok: false, error: "bridge_panel_unavailable" \}\)\) return;/.test(branchBody),
  "钩子若内联 try/catch+log 就会破坏上一条断言");

// ---- 3. panelNavSuppressed 行为(抽到沙箱,接真实 State/nowMs 语义) ----
const supSrc = (src.match(/function panelNavSuppressed\(\) \{[\s\S]*?\n  \}/) || [])[0];
check("抽到 panelNavSuppressed 源码", !!supSrc);
if (supSrc) {
  const run = new Function("State", "nowMs", "return (" + supSrc + ")();");
  const S1 = { navDeadUntil: 900000 };
  check("冷却中返回 true(抑制导航)", run(S1, function () { return 500000; }) === true);
  const S2 = { navDeadUntil: 400000 };
  check("冷却已过返回 false(允许复探)", run(S2, function () { return 500000; }) === false);
  const S3 = { navDeadUntil: 0 };
  check("未判死返回 false(默认可导航)", run(S3, function () { return 500000; }) === false);
}

// ---- 4. pollTitle 失败分支:硬死签名累计 + 进冷却 + 日志限流 ----
const failIdx = src.indexOf('if (!pending.sawAlive && nowMs() - pending.startedAt > BRIDGE_ALIVE_SECONDS * 1000)');
check("找到导航失败快速判定分支", failIdx > 0, "idx=" + failIdx);
const failBody = failIdx > 0 ? src.slice(failIdx, failIdx + 1400) : "";
check("只按硬死签名 src=\"\" 累计(加载慢不计数,避免误杀)",
  /indexOf\('src=""'\) !== -1\) State\.navDeadStreak \+= 1/.test(failBody));
check("达到门槛进冷却并写 navDeadUntil",
  /State\.navDeadStreak >= PANEL_NAV_DEAD_STREAK/.test(failBody) &&
  /State\.navDeadUntil = nowMs\(\) \+ PANEL_NAV_COOLDOWN_MS/.test(failBody));
check("细节日志被 navDeadLogged 限流(全程仅一次)",
  /else if \(!State\.navDeadLogged\)/.test(failBody) && /State\.navDeadLogged = true/.test(failBody));
check("进冷却只打一条摘要日志",
  /log\("bridge nav: panel channel dead/.test(failBody));

// ---- 5. 死链日志全源只有一处受控出口(注释里提名字不算) ----
const navLogCount = (src.match(/log\("bridge nav failed: panel dead/g) || []).length;
check("bridge nav failed 日志仅 1 处(受 navDeadLogged 限流)", navLogCount === 1, "count=" + navLogCount);
const navSumCount = (src.match(/log\("bridge nav: panel channel dead/g) || []).length;
check("进冷却摘要日志仅 1 处", navSumCount === 1, "count=" + navSumCount);

// ---- 6. 导航成功时清除判死状态(通道恢复自愈) ----
const aliveIdx = src.indexOf("if (title === TITLE_ALIVE)");
const aliveBody = aliveIdx > 0 ? src.slice(aliveIdx, aliveIdx + 300) : "";
check("导航成功清零 navDeadStreak/navDeadUntil(自愈)",
  /State\.navDeadStreak = 0/.test(aliveBody) && /State\.navDeadUntil = 0/.test(aliveBody));

// ---- 7. 离线复探直连通道限流(否则每 5s 刷一条 reset 日志) ----
check("detectAsyncWebRequest 记录 canHttpLastProbe",
  /State\.canHttp = ok;\s*\n\s*State\.canHttpLastProbe = nowMs\(\);/.test(src));
const reprobeIdx = src.indexOf('log("bridge channel: reset to re-probe direct');
const reprobeBody = reprobeIdx > 0 ? src.slice(reprobeIdx - 400, reprobeIdx) : "";
check("找到复位直连通道日志", reprobeIdx > 0, "idx=" + reprobeIdx);
check("复位直连通道受 CANHTTP_REPROBE_MS 限流",
  /nowMs\(\) - State\.canHttpLastProbe >= CANHTTP_REPROBE_MS/.test(reprobeBody));
const reprobeCount = (src.match(/log\("bridge channel: reset to re-probe direct/g) || []).length;
check("reset 日志仅 1 处", reprobeCount === 1, "count=" + reprobeCount);

console.log("\nRESULT: PASS " + pass + " / FAIL " + fail);
process.exit(fail ? 1 : 0);
