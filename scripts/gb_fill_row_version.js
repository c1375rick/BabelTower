// gb_fill_row_version.js — 给 GameBanana 指定文件的版本号字段填值并保存
// 用法: node gb_fill_row_version.js <文件名片段> <版本号>
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const COOKIES_FILE = "F:\\BabelTower\\config\\gamebanana_cookies.txt";
const EDIT_URL = "https://gamebanana.com/mods/edit/700107";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const namePart = process.argv[2] || "babeltower-013-win64_22047";
const version = process.argv[3] || "0.1.3";

async function loadCookies(page) {
  if (!fs.existsSync(COOKIES_FILE)) return;
  const raw = fs.readFileSync(COOKIES_FILE, "utf8").trim();
  if (!raw) return;
  const pairs = raw.split(";").map(s => s.trim()).filter(Boolean).map(s => {
    const i = s.indexOf("=");
    return { name: s.slice(0, i), value: s.slice(i + 1) };
  });
  const merged = new Map();
  pairs.forEach(p => merged.set(p.name, p.value));
  const cookies = [...merged.entries()].map(([name, value]) => ({
    name, value, domain: ".gamebanana.com", path: "/",
    httpOnly: name === "sess", secure: true,
  }));
  if (cookies.length) {
    await page.setCookie(...cookies);
    console.log("COOKIES LOADED:", cookies.map(c => c.name).join(", "));
  }
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, userDataDir: PROFILE, headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--ignore-certificate-errors", "--no-proxy-server"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
  page.on("dialog", async (d) => { console.log("DIALOG:", d.type(), String(d.message()).slice(0, 60)); await d.accept(); });
  await loadCookies(page);

  await page.goto(EDIT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(8000);

  let ready = false;
  for (let i = 0; i < 16; i++) {
    try { ready = await page.evaluate(() => !!document.getElementById("Files")); } catch (e) { await sleep(3000); continue; }
    if (ready) break;
    await sleep(5000);
  }
  if (!ready) { console.log("NO_FILES"); await browser.close(); process.exit(1); }

  // 找到目标行, 填版本
  const res = await page.evaluate(({ namePart, version }) => {
    const fs = document.getElementById("Files");
    const li = [...fs.querySelectorAll("li")].find(li => li.innerText.includes(namePart));
    if (!li) return { ok: false, reason: "row not found: " + namePart };
    const input = li.querySelector("input.VersionInput");
    if (!input) return { ok: false, reason: "no version input" };
    const old = input.value;
    const proto = Object.getPrototypeOf(input);
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(input, version);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, old, now: input.value, rowText: li.innerText.replace(/\s+/g, " ").slice(0, 100) };
  }, { namePart, version });
  console.log("FILL:", JSON.stringify(res));
  if (!res.ok) { await browser.close(); process.exit(1); }

  await sleep(1000);
  const saved = await page.evaluate(() => {
    const btn = document.querySelector("fieldset.Submit button[type=submit]");
    if (!btn) return { ok: false };
    btn.click();
    return { ok: true, text: (btn.innerText || "").trim() };
  });
  console.log("SAVE:", JSON.stringify(saved));
  await sleep(12000);
  console.log("URL:", await page.url());

  const cookies = await page.cookies("https://gamebanana.com");
  const keep = ["sess", "rmc", "cf_clearance"];
  const parts = cookies.filter(c => keep.includes(c.name)).map(c => c.name + "=" + c.value);
  if (parts.length) fs.writeFileSync(COOKIES_FILE, parts.join("; "));

  await browser.close();
  console.log("DONE");
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });