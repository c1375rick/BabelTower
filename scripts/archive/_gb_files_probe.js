// Map each "Select files" button to its section, and look for an explicit
// upload/add button that must be pressed after choosing a file.
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
  await page.goto("https://gamebanana.com/mods/edit/700107", { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(4000);

  const info = await page.evaluate(() => {
    const out = [];
    for (const b of document.querySelectorAll("button")) {
      if (!/select files/i.test(b.innerText || "")) continue;
      let sec = b;
      for (let i = 0; i < 6 && sec.parentElement; i++) {
        sec = sec.parentElement;
        if (sec.querySelectorAll("input[name=_sVersion]").length > 3) break;
      }
      out.push({
        id: b.id,
        sectionHasVersionRows: sec.querySelectorAll('input[name="_sVersion"]').length,
        fileInputInSection: [...sec.querySelectorAll("input[type=file]")].map((i) => i.id),
        sectionHeadings: [...sec.querySelectorAll("h1,h2,h3,h4,label,legend")].map((h) => (h.innerText || "").trim()).filter(Boolean).slice(0, 8),
        buttonsInSection: [...sec.querySelectorAll("button,a.btn,input[type=submit]")]
          .map((x) => ((x.innerText || x.value || "").trim())).filter(Boolean).slice(0, 15),
        sectionText: (sec.innerText || "").replace(/\s+/g, " ").slice(0, 220),
      });
    }
    return out;
  });
  console.log(JSON.stringify(info, null, 1));

  const up = await page.evaluate(() =>
    [...document.querySelectorAll("button,a.btn,input[type=submit]")]
      .map((x) => ((x.innerText || x.value || "").trim()))
      .filter((t) => /upload|attach|add file|submit|publish|save/i.test(t)));
  console.log("UPLOAD-LIKE BUTTONS:", JSON.stringify([...new Set(up)]));
  await browser.close();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });