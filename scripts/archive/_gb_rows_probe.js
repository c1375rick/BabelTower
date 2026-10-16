// Read-only: list every file row (filename + version) currently on the edit page,
// so we can tell "staged but not saved" from "published".
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
  await sleep(6000);
  const rows = await page.evaluate(() => {
    const out = [];
    const vs = [...document.querySelectorAll('input[name="_sVersion"]')];
    for (const v of vs) {
      let n = v;
      let name = "";
      for (let i = 0; i < 6 && n && !name; i++) {
        n = n.parentElement;
        if (!n) break;
        const m = (n.innerText || "").match(/[\w.-]+\.(?:zip|7z|rar|7zip)\b/i);
        if (m) name = m[0];
      }
      out.push({ version: v.value, file: name || "(unknown)" });
    }
    return out;
  });
  console.log("FILE ROWS (" + rows.length + "):");
  for (const r of rows) console.log("  " + (r.version || "(empty)").padEnd(10) + "  " + r.file);

  const desc = await page.evaluate(() => {
    const t = [...document.querySelectorAll("textarea")].find((x) => /Babel Tower/i.test(x.value || "") && (x.value || "").length > 200);
    return t ? { len: t.value.length, hasNew: /Real-time Chat Translator/.test(t.value) } : null;
  });
  console.log("DESC ON EDIT PAGE:", JSON.stringify(desc));
  await browser.close();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });