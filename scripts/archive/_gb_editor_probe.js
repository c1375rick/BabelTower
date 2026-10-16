// Identify the description editor type and every text field on the page,
// so the content is written through the editor's own model (setting a
// textarea's .value does NOT reach it, and would not be saved either).
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

  const main = await page.evaluate(() => {
    const t = [...document.querySelectorAll("textarea")].find((x) => /Babel Tower/i.test(x.value || "") && (x.value || "").length > 500);
    if (!t) return { err: "main textarea not found" };
    let node = t, chain = [];
    for (let i = 0; i < 6 && node; i++) {
      chain.push({ tag: node.tagName, id: node.id, cls: String(node.className).slice(0, 80) });
      node = node.parentElement;
    }
    return {
      textareaId: t.id,
      chain,
      tinymceGlobal: typeof window.tinymce,
      tinymceEditors: window.tinymce && window.tinymce.editors ? window.tinymce.editors.length : -1,
      tinymceIds: window.tinymce && window.tinymce.editors ? window.tinymce.editors.map((e) => e.id) : [],
      iframes: [...document.querySelectorAll("iframe")].map((f) => ({ id: f.id, cls: String(f.className).slice(0, 60) })),
      contenteditables: [...document.querySelectorAll("[contenteditable=true]")].map((e) => ({
        id: e.id, cls: String(e.className).slice(0, 60), len: (e.innerText || "").length,
      })),
      mceContainers: [...document.querySelectorAll('[class*="mce"],[id*="mce"],[id^="mce"]')].map((e) => ({
        tag: e.tagName, id: e.id, cls: String(e.className).slice(0, 60),
      })).slice(0, 12),
    };
  });
  console.log("MAIN:", JSON.stringify(main, null, 1));

  // every text field with a nearby label, so we know what to touch
  const fields = await page.evaluate(() => {
    const out = [];
    for (const t of document.querySelectorAll("textarea")) {
      let lab = "";
      let n = t;
      for (let i = 0; i < 3 && n && !lab; i++) {
        n = n.previousElementSibling;
        if (n) lab = (n.innerText || n.value || "").trim().slice(0, 40);
      }
      out.push({ id: t.id, len: (t.value || "").length, near: lab, head: (t.value || "").replace(/\s+/g, " ").slice(0, 50) });
    }
    return out;
  });
  console.log("TEXTAREAS:", JSON.stringify(fields, null, 1));
  await browser.close();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });