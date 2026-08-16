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

const TITLE = "0.1.3 正式版：内置词典 2766 条 + Thirt927 优化分支合入";
const VERSION = "0.1.3";

// Changelog 条目: [Type, 文案]  (Type 为下拉选项)
const CHANGELOG = [
  ["Feature", "合并 Thirt927 优化分支：多翻译商失败回退链、内置词典离线直查、大厅聊天翻译、聊天记录日志"],
  ["Bugfix", "内置词典修缮：清除 36 条废弃/占位符道具条目（官方数据库+商店页三重验证），新增 High-Velocity Rounds→高速弹，现 2766 条与当前 156 件商店道具完全对齐"],
  ["Bugfix", "修复发布包漏带内置词典（此前 zip 缺 dictionary.builtin.json，安装后内置词典实际为空）"],
  ["Bugfix", "桥常驻修复：关游戏→再开游戏桥不再消失；新增 restart_bridge 一键重启+健康自检"],
  ["Bugfix", "发送前翻译与保存链路修复（设置选项经桥持久化）；输入框鼠标/键盘冻结修复（TextEntry V1-V5）；翻译标签改 CSS 类控制"],
  ["Improvement", "自启脚本清除 StartupApproved 禁用标记；GameBanana 更新脚本导航容错+登录页检测"],
];

const BLURB = "请下载新的 babeltower-013-win64.zip（旧文件已自动归档）。\n0.1.3 正式版：内置词典修缮至 2766 条（清除 36 条废弃道具，新增高速弹，与当前游戏道具对齐）；合并 Thirt927 优化分支（多翻译商失败回退、内置词典、大厅聊天、聊天日志）；修复桥常驻、发送前翻译链路、输入框冻结、翻译标签样式等。注意：含桥/脚本改动，请下载完整 zip 包，DMM 只装 vpk 会丢本地桥。";

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