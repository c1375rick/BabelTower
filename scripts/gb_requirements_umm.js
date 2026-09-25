// gb_requirements_umm.js — 在 GameBanana mod 页 Technical → Requirements 添加 UMM 为 Recommended 前置
// 运行前提: config/gamebanana_cookies.txt 有效(先登录 gamebanana.com 导出 sess cookie)
// 用法: node scripts/gb_requirements_umm.js
// 参考: UMM 文档 "Listing UMM as a requirement" — Requirements 必须用 mod 页 URL
// https://gamebanana.com/mods/693642(DMM 从 GameBanana 解析前置,不能用文档站或直链)
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const COOKIES_FILE = "F:\\BabelTower\\config\\gamebanana_cookies.txt";
const EDIT_URL = "https://gamebanana.com/mods/edit/700107"; // Babel Tower 编辑页

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 前置条目: UMM(Universal Mod Manager),Recommended(不装 UMM 本 mod 仍完整可用,只是少了设置窗口)
const REQUIREMENT = {
  name: "Universal Mod Manager",
  url: "https://gamebanana.com/mods/693642",
  kind: "Recommended", // Required | Recommended(游戏内选择)
};

function loadCookies(browserPage) {
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
    browserPage.setCookie(...cookies);
    console.log("COOKIES LOADED:", cookies.map(c => c.name).join(", "));
  }
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, userDataDir: PROFILE, headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--ignore-certificate-errors", "--no-proxy-server"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
  loadCookies(page);

  await page.goto(EDIT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(6000);

  // 进入 Technical tab(GameBanana 编辑页的分步向导)
  const techClicked = await page.evaluate(() => {
    const steps = [...document.querySelectorAll("a, button, .Step, li")];
    const t = steps.find(el => /technical/i.test((el.innerText || "").trim()));
    if (!t) return false;
    t.click();
    return true;
  });
  console.log("TECHNICAL TAB:", techClicked);
  await sleep(5000);

  // Requirements 区: 找 Add Requirement / Add 按钮
  // GameBanana 前置表单: mod 页 URL 输入 + 类型选择(Required/Recommended/Optional)+ Enabled 开关
  const pageText = await page.evaluate(() => (document.body.innerText || "").slice(0, 4000));
  console.log("--- page snippet ---");
  console.log(pageText.split("\n").filter(l => /require/i.test(l)).join("\n") || "(no 'require' text found)");
  console.log("--- END snippet(请人工核对表单结构后继续;脚本在此暂停 30s) ---");

  // 尝试自动化: 找 Requirements 区的 Add 按钮
  const addClicked = await page.evaluate(() => {
    const sections = [...document.querySelectorAll(".Section, .Cluster, fieldset, div")];
    const req = sections.find(el => {
      const head = el.querySelector("h2, h3, .Head, label");
      return head && /requirements/i.test(head.innerText || "");
    });
    if (!req) return { ok: false, why: "requirements section not found" };
    const btn = [...req.querySelectorAll("button, a")].find(b => /add/i.test((b.innerText || "").trim()));
    if (!btn) return { ok: false, why: "add button not found" };
    btn.click();
    return { ok: true };
  });
  console.log("ADD CLICKED:", JSON.stringify(addClicked));
  await sleep(4000);

  // 填 URL(GameBanana 前置支持直接贴 mod URL,自动解析)
  const urlFilled = await page.evaluate((url) => {
    const inputs = [...document.querySelectorAll("input[type=text], input:not([type])")]
      .filter(i => i.offsetParent !== null); // 可见
    const target = inputs.reverse().find(i => /url|link|mod/i.test(i.name || i.id || i.placeholder || ""));
    if (!target) return { ok: false, visible: inputs.length };
    const proto = Object.getPrototypeOf(target);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(target, url);
    else target.value = url;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, filled: target.name || target.id || "?" };
  }, REQUIREMENT.url);
  console.log("URL FILL:", JSON.stringify(urlFilled));
  await sleep(4000); // 等待 GameBanana 解析 URL

  // 选 Recommended
  const kindSet = await page.evaluate((kind) => {
    const sels = [...document.querySelectorAll("select")].filter(s => s.offsetParent !== null);
    const sel = sels.reverse().find(s => [...s.options].some(o => o.value === kind || o.text === kind));
    if (!sel) return { ok: false };
    const proto = Object.getPrototypeOf(sel);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(sel, kind);
    else sel.value = kind;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, val: sel.value };
  }, REQUIREMENT.kind);
  console.log("KIND SET:", JSON.stringify(kindSet));
  await sleep(1500);

  console.log(">>> 请在打开的浏览器窗口人工核对 Requirements 表单(URL 解析结果/类型/Enabled 开关),");
  console.log(">>> 确认无误后手动点击 Save/Submit。脚本 60 秒后读取结果并退出。");
  await sleep(60000);

  const after = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 300));
  console.log("AFTER:", after);

  // 回写 cookies(保持登录态)
  const cookies = await page.cookies("https://gamebanana.com");
  const keep = ["sess", "rmc", "cf_clearance"];
  const parts = cookies.filter(c => keep.includes(c.name)).map(c => c.name + "=" + c.value);
  if (parts.length) fs.writeFileSync(COOKIES_FILE, parts.join("; "));

  await browser.close();
  console.log("DONE(若表单未成功保存,重跑本脚本或人工在编辑页操作)");
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
