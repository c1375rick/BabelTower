// 核验:公开页上 1.2.2 文件是否可下载(没被归档)+ 更新条目 id
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

  // 公开页:文件区
  await page.goto("https://gamebanana.com/mods/700107", { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(7000);
  const pub = await page.evaluate(() => {
    const out = [];
    const links = [...document.querySelectorAll("a")].filter((a) => /babeltower-\d+-win64/i.test(a.innerText || a.getAttribute("href") || ""));
    links.forEach((a) => out.push({
      text: (a.innerText || "").replace(/\s+/g, " ").trim().slice(0, 60),
      href: (a.getAttribute("href") || "").slice(0, 120),
    }));
    const txt = document.body.innerText;
    const m = txt.match(/Version\s*:?\s*([0-9]+\.[0-9]+\.[0-9]+)/);
    return { files: out.slice(-8), versionOnPage: m ? m[1] : null, has122: /babeltower-122-win64/i.test(txt) };
  });
  console.log("PUBLIC PAGE version =", JSON.stringify(pub.versionOnPage), "| mentions 1.2.2 file:", pub.has122);
  console.log("  file links:");
  pub.files.forEach((f) => console.log("    " + f.text + "  ->  " + f.href));

  // 更新条目 id
  await page.goto("https://gamebanana.com/mods/updates/700107", { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(6000);
  const ids = await page.evaluate(() => {
    return [...document.querySelectorAll("a")].map((a) => ({
      t: (a.innerText || "").replace(/\s+/g, " ").trim().slice(0, 40),
      h: a.getAttribute("href") || "",
    })).filter((x) => /^1\.2\.[0-9]/.test(x.t) && /updates\/\d+/.test(x.h)).slice(0, 6);
  });
  console.log("UPDATE ENTRIES:");
  ids.forEach((x) => console.log("    " + x.t + "  ->  " + x.h));

  await browser.close();
  console.log("DONE");
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
