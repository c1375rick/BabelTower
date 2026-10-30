// gb_update_124 补丁三:GB 会把上传文件名转成小写去点号加哈希尾巴
// (BabelTower-1.2.4-win64.zip → babeltower-124-win64_xxxxx.zip),
// 原文精确匹配永远不中。改 /124-win64/i 宽松匹配(检测 + 版本行定位两处)。
const fs = require("fs");
const path = require("path");
const f = path.join(__dirname, "gb_update_124.js");
let t = fs.readFileSync(f, "utf8");

const old1 = '    zipShownOnce = await page.evaluate(() => document.body.innerText.indexOf("BabelTower-1.2.4-win64.zip") !== -1);';
const new1 = '    zipShownOnce = await page.evaluate(() => /124-win64/i.test(document.body.innerText));';
if (!t.includes(old1)) { console.error("anchor1 missing"); process.exit(1); }
t = t.replace(old1, new1);

const old2 = '      if ((el.innerText || el.textContent || "").indexOf("BabelTower-1.2.4-win64.zip") !== -1) { target = inp; el = null; i = 99; break; }';
const new2 = '      if (/124-win64/i.test(el.innerText || el.textContent || "")) { target = inp; el = null; i = 99; break; }';
if (!t.includes(old2)) { console.error("anchor2 missing"); process.exit(1); }
t = t.replace(old2, new2);

fs.writeFileSync(f, t, "utf8");
console.log("patched, size=" + t.length);