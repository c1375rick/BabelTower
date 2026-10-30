// gb_update_124 补丁:自动挂 zip 三路线全静默失败(GB 组件行为变化),改为
// 人工挂文件 + 脚本做后续(等新行 → 填版本 → 双写描述 → 停给人工 Save)。
const fs = require("fs");
const path = require("path");
const f = path.join(__dirname, "gb_update_124.js");
let t = fs.readFileSync(f, "utf8");

const startMark = "  // ---- 1. attach the zip through the page's own file chooser ----";
const endMark = "  // ---- 2. version ONLY on the new (last) row ----";
const i1 = t.indexOf(startMark);
const i2 = t.indexOf(endMark);
if (i1 === -1 || i2 === -1 || i2 <= i1) { console.error("markers missing"); process.exit(1); }

const manual = [
  "  // ---- 1. 人工挂 zip(2026-10-30:自动三路线全静默失败,GB 组件行为变化)----",
  "  const rowsBefore = await page.evaluate(() => document.querySelectorAll('input[name=\"_sVersion\"]').length);",
  "  console.log(\"VERSION ROWS BEFORE: \" + rowsBefore);",
  "  console.log(\"\");",
  "  console.log(\">>> 人工步骤:在 Edge 窗口里滚动到 Files 区,点该区的 Select files,\");",
  "  console.log(\">>>          选择 dist\\\\BabelTower-1.2.4-win64.zip,等新行出现(上传约 1-2 分钟)。\");",
  "  console.log(\">>>          脚本每 10 秒自动检测新行,最长等 15 分钟。\");",
  "  console.log(\"\");",
  "  let rowsAfter = rowsBefore;",
  "  const waitStart = Date.now();",
  "  while (Date.now() - waitStart < 15 * 60 * 1000) {",
  "    await sleep(10000);",
  "    rowsAfter = await page.evaluate(() => document.querySelectorAll('input[name=\"_sVersion\"]').length);",
  "    const shown = await page.evaluate(() => document.body.innerText.indexOf(\"BabelTower-1.2.4-win64.zip\") !== -1);",
  "    const mins = Math.round((Date.now() - waitStart) / 60000 * 10) / 10;",
  "    console.log(\"  t=\" + mins + \"min rows=\" + rowsAfter + \" zipShown=\" + shown);",
  "    if (rowsAfter > rowsBefore) { console.log(\"  ✓ 新文件行已出现!\"); break; }",
  "  }",
  "  if (rowsAfter <= rowsBefore) { console.log(\"15 分钟内未检测到新行 —— 停止(未保存任何东西)。\"); await browser.close(); process.exit(1); }",
  "",
].join("\n");

t = t.slice(0, i1) + manual + "\n" + t.slice(i2);
fs.writeFileSync(f, t, "utf8");
console.log("patched, size=" + t.length);