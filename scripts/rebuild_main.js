// 从 0a29167 重建工作树 lingua_chat.js + 重放两个未提交评审修复。
// 背景:行定位补丁在混合换行文件上 splice 失控,工作树丢失多个已提交块
// (LCTBTIPC 解构块/handleChatSubmit/clearDirtyForPaths 等),已由 inspect_base.js
// 确认 0a29167 blob 完整(12/12 标记,纯 LF)。
// 安全策略:全部编辑在内存完成、每个锚点严格校验(缺失即退出、绝不写半成品)、
// 最后一次性写入。
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const COMMIT = "0a29167";
const rel = "mod/panorama/scripts/lingua_chat.js";
const outPath = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat.js");
let t = execSync(`git show ${COMMIT}:${rel}`, { encoding: "utf8", maxBuffer: 50e6 });
let edits = 0;

// ---- ② resolveOutgoingTarget:convar 优先 (conc-1/conc-5) ----
// 双上下文下差分应用发生在拉取的上下文,另一上下文的 State.cfg.outgoingTarget 滞后
// 60-120s;convar(lct_ui)全局共享,saveUiConfig 在差分应用时立即写入——唯一跨上下文新鲜源。
const oldFn = [
  "  function resolveOutgoingTarget() {",
  "    let lang = State.cfg.outgoingTarget || \"en\";",
  "    if (lang === \"custom\") {",
  "      lang = fieldValue(\"LCTOutgoingTargetCustom\") || \"en\";",
  "    }",
  "    return lang;",
  "  }",
].join("\n");
const newFn = [
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
  "  }",
].join("\n");
if (t.includes("convar 优先")) {
  console.log("② 已存在,跳过");
} else if (t.includes(oldFn)) {
  t = t.replace(oldFn, newFn);
  edits++;
  console.log("② resolveOutgoingTarget: convar 优先 ✓(精确替换)");
} else {
  console.error("② 锚点缺失!中止(未写入)"); process.exit(1);
}

// ---- ③ 陈旧差分丢弃后 2s 立即重同步 (conc-2) ----
// 丢弃后原本干等 60s 兜底轮询;重试携带已推进的 rev,桥历史必有基线,一轮收敛。
if (t.includes("丢弃后 2s 立即重同步")) {
  console.log("③ 已存在,跳过");
} else {
  const lines = t.split("\n");
  const di = lines.findIndex((l) => l.includes("stale delta discarded"));
  if (di === -1) { console.error("③ 丢弃日志行缺失!中止(未写入)"); process.exit(1); }
  // 其后 3 行内必须是 return false;(trim 匹配,换行符容错)
  let ri = -1;
  for (let k = di + 1; k <= Math.min(di + 3, lines.length - 1); k++) {
    if (lines[k].trim() === "return false;") { ri = k; break; }
  }
  if (ri === -1) { console.error("③ return false 未找到!中止(未写入)"); process.exit(1); }
  const retry = [
    "          // conc-2 评审修复:丢弃后 2s 立即重同步(携带已推进的 rev,一次即收敛),",
    "          // 不干等 60s 兜底轮询。重试发送的是当前 rev → 桥历史必有基线 → 一轮收敛。",
    "          try { $.Schedule(2.0, function () { try { syncConfigDelta(onDone); } catch (eR) {} }); } catch (eR2) {}",
  ];
  lines.splice(ri, 0, ...retry);
  t = lines.join("\n");
  edits++;
  console.log("③ 陈旧差分丢弃后 2s 重同步 ✓(插于 L" + (ri + 1) + ")");
}

// ---- 终检:基底标记 + 新修复标记,全过才写入 ----
const must = [
  "const BTIPC = LCTBTIPC.BTIPC;",
  "function handleChatSubmit(input) {",
  "function clearDirtyForPaths",
  'log("hash dispatch: ctx="',
  "主文件引用的面板全局函数在此兜底",
  "\\p{L}/u",
  "convar 优先",
  "丢弃后 2s 立即重同步",
];
const missing = must.filter((m) => !t.includes(m));
if (missing.length) { console.error("终检失败,缺: " + missing.join(" | ") + "(未写入)"); process.exit(1); }

fs.writeFileSync(outPath, t, "utf8");
console.log("已写入 " + edits + " 处编辑,共 " + t.split("\n").length + " 行");
