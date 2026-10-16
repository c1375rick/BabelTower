// GameBanana publish automation (ASCII-only on purpose).
// Run:  node scripts\archive\gb_publish.js publish
//
// Login handling (fixed 2026-10-16): the old loop called page.goto(MOD_URL)
// every 5s while waiting, which navigated the browser AWAY from the login
// form the user was typing into -- they could never finish logging in.
// This version never navigates while waiting: it only watches page.url()
// and, once that changes away from the login page, checks the edit link once.
//
// NOTE: never paste session cookies into chat. The script reads them from
// config\gamebanana_cookies.txt, which is gitignored.
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const COOKIES_FILE = "F:\\BabelTower\\config\\gamebanana_cookies.txt";
const MOD_URL = "https://gamebanana.com/mods/700107";
const EDIT_URL = "https://gamebanana.com/mods/700107/edit";

function findZip() {
  const dist = "F:\\BabelTower\\dist";
  const files = fs.readdirSync(dist).filter((f) => /^BabelTower-.*-win64\.zip$/.test(f));
  if (!files.length) throw new Error("no BabelTower-*-win64.zip under dist");
  files.sort((a, b) => fs.statSync(path.join(dist, b)).mtimeMs - fs.statSync(path.join(dist, a)).mtimeMs);
  return path.join(dist, files[0]);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function editLinks(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("a")]
      .filter((a) => /edit/i.test(a.href) && /700107/.test(a.href))
      .map((a) => a.href));
}

(async () => {
  const zipPath = findZip();
  console.log("ZIP:", zipPath, "size:", fs.statSync(zipPath).size);
  const mode = process.argv[2] || "probe";

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    userDataDir: PROFILE,
    headless: false, // always visible: the user may need to log in
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");

  await page.goto(MOD_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(2500);
  console.log("MOD PAGE:", await page.title());

  let links = await editLinks(page);
  if (!links.length) {
    // Open the login page ONCE, then never navigate again while waiting.
    await page.goto("https://gamebanana.com/members/account/login", { waitUntil: "domcontentloaded", timeout: 60000 });
    console.log("LOGIN PAGE OPENED - log in inside this window. It will NOT be reloaded.");
    let loggedIn = false;
    for (let i = 0; i < 240; i++) { // up to 20 minutes
      await sleep(5000);
      const url = page.url();
      if (!/\/login/i.test(url)) {
        // Session established (GameBanana redirects away from the login form).
        await page.goto(MOD_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
        links = await editLinks(page);
        if (links.length) { loggedIn = true; console.log("LOGIN OK after " + (i + 1) * 5 + "s"); break; }
      }
    }
    if (!loggedIn) { console.log("LOGIN_TIMEOUT (no edit link found within 20 min)"); await browser.close(); process.exit(1); }
  }
  console.log("EDIT LINKS:", JSON.stringify(links));

  const cookies = await page.cookies("https://gamebanana.com");
  const keep = ["sess", "rmc", "cf_clearance"];
  const parts = cookies.filter((c) => keep.includes(c.name)).map((c) => c.name + "=" + c.value);
  if (parts.length) fs.writeFileSync(COOKIES_FILE, parts.join("; "));
  console.log("COOKIES SAVED:", keep.filter((n) => cookies.some((c) => c.name === n)).join(",") || "(none)");

  await page.goto(EDIT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(3000);
  console.log("EDIT PAGE:", await page.title(), "|", page.url());

  const structure = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll("input")].map((i) => ({
      id: i.id, name: i.name, type: i.type, value: (i.value || "").slice(0, 60),
    }));
    const fileInputs = [...document.querySelectorAll("input[type=file]")].map((i) => ({ id: i.id, name: i.name, accept: i.accept }));
    const textareas = [...document.querySelectorAll("textarea")].map((t) => ({ id: t.id, name: t.name, len: (t.value || "").length }));
    const buttons = [...document.querySelectorAll("button, input[type=submit], a.btn")]
      .map((b) => ((b.innerText || b.value || "").trim()).slice(0, 40)).filter(Boolean).slice(0, 25);
    return { inputs, fileInputs, textareas, buttons };
  });
  console.log("EDIT STRUCTURE:", JSON.stringify(structure, null, 1));

  if (mode !== "publish") { await browser.close(); console.log("PROBE_DONE"); return; }

  // Upload step is written after the real form structure is known.
  console.log("UPLOAD_STEP: TODO (structure above)");
  await browser.close();
  console.log("DONE");
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });