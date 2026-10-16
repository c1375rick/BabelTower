// gb_add_update3.js — 发布 1.0.9 更新日志: /tr 关闭按钮移到底部(原版聊天框遮挡) + 发布/安装脚本 7 项修复
// 2026-10-09: 发 1.0.9。1.0.8 已于 10-04 发出,本脚本原样新增一条,不动旧条目。
// 发版前查重: gh release list 最新 v1.0.8、gb_updates_probe 1.0.9 含[1.0.9]=false -> 1.0.9 未消耗。
// 用法: node gb_add_update3.js
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const COOKIES_FILE = "F:\\BabelTower\\config\\gamebanana_cookies.txt";
const UPDATES_URL = "https://gamebanana.com/mods/updates/700107";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const TITLE = "1.0.9 修 /tr 菜单关闭按钮点不到(顶部被原版聊天框遮挡)+ 发布/安装脚本 7 项修复,请整包升级";
const VERSION = "1.0.9";

const CHANGELOG = [
  ["Bugfix", "修 /tr 菜单关闭按钮点不到:面板顶部被原版聊天框遮挡,右上角的 X 根本够不着。设置面板由 660x600 收窄到 580x520,关闭按钮从右上角标题栏移到底部右侧(底部不会再被遮挡);底部提示条占满剩余宽度把 X 顶到最右,提示与文档同步改为「点右下角 X 关闭」。"],
  ["Bugfix", "打包脚本有一处编译期参数错误:整份脚本其实从未真正跑通过,一行输出都没有就报「出错了」——发版链路上最要命的一处。已修正并实测。"],
  ["Bugfix", "打包脚本的 VPK 路径指向不存在的根目录,会打出缺 VPK 的残缺包却报成功;另有一处脚本保存为 UTF-8 无 BOM,里面的中文正则被 PowerShell 5.1 按 GBK 误读,版本号永远解析不出来。两处均已修正。"],
  ["Bugfix", "守卫式安装器:首装时目标目录不存在会直接中止(必失败),改为自动建目录并跳过备份;校验从「只比文件长度」改为比对源/目标 SHA-256,防止装了半截包还报成功;再加单实例互斥锁,防止两个安装实例抢同一个换包窗口。"],
  ["Bugfix", "一键打包脚本默认版本硬编码 0.1.0,改为读取 VERSION 单一来源并校验格式,不再可能打出版本号写错的包。"],
  ["Feature", "自启脚本文案「游戏退出桥自动关闭」与 2026-08-12 起桥常驻的行为矛盾,已更正(文件仍保持纯 ASCII);README 新增第三方 Windows 图形界面启动器 BabelTowerLauncher 链接(可选,不含 Mod 本体);5 处口径由「ESC 关闭」改为「点右下角 X 关闭」。"],
];

const BLURB = "本版主要是**关闭入口修复**:游戏原版聊天框会盖住 /tr 设置面板的顶部,右上角的关闭 X 根本点不到——现在面板收窄到 580x520,关闭按钮移到**底部右侧**,底部提示条占满剩余宽度把 X 顶到最右,提示改成「点右下角 X 关闭」。另外把发版/安装链路整体审了一遍,修掉 **7 项脚本缺陷**:打包脚本一处编译期错误导致整份脚本从未真正跑通、一处 VPK 路径写错会打出缺 VPK 的残缺包、一处编码问题让版本号永远解析不出来、一键打包默认版本硬编码;安装器首装必失败、校验只比长度不比内容、两个安装实例抢同一换包窗口。升级方法:下载新的 BabelTower-1.0.9-win64.zip(旧包已归档),解压后 Mod Manager 导入 pak01_dir.vpk,再跑 powershell -ExecutionPolicy Bypass -File scripts\\autostart.ps1 -Action Install,然后游戏内 /tr → 测试 → 保存。详见包内《安装使用说明.txt》。";

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

  // 勾选要发布的文件:严格优先 109(本版),107/106/105 只作兜底。
  // 原实现 .find() 返回 DOM 中先出现者,而 babeltower-105-win64.zip 仍在列表里
  // 且常排在本版之前 → 会误勾 1.0.5 的包(9/25 那条 1.0.6 就是这么绑错的);
  // 另有已勾选状态未检查、再点会反勾的风险。
  const fileChecked = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll("input[type=checkbox]")];
    const labelOf = (b) => ((b.closest(".RadioCheckWrapper") || {}).innerText || "");
    const cands = boxes.filter((b) => /babeltower-10[6789]-win64/i.test(labelOf(b)));
    const target = cands.find((b) => /babeltower-109-win64/i.test(labelOf(b))) || cands[0];
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
