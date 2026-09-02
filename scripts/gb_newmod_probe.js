// gb_newmod_probe.js — 探测 GameBanana 新建 Mod 表单 (无副作用, 只读)
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const COOKIES_FILE = "F:\\BabelTower\\config\\gamebanana_cookies.txt";
const GAME_URL = "https://gamebanana.com/games/20948";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadCookies(page) {
  if (!fs.existsSync(COOKIES_FILE)) { console.log("NO COOKIES FILE"); return; }
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
  if (cookies.length) {
    await page.setCookie(...cookies);
    console.log("COOKIES LOADED:", cookies.map((c) => c.name).join(", "));
  }
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, userDataDir: PROFILE, headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--ignore-certificate-errors", "--no-proxy-server"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
  await loadCookies(page);

  await page.goto(GAME_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(5000);
  console.log("GAME PAGE TITLE:", await page.title());
  console.log("URL:", page.url());

  // 找新增/Submit 入口链接
  const submitLinks = await page.evaluate(() =>
    [...document.querySelectorAll("a")].map((a) => ({
      href: a.href,
      text: (a.innerText || "").replace(/\s+/g, " ").trim().slice(0, 60),
    })).filter((a) => /submit|add/i.test(a.href) || /submit|new|add/i.test(a.text))
      .slice(0, 15)
  );
  console.log("SUBMIT LINKS:", JSON.stringify(submitLinks, null, 1));

  // 探测 Mod 区的 Submit 按钮
  const buttons = await page.evaluate(() =>
    [...document.querySelectorAll("button, a.btn, input[type=submit]")]
      .map((b) => ((b.innerText || b.value || "").trim() || "").slice(0, 50))
      .filter(Boolean).filter((t) => /submit|new|mod|upload|create|add/i.test(t)).slice(0, 15)
  );
  console.log("BUTTONS:", JSON.stringify(buttons));

  // 探测当前页面是否是 Mod 列表页(找 Mod 提交表单入口)
  const formProbe = await page.evaluate(() => {
    const forms = [...document.querySelectorAll("form")].map((f) => ({
      id: f.id, action: f.action, method: f.getAttribute("method"),
    }));
    return { forms };
  });
  console.log("FORMS ON GAME PAGE:", JSON.stringify(formProbe));

  await browser.close();
  console.log("PROBE_DONE");
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });