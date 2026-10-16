// What is the edit page serving right now? (title / challenge / row counts)
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
  const resp = await page.goto("https://gamebanana.com/mods/edit/700107", { waitUntil: "domcontentloaded", timeout: 60000 });
  console.log("HTTP:", resp.status(), "| final URL:", page.url());
  for (const wait of [3000, 6000, 10000]) {
    await sleep(wait === 3000 ? 3000 : 3000);
    const s = await page.evaluate(() => ({
      title: document.title,
      rows: document.querySelectorAll('input[name="_sVersion"]').length,
      selects: [...document.querySelectorAll("button")].filter((b) => /select files/i.test(b.innerText || "")).length,
      bodyHead: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 260),
      hasCf: /just a moment|checking your browser|attention required/i.test(document.body.innerText || ""),
    }));
    console.log("t+" + wait + "ms:", JSON.stringify(s));
  }
  await browser.close();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });