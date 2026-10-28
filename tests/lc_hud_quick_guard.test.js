// 离线护栏:HUD 顶栏行的 quick 判定不得单凭 DOM 标记跳过翻译
// 背景(10-03 实车定位):
//   HUD 顶栏行是统一模板,PingStyleIcon(+SubjectIcon/CooldownTimer/ResponseHeroes)是常驻槽位,
//   打字消息同样命中 → record.quick 恒为 true → shouldSkip 无条件 return true →
//   HUD 气泡 100% 拿不到译文(连 L3378/L3389 的缓存恢复也被 !skipTranslation 拦住)。
//   当天证据:hi/gg/防守分路/FOR THE KING RAAAAH 全部 `diag: quick row hud=1` 后无下文,
//   `translated [hud]` = 0;而 !lcttest ok(无 ping 标记的构造行)全链路走通 → 管线无问题。
// 修复:HUD 行的 quick 标记必须由文本侧(轮盘语料 / 目标语言)再确认才跳过;
//      聊天/大厅行的 PingLabel 是专用标记,保持原行为(16/26 红 fixture 基线不动)。
// 跑法: node tests/lc_hud_quick_guard.test.js
"use strict";
const fs = require("fs");
const path = require("path");
const { matchesQuickTemplate } = require("../core/quickchat_match.js");

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js"),
  "utf8"
);

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS |", label); }
  else { fail++; console.log("  FAIL |", label); }
}

// 从客户端源码提取函数体,在沙箱里执行(客户端依赖 Panorama 全局,无法 require)
function extract(name) {
  const m = SRC.match(new RegExp("  function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}"));
  if (!m) { console.error("FAIL: cannot extract function " + name + " from lingua_chat.js"); process.exit(1); }
  return m[0];
}

const CJK_RE = /[㐀-䶿一-鿿]/;

function makeSkip(cfg) {
  const State = {
    cfg: Object.assign({ force: false, translateOwn: true, targetLanguage: "zh-Hans" }, cfg || {}),
  };
  const factory = new Function(
    "isQuickChatTemplate", "State", "CJK_RE",
    extract("isTargetLanguageText") + "\n" + extract("shouldSkip") + "\nreturn shouldSkip;"
  );
  return factory(matchesQuickTemplate, State, CJK_RE);
}

const skip = makeSkip();
const skipForce = makeSkip({ force: true });
const skipEn = makeSkip({ targetLanguage: "en" });

console.log("--- ① 核心修复:HUD 行打字消息必须送翻译 ---");
ok(skip({ text: "hi", quick: true, hud: true }) === false, "HUD quick=1 + hi  -> 送翻译");
ok(skip({ text: "gg", quick: true, hud: true }) === false, "HUD quick=1 + gg  -> 送翻译");
ok(skip({ text: "FOR THE KING RAAAAH", quick: true, hud: true }) === false, "HUD quick=1 + 实车英文 -> 送翻译");
ok(skip({ text: "hello", quick: true, hud: true }) === false, "HUD quick=1 + hello -> 送翻译");

console.log("--- ② HUD 轮盘/中文仍必须跳过(不能因为放开标记就乱翻) ---");
ok(skip({ text: "前去带线！", quick: true, hud: true }) === true, "HUD 轮盘 前去带线！ -> 模板命中跳过");
ok(skip({ text: "防守分路", quick: true, hud: true }) === true, "HUD 轮盘 防守分路 -> 模板命中跳过");
ok(skip({ text: "撤退", quick: true, hud: true }) === true, "HUD 轮盘 撤退 -> 模板命中跳过");
ok(skip({ text: "去商店", quick: true, hud: true }) === true, "HUD 非语料中文 去商店 -> 目标语言跳过");

console.log("--- ③ 回归护栏:2026-10-28 起 DOM 标记一律经文本硬校验(当日游戏更新后全部行误命中 Ping 标记) ---");
ok(skip({ text: "前去带线！", quick: true, hud: false }) === true, "聊天行 quick + 轮盘模板命中 -> 跳过");
ok(skip({ text: "hi", quick: true, hud: false }) === false, "聊天行 quick + 非语料 -> 送翻译(旧直接跳过已废)");
ok(skip({ text: "哨兵文本", quick: true }) === true, "无 hud 字段(大厅行) + 纯中文 -> 目标语言跳过");
ok(skip({ text: "sentinel text X", quick: true }) === false, "无 hud 字段(大厅行) + 非语料英文 -> 送翻译");

console.log("--- ④ 无标记行的既有判定不受影响 ---");
ok(skip({ text: "hi", quick: false, hud: true }) === false, "HUD 无标记 + hi -> 送翻译");
ok(skip({ text: "防守分路", quick: false, hud: true }) === true, "HUD 无标记 + 已是目标语言 -> 跳过");
ok(skip({ text: "a", quick: false, hud: true }) === true, "长度 < 2 -> 跳过");
ok(skip({ text: "/bt6737 hello", quick: false, hud: true }) === true, "指令消息 -> 跳过");
ok(skip({ text: "123", quick: false, hud: true }) === true, "纯数字 -> 跳过");

console.log("--- ⑤ force / target=en 边界 ---");
ok(skipForce({ text: "hi", quick: true, hud: true }) === false, "force 下 HUD hi 仍翻译");
ok(skipForce({ text: "前去带线！", quick: true, hud: true }) === true, "force 下 HUD 轮盘仍跳过(模板白名单不看 force)");
ok(skipEn({ text: "hi", quick: true, hud: true }) === false, "target=en HUD hi -> 送翻译");
ok(skipEn({ text: "前去带线！", quick: true, hud: true }) === true, "target=en HUD 中文轮盘 -> 模板命中跳过");

console.log("");
console.log("pass=" + pass + " fail=" + fail);
process.exit(fail ? 1 : 0);
