// gb_add_form_probe.js — 探测 gamebanana.com/add 新建投稿表单 (只读, 不提交)
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const COOKIES_FILE = "F:\\BabelTower\\config\\gamebanana_cookies.txt";
const ADD_URL = "https://gamebanana.com/add?gameid=20948";

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

  await page.goto(ADD_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(6000);
  console.log("PAGE TITLE:", await page.title());
  console.log("URL:", page.url());

  const dump = await page.evaluate(() => {
    const out = { inputs: [], textareas: [], selects: [], files: [], buttons: [], forms: [], body: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 400) };
    document.querySelectorAll("input").forEach((i) => {
      if (i.type === "file") { out.files.push({ id: i.id, name: i.name, accept: i.accept }); return; }
      out.inputs.push({ id: i.id, name: i.name, type: i.type, value: (i.value || "").slice(0, 30), ph: i.placeholder });
    });
    document.querySelectorAll("textarea").forEach((t) => out.textareas.push({ id: t.id, name: t.name, rows: t.rows }));
    document.querySelectorAll("select").forEach((s) => out.selects.push({
      id: s.id, name: s.name, opts: [...s.options].map((o) => o.text.trim()).slice(0, 40),
    }));
    document.querySelectorAll("button, input[type=submit]").forEach((b) =>
      out.buttons.push((b.innerText || b.value || "").trim().slice(0, 50)));
    document.querySelectorAll("form").forEach((f) => out.forms.push({ id: f.id, action: f.action, method: f.method }));
    return out;
  });
  console.log("STRUCTURE:", JSON.stringify(dump, null, 1));

  await browser.close();
  console.log("PROBE_DONE");
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });