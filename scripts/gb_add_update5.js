// gb_add_update5.js — 发布 1.1.0 更新日志: 对局高峰拥塞误判修复 + 配置原子写 + 自启/安装脚本加固
// 2026-10-13: 继承 gb_add_update4(1.0.10) 全流程;差异:
//   1) TITLE/VERSION/CHANGELOG/BLURB 换 1.1.0 内容;
//   2) 文件勾选键改 babeltower-110(1.1.0 去点;先宽过滤 babeltower-\d+-win64,
//      再精确 find babeltower-110-win64 —— 与 add4 的四位键(1010)同理:精确 find
//      不会命中 105/106/107/108/109/1010,无误勾旧包风险);
//   3) 文件勾不到时中止不提交(沿 add4)。
// 发版前检查(2026-10-13 已做): gh release v1.1.0 已建(Latest,双资产字节数核对一致)、
//   gb_updates_probe 1.1.0 = false(未消耗)、gb_replace_file 1.1.0 已把 babeltower-110-win64.zip
//   传上 Files 区(行版本 + 全局版本均 1.1.0)。
// 用法: node scripts/gb_add_update5.js
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const COOKIES_FILE = "F:\\BabelTower\\config\\gamebanana_cookies.txt";
const UPDATES_URL = "https://gamebanana.com/mods/updates/700107";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const TITLE = "1.1.0 稳定性更新(对局高峰误判桥掉线修复 + 配置原子写 + 自启/安装脚本加固)";
const VERSION = "1.1.0";

const CHANGELOG = [
  ["Bugfix", "对局高峰时,偶发的健康回声超时不再被误判为本地桥掉线。此前控制台日志洪峰中一次超时就会触发整段聊天通道重探测(面板失效刷屏、译文断流);现风暴窗口内按拥塞处理并自动恢复,聊天链路不丢、不重、不乱序(实弹验收:6 次超时 6 次分类全对)。"],
  ["Bugfix", "配置保存改为原子写(临时文件 + 原子改名),断电、强杀游戏、写入途中崩溃都不再有「保存了一半的配置」窗口。"],
  ["Bugfix", "开机自启脚本的模板语法错误:此前重跑 install-autostart.bat 反而会把登录自启打坏(静默失败、无任何报错),本版修复并加护栏防复发;缺 Node 运行时改为中止注册并报错,不再静默注册一个永远起不来的自启。"],
  ["Improvement", "安装/启动脚本加固:换车改原子替换(旧车自动备份、崩溃不留空槽);桥重启脚本会校验新进程真的活着再报成功(不再拿旧实例的健康响应误报 OK),并发重复重启自动让位;日志加日期;端口严格按配置读取。"],
  // 注:GB changelog 类型全集为 Addition/Removal/Overhaul/Adjustment/Amendment/
  //     Improvement/Optimization/Tweak/Suggestion/Feature/Refactor/Bugfix —— **没有 Note**。
  //     2026-10-13 实测:填 "Note" select 不接受、落库为「无类型(显示 -)」,已改 Adjustment。
  ["Adjustment", "内部工程(玩家无感):统一测试入口扩至 30 项并新增脚本加固护栏;自动模拟测试套件回程链补齐(68 项场景全绿,真桥真传输);建立正式风险登记表归档各加固项的护栏与边界。本版无游戏内新功能,操作方式与 1.0.10 完全一致。"],
];

const BLURB = "本版是*稳定性 + 脚本加固*,无新功能、操作方式与 1.0.10 完全一致:① 修复对局高峰(日志洪峰)时偶发超时被误判成\"本地桥掉线\"的问题 —— 此前会触发聊天通道重探测、表现为面板失效刷屏与译文断流,现在按拥塞自动恢复;② 配置保存原子化,断电/强杀不再写坏配置;③ 修复开机自启脚本的隐性语法错误(此前重装自启反而会把登录启动打坏且无报错)。升级方法:下载新的 BabelTower-1.1.0-win64.zip,解压后 Mod Manager 导入 pak01_dir.vpk,再跑 powershell -ExecutionPolicy Bypass -File scripts\\autostart.ps1 -Action Install,然后游戏内 /tr → 测试 → 保存。详见包内《安装使用说明.txt》。";

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

  // 勾选本版文件:宽过滤所有 babeltower-*-win64 行,再精确命中 babeltower-110-win64。
  // 勾不到即中止(沿 add4):防止发出无绑定文件的条目。
  const fileChecked = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll("input[type=checkbox]")];
    const labelOf = (b) => ((b.closest(".RadioCheckWrapper") || {}).innerText || "");
    const cands = boxes.filter((b) => /babeltower-\d+-win64/i.test(labelOf(b)));
    const target = cands.find((b) => /babeltower-110-win64/i.test(labelOf(b))) || null;
    if (!target) return { ok: false, total: boxes.length, cands: cands.map(c => labelOf(c).replace(/\s+/g, " ").trim().slice(0, 50)) };
    const label = labelOf(target).replace(/\s+/g, " ").trim().slice(0, 60);
    if (!target.checked) target.click();
    return { ok: true, id: target.id, label: label, already: target.checked };
  });
  console.log("FILE CHECK:", JSON.stringify(fileChecked));
  if (!fileChecked.ok) {
    console.log("ABORT: 未勾到 babeltower-110 文件行(上传未完成?),不提交以避免发出无绑定条目。");
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
