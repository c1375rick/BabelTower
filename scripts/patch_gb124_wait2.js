// gb_update_124 补丁二:① 等待 30min,成功信号 = 页面出现 zip 文件名(删旧行不误判)
// ② 版本号填到包含 1.2.4 文件名的那一行(不再盲填最后一行)
const fs = require("fs");
const path = require("path");
const f = path.join(__dirname, "gb_update_124.js");
let t = fs.readFileSync(f, "utf8");

const old1 = [
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
].join("\n");
const new1 = [
  "  let rowsAfter = rowsBefore;",
  "  let zipShownOnce = false;",
  "  const waitStart = Date.now();",
  "  while (Date.now() - waitStart < 30 * 60 * 1000) {",
  "    await sleep(10000);",
  "    rowsAfter = await page.evaluate(() => document.querySelectorAll('input[name=\"_sVersion\"]').length);",
  "    zipShownOnce = await page.evaluate(() => document.body.innerText.indexOf(\"BabelTower-1.2.4-win64.zip\") !== -1);",
  "    const mins = Math.round((Date.now() - waitStart) / 60000 * 10) / 10;",
  "    console.log(\"  t=\" + mins + \"min rows=\" + rowsAfter + \" zipShown=\" + zipShownOnce);",
  "    if (zipShownOnce) { console.log(\"  ✓ 1.2.4 zip 已出现在页面!\"); break; }",
  "  }",
  "  if (!zipShownOnce) { console.log(\"30 分钟内未检测到 1.2.4 zip —— 停止(未保存任何东西)。\"); await browser.close(); process.exit(1); }",
].join("\n");
if (!t.includes(old1)) { console.error("anchor1 missing"); process.exit(1); }
t = t.replace(old1, new1);

// 版本号精准定位:包含 1.2.4 zip 名的行里的版本输入框
const old2 = [
  "  await page.evaluate((v) => {",
  "    const list = [...document.querySelectorAll('input[name=\"_sVersion\"]')];",
  "    const last = list[list.length - 1];",
  "    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, \"value\").set;",
  "    setter.call(last, v);",
  "    last.dispatchEvent(new Event(\"input\", { bubbles: true }));",
  "    last.dispatchEvent(new Event(\"change\", { bubbles: true }));",
  "  }, NEW_VERSION);",
].join("\n");
const new2 = [
  "  await page.evaluate((v) => {",
  "    const list = [...document.querySelectorAll('input[name=\"_sVersion\"]')];",
  "    // 找包含 1.2.4 zip 文件名的那一行(LI 祖先文本),没有就退回最后一行",
  "    let target = list[list.length - 1];",
  "    for (const inp of list) {",
  "      let el = inp;",
  "      for (let i = 0; i < 6 && el; i++) {",
  "        if ((el.innerText || el.textContent || \"\").indexOf(\"BabelTower-1.2.4-win64.zip\") !== -1) { target = inp; el = null; i = 99; break; }",
  "        el = el.parentElement;",
  "      }",
  "    }",
  "    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, \"value\").set;",
  "    setter.call(target, v);",
  "    target.dispatchEvent(new Event(\"input\", { bubbles: true }));",
  "    target.dispatchEvent(new Event(\"change\", { bubbles: true }));",
  "  }, NEW_VERSION);",
].join("\n");
if (!t.includes(old2)) { console.error("anchor2 missing"); process.exit(1); }
t = t.replace(old2, new2);

fs.writeFileSync(f, t, "utf8");
console.log("patched, size=" + t.length);