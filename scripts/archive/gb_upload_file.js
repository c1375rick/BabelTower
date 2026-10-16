// gb_upload_file.js — 上传 1.0.6 安装包到 GameBanana mod 页(Files 区)
// 用法: node scripts/gb_upload_file.js
// 前提: config/gamebanana_cookies.txt 有效;dist/BabelTower-1.0.6-win64.zip 已打包
// 注意: GameBanana 文件上传在编辑向导 Files 步;脚本自动填路径,上传耗时较长
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const COOKIES_FILE = "F:\\BabelTower\\config\\gamebanana_cookies.txt";
// 注意: 不要直接打开 /mods/edit/ URL —— 该页是无 JS 的服务端降级表单(纯 textarea)。
// 必须先开 mod 页再点 Edit 链接,由 ajax 壳加载编辑向导,富文本编辑器才会挂载。
const MOD_URL = "https://gamebanana.com/mods/700107";
const ZIP = path.join(__dirname, "..", "dist", "BabelTower-1.0.6-win64.zip");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function loadCookies(page) {
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
    page.setCookie(...cookies);
    console.log("COOKIES LOADED:", cookies.map(c => c.name).join(", "));
  }
}

(async () => {
  if (!fs.existsSync(ZIP)) { console.error("缺少安装包:", ZIP); process.exit(1); }
  console.log("ZIP:", ZIP, (fs.statSync(ZIP).size / 1048576).toFixed(1) + " MB");

  const browser = await puppeteer.launch({
    executablePath: EDGE, userDataDir: PROFILE, headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--ignore-certificate-errors", "--no-proxy-server"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
  loadCookies(page);

  await page.goto(MOD_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(6000);

  // 壳内点击 Edit 链接进入编辑向导(不能直接 goto edit URL, 那是无 JS 降级页)
  const editClicked = await page.evaluate(() => {
    const a = [...document.querySelectorAll("a")]
      .find(el => /^edit$/i.test((el.innerText || "").trim()) && /\/mods\/edit\//.test(el.getAttribute("href") || ""));
    if (!a) return false;
    a.click();
    return true;
  });
  console.log("EDIT WIZARD:", editClicked);
  if (!editClicked) { console.error("未找到 Edit 链接,请检查登录态"); await browser.close(); process.exit(1); }
  await sleep(8000);

  // 若不在 Main 步,先切到 Main(壳内向导默认可能停在别的步)
  await page.evaluate(() => {
    const el = [...document.querySelectorAll("a, button, li, .NavItem, [class*=Step]")]
      .filter(e => e.offsetParent !== null)
      .find(e => /^main\b/i.test((e.innerText || "").trim()));
    if (el) el.click();
  });
  await sleep(3000);

  // 进 Files 步(壳内向导分步导航)
  const filesClicked = await page.evaluate(() => {
    const steps = [...document.querySelectorAll("a, button, .Step, li")];
    const t = steps.find(el => /^files$/i.test((el.innerText || "").trim()));
    if (!t) return false;
    t.click();
    return true;
  });
  console.log("FILES TAB:", filesClicked);
  await sleep(5000);

  // 找 Add File / Upload 按钮并触发
  const addClicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button, a")]
      .filter(b => b.offsetParent !== null);
    const t = btns.find(b => /add file|upload/i.test((b.innerText || "").trim()));
    if (!t) return { ok: false, btns: btns.slice(0, 20).map(b => (b.innerText || "").trim()).filter(Boolean) };
    t.click();
    return { ok: true };
  });
  console.log("ADD FILE:", JSON.stringify(addClicked));
  await sleep(4000);

  // 填 file input
  const fileSet = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll("input[type=file]")].filter(i => !i.disabled);
    return { count: inputs.length, ids: inputs.map(i => i.id || i.name || "?") };
  });
  console.log("FILE INPUTS:", JSON.stringify(fileSet));
  if (fileSet.count > 0) {
    // 直接对最后一个 file input 设置文件
    const fileInputs = await page.$$("input[type=file]");
    const target = fileInputs[fileInputs.length - 1];
    await target.uploadFile(ZIP);
    console.log("FILE ATTACHED");
    await sleep(3000);

    // 若有文件名/描述输入框,填上
    const named = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll("input[type=text]")]
        .filter(i => i.offsetParent !== null);
      const t = inputs.reverse().find(i => /file name|title|name/i.test(i.placeholder || i.name || i.id || ""));
      if (!t) return { ok: false };
      const proto = Object.getPrototypeOf(t);
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      const val = "BabelTower-1.0.6-win64.zip";
      if (desc && desc.set) desc.set.call(t, val);
      else t.value = val;
      t.dispatchEvent(new Event("input", { bubbles: true }));
      t.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    });
    console.log("NAME FILL:", JSON.stringify(named));
    await sleep(2000);
  }

  console.log(">>> 浏览器窗口保持打开 120 秒:请人工核对上传进度与表单,");
  console.log(">>> 若上传已开始请等待进度条走完;确认无误后手动点 Save/Submit。");
  await sleep(120000);

  const after = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 300));
  console.log("AFTER:", after);

  const cookies = await page.cookies("https://gamebanana.com");
  const keep = ["sess", "rmc", "cf_clearance"];
  const parts = cookies.filter(c => keep.includes(c.name)).map(c => c.name + "=" + c.value);
  if (parts.length) fs.writeFileSync(COOKIES_FILE, parts.join("; "));

  await browser.close();
  console.log("DONE(若未成功,重跑本脚本或人工在编辑页 Files 步上传)");
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
