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
  await page.goto("https://gamebanana.com/mods/updates/700107", { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(5000);
  const st = await page.evaluate(() => {
    const t = document.body.innerText || "";
    return {
      has124: /1\.2\.4/.test(t),
      postLinks: [...document.querySelectorAll("a")].filter((a) => /updates\/\d{4,}/.test(a.href || "")).map((a) => (a.innerText || "").trim().slice(0, 60) + " -> " + a.href).slice(0, 6),
      head: t.replace(/\s+/g, " ").slice(0, 350),
    };
  });
  console.log(JSON.stringify(st, null, 1));
  await page.screenshot({ path: "dist/gb_updates_list.png" });
  await browser.close();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });