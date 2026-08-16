// Babel Tower - GameBanana 文件替换 + 版本号更新脚本 (v2)
// 结构(2026-08-06 实测):
//   - 文件区: fieldset#Files 内的 input[type=file] (display:none, id 动态: xxx_FileInput)
//   - 全局版本: fieldset#Version 内 input[type=text] (value=0.1.1)
//   - 保存: fieldset.Submit button[type=submit] ("Save")
// 用法: node gb_update_files.js 0.1.2-beta.1
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const COOKIES_FILE = "F:\\BabelTower\\config\\gamebanana_cookies.txt";
const EDIT_URL = "https://gamebanana.com/mods/edit/700107";
const MOD_URL = "https://gamebanana.com/mods/700107";

// 从 cookies 文件注入登录态(sess/rmc/cf_clearance),避免每次手动登录
async function loadCookies(page) {
  if (!fs.existsSync(COOKIES_FILE)) { console.log("NO COOKIES FILE"); return; }
  const raw = fs.readFileSync(COOKIES_FILE, "utf8").trim();
  if (!raw) return;
  const pairs = raw.split(";").map(s => s.trim()).filter(Boolean).map(s => {
    const i = s.indexOf("=");
    return { name: s.slice(0, i), value: s.slice(i + 1) };
  });
  // 同 name 多值(cf_clearance 可能有两个)只取最后一个
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

const version = process.argv[2] || "0.1.2-beta.1";
const zipPath = path.join("F:\\BabelTower\\dist", `BabelTower-${version}-win64.zip`);
if (!fs.existsSync(zipPath)) { console.error("ZIP NOT FOUND:", zipPath); process.exit(1); }
console.log("ZIP:", zipPath, "size:", fs.statSync(zipPath).size);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, userDataDir: PROFILE, headless: false, // 可见窗口, 过 Cloudflare 更稳
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--ignore-certificate-errors", "--no-proxy-server"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");

  // 注入已保存的登录态
  await loadCookies(page);

  await page.goto(EDIT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(5000);
  console.log("EDIT TITLE:", await page.title());

  // 等待 Files 区出现(可能被 Cloudflare/JS 延迟/登录跳转导航,最多等 60s+)
  let fileInput = null;
  let loginNoticed = false;
  for (let i = 0; i < 16; i++) {
    try {
      fileInput = await page.evaluate(() => {
        const fs = document.getElementById("Files");
        if (!fs) return null;
        const inp = fs.querySelector("input[type=file]");
        return inp ? { id: inp.id, name: inp.name } : null;
      });
    } catch (e) {
      // 导航中(登录跳转/Cloudflare 挑战),execution context 销毁是预期内的,重试即可
      console.log("  nav in progress...", e.message.slice(0, 50));
      await sleep(3000);
      continue;
    }
    if (fileInput) break;
    try {
      const u = page.url();
      const onLogin = /login|signin|account/i.test(u);
      if (onLogin && !loginNoticed) {
        loginNoticed = true;
        console.log("ON_LOGIN_PAGE: 会话过期,请在窗口里登录 GameBanana(chehehe1579),脚本会自动继续...");
      }
      const bodyText = await page.evaluate(() => (document.body.innerText || "").slice(0, 200).replace(/\s+/g, " "));
      console.log(`  [${(i + 1) * 5}s] waiting Files... body:`, bodyText.slice(0, 120));
    } catch (e) { /* 导航中忽略 */ }
    await sleep(5000);
  }
  console.log("FILES INPUT:", JSON.stringify(fileInput));
  if (!fileInput) { console.log("NO_FILES_INPUT"); await browser.close(); process.exit(1); }

  // ---- 上传前文件行基线 ----
  const rowInfo = () => page.evaluate(() => {
    const fs = document.getElementById("Files");
    if (!fs) return { count: 0, rows: [] };
    // 文件行:Files 区内的 tr/li/div 行,取含版本输入框或文件名的
    const versionInputs = [...fs.querySelectorAll("input[type=text]")];
    const rows = versionInputs.map(i => {
      const row = i.closest("tr") || i.closest("li") || i.parentElement.parentElement;
      return row ? row.innerText.replace(/\s+/g, " ").trim().slice(0, 140) : "";
    }).filter(Boolean);
    return { count: rows.length, rows };
  });
  const before = await rowInfo();
  console.log("BEFORE FILE ROWS:", JSON.stringify(before));

  // ---- 上传 ----
  const handle = await page.$(`#Files input[type=file]`);
  await handle.uploadFile(zipPath);
  console.log("UPLOAD TRIGGERED, waiting...");

  let uploaded = false;
  for (let i = 0; i < 72; i++) { // 最多 6 分钟
    await sleep(5000);
    const cur = await rowInfo();
    if (cur.count > before.count) {
      console.log(`[${(i + 1) * 5}s] rows ${before.count} -> ${cur.count}`);
      console.log("ROWS NOW:", JSON.stringify(cur.rows, null, 1));
      uploaded = true;
      break;
    }
    if (i % 6 === 5) console.log(`[${(i + 1) * 5}s] waiting... rows=${cur.count}`);
  }
  if (!uploaded) { console.log("UPLOAD_TIMEOUT"); await browser.close(); process.exit(1); }

  // ---- 新行填版本号(最后一行) ----
  const fillRow = await page.evaluate((ver) => {
    const fs = document.getElementById("Files");
    const inputs = [...fs.querySelectorAll("input[type=text]")];
    const target = inputs[inputs.length - 1];
    if (!target) return { ok: false };
    const proto = Object.getPrototypeOf(target);
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(target, ver);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: target.value, id: target.id, name: target.name };
  }, version);
  console.log("ROW VERSION FILL:", JSON.stringify(fillRow));
  await sleep(1000);

  // ---- 全局 Version 字段 ----
  const fillGlobal = await page.evaluate((ver) => {
    const vf = document.getElementById("Version");
    if (!vf) return { ok: false, reason: "no Version fieldset" };
    const inp = vf.querySelector("input[type=text]");
    if (!inp) return { ok: false, reason: "no input in Version" };
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

  // ---- Save ----
  const saved = await page.evaluate(() => {
    const btn = document.querySelector("fieldset.Submit button[type=submit]");
    if (!btn) return { ok: false };
    btn.click();
    return { ok: true, text: (btn.innerText || "").trim() };
  });
  console.log("SAVE CLICK:", JSON.stringify(saved));
  if (!saved.ok) { console.log("NO_SAVE_BUTTON"); await browser.close(); process.exit(1); }

  // 保存后导航,重新打开验证
  await sleep(10000);
  try { await page.goto(MOD_URL, { waitUntil: "domcontentloaded", timeout: 60000 }); } catch (e) { console.log("nav err (expected):", e.message); }
  await sleep(4000);
  const verify = await page.evaluate(() => {
    const text = document.body.innerText;
    const lines = text.split("\n").map(l => l.trim()).filter(l => /\.zip|Added|Version|Archived/i.test(l)).slice(0, 25);
    return lines;
  });
  console.log("VERIFY:", JSON.stringify(verify, null, 1));

  await browser.close();
  console.log("DONE");
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });
