const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const COOKIES_FILE = "F:\\BabelTower\\config\\gamebanana_cookies.txt";
const MOD_URL = "https://gamebanana.com/mods/700107";
const EDIT_URL = "https://gamebanana.com/mods/700107/edit";

// 待上传的 zip(自动找 dist 下最新)
function findZip() {
  const dist = "F:\\BabelTower\\dist";
  const files = fs.readdirSync(dist).filter(f => /^BabelTower-.*-win64\.zip$/.test(f));
  if (!files.length) throw new Error("dist 下没有 BabelTower-*-win64.zip");
  files.sort((a, b) => fs.statSync(path.join(dist, b)).mtimeMs - fs.statSync(path.join(dist, a)).mtimeMs);
  return path.join(dist, files[0]);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const zipPath = findZip();
  console.log("ZIP:", zipPath, "size:", fs.statSync(zipPath).size);
  const args = process.argv.slice(2);
  const mode = args[0] || "probe"; // probe | publish

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    userDataDir: PROFILE,
    headless: mode === "publish" ? false : "new",
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");

  // 打开 mod 页
  await page.goto(MOD_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(2500);
  console.log("MOD PAGE:", await page.title());

  // 检查是否登录:找 Edit 按钮
  const editLink = await page.evaluate(() => {
    const links = [...document.querySelectorAll("a")].filter(a => /edit/i.test(a.href) && /700107/.test(a.href));
    return links.map(a => a.href);
  });
  console.log("EDIT LINKS:", JSON.stringify(editLink));

  if (!editLink.length) {
    console.log("NOT_LOGGED_IN: 需要登录");
    if (mode === "publish") {
      // 打开登录页,等用户手动登录
      await page.goto("https://gamebanana.com/members/account/login", { waitUntil: "domcontentloaded", timeout: 60000 });
      console.log("LOGIN PAGE OPENED - 请在浏览器窗口完成登录...");
      // 等待登录完成(轮询检测)
      let loggedIn = false;
      for (let i = 0; i < 120; i++) { // 最长等 10 分钟
        await sleep(5000);
        await page.goto(MOD_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
        const links = await page.evaluate(() =>
          [...document.querySelectorAll("a")].filter(a => /edit/i.test(a.href) && /700107/.test(a.href)).map(a => a.href)
        );
        if (links.length) { loggedIn = true; console.log("LOGIN OK after", (i + 1) * 5, "s"); break; }
      }
      if (!loggedIn) { console.log("LOGIN_TIMEOUT"); await browser.close(); process.exit(1); }
    } else {
      console.log("PROBE_MODE: 不实际登录/发布");
      await browser.close();
      return;
    }
  }

  // 保存 cookies
  const cookies = await page.cookies("https://gamebanana.com");
  const keep = ["sess", "rmc", "cf_clearance"];
  const parts = cookies.filter(c => keep.includes(c.name)).map(c => c.name + "=" + c.value);
  fs.writeFileSync(COOKIES_FILE, parts.join("; "));
  console.log("COOKIES SAVED");

  if (mode !== "publish") {
    console.log("PROBE_DONE: 已登录,编辑页待发布");
    await browser.close();
    return;
  }

  // ===== PUBLISH 模式:编辑页操作 =====
  await page.goto(EDIT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(3000);
  console.log("EDIT PAGE TITLE:", await page.title());
  console.log("EDIT PAGE URL:", page.url());

  // 探测编辑页结构:表单、文件区、版本号输入框
  const structure = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll("input")].map(i => ({ id: i.id, name: i.name, type: i.type, value: (i.value || "").slice(0, 40) }))
      .filter(i => i.type !== "checkbox");
    const fileInputs = [...document.querySelectorAll("input[type=file]")].map(i => ({ id: i.id, name: i.name, accept: i.accept }));
    const buttons = [...document.querySelectorAll("button, input[type=submit], a.btn")].map(b => ((b.innerText || b.value || "").trim()).slice(0, 40)).filter(Boolean).slice(0, 15);
    const versionFields = [...document.querySelectorAll("input, select")].filter(el => /version|ver/i.test(el.id + " " + (el.name || ""))).map(el => ({ tag: el.tagName, id: el.id, name: el.name, value: el.value }));
    return { inputs, fileInputs, buttons, versionFields };
  });
  console.log("EDIT STRUCTURE:", JSON.stringify(structure, null, 1));

  await browser.close();
  console.log("DONE");
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });
