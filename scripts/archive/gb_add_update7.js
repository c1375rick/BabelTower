// gb_add_update6.js — 发布 1.2.0 更新日志: https 面板低延迟通道转正 + 配置同步三修 + 维护入口精简
// 2026-10-16: 继承 gb_add_update5(1.1.0) 全流程;差异:
//   1) TITLE/VERSION/CHANGELOG/BLURB 换 1.2.0 内容;
//   2) 文件勾选键改 babeltower-120(先宽过滤 babeltower-\d+-win64,再精确 find
//      babeltower-121-win64 —— GB 上传后会自动加哈希后缀(_3df0e),故用前缀匹配);
//   3) 文件勾不到时中止不提交(沿 add4/add5)。
// 发版前检查(2026-10-16 已做): dist\BabelTower-1.2.0-win64.zip 已打出并冒烟通过,
//   GB Files 区已有 babeltower-121-win64_3df0e.zip(行版本 1.2.0)、描述中英短版已替换,
//   列表页回读确认该 zip 与 1.2.0 均在。GitHub 代码已推 origin/push/code-only @ 5eeed45
//   (v1.2.0 tag/release 尚未打 —— 本条目不依赖它)。
// 用法: node scripts\archive\gb_add_update6.js
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const COOKIES_FILE = "F:\\BabelTower\\config\\gamebanana_cookies.txt";
const UPDATES_URL = "https://gamebanana.com/mods/updates/700107";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const TITLE = "1.2.1 网页设置页(10 种语言) + 配置即时下发(保存后 1 秒生效)";
const VERSION = "1.2.1";

const CHANGELOG = [
  ["Feature", "设置面板搬到**本地网页**:游戏内输入 /tr 用系统默认浏览器打开设置页(10 种界面语言:简中/繁中/英/日/韩/法/德/西/俄/葡,默认跟随游戏界面语言,右上角可手动切换);游戏内旧面板保留为调试/兜底入口(/tr panel)。"],
  ["Feature", "**配置即时下发**:网页保存后游戏 **1 秒内**生效,不用再重启游戏 —— 桥主动把\"配置变了\"的信号推给游戏,游戏再自己去读配置(此前网页改了要重启游戏才认)。"],
  ["Bugfix", "\"启用翻译\"开关此前只管发送前翻译:关掉它,队友发来的消息照样被翻译。现在它是名副其实的总开关——关掉后收发都不翻译。"],
  ["Improvement", "网页设置页新增**通道健康卡**(实时显示游戏↔桥四条通路的最近活跃时间,一眼看出是没连上还是只是没说话)与**高级 JSON** 编辑;免 Key 服务商的判定改用\"是否收 Key\"(bing 不收,以前会误显示 Key 输入框)。"],
  ["Adjustment", "游戏内 /tr 现在打开网页设置页(旧面板改用 /tr panel);网页与游戏内面板共用同一份 config.json,改哪边都一样。"],
  // 注:GB changelog 类型全集为 Addition/Removal/Overhaul/Adjustment/Amendment/
  //     Improvement/Optimization/Tweak/Suggestion/Feature/Refactor/Bugfix —— **没有 Note**。
  //     2026-10-13 实测:填 "Note" select 不接受、落库为「无类型(显示 -)」,沿用 Adjustment。
];

const BLURB = "本版把\"设置\"这件事从游戏里搬到了浏览器:游戏内输入 /tr,系统默认浏览器会打开一个本地网页设置页 —— 10 种界面语言(默认跟随游戏语言),服务商、Key、目标语言、游戏内行为都能在这儿点着改,而且**保存后游戏 1 秒内生效,不用重启**。改的其实是以前最别扭的一环:此前网页改了配置、游戏得重启才认,现在桥会把\"配置变了\"直接推给游戏。另外修掉一个老毛病:\"启用翻译\"这个开关从前只管发送前翻译,关掉它队友的消息照样被翻译,现在它是个真正的总开关。游戏内旧面板没删,/tr panel 还能开,留作调试与兜底。升级方法:下载新的 babeltower-121-win64.zip,解压后用 Mod Manager 导入 pak01_dir.vpk,再双击 BabelTower-维护菜单.bat 选 1(首次)或选 2(已装过的直接更新),然后游戏内 /tr 就会打开网页设置页。详见包内《安装使用说明.txt》。";


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
    // 填多条 changelog 后 Runtime.callFunctionOn 默认 180s 超时会走不到提交;放长到 10 分钟。
    protocolTimeout: 600000,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--ignore-certificate-errors", "--no-proxy-server"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
  await loadCookies(page);

  await page.goto(UPDATES_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(6000);
  // COOKIE FALLBACK(2026-10-20):cookies 文件可能已过期,而浏览器 profile 的会话是新的
  // (2026-10-20 实测:profile 能进 GB 编辑页,cookies 文件却已失效)。先看表单在不在,
  // 不在再补 cookies 并重载 —— 别用过期 cookie 把 profile 的新会话顶掉。
  const hasForm = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => /add update/i.test(b.innerText || "")));
  if (!hasForm) {
    await loadCookies(page);
    await page.goto(UPDATES_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(6000);
  }
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

  // 勾选本版文件:宽过滤所有 babeltower-*-win64 行,再精确命中 babeltower-121-win64
  // (GB 会给上传文件加哈希后缀,故用前缀匹配而非全等)。
  // 勾不到即中止(沿 add4):防止发出无绑定文件的条目。
  const fileChecked = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll("input[type=checkbox]")];
    const labelOf = (b) => ((b.closest(".RadioCheckWrapper") || {}).innerText || "");
    const cands = boxes.filter((b) => /babeltower-\d+-win64/i.test(labelOf(b)));
    const target = cands.find((b) => /babeltower-121-win64/i.test(labelOf(b))) || null;
    if (!target) return { ok: false, total: boxes.length, cands: cands.map(c => labelOf(c).replace(/\s+/g, " ").trim().slice(0, 50)) };
    const label = labelOf(target).replace(/\s+/g, " ").trim().slice(0, 60);
    if (!target.checked) target.click();
    return { ok: true, id: target.id, label: label, already: target.checked };
  });
  console.log("FILE CHECK:", JSON.stringify(fileChecked));
  if (!fileChecked.ok) {
    console.log("ABORT: 未勾到 babeltower-120 文件行(上传未完成?),不提交以避免发出无绑定条目。");
    await browser.close();
    process.exit(1);
  }
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
