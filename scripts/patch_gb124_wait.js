// gb_update_124 增强补丁:fileChooser 后等 300s(40MB 上传服务端耗时)、截图取证、
// 捕获页面错误提示。2016-10-22 的 1.2.2 成功流程不变,只放宽等待与加观测。
const fs = require("fs");
const path = require("path");
const f = path.join(__dirname, "gb_update_124.js");
let t = fs.readFileSync(f, "utf8");

// ① fileChooser 分支:120s → 300s,期间每 15s 截图 + 抓页面可见错误
const old1 = [
  "      console.log(\"ZIP ACCEPTED VIA FILECHOOSER:\", zip);",
  "      let waited2 = 0;",
  "      while (waited2 < 120000) {",
  "        await sleep(5000); waited2 += 5000;",
  "        rowsAfter = await page.evaluate(() => document.querySelectorAll('input[name=\"_sVersion\"]').length);",
  "        if (rowsAfter > rowsBefore) break;",
  "      }",
  "      console.log(\"  fileChooser -> rows=\" + rowsAfter);",
].join("\n");
const new1 = [
  "      console.log(\"ZIP ACCEPTED VIA FILECHOOSER:\", zip);",
  "      let waited2 = 0;",
  "      let shotN = 0;",
  "      while (waited2 < 300000) {",
  "        await sleep(5000); waited2 += 5000;",
  "        rowsAfter = await page.evaluate(() => document.querySelectorAll('input[name=\"_sVersion\"]').length);",
  "        const shown = await page.evaluate(() => document.body.innerText.indexOf(\"BabelTower-1.2.4-win64.zip\") !== -1);",
  "        const errs = await page.evaluate(() => {",
  "          const out = [];",
  "          document.querySelectorAll(\"[class*='Alert'],[class*='alert'],[role='alert'],.Toast,.toast\").forEach((e) => {",
  "            const s = (e.innerText || \"\").trim();",
  "            if (s && s.length < 200) out.push(s);",
  "          });",
  "          return out.slice(0, 3);",
  "        });",
  "        console.log(\"  t=\" + Math.round(waited2 / 1000) + \"s rows=\" + rowsAfter + \" shown=\" + shown + (errs.length ? \" alerts=\" + JSON.stringify(errs) : \"\"));",
  "        if (rowsAfter > rowsBefore || shown) {",
  "          try { await page.screenshot({ path: \"dist/gb_attach_ok.png\" }); } catch (e) {}",
  "          break;",
  "        }",
  "        if (waited2 % 15000 === 0) {",
  "          try { await page.screenshot({ path: \"dist/gb_attach_wait\" + (++shotN) + \".png\" }); } catch (e) {}",
  "        }",
  "      }",
  "      console.log(\"  fileChooser -> rows=\" + rowsAfter);",
].join("\n");
if (!t.includes(old1)) { console.error("anchor1 missing"); process.exit(1); }
t = t.replace(old1, new1);

// ② "FILE SHOWN ON PAGE" 的文件名检查已是 1.2.4(make 脚本替换过)——确认
console.log("文件名检查 1.2.4: " + t.includes("BabelTower-1.2.4-win64.zip\" )"));
fs.writeFileSync(f, t, "utf8");
console.log("patched, size=" + t.length);