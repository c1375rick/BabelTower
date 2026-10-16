// Probe the real edit page shape: /mods/edit/<id>  (NOT /mods/<id>/edit).
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
  const url = "https://gamebanana.com/mods/edit/" + id;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(4000);
  console.log("URL:", page.url());
  console.log("TITLE:", await page.title());

  const s = await page.evaluate(() => ({
    h1: (document.querySelector("h1") || {}).innerText || "",
    inputs: [...document.querySelectorAll("input")].map((i) => ({ id: i.id, name: i.name, type: i.type, value: (i.value || "").slice(0, 50) })),
    files: [...document.querySelectorAll("input[type=file]")].map((i) => ({ id: i.id, name: i.name, accept: i.accept, multiple: i.multiple })),
    textareas: [...document.querySelectorAll("textarea")].map((t) => ({ id: t.id, name: t.name, len: (t.value || "").length, head: (t.value || "").slice(0, 40) })),
    selects: [...document.querySelectorAll("select")].map((t) => ({ id: t.id, name: t.name, value: t.value, opts: [...t.options].slice(0, 8).map((o) => o.value) })),
    buttons: [...document.querySelectorAll("button, input[type=submit], a.btn")].map((b) => ((b.innerText || b.value || "").trim()).slice(0, 40)).filter(Boolean).slice(0, 25),
    editables: [...document.querySelectorAll("[contenteditable=true]")].map((e) => ({ id: e.id, cls: e.className.slice(0, 40), len: (e.innerText || "").length })),
    currentFiles: [...document.querySelectorAll("a")].map((a) => a.href).filter((h) => /download|\/files?\/|dl\./i.test(h)).slice(0, 10),
  }));
  console.log("STRUCTURE:", JSON.stringify(s, null, 1));
  await browser.close();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });