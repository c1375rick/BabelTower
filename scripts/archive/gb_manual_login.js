// gb_manual_login.js — GameBanana 手动登录(一次性, 半自动)
// 弹出可见 Edge 窗口到 GameBanana 登录页; 用户在窗口里手动输入账号密码登录;
// 脚本轮询检测到登录成功后, 自动保存新 cookies 到 config/gamebanana_cookies.txt
// 用法: node scripts/gb_manual_login.js
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const COOKIES_FILE = "F:\\BabelTower\\config\\gamebanana_cookies.txt";
const LOGIN_URL = "https://gamebanana.com/account/login";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log("打开 Edge 登录窗口...");
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    userDataDir: PROFILE,
    headless: false, // 可见窗口, 用户手动输入
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--ignore-certificate-errors", "--no-proxy-server"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");

  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  console.log("登录页已打开:", page.url());
  console.log(">>> 请在 Edge 窗口里登录 GameBanana (账号 chehehe1579) <<<");
  console.log(">>> 登录成功后本脚本会自动保存 cookies, 无需其他操作 <<<");

  // 轮询检测登录态: 最多等 10 分钟
  let loggedIn = false;
  for (let i = 0; i < 120; i++) {
    await sleep(5000);
    try {
      const r = await page.evaluate(() => {
        const logoutLinks = [...document.querySelectorAll("a")].filter(a => /members\/account\/logout|sign\s*out/i.test((a.href || "") + " " + (a.innerText || ""))).length;
        return { logoutLinks, url: location.href };
      });
      if (r.logoutLinks > 0 || /members\/\d+/.test(r.url)) {
        loggedIn = true;
        console.log("检测到登录成功! url:", r.url);
        break;
      }
    } catch (e) { /* 页面导航中, 忽略 */ }
    if (i % 6 === 5) console.log(`  等待登录... ${(i + 1) * 5}s`);
  }

  if (!loggedIn) {
    console.log("TIMEOUT: 10 分钟内未检测到登录, 请重试");
    await browser.close();
    process.exit(1);
  }

  // 保存 cookies
  await sleep(3000);
  const cookies = await page.cookies("https://gamebanana.com");
  const keep = ["sess", "rmc", "cf_clearance"];
  const parts = cookies.filter(c => keep.includes(c.name)).map(c => c.name + "=" + c.value);
  if (!parts.length) { console.log("NO SESS COOKIE FOUND"); await browser.close(); process.exit(1); }
  fs.writeFileSync(COOKIES_FILE, parts.join("; "));
  console.log("COOKIES SAVED:", parts.map(p => p.split("=")[0]).join(", "), "->", COOKIES_FILE);

  await browser.close();
  console.log("LOGIN_DONE: 可以运行发布脚本了");
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });
