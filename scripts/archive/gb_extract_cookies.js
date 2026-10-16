// gb_extract_cookies.js — 从 gb_browser_profile 直接抠 cookie(兜底)
// 场景: gb_manual_login.js 的登录态检测(GameBanana 改版/登出链接藏在下拉里)没认出来而超时,
//       但用户确实已在弹出的 Edge 窗口里登录成功 —— 会话已持久化在 userDataDir profile 里,
//       本脚本不依赖页面 DOM 判定,直接读 profile 的 cookie jar 落盘。
// 用法: node scripts/gb_extract_cookies.js [--check]
//   --check  只验证当前 cookie 是否有效(打开 mod 页看有没有 Edit 链接),不改文件
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const COOKIES_FILE = "F:\\BabelTower\\config\\gamebanana_cookies.txt";
const MOD_URL = "https://gamebanana.com/mods/700107";
const CHECK_ONLY = process.argv.includes("--check");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    userDataDir: PROFILE,
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--ignore-certificate-errors", "--no-proxy-server"],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    );

    const all = await page.browserContext().cookies();
    const gb = all.filter((c) => /gamebanana\.com$/.test(c.domain) || /\.gamebanana\.com$/.test(c.domain));
    const names = gb.map((c) => c.name);
    console.log("PROFILE COOKIES:", names.join(", ") || "(空)");
    const hasSess = names.includes("sess");
    console.log("HAS sess:", hasSess);

    // 实证:打开 mod 页看有没有 Edit 入口(登录才有)
    await page.goto(MOD_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(6000);
    const probe = await page.evaluate(() => {
      const links = [...document.querySelectorAll("a")];
      const edit = links.find((el) => /^edit$/i.test((el.innerText || "").trim()) && /\/mods\/edit\//.test(el.getAttribute("href") || ""));
      const logout = links.filter((el) => /members\/account\/logout/i.test(el.getAttribute("href") || "")).length;
      const title = (document.title || "").slice(0, 80);
      return { edit: !!edit, logout, title };
    });
    console.log("MOD PAGE:", JSON.stringify(probe), "->", probe.edit ? "LOGGED_IN ✓" : "NOT_LOGGED_IN");

    if (CHECK_ONLY) {
      process.exitCode = probe.edit ? 0 : 1;
      return;
    }
    if (!hasSess) {
      console.log("FAIL: profile 里没有 sess cookie,需要重新登录");
      process.exitCode = 1;
      return;
    }
    if (!probe.edit) {
      console.log("FAIL: sess 存在但页面无 Edit 入口,会话可能过期,需要重新登录");
      process.exitCode = 1;
      return;
    }

    const keep = ["sess", "rmc", "cf_clearance"];
    const parts = keep
      .map((n) => {
        const c = gb.find((x) => x.name === n);
        return c ? n + "=" + c.value : null;
      })
      .filter(Boolean);
    fs.writeFileSync(COOKIES_FILE, parts.join("; "));
    console.log("COOKIES SAVED:", keep.filter((n) => parts.some((p) => p.startsWith(n + "="))).join(", "), "->", COOKIES_FILE);
    console.log("LOGIN_DONE: 可以运行发布脚本了");
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
