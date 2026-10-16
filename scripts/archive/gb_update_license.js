// gb_update_license.js — replace "LGPL-3.0" with "GPL-3.0" in GameBanana mod description
// Usage: node scripts/gb_update_license.js probe | publish
// publish mode: opens a visible Edge window; if the session is expired, it goes
// to the login page and waits (up to 10 min) for the user to sign in manually.
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const COOKIES_FILE = "F:\\BabelTower\\config\\gamebanana_cookies.txt";
const DESC_TEXTAREA = "bfc5b02d6f8165994dd9f4ec31a1129c";
const MOD_URL = "https://gamebanana.com/mods/700107";
const EDIT_URL = "https://gamebanana.com/mods/edit/700107";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

async function isLoggedIn(page) {
  // 重试:页面可能还在跳转(Cloudflare 挑战 / 导航中),execution context 会销毁
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await page.goto(MOD_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await sleep(4000);
      const r = await page.evaluate(() => {
        const loginLinks = [...document.querySelectorAll("a")].filter(a => /account\/login/i.test(a.href || "")).length;
        const hasSess = [...document.querySelectorAll("a")].some(a => /members\/account\/logout|sign\s*out/i.test((a.href || "") + " " + (a.innerText || "")));
        return { loginLinks, hasSess, url: location.href };
      });
      const loggedIn = r.hasSess || (r.loginLinks === 0 && r.url.includes("/mods/700107"));
      return { loggedIn, ...r };
    } catch (e) {
      console.log("  isLoggedIn attempt", attempt + 1, "failed:", e.message.slice(0, 60));
      await sleep(3000);
    }
  }
  return { loggedIn: false, loginLinks: -1, hasSess: false, url: "" };
}

(async () => {
  const mode = process.argv[2] || "probe";

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    userDataDir: PROFILE,
    headless: mode === "publish" ? false : "new",
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--ignore-certificate-errors"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
  // 注入已保存的登录态
  await loadCookies(page);

  // 登录检查(仅 probe 模式强制;publish 模式直接去 edit 页,
  // 未登录时 textarea 等待循环会超时,用户可先在窗口里手动登录)
  if (mode === "probe") {
    const st = await isLoggedIn(page);
    console.log("LOGIN STATE:", JSON.stringify(st));
    if (!st.loggedIn) {
      console.log("PROBE_MODE: session expired, not logged in — cannot inspect edit page");
      await browser.close();
      process.exit(2);
    }
  }

  try {
    await page.goto(EDIT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch (e) { console.log("goto edit err:", e.message.slice(0, 80)); }
  await sleep(8000);
  console.log("EDIT URL:", page.url());

  // 等待描述 textarea 出现(真实窗口下 Cloudflare 挑战可能耗时,最多等 3 分钟)
  // 未登录时 edit 页会跳转登录页 -> 导航会销毁执行上下文,必须容错重试,
  // 并打印提示等待用户在窗口里手动登录(会话过期时)
  let ta = null;
  let loginNoticed = false;
  for (let i = 0; i < 60; i++) {
    try {
      ta = await page.$(`textarea[id="${DESC_TEXTAREA}"]`);
    } catch (e) {
      // 导航中(登录跳转/Cloudflare),上下文销毁是预期内的,重试即可
      console.log("  nav in progress...", e.message.slice(0, 50));
      await sleep(3000);
      continue;
    }
    if (ta) break;
    // 检测是否落在登录页:若是,提示用户手动登录(窗口可见,最多等 10 分钟)
    try {
      const u = page.url();
      const onLogin = /login|signin|account/i.test(u);
      if (onLogin && !loginNoticed) {
        loginNoticed = true;
        console.log("ON_LOGIN_PAGE: 会话过期,请在窗口里登录 GameBanana(chehehe1579),脚本会自动继续...");
      }
    } catch (e) { /* ignore */ }
    console.log("  waiting for textarea...", Math.round((i + 1) * 3), "s");
    await sleep(3000);
  }
  if (!ta) { console.log("TEXTAREA NOT FOUND"); await browser.close(); process.exit(1); }

  const oldVal = await page.evaluate(id => document.querySelector(`textarea[id="${id}"]`).value, DESC_TEXTAREA);
  console.log("OLD LEN:", oldVal.length);
  const lgplCount = (oldVal.match(/LGPL/g) || []).length;
  console.log("LGPL OCCURRENCES:", lgplCount);

  let newVal = oldVal.replace(/LGPL-3\.0/g, "GPL-3.0").replace(/LGPL/gi, "GPL");
  newVal = newVal.replace(/Lesser General Public License/gi, "General Public License");
  const changed = newVal !== oldVal;
  console.log("CHANGED:", changed);
  if (!changed) { console.log("NO_CHANGE: nothing to update (may already be GPL)"); await browser.close(); return; }

  if (mode === "probe") {
    fs.writeFileSync("F:/BabelTower/tmp_gb_license_preview.html", newVal);
    console.log("PREVIEW NEW LEN:", newVal.length);
    const idx = newVal.indexOf("GPL");
    console.log("PREVIEW CONTEXT:", newVal.slice(Math.max(0, idx - 80), idx + 80).replace(/\s+/g, " "));
    await browser.close();
    console.log("PROBE_DONE");
    return;
  }

  // ===== publish =====
  await page.evaluate(({ id, val }) => {
    const t = document.querySelector(`textarea[id="${id}"]`);
    t.value = val;
    t.dispatchEvent(new Event("input", { bubbles: true }));
    t.dispatchEvent(new Event("change", { bubbles: true }));
  }, { id: DESC_TEXTAREA, val: newVal });
  console.log("DESC UPDATED, new len:", newVal.length);

  await sleep(1000);
  const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button, input[type=submit]")].filter(b => /^save$/i.test((b.innerText || b.value || "").trim()));
    if (btns.length) { btns[0].click(); return true; }
    return false;
  });
  console.log("SAVE CLICKED:", clicked);

  await sleep(8000);
  console.log("AFTER SAVE URL:", page.url());
  const bodyText = await page.evaluate(() => (document.body.innerText || "").slice(0, 400));
  console.log("BODY:", bodyText.replace(/\s+/g, " ").slice(0, 300));

  const cookies = await page.cookies("https://gamebanana.com");
  const keep = ["sess", "rmc", "cf_clearance"];
  const parts = cookies.filter(c => keep.includes(c.name)).map(c => c.name + "=" + c.value);
  fs.writeFileSync(COOKIES_FILE, parts.join("; "));

  await browser.close();
  console.log("PUBLISH_DONE");
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });
