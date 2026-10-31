// GameBanana 1.2.5 更新公告(Add Update 表单)——全自动(2026-10-31 用户指示)。
// 表单知识来自 gb_add_update_124.js(2026-10-30 实测):
//   _sName / _sVersion / Changelog(.ChangelogInput 行,Add Entry 逐条加) /
//   Blurb(ProseMirror 键入) / 文件勾选(input[type=checkbox],File_ 前缀)
// Run:  node scripts\gb_add_update_125.js [--no-save]
const puppeteer = require("puppeteer-core");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const TITLE = "1.2.5 用户更新前置更新(出站方向修复)——1.2.4 必须升级";
const VERSION = "1.2.5";
const CHANGELOG = [
  ["Bugfix", "修复 1.2.4 出站翻译方向整反(hash 载荷字段名错误,中文消息被静默原样发出)——1.2.4 用户必须升级"],
  ["Bugfix", "修复同文本翻译中重复按 Enter 被静默吞掉(现原样立即发出,消息不再丢;Shift+Enter 通道同样受益)"],
  ["Bugfix", "修复俄/韩/日消息被纯符号正则误跳过、完全不翻译的问题(Unicode 字母判定)"],
  ["Bugfix", "根修 convar 写入自项目起从未生效的潜伏 bug(变量作用域错误被空 catch 吞掉)"],
  ["Improvement", "配置最终一致性:陈旧差分防护 + 丢弃后 2s 重同步——网页改配置游戏侧秒级生效,且不会被乱序旧差分回退"],
  ["Improvement", "双上下文方向新鲜度:发送方向 convar 直读,改配置后两个聊天布局立即一致"],
  ["Improvement", "游戏内设置面板移除,全部设置走网页 /tr;面板全局函数在主文件兜底"],
];
const BLURB = [
  "更新新的 BabelTower-1.2.5-win64.zip:用户更新前置更新——修复 1.2.4 出站方向整反(必须升级)、俄/韩/日扫描跳过、同文本重复发送被吞;配置一致性底层收敛(网页改配置秒级生效)。",
  "证书与桥无变化:替换 pak01_dir.vpk 重启游戏即可,无需重新信任证书。",
  "详见 GitHub Release: https://github.com/c1375rick/BabelTower/releases/tag/v1.2.5",
].join("\n");

(async () => {
  const autoSave = !process.argv.includes("--no-save");
  const browser = await puppeteer.launch({
    executablePath: EDGE, userDataDir: PROFILE, headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");

  await page.goto("https://gamebanana.com/mods/updates/700107", { waitUntil: "domcontentloaded", timeout: 60000 });
  // Add Update 按钮是延迟渲染的 GB 组件(实测 5-6s 才出现)——轮询等它,最长 40s
  let addReady = false;
  for (let i = 0; i < 20; i++) {
    addReady = await page.evaluate(() =>
      [...document.querySelectorAll("button,[role=button]")].some((b) => /^add update$/i.test((b.innerText || "").trim())));
    if (addReady) break;
    await sleep(2000);
  }
  if (!addReady) { console.log("ADD UPDATE 按钮未出现(40s)—— 停止(未提交)。"); await browser.close(); process.exit(1); }
  console.log("ADD UPDATE 按钮 ✓,点击...");
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button,[role=button]")].find((x) => /^add update$/i.test((x.innerText || "").trim()));
    if (b) b.click();
  });
  // 等表单(#_sName)渲染
  let onForm = false;
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    onForm = await page.evaluate(() => !!document.querySelector("#_sName"));
    if (onForm) break;
  }
  if (!onForm) {
    console.log("表单未出现 —— 停止(未提交)。URL: " + page.url().slice(0, 90));
    await browser.close();
    process.exit(1);
  }
  console.log("FORM 页就绪:", (await page.title()).slice(0, 80));

  const setInput = async (sel, value) => page.evaluate((s, v) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, sel, value);
  console.log("TITLE:", JSON.stringify(await setInput("#_sName", TITLE)));
  console.log("VERSION:", JSON.stringify(await setInput("#_sVersion", VERSION)));

  for (let i = 0; i < CHANGELOG.length; i++) {
    await page.evaluate(() => {
      const cluster = [...document.querySelectorAll(".Cluster")].find((c) => /Add Entry/i.test(c.innerText || ""));
      const btn = cluster ? [...cluster.querySelectorAll("button")].find((b) => /Add Entry/i.test(b.innerText || "")) : null;
      if (btn) btn.click();
    });
    await sleep(700);
    const filled = await page.evaluate((t, txt) => {
      const rows = [...document.querySelectorAll(".ChangelogInput")];
      const row = rows[rows.length - 1];
      if (!row) return { ok: false };
      const input = row.querySelector("input[type=text]");
      const select = row.querySelector("select");
      if (!input || !select) return { ok: false };
      const sdesc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), "value");
      if (sdesc && sdesc.set) sdesc.set.call(select, t); else select.value = t;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      const idesc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");
      if (idesc && idesc.set) idesc.set.call(input, txt); else input.value = txt;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, type: select.value, len: input.value.length };
    }, CHANGELOG[i][0], CHANGELOG[i][1]);
    console.log("  entry " + (i + 1) + " [" + CHANGELOG[i][0] + "]:", JSON.stringify(filled));
    await sleep(400);
  }

  // Blurb:找与 #_sText 同容器的 ProseMirror(页面可能有多个 PM 组件),键入后必须验证隐藏域;
  // 隐藏域仍为空则直写 #_sText 兜底(native setter + 事件)。
  const blurbDone = await page.evaluate((txt) => {
    const hidden = document.querySelector("#_sText");
    if (!hidden) return { ok: false, why: "no #_sText" };
    const pms = [...document.querySelectorAll(".ProseMirror")];
    const inSameForm = (pm) => {
      let el = pm;
      for (let k = 0; k < 12 && el; k++) {
        if (el.querySelector && el.querySelector("#_sText")) return true;
        el = el.parentElement;
      }
      return false;
    };
    const pm = pms.find(inSameForm) || pms[0] || null;
    if (pm) {
      try {
        pm.focus();
        pm.click();
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, txt);
        pm.dispatchEvent(new Event("input", { bubbles: true }));
        pm.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (ePm) {}
    }
    let len = (hidden.value || "").length;
    if (len < 30) {
      // 按 tagName 选 setter(#_sText 在此表单是 input,用 textarea 的 setter 会 Illegal invocation)
      const proto = hidden.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      if (setter) setter.call(hidden, txt); else hidden.value = txt;
      hidden.dispatchEvent(new Event("input", { bubbles: true }));
      hidden.dispatchEvent(new Event("change", { bubbles: true }));
      len = (hidden.value || "").length;
      return { ok: len >= 30, len: len, note: "fallback direct write, pm=" + !!pm };
    }
    return { ok: true, len: len, note: "via prosemirror" };
  }, BLURB);
  console.log("BLURB:", JSON.stringify(blurbDone));
  await sleep(1000);

  const fileChecked = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll("input[type=checkbox]")];
    const target = boxes.find((b) => {
      const label = b.closest(".RadioCheckWrapper") || b.parentElement;
      return label && /babeltower-125-win64/i.test(label.innerText || "");
    });
    if (!target) {
      const all = boxes.filter((b) => b.id && /^File_/.test(b.id));
      const t2 = all[all.length - 1];
      if (t2) { t2.click(); return { ok: true, id: t2.id, note: "fallback last" }; }
      return { ok: false };
    }
    target.click();
    return { ok: true, id: target.id };
  });
  console.log("FILE CHECK:", JSON.stringify(fileChecked));
  await sleep(1000);

  const final = await page.evaluate(() => ({
    name: (document.querySelector("#_sName") || {}).value || "",
    ver: (document.querySelector("#_sVersion") || {}).value || "",
    changelogLen: document.querySelectorAll(".ChangelogInput").length,
    blurbLen: ((document.querySelector("#_sText") || {}).value || "").length,
  }));
  console.log("FINAL:", JSON.stringify(final));
  if (!final.name || !final.ver || final.changelogLen < CHANGELOG.length || final.blurbLen < 50) {
    console.log("字段不齐 —— 停止(未提交)。请人工检查窗口里的表单。");
    await browser.close();
    process.exit(1);
  }
  if (!autoSave) {
    console.log("READY(--no-save): 请在窗口里点 Save。WATCHING 20 MIN...");
    for (let i = 0; i < 40; i++) {
      await sleep(30000);
      if (!/updates\/700107/i.test(page.url())) { console.log("SAVED, landed on:", page.url()); break; }
    }
    await browser.close();
    return;
  }
  console.log("自动提交中...");
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /^(Save|Post|Submit)$/i.test((x.innerText || "").trim()));
    if (b) b.click();
    return !!b;
  });
  let saved = false;
  for (let i = 0; i < 40; i++) {
    await sleep(10000);
    if (!/updates\/700107/i.test(page.url())) { saved = true; console.log("✓ SAVED, landed on: " + page.url()); break; }
  }
  if (!saved) console.log("⚠ 6 分钟未跳转 —— 请人工检查。");
  await browser.close();
  console.log(saved ? "DONE ✓" : "DONE(未确认)");
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
