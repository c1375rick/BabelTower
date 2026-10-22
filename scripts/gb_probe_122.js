// 核验 GameBanana 上的 1.2.2 落位:文件区 / 全局版本 / 更新条目
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const COOKIES_FILE = "F:\\BabelTower\\config\\gamebanana_cookies.txt";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadCookies(page) {
  if (!fs.existsSync(COOKIES_FILE)) return;
  const raw = fs.readFileSync(COOKIES_FILE, "utf8").trim();
  if (!raw) return;
  const pairs = raw.split(";").map((s) => s.trim()).filter(Boolean).map((s) => {
    const i = s.indexOf("=");
    return { name: s.slice(0, i), value: s.slice(i + 1) };
  });
  const merged = new Map();
  pairs.forEach((p) => merged.set(p.name, p.value));
  const cookies = [...merged.entries()].map(([name, value]) => ({
    name, value, domain: ".gamebanana.com", path: "/",
    httpOnly: name === "sess", secure: true,
  }));
  if (cookies.length) await page.setCookie(...cookies);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, userDataDir: PROFILE, headless: false,
    protocolTimeout: 300000,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--ignore-certificate-errors", "--no-proxy-server"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
  await loadCookies(page);

  // ---- 1) 编辑页:文件区 + 全局版本 ----
  await page.goto("https://gamebanana.com/mods/edit/700107", { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(8000);
  const edit = await page.evaluate(() => {
    const vEl = document.getElementById("Version");
    const globalVer = vEl ? (vEl.querySelector("input[type=text]") || {}).value : null;
    const fsx = document.getElementById("Files");
    const rows = fsx
      ? [...fsx.querySelectorAll("li")].map((li) => li.innerText.replace(/\s+/g, " ").trim()).filter((t) => /babeltower/i.test(t))
      : [];
    const versions = [...document.querySelectorAll('input[name="_sVersion"]')].map((i) => i.value);
    return { globalVer, rows: rows.slice(-6), lastVersions: versions.slice(-4), rowCount: versions.length };
  });
  console.log("EDIT PAGE global Version =", JSON.stringify(edit.globalVer));
  console.log("  version rows =", edit.rowCount, "| last =", JSON.stringify(edit.lastVersions));
  console.log("  files (last 6):");
  edit.rows.forEach((r) => console.log("    " + r.slice(0, 100)));

  // ---- 2) 更新列表页 ----
  await page.goto("https://gamebanana.com/mods/updates/700107", { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(6000);
  const upd = await page.evaluate(() => {
    const text = document.body.innerText;
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const hits = lines.filter((l) => /1\.2\.[0-9]/.test(l)).slice(0, 12);
    const links = [...document.querySelectorAll("a")].map((a) => a.innerText.replace(/\s+/g, " ").trim())
      .filter((t) => /^1\.2\.[0-9]/.test(t)).slice(0, 8);
    return { hits, links };
  });
  console.log("UPDATES PAGE 1.2.x lines:");
  upd.hits.forEach((l) => console.log("    " + l.slice(0, 110)));
  console.log("  1.2.x link texts:");
  upd.links.forEach((l) => console.log("    " + l.slice(0, 110)));

  await browser.close();
  console.log("DONE");
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
