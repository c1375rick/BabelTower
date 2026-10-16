// Cache-busted public page read: what does the Updates section actually list?
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
  await page.goto("https://gamebanana.com/mods/700107?_=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(5000);
  const s = await page.evaluate(() => {
    const t = document.body.innerText || "";
    const vers = [...t.matchAll(/\b(0\.\d+\.\d+|1\.\d+\.\d+)\b/g)].map((m) => m[1]);
    const files = [...new Set([...t.matchAll(/[\w.-]*win64[\w.-]*\.(?:zip|7z)/gi)].map((m) => m[0]))];
    const uniq = {};
    for (const v of vers) uniq[v] = (uniq[v] || 0) + 1;
    return {
      versionsOnPage: uniq,
      filesOnPage: files,
      firstUpdatesBlock: (t.split("Updates")[1] || "").replace(/\s+/g, " ").slice(0, 400),
      has1_2: t.indexOf("1.2.0") !== -1,
    };
  });
  console.log(JSON.stringify(s, null, 1));
  await browser.close();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });