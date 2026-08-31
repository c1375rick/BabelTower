// gb_add_update.js — 发布 GameBanana 更新日志 (UpsertUpdateForm)
// 用法: node scripts/gb_add_update.js
// 表单字段: _sName(标题) _sVersion(版本) Changelog 条目列表(隐藏 _aChangeLog) + Blurb 富文本(_sText) + 文件勾选 + 提交
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const COOKIES_FILE = "F:\\BabelTower\\config\\gamebanana_cookies.txt";
const UPDATES_URL = "https://gamebanana.com/mods/updates/700107";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const TITLE = "1.0.0 首个稳定版：名称保护统一 / HUD 浮层 / 日志轮转";
const VERSION = "1.0.0";

// Changelog 条目: [Type, 文案]  (Type 为下拉选项)
const CHANGELOG = [
  ["Bugfix", "修复 buildProtectRe() 正则转义：resourcecompiler 对单反斜杠处理有 bug，导致编译产物语法错误，脚本加载失败"],
  ["Bugfix", "修复 PROTECT_RE 重复声明（const → let），消除 SyntaxError"],
  ["Bugfix", "修复 HUD 浮层不消失：DeleteAsync 在部分 Panorama 版本不可靠，改用 visible=false"],
  ["Improvement", "名称保护动态同步：启动时从桥拉取全量 285 条游戏名，桥离线降级到 60 条兜底"],
  ["Improvement", "HUD 翻译浮层：顶栏消息被游戏清理后自动接管显示译文，5 秒后隐藏"],
  ["Improvement", "聊天日志轮转：单文件 5MB 自动归档，启动时清理 30 天以上旧日志"],
  ["Improvement", "词典 learned 条目上限 5000/语言，按频率淘汰低频词"],
];

const BLURB = "请下载新的 BabelTower-1.0.0-win64.zip（旧文件已自动归档）。1.0.0 首个稳定版：修复 resourcecompiler 正则转义导致脚本加载失败的严重 bug；名称保护从桥动态同步全量 285 条；HUD 顶栏译文浮层；聊天日志自动轮转；词典学习条目上限。注意：含桥/脚本改动，请下载完整 zip 包。";

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

// 用原生 setter 触发 Vue 更新
async function setInput(page, selector, value) {
  const r = await page.evaluate(({ sel, val }) => {
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
  return r;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, userDataDir: PROFILE, headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--ignore-certificate-errors", "--no-proxy-server"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
  await loadCookies(page);

  // 打开更新页并点 Add Update
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

  // 确认表单在
  const hasForm = await page.$("#UpsertUpdateForm");
  if (!hasForm) { console.log("NO FORM"); await browser.close(); process.exit(1); }

  // 1) Title + Version
  console.log("TITLE FILL:", JSON.stringify(await setInput(page, "#_sName", TITLE)));
  console.log("VERSION FILL:", JSON.stringify(await setInput(page, "#_sVersion", VERSION)));
  await sleep(1500);

  // 2) Changelog 条目: 逐条 Add Entry -> 填 Type + 文案
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
    // 填新行(最后一行 .ChangelogInput)
    const [type, text] = CHANGELOG[i];
    const filled = await page.evaluate(({ t, txt }) => {
      const rows = [...document.querySelectorAll(".ChangelogInput")];
      const row = rows[rows.length - 1];
      if (!row) return { ok: false };
      const input = row.querySelector("input[type=text]");
      const select = row.querySelector("select");
      if (!input || !select) return { ok: false };
      // select 用原生 setter
      const sp = Object.getPrototypeOf(select);
      const sdesc = Object.getOwnPropertyDescriptor(sp, "value");
      if (sdesc && sdesc.set) sdesc.set.call(select, t);
      else select.value = t;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      // input 用原生 setter
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

  // 检查隐藏 changelog 值
  const cl = await page.evaluate(() => {
    const h = document.querySelector("#_aChangeLog");
    return h ? h.value : "NO_HIDDEN";
  });
  console.log("CHANGELOG HIDDEN:", String(cl).slice(0, 200));

  // 3) Blurb 富文本: 聚焦 ProseMirror 并输入
  const pm = await page.$(".ProseMirror");
  if (pm) {
    await pm.click();
    await sleep(800);
    await page.keyboard.type(BLURB, { delay: 0 });
    await sleep(1500);
    const st = await page.evaluate(() => {
      const h = document.querySelector("#_sText");
      return h ? h.value : "NO_HIDDEN";
    });
    console.log("BLURB HIDDEN:", String(st).slice(0, 150).replace(/\n/g, " | "));
  } else {
    console.log("NO PROSEMIRROR");
  }

  // 4) 勾选 0.1.3 文件
  const fileChecked = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll("input[type=checkbox]")];
    const target = boxes.find(b => {
      const label = b.closest(".RadioCheckWrapper");
      return label && /babeltower-013-win64/i.test(label.innerText);
    });
    if (!target) {
      // fallback: 最近添加的文件(最后一个非 archived 的)
      const all = boxes.filter(b => b.id && /^File_/.test(b.id));
      const t2 = all[all.length - 1];
      if (t2) { t2.click(); return { ok: true, id: t2.id, note: "fallback last file" }; }
      return { ok: false };
    }
    target.click();
    return { ok: true, id: target.id };
  });
  console.log("FILE CHECK:", JSON.stringify(fileChecked));
  await sleep(1000);

  // 5) 提交
  const submit = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button, input[type=submit]")].find(b => {
      const t = (b.innerText || b.value || "").trim();
      return /^save$|^submit$|^publish$|^post update$/i.test(t);
    });
    if (!btn) return { ok: false, buttons: [...document.querySelectorAll("button")].map(b => (b.innerText || "").trim().slice(0, 30)).filter(Boolean).slice(0, 15) };
    btn.click();
    return { ok: true, text: (btn.innerText || btn.value || "").trim() };
  });
  console.log("SUBMIT:", JSON.stringify(submit));

  await sleep(12000);
  console.log("AFTER URL:", await page.url());
  const body = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 500));
  console.log("BODY:", body);

  // 刷新 cookies
  const cookies = await page.cookies("https://gamebanana.com");
  const keep = ["sess", "rmc", "cf_clearance"];
  const parts = cookies.filter(c => keep.includes(c.name)).map(c => c.name + "=" + c.value);
  if (parts.length) fs.writeFileSync(COOKIES_FILE, parts.join("; "));

  await browser.close();
  console.log("DONE");
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });