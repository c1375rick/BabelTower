// gb_add_update4.js — 发布 1.0.10 更新日志: 安全补丁(网页篡改本地桥配置 → API Key 外泄口)+ 翻译超时/结算稳定性修复
// 2026-10-10: 继承 gb_add_update3(1.0.9) 全流程;差异:
//   1) TITLE/VERSION/CHANGELOG/BLURB 换 1.0.10 内容;
//   2) 文件勾选键改 babeltower-1010(四位,精确匹配 10\d\d 只会命中 1000+ 版本,不再有误勾旧包风险);
//   3) 文件勾不到时**中止不提交**(add3 是打日志继续 → 可能发出无绑定文件的条目)。
// 发版前检查(2026-10-10 已做): gh release v1.0.10 已建、gb_updates_probe 1.0.10 = false(未消耗)、
//   gb_replace_file 1.0.10 已把 babeltower-1010-win64.zip 传上 Files 区。
// 用法: node scripts/gb_add_update4.js
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const COOKIES_FILE = "F:\\BabelTower\\config\\gamebanana_cookies.txt";
const UPDATES_URL = "https://gamebanana.com/mods/updates/700107";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const TITLE = "1.0.10 安全补丁(堵死网页篡改本地桥配置/API Key 外泄口)+ 翻译超时与结算稳定性修复";
const VERSION = "1.0.10";

const CHANGELOG = [
  ["Bugfix", "安全:删除本地桥的无鉴权 GET 写接口 —— 恶意网页曾可用一条隐藏请求改掉翻译服务端点,下一次翻译就把 API Key 发往攻击者服务器;现显式 410 拒绝。写配置只剩保存按钮(POST)与游戏内 BTIPC 两条受控路径,正常用法零变化。"],
  ["Bugfix", "安全:新增跨站请求三道闸(Host 必须回环 / 跨源 Origin 拦截 / Sec-Fetch-Site 拦截),并把 10 处 Access-Control-Allow-Origin: * 收敛为仅回显本地同源来源;游戏与本地工具零感知(游戏内实测零误伤)。"],
  ["Bugfix", "修复翻译请求的超时取消在当前游戏版本中完全无效的问题(游戏内 clearTimeout/setTimeout 实测不存在):$.Schedule 句柄改用引擎官方 $.CancelScheduled 取消,消除超时回调晚到造成的重复结算/并发槽位超发隐患。"],
  ["Bugfix", "修复某条翻译超时/失败会让整组聊天吞译或队列卡死的结算缺陷:任何失败都优雅回退发送原文并留痕;桥停掉再拉起,聊天自动恢复(游戏内已验证僵尸复活闭环)。"],
  ["Improvement", "发版基建:统一测试入口(24 项显式清单)+ 3 个新护栏测试 + 构建语法检查;打包脚本修复 3 处缺陷(版本目录名 / 冒烟进程退出 / 压缩文件锁)。"],
];

const BLURB = "本版是*安全补丁 + 稳定性修复*,无功能变化:① 堵死\"恶意网页经浏览器改写本地翻译桥配置\"的口子 —— 该漏洞可让下一次翻译把你的 API Key 发往攻击者服务器,现已删除无鉴权写接口并新增跨站拦截(游戏与本地工具零影响);② 修复翻译请求的超时取消与失败结算路径,断桥/超时时聊天回退发原文、恢复后自动继续,不再吞译或卡队列。协议与操作方式和 1.0.9 完全一致。升级方法:下载新的 BabelTower-1.0.10-win64.zip,解压后 Mod Manager 导入 pak01_dir.vpk,再跑 powershell -ExecutionPolicy Bypass -File scripts\\autostart.ps1 -Action Install,然后游戏内 /tr → 测试 → 保存。详见包内《安装使用说明.txt》。";

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

  // 勾选本版文件:只认 babeltower-1010-win64(10\d\d 四位键,105/106/107/108/109 均不命中 → 无误勾风险)。
  // 2026-10-10 差异:add3 勾不到是打日志继续,会发出无绑定文件的条目 —— 这里改为中止,先传文件再发条目。
  const fileChecked = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll("input[type=checkbox]")];
    const labelOf = (b) => ((b.closest(".RadioCheckWrapper") || {}).innerText || "");
    const cands = boxes.filter((b) => /babeltower-10\d\d-win64/i.test(labelOf(b)));
    const target = cands.find((b) => /babeltower-1010-win64/i.test(labelOf(b))) || cands[0];
    if (!target) return { ok: false, total: boxes.length, cands: cands.length };
    const label = labelOf(target).replace(/\s+/g, " ").trim().slice(0, 60);
    if (!target.checked) target.click();
    return { ok: true, id: target.id, label: label, already: target.checked };
  });
  console.log("FILE CHECK:", JSON.stringify(fileChecked));
  if (!fileChecked.ok) {
    console.log("ABORT: 未勾到 babeltower-1010 文件行(上传未完成?),不提交以避免发出无绑定条目。");
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
