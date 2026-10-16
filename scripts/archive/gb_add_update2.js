// gb_add_update2.js — 发布 1.0.8 更新日志: 修消息不进本地桥 + 聊天行露 HTML + 崩溃 + 安装教程补 -condebug
// 2026-10-04: 发 1.0.8。1.0.7 已于 10-03 发出(条目 460737),本脚本原样新增一条,不动旧条目。
// 发版前查重: gh release list 最新 v1.0.7、gb_updates_probe 1.0.8 含[1.0.8]=false -> 1.0.8 未消耗。
// 用法: node gb_add_update2.js
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const COOKIES_FILE = "F:\\BabelTower\\config\\gamebanana_cookies.txt";
const UPDATES_URL = "https://gamebanana.com/mods/updates/700107";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const TITLE = "1.0.8 修复消息不进本地桥(翻译静默失效)+ 聊天行原样显示 HTML,请整包升级";
const VERSION = "1.0.8";

const CHANGELOG = [
  ["Bugfix", "本版主要修复——消息不再进本地桥(翻译静默失效):出站队列是单槽设计,某次同步任务抛异常时槽位没有归还,队列从此不再派发任何任务。表现为游戏里 /tr 能开、设置能存、看起来一切正常,但消息根本没送到翻译桥,logs\\bridge.log 里一条消息流量都没有。现已给派发加异常兜底:槽位必还、真实错误落日志、超限后按原文发送,不吞用户消息。"],
  ["Bugfix", "聊天行原样显示 HTML 源码:游戏 10-03 更新后,快捷语音消息(如「Abrams的大招好了」)会把 <span class=\"highlight\"> 标记当纯文本露出来。原因是游戏给 PingLabel 加了富文本开关 html=\"true\",本 mod 的布局没跟上,现已补齐。"],
  ["Bugfix", "游戏崩溃(聊天渲染查不到面板):补上 TargetHeroImage 面板,消除 10-03 更新后的 Unable to find child 'TargetHeroImage' 致命错误。"],
  ["Feature", "健康 / 快捷语音 / 英雄物品名改走 BTIPC 信道;292 条名称保护名单改为随游戏更新自动增量同步,游戏更新名字后不再需要整包升级。"],
  ["Bugfix", "《安装使用说明.txt》新增 -condebug 启动参数步骤(必做):游戏不带该参数就不生成 console.log,而本地桥只能靠它收游戏消息——不设就是静默失效。设置路径:Steam 库 → Deadlock 右键 → 属性 → 常规 → 启动选项 填 -condebug(设一次永久生效);用 StartDeadlock.bat 启动的已自动带上,可跳过。"],
];

const BLURB = "本版以修复为主:**消息不进本地桥导致翻译静默失效**已修(出站队列单槽泄漏,某次任务抛异常后队列永久停摆,游戏里看着正常但消息根本没送到桥)。同时修了聊天行原样显示 HTML 源码、以及 10-03 游戏更新带来的崩溃(TargetHeroImage 面板缺失)。安装教程已补上 **-condebug 启动参数**这一步——它不设翻译链路就是静默失效,Steam 库 → Deadlock 右键 → 属性 → 常规 → 启动选项 填 -condebug(设一次即可)。安装(3 步):解压 zip → Mod Manager 导入 pak01_dir.vpk → powershell -ExecutionPolicy Bypass -File scripts\\autostart.ps1 -Action Install,然后游戏内 /tr → 测试 → 保存。沿用 1.0.6:游戏内 UMM 设置窗口有「巴别塔」标签页,不装 UMM 完全不影响本 mod。详细说明见包内《安装使用说明.txt》。";

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
    // 2026-10-03: 填完第 4 条 changelog 后 Runtime.callFunctionOn 默认 180s 超时,
    // 走不到提交那步(条目未创建)。放长到 10 分钟。
    protocolTimeout: 600000,
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

  console.log("BLURB STEP...");
  const pm = await page.$(".ProseMirror");
  console.log("  ProseMirror found:", !!pm);
  if (pm) {
    await pm.click();
    await sleep(800);
    await page.keyboard.type(BLURB, { delay: 0 });
    await sleep(1500);
    const blurbLen = await page.evaluate(() => {
      const el = document.querySelector(".ProseMirror");
      return el ? (el.innerText || "").length : -1;
    });
    console.log("  BLURB LEN:", blurbLen, "/", BLURB.length);
  }

  // 勾选要发布的文件:严格优先 108(本版),107/106/105 只作兜底。
  // 原实现 .find() 返回 DOM 中先出现者,而 babeltower-105-win64.zip 仍在列表里
  // 且常排在本版之前 → 会误勾 1.0.5 的包(9/25 那条 1.0.6 就是这么绑错的);
  // 另有已勾选状态未检查、再点会反勾的风险。
  const fileChecked = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll("input[type=checkbox]")];
    const labelOf = (b) => ((b.closest(".RadioCheckWrapper") || {}).innerText || "");
    const cands = boxes.filter((b) => /babeltower-10[5678]-win64/i.test(labelOf(b)));
    const target = cands.find((b) => /babeltower-108-win64/i.test(labelOf(b))) || cands[0];
    if (!target) return { ok: false, total: boxes.length, cands: cands.length };
    const label = labelOf(target).replace(/\s+/g, " ").trim().slice(0, 60);
    if (!target.checked) target.click();
    return { ok: true, id: target.id, label: label, already: target.checked };
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
