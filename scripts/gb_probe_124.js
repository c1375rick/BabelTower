// GB 深度探针(2026-10-30):为什么 zip 三条路线都静默失败?
// 观测点:① 上传 XHR 的真实 URL+状态码 ② 页面 JS 异常 ③ Files 区 DOM 结构
// ④ 20 行是否为文件数上限(找 Max 提示/删除按钮) ⑤ 全页截图
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const ROOT = path.join(__dirname, "..");
const zip = path.join(ROOT, "dist", "BabelTower-1.2.4-win64.zip");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, userDataDir: PROFILE, headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");

  const net = [];
  page.on("response", (res) => {
    const m = res.request().method();
    if (m !== "GET" || res.status() >= 400) {
      net.push(m + " " + res.status() + " " + res.url().slice(0, 110));
    }
  });
  page.on("pageerror", (e) => net.push("PAGEERROR: " + e.message.slice(0, 110)));
  page.on("console", (msg) => {
    if (msg.type() === "error") net.push("CONSOLE-ERR: " + msg.text().slice(0, 110));
  });

  await page.goto("https://gamebanana.com/mods/edit/700107", { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(6000);

  const rows0 = await page.evaluate(() => document.querySelectorAll('input[name="_sVersion"]').length);
  console.log("rows0=" + rows0 + "  url=" + page.url().slice(0, 90));

  // Files 区 DOM 结构
  const filesInfo = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].filter((x) => /select files/i.test(x.innerText || ""));
    const last = btns[btns.length - 1];
    const inputId = last && last.id ? last.id.replace(/_FileSelector$/, "_FileInput") : null;
    const input = inputId ? document.getElementById(inputId) : null;
    // 找 Files 区附近的提示文字(文件数上限等)
    const hint = [];
    document.querySelectorAll("*").forEach((e) => {
      if (e.children.length) return;
      const s = (e.innerText || "").trim();
      if (/max|limit|上限|最多|file.*count|20 files/i.test(s) && s.length < 120 && !/cookie|login/i.test(s)) {
        if (/file|upload|attach/i.test(s)) hint.push(s);
      }
    });
    return {
      selectBtns: btns.length,
      btnIds: btns.map((b) => b.id || "(no-id)"),
      inputId: inputId,
      inputExists: !!input,
      accept: input ? input.accept : null,
      hints: [...new Set(hint)].slice(0, 6),
    };
  });
  console.log("FILES 区: " + JSON.stringify(filesInfo, null, 1));

  // 滚到 Files 区 + 全页截图
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].filter((x) => /select files/i.test(x.innerText || ""));
    if (btns.length) btns[btns.length - 1].scrollIntoView({ block: "center" });
  });
  await sleep(1500);
  await page.screenshot({ path: "dist/gb_probe_files.png", fullPage: false });
  await page.screenshot({ path: "dist/gb_probe_full.png", fullPage: true });
  console.log("screenshots saved");

  // 附加 + 盯网络 45s
  const accepted = await Promise.all([
    page.waitForFileChooser({ timeout: 45000 }).catch(() => null),
    page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")].filter((x) => /select files/i.test(x.innerText || ""));
      const last = btns[btns.length - 1];
      if (last) last.click();
    }),
  ]);
  if (accepted[0]) { await accepted[0].accept([zip]); console.log("chooser accepted"); }
  else console.log("NO fileChooser appeared");

  for (let i = 0; i < 9; i++) {
    await sleep(5000);
    const st = await page.evaluate(() => ({
      rows: document.querySelectorAll('input[name="_sVersion"]').length,
      shown: document.body.innerText.indexOf("BabelTower-1.2.4-win64.zip") !== -1,
    }));
    console.log("t=" + ((i + 1) * 5) + "s rows=" + st.rows + " shown=" + st.shown);
    if (st.rows > rows0 || st.shown) break;
  }
  console.log("---- 非GET/异常网络活动 ----");
  net.slice(0, 15).forEach((n) => console.log("  " + n));
  await page.screenshot({ path: "dist/gb_probe_after.png" });
  await browser.close();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
