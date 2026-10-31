// 测试改造:出站方向端到端断言——中文文本 + en 目标 → 译文必须是英文(非 no-op)。
const fs = require("fs");
const testF = __dirname + "/../tests/lc_sim_outgoing_dirty.test.js";
let t = fs.readFileSync(testF, "utf8");
let n = 0;

// T2(zh-Hans 阶段):hello → zh 方向,译文应为中文(≠ hello)
const oldT2 = [
  "    // T2:该方向下派发目标(确定性断言,不依赖 provider 成功)",
  "    check(\"T2 派发方向=zh-Hans\", LCTNS.resolveOutgoingTarget() === \"zh-Hans\",",
  "      \"resolveOutgoingTarget=\" + LCTNS.resolveOutgoingTarget());",
  "    await settleOutgoing(\"hello\", \"zh-Hans\"); // 冒烟:作业能走完整链",
  "    await sim.sleep(300);",
].join("\n");
const newT2 = [
  "    // T2:该方向下派发目标 + 端到端方向(hello → 中文译文)",
  "    check(\"T2 派发方向=zh-Hans\", LCTNS.resolveOutgoingTarget() === \"zh-Hans\",",
  "      \"resolveOutgoingTarget=\" + LCTNS.resolveOutgoingTarget());",
  "    const r2 = await settleOutgoing(\"hello\", \"zh-Hans\");",
  "    check(\"T2b 译文非原文(方向生效)\", !!(r2 && r2.translation && r2.translation !== \"hello\"),",
  "      \"translation=\" + JSON.stringify(r2 && r2.translation).slice(0, 60));",
].join("\n");
if (t.includes(oldT2)) { t = t.replace(oldT2, newT2); n++; } else console.log("T2 anchor missing");

// T4(en 阶段):中文文本 → 译文应为英文(≠ 原文)——回归锁:字段名 targetLanguage
const oldT4 = [
  "    // T4:该方向下派发目标(方向正确性回归锁)",
  "    check(\"T4 派发方向=en\", LCTNS.resolveOutgoingTarget() === \"en\",",
  "      \"resolveOutgoingTarget=\" + LCTNS.resolveOutgoingTarget());",
  "    await settleOutgoing(\"hello\", \"en\"); // 冒烟:作业能走完整链",
  "    await sim.sleep(300);",
].join("\n");
const newT4 = [
  "    // T4:该方向下派发目标 + 端到端方向(中文名 → 英文译文)——hash 字段名回归锁",
  "    check(\"T4 派发方向=en\", LCTNS.resolveOutgoingTarget() === \"en\",",
  "      \"resolveOutgoingTarget=\" + LCTNS.resolveOutgoingTarget());",
  "    const r4 = await settleOutgoing(\"你好\", \"en\");",
  "    check(\"T4b 译文是英文(非 no-op)\", !!(r4 && r4.translation && r4.translation !== \"你好\"),",
  "      \"translation=\" + JSON.stringify(r4 && r4.translation).slice(0, 60));",
].join("\n");
if (t.includes(oldT4)) { t = t.replace(oldT4, newT4); n++; } else console.log("T4 anchor missing");

fs.writeFileSync(testF, t, "utf8");
console.log("done, edits=" + n);
