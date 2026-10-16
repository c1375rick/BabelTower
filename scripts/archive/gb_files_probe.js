// gb_files_probe.js — 只读探测 GameBanana mod 编辑向导的文件区现状
// 用途: 发布前确认 Files 区已有的 zip 行(替换 or 新增)、当前全局版本号、可用的向导步骤。
// 不做任何修改、不写 cookie。用法: node scripts/gb_files_probe.js [pattern]
const puppeteer = require("puppeteer-core");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const EDIT_URL = "https://gamebanana.com/mods/edit/700107";
const MOD_URL = "https://gamebanana.com/mods/700107";
const PATTERN = process.argv[2] || "babeltower";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    userDataDir: PROFILE,
    headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--ignore-certificate-errors", "--no-proxy-server"],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    );

    await page.goto(MOD_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(5000);

    // 壳内点 Edit(直接 goto edit URL 是无 JS 降级页)
    const editClicked = await page.evaluate(() => {
      const a = [...document.querySelectorAll("a")].find(
        (el) => /^edit$/i.test((el.innerText || "").trim()) && /\/mods\/edit\//.test(el.getAttribute("href") || "")
      );
      if (!a) return false;
      a.click();
      return true;
    });
    console.log("EDIT WIZARD:", editClicked);
    await sleep(8000);

    let ready = false;
    for (let i = 0; i < 16; i++) {
      try {
        ready = await page.evaluate(() => !!document.getElementById("Files"));
      } catch (e) {
        await sleep(3000);
        continue;
      }
      if (ready) break;
      await sleep(5000);
    }
    console.log("FILES READY:", ready);
    if (!ready) {
      console.log("TITLE:", await page.title());
      const t = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 300));
      console.log("BODY:", t);
      return;
    }

    const dump = await page.evaluate((pat) => {
      const rx = new RegExp(pat, "i");
      const fsEl = document.getElementById("Files");
      const all = [...fsEl.querySelectorAll("li")].map((li) => li.innerText.replace(/\s+/g, " ").trim().slice(0, 130));
      const hit = all.filter((s) => rx.test(s));
      const verEl = document.getElementById("Version");
      const verInp = verEl ? verEl.querySelector("input[type=text]") : null;
      const steps = [...document.querySelectorAll("a, button, li, .NavItem, [class*=Step]")]
        .map((e) => (e.innerText || "").trim())
        .filter((s) => s && s.length < 24);
      const uniqSteps = [...new Set(steps)].slice(0, 30);
      // 文件行里的下载/详情链接(href 是验证「线上文件=本地文件」的入口)
      const links = [...fsEl.querySelectorAll("a[href]")].map((a) => ({
        text: (a.innerText || "").replace(/\s+/g, " ").trim().slice(0, 50),
        href: a.getAttribute("href"),
      }));
      return {
        totalRows: all.length,
        allRows: all,
        matchRows: hit,
        globalVersion: verInp ? verInp.value : null,
        hasFileInput: !!fsEl.querySelector("input[type=file]"),
        steps: uniqSteps,
        links: links,
      };
    }, PATTERN);

    console.log("TOTAL ROWS:", dump.totalRows);
    console.log("GLOBAL VERSION:", JSON.stringify(dump.globalVersion));
    console.log("HAS FILE INPUT:", dump.hasFileInput);
    console.log("STEPS:", JSON.stringify(dump.steps));
    console.log("--- MATCH [" + PATTERN + "] ---");
    dump.matchRows.forEach((r) => console.log("  * " + r));
    console.log("--- 文件区链接 ---");
    if (dump.links.length === 0) console.log("  (无)");
    dump.links.forEach((l) => console.log("  " + l.href + "   |" + l.text + "|"));
    console.log("--- ALL ROWS ---");
    dump.allRows.forEach((r) => console.log("  - " + r));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
