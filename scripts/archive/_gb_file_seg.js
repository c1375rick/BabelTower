// Exact file entry text for the 1.2.0 upload: name + stated size + version.
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
  const seg = await page.evaluate(() => {
    const t = (document.body.innerText || "").replace(/[ \t]+/g, " ");
    const i = t.toLowerCase().indexOf("120-win64");
    const j = t.toLowerCase().indexOf("110-win64");
    return {
      around120: i >= 0 ? t.slice(Math.max(0, i - 120), i + 220).replace(/\n+/g, " | ") : "(not found)",
      around110: j >= 0 ? t.slice(Math.max(0, j - 120), j + 220).replace(/\n+/g, " | ") : "(not found)",
      downloadLinks: [...document.querySelectorAll("a")].map((a) => a.href)
        .filter((h) => /download/i.test(h)).slice(0, 6),
    };
  });
  console.log(JSON.stringify(seg, null, 1));
  await browser.close();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });