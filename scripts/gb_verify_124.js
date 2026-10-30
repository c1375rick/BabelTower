// 验证 1.2.4 是否真的保存上了:编辑页的行列表 + 登录态的公开页文件列表
const puppeteer = require("puppeteer-core");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    userDataDir: "F:\\BabelTower\\config\\gb_browser_profile", headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
  await page.goto("https://gamebanana.com/mods/edit/700107", { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(6000);
  const rows = await page.evaluate(() => [...document.querySelectorAll('input[name="_sVersion"]')].map((i) => i.value));
  console.log("编辑页行(" + rows.length + "): " + JSON.stringify(rows));
  const has124 = rows.indexOf("1.2.4") !== -1;
  console.log("1.2.4 行存在: " + has124);
  if (has124) {
    // 找到该行对应的文件名与状态
    const info = await page.evaluate(() => {
      const out = [];
      [...document.querySelectorAll('input[name="_sVersion"]')].forEach((inp) => {
        let el = inp, text = "";
        for (let i = 0; i < 6 && el; i++) { text = el.innerText || el.textContent || ""; if (/\.zip/i.test(text)) break; el = el.parentElement; }
        if (/1\.2\.4/.test(inp.value)) out.push(text.replace(/\s+/g, " ").slice(0, 120));
      });
      return out;
    });
    console.log("1.2.4 行内容: " + JSON.stringify(info));
  }
  // 公开页(登录态)的文件区
  await page.goto("https://gamebanana.com/mods/700107", { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(4000);
  const pub = await page.evaluate(() => {
    const t = document.body.innerText || "";
    return { has124: /1\.2\.4/.test(t), has124zip: /124-win64/i.test(t), tail: t.replace(/\s+/g, " ").slice(0, 0) };
  });
  console.log("登录态公开页: " + JSON.stringify(pub));
  await browser.close();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });