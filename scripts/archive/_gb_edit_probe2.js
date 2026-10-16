// Compact probe of the edit page: only what the upload step needs.
const puppeteer = require("puppeteer-core");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const id = process.argv[2] || "700107";

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, userDataDir: PROFILE, headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
  await page.goto("https://gamebanana.com/mods/edit/" + id, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(4000);

  const s = await page.evaluate(() => ({
    fileInputs: [...document.querySelectorAll("input[type=file]")].map((i) => ({
      id: i.id, name: i.name, accept: i.accept, multiple: i.multiple, visible: !!i.offsetParent,
    })),
    textareas: [...document.querySelectorAll("textarea")].map((t) => ({
      id: t.id, name: t.name, len: (t.value || "").length, head: (t.value || "").replace(/\s+/g, " ").slice(0, 60),
    })),
    editables: [...document.querySelectorAll("[contenteditable=true]")].map((e) => ({
      id: e.id, cls: String(e.className).slice(0, 40), len: (e.innerText || "").length,
    })),
    versionish: [...document.querySelectorAll("input,select,textarea")].filter((el) =>
      /version|_ver|ver\b|file_?version/i.test((el.id || "") + " " + (el.name || "") + " " + (el.placeholder || ""))
    ).map((el) => ({ tag: el.tagName, id: el.id, name: el.name, value: (el.value || "").slice(0, 40) })),
    submits: [...document.querySelectorAll("input[type=submit],button[type=submit],button")]
      .map((b) => ({ tag: b.tagName, name: b.name, id: b.id, text: (b.innerText || b.value || "").trim().slice(0, 40),
        form: (b.form && b.form.getAttribute("action")) || null }))
      .filter((b) => b.text).slice(0, 20),
    forms: [...document.querySelectorAll("form")].map((f) => ({
      action: f.getAttribute("action"), method: f.method, id: f.id, cls: String(f.className).slice(0, 40),
    })),
    versionText: (document.body.innerText.match(/version[^\n]{0,40}/i) || [""])[0],
  }));
  console.log(JSON.stringify(s, null, 1));
  await browser.close();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });