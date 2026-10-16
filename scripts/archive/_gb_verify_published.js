// Verify the PUBLISHED entry (not the edit form): description text + file/version.
const puppeteer = require("puppeteer-core");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, userDataDir: PROFILE, headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
  await page.goto("https://gamebanana.com/mods/700107", { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(5000);
  const s = await page.evaluate(() => {
    const t = document.body.innerText || "";
    return {
      title: document.title,
      hasNewDescEN: t.indexOf("Real-time Chat Translator for Deadlock") !== -1,
      hasNewDescCN: t.indexOf("队友外语秒翻") !== -1,
      hasOldDesc: t.indexOf("Babel Tower - Deadlock In-game Chat Translator") !== -1,
      hasInstall3Steps: t.indexOf("Installation (3 steps)") !== -1,
      zip120: /BabelTower-1\.2\.0-win64/i.test(t),
      zipOld: (t.match(/BabelTower-[\d.]+-win64[^\s]*/i) || [""])[0],
      version120: t.indexOf("1.2.0") !== -1,
      head: t.replace(/\s+/g, " ").slice(0, 300),
    };
  });
  console.log(JSON.stringify(s, null, 1));
  await browser.close();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });