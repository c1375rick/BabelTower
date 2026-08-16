// gb_replace_file.js — 替换 GameBanana 上的 0.1.3 文件(删旧行 + 上传新包 + 版本号 + 保存)
// 2026-08-16: 0.1.3 首包缺 core/hero_names.js, 桥离线; 此脚本用于上传修复包替换
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const COOKIES_FILE = "F:\\BabelTower\\config\\gamebanana_cookies.txt";
const EDIT_URL = "https://gamebanana.com/mods/edit/700107";
const MOD_URL = "https://gamebanana.com/mods/700107";

const version = process.argv[2] || "0.1.3";
const zipPath = path.join("F:\\BabelTower\\dist", `BabelTower-${version}-win64.zip`);
if (!fs.existsSync(zipPath)) { console.error("ZIP NOT FOUND:", zipPath); process.exit(1); }
console.log("ZIP:", zipPath, "size:", fs.statSync(zipPath).size);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function loadCookies(page) {
  if (!fs.existsSync(COOKIES_FILE)) { console.log("NO COOKIES FILE"); return; }
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

// 文件行状态(按文件名过滤)
const rowInfo = (page, pattern) => page.evaluate((pat) => {
  const fs = document.getElementById("Files");
  if (!fs) return { count: 0, rows: [] };
  const lis = [...fs.querySelectorAll("li")].filter(li => new RegExp(pat).test(li.innerText));
  return {
    count: lis.length,
    rows: lis.map(li => li.innerText.replace(/\s+/g, " ").trim().slice(0, 110)),
  };
}, pattern);

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, userDataDir: PROFILE, headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--ignore-certificate-errors", "--no-proxy-server"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
  await loadCookies(page);

  await page.goto(EDIT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(8000);
  console.log("EDIT TITLE:", await page.title());

  // 处理原生对话框(Remove 可能弹 confirm)
  page.on("dialog", async (d) => {
    console.log("DIALOG:", d.type(), "|", String(d.message()).slice(0, 80));
    await d.accept();
  });

  // 等待 Files 区
  let filesReady = false;
  for (let i = 0; i < 16; i++) {
    try {
      filesReady = await page.evaluate(() => !!document.getElementById("Files"));
    } catch (e) { await sleep(3000); continue; }
    if (filesReady) break;
    await sleep(5000);
  }
  if (!filesReady) { console.log("NO_FILES"); await browser.close(); process.exit(1); }
  console.log("FILES READY");

  // 1) 删除旧的 0.1.3 行(若有)
  const oldRows = await rowInfo(page, "babeltower-013");
  console.log("OLD 0.1.3 ROWS:", JSON.stringify(oldRows));
  const removed = await page.evaluate(() => {
    const fs = document.getElementById("Files");
    const li = [...fs.querySelectorAll("li")].find(li => /babeltower-013-win64\.zip/.test(li.innerText));
    if (!li) return { ok: false, reason: "no 013 row" };
    const btn = li.querySelector(".TrashFile");
    if (!btn) return { ok: false, reason: "no remove btn" };
    btn.click();
    return { ok: true };
  });
  console.log("REMOVE OLD:", JSON.stringify(removed));
  await sleep(3000);
  const afterRemove = await rowInfo(page, "babeltower-013");
  console.log("AFTER REMOVE:", JSON.stringify(afterRemove));

  // 2) 上传新包
  const handle = await page.$("#Files input[type=file]");
  if (!handle) { console.log("NO FILE INPUT"); await browser.close(); process.exit(1); }
  await handle.uploadFile(zipPath);
  console.log("UPLOAD TRIGGERED, waiting...");

  let uploaded = false;
  for (let i = 0; i < 72; i++) {
    await sleep(5000);
    const cur = await rowInfo(page, "babeltower-013");
    if (cur.count > afterRemove.count) {
      console.log(`[${(i + 1) * 5}s] uploaded, rows now:`, JSON.stringify(cur));
      uploaded = true;
      break;
    }
    if (i % 6 === 5) console.log(`[${(i + 1) * 5}s] waiting... rows=${cur.count}`);
  }
  if (!uploaded) { console.log("UPLOAD_TIMEOUT"); await browser.close(); process.exit(1); }

  // 3) 新行填版本号(0.1.3 行内最后一个 VersionInput)
  const fillRow = await page.evaluate((ver) => {
    const fs = document.getElementById("Files");
    const li = [...fs.querySelectorAll("li")].find(li => /babeltower-013-win64\.zip/.test(li.innerText));
    if (!li) return { ok: false };
    const inputs = [...li.querySelectorAll("input.VersionInput")];
    const target = inputs[inputs.length - 1];
    if (!target) return { ok: false };
    const proto = Object.getPrototypeOf(target);
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(target, ver);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: target.value };
  }, version);
  console.log("ROW VERSION FILL:", JSON.stringify(fillRow));
  await sleep(1000);

  // 4) 全局 Version
  const fillGlobal = await page.evaluate((ver) => {
    const vf = document.getElementById("Version");
    if (!vf) return { ok: false };
    const inp = vf.querySelector("input[type=text]");
    if (!inp) return { ok: false };
    const old = inp.value;
    const proto = Object.getPrototypeOf(inp);
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(inp, ver);
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    inp.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, old, now: inp.value };
  }, version);
  console.log("GLOBAL VERSION FILL:", JSON.stringify(fillGlobal));
  await sleep(1000);

  // 5) Save
  const saved = await page.evaluate(() => {
    const btn = document.querySelector("fieldset.Submit button[type=submit]");
    if (!btn) return { ok: false };
    btn.click();
    return { ok: true, text: (btn.innerText || "").trim() };
  });
  console.log("SAVE CLICK:", JSON.stringify(saved));
  if (!saved.ok) { console.log("NO_SAVE_BUTTON"); await browser.close(); process.exit(1); }

  await sleep(12000);
  try { await page.goto(MOD_URL, { waitUntil: "domcontentloaded", timeout: 60000 }); } catch (e) { console.log("nav err (expected):", e.message); }
  await sleep(5000);
  const verify = await page.evaluate(() => {
    const text = document.body.innerText;
    return text.split("\n").map(l => l.trim()).filter(l => /\.zip|Added|Version|Archived/i.test(l)).slice(0, 30);
  });
  console.log("VERIFY:", JSON.stringify(verify, null, 1));

  const cookies = await page.cookies("https://gamebanana.com");
  const keep = ["sess", "rmc", "cf_clearance"];
  const parts = cookies.filter(c => keep.includes(c.name)).map(c => c.name + "=" + c.value);
  if (parts.length) fs.writeFileSync(COOKIES_FILE, parts.join("; "));

  await browser.close();
  console.log("DONE");
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });