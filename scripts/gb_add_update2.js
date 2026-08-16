// gb_add_update2.js — 发布第二条更新日志: 0.1.3 紧急修复(hero_names.js 缺失导致桥离线)
// 用法: node gb_add_update2.js
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const COOKIES_FILE = "F:\\BabelTower\\config\\gamebanana_cookies.txt";
const UPDATES_URL = "https://gamebanana.com/mods/updates/700107";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const TITLE = "0.1.3 紧急修复：桥不能离线 (hero_names.js 缺失)";
const VERSION = "0.1.3";

const CHANGELOG = [
  ["Bugfix", "修复 0.1.3 初版包缺失 core/hero_names.js 导致本地桥启动崩溃/离线的严重问题（dictionary.js 启动时 require 该模块）"],
  ["Improvement", "打包脚本强制校验：已补齐 hero_names.js 并加入冒烟测试（解压→内置 node 启动桥→健康检查通过→MD5 核对一致）"],
  ["Improvement", "若您已安装旧 0.1.3 包请重新下载 babeltower-013-win64_22047.zip 覆盖安装；已下载旧包的用户只需替换本地桥与配置文件所在的整个安装目录"],
];

const BLURB = "重要：旧版 0.1.3 压缩包（babeltower-013-win64.zip，无 _22047 后缀）缺少 hero_names.js，会导致本地桥启动失败（翻译功能不可用）。本修复包已解决，MD5 校验通过。请重新下载新文件并覆盖安装。";

async function loadCookies(page) {
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
    await page.setCookie(...cookies);
    console.log("COOKIES LOADED:", cookies.map(c => c.name).join(", "));
  }
}

async function setInput(page, selector, value) {
  return page.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel);
    if (!el) return { ok: false, reason: "not found: " + sel };
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, val);
    else el.value = val;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, now: el.value };
  }, { sel: selector, val: value });
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, userDataDir: PROFILE, headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--ignore-certificate-errors", "--no-proxy-server"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
  await loadCookies(page);

  await page.goto(UPDATES_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(6000);
  const modalOpened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(b => /add update/i.test((b.innerText || "").trim()));
    if (!btn) return false;
    btn.click();
    return true;
  });
  console.log("MODAL OPENED:", modalOpened);
  if (!modalOpened) { await browser.close(); process.exit(1); }
  await sleep(8000);

  console.log("TITLE FILL:", JSON.stringify(await setInput(page, "#_sName", TITLE)));
  console.log("VERSION FILL:", JSON.stringify(await setInput(page, "#_sVersion", VERSION)));
  await sleep(1500);

  for (let i = 0; i < CHANGELOG.length; i++) {
    const clicked = await page.evaluate(() => {
      const cluster = [...document.querySelectorAll(".Cluster")].find(c => /Add Entry/.test(c.innerText));
      if (!cluster) return false;
      const btn = [...cluster.querySelectorAll("button")].find(b => /Add Entry/.test(b.innerText || ""));
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!clicked) { console.log("ADD ENTRY FAILED at", i); break; }
    await sleep(600);
    const [type, text] = CHANGELOG[i];
    const filled = await page.evaluate(({ t, txt }) => {
      const rows = [...document.querySelectorAll(".ChangelogInput")];
      const row = rows[rows.length - 1];
      if (!row) return { ok: false };
      const input = row.querySelector("input[type=text]");
      const select = row.querySelector("select");
      if (!input || !select) return { ok: false };
      const sp = Object.getPrototypeOf(select);
      const sdesc = Object.getOwnPropertyDescriptor(sp, "value");
      if (sdesc && sdesc.set) sdesc.set.call(select, t);
      else select.value = t;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      const ip = Object.getPrototypeOf(input);
      const idesc = Object.getOwnPropertyDescriptor(ip, "value");
      if (idesc && idesc.set) idesc.set.call(input, txt);
      else input.value = txt;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, type: select.value, len: input.value.length };
    }, { t: type, txt: text });
    console.log(`  entry ${i + 1} [${type}]:`, JSON.stringify(filled));
    await sleep(500);
  }

  const pm = await page.$(".ProseMirror");
  if (pm) {
    await pm.click();
    await sleep(800);
    await page.keyboard.type(BLURB, { delay: 0 });
    await sleep(1500);
  }

  // 勾选新文件(带 _22047 后缀的)
  const fileChecked = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll("input[type=checkbox]")];
    const target = boxes.find(b => {
      const label = b.closest(".RadioCheckWrapper");
      return label && /babeltower-013-win64_22047/i.test(label.innerText);
    });
    if (!target) return { ok: false };
    target.click();
    return { ok: true, id: target.id };
  });
  console.log("FILE CHECK:", JSON.stringify(fileChecked));
  await sleep(1000);

  const submit = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button, input[type=submit]")].find(b => {
      const t = (b.innerText || b.value || "").trim();
      return /^save$|^submit$|^publish$|^post update$/i.test(t);
    });
    if (!btn) return { ok: false };
    btn.click();
    return { ok: true, text: (btn.innerText || btn.value || "").trim() };
  });
  console.log("SUBMIT:", JSON.stringify(submit));

  await sleep(12000);
  console.log("AFTER URL:", await page.url());
  const body = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 300));
  console.log("BODY:", body);

  const cookies = await page.cookies("https://gamebanana.com");
  const keep = ["sess", "rmc", "cf_clearance"];
  const parts = cookies.filter(c => keep.includes(c.name)).map(c => c.name + "=" + c.value);
  if (parts.length) fs.writeFileSync(COOKIES_FILE, parts.join("; "));

  await browser.close();
  console.log("DONE");
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });