// GameBanana 1.2.5 update(全自动:fileChooser 传文件 + 版本行 + 描述 + 自动 Save)。
// 2026-10-31 用户指示 GB 全自动(此前 124 版的"人工挂 zip + 人工 Save"改为脚本完成)。
// 安全设计:每个关键步骤失败即停、退出前不保存任何东西;终检不过不点 Save;
//   --no-save 逃生口(回到人工 Save 模式)。
// 上传知识(来自 124 实测):隐藏 input[type=file] 不加行;页面自己的 "Select files"
//   按钮走 fileChooser 才会加行 —— 所以这里用 waitForFileChooser + 点按钮。
// Run:  node scripts\gb_update_125.js [entryId] [--no-save]
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const ROOT = path.join(__dirname, "..");
const NEW_VERSION = "1.2.5";
const ZIP_RE = /1\.2\.5-win64/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findZip() {
  const dist = path.join(ROOT, "dist");
  const files = fs.readdirSync(dist).filter((f) => /^BabelTower-.*-win64\.zip$/.test(f));
  if (!files.length) throw new Error("no release zip in dist");
  files.sort((a, b) => fs.statSync(path.join(dist, b)).mtimeMs - fs.statSync(path.join(dist, a)).mtimeMs);
  const hit = files.find((f) => ZIP_RE.test(f));
  if (!hit) throw new Error("dist 里没有 1.2.5 zip: " + files.join(", "));
  return path.join(dist, hit);
}

function mdToHtml(md) {
  return md.split(/\r?\n/).map((l) => {
    if (/^#\s+/.test(l)) return "<strong>" + l.replace(/^#\s+/, "") + "</strong>";
    if (/^-\s+/.test(l)) return "&bull; " + l.replace(/^-\s+/, "");
    return l.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  }).join("<br>");
}

(async () => {
  const entryId = process.argv[2] || "700107";
  const autoSave = !process.argv.includes("--no-save");
  const zip = findZip();
  console.log("ZIP: " + zip + " (" + Math.round(fs.statSync(zip).size / 1048576 * 10) / 10 + " MB)");
  const en = mdToHtml(fs.readFileSync(path.join(ROOT, "gamebanana", "description_en.md"), "utf8"));
  const cn = mdToHtml(fs.readFileSync(path.join(ROOT, "gamebanana", "description_cn.md"), "utf8"));
  const desc = en + "<br><br><hr><br><br>" + cn;

  const browser = await puppeteer.launch({
    executablePath: EDGE, userDataDir: PROFILE, headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
  await page.goto("https://gamebanana.com/mods/edit/" + entryId, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(4000);
  let rows0 = await page.evaluate(() => document.querySelectorAll('input[name="_sVersion"]').length);
  if (rows0 === 0) {
    console.log("NOT LOGGED IN (edit form absent). 打开登录页等待人工登录(不会自动重载)。");
    await page.goto("https://gamebanana.com/members/account/login", { waitUntil: "domcontentloaded", timeout: 60000 });
    let ok = false;
    for (let i = 0; i < 120; i++) {
      await sleep(5000);
      if (!/\/login/i.test(page.url())) {
        await page.goto("https://gamebanana.com/mods/edit/" + entryId, { waitUntil: "domcontentloaded", timeout: 30000 });
        await sleep(3000);
        rows0 = await page.evaluate(() => document.querySelectorAll('input[name="_sVersion"]').length);
        if (rows0 > 0) { ok = true; console.log("LOGIN OK after " + (i + 1) * 5 + "s (" + rows0 + " rows)"); break; }
      }
    }
    if (!ok) { console.log("LOGIN_TIMEOUT"); await browser.close(); process.exit(1); }
  }
  const title = await page.title();
  if (!/Edit\s*:/i.test(title)) { console.log("NOT_EDIT_PAGE:", title); await browser.close(); process.exit(1); }
  console.log("EDIT PAGE:", title);

  // ---- 1. 自动挂 zip:点 "Select files" + waitForFileChooser 并发 ----
  const rowsBefore = await page.evaluate(() => document.querySelectorAll('input[name="_sVersion"]').length);
  console.log("VERSION ROWS BEFORE: " + rowsBefore);
  const btnCount = await page.evaluate(() =>
    [...document.querySelectorAll("a,button,span")].filter((b) => /select files/i.test((b.innerText || "").trim())).length);
  console.log("SELECT FILES 按钮: " + btnCount + " 个");
  if (!btnCount) { console.log("找不到 Select files 按钮 —— 停止(未保存)。"); await browser.close(); process.exit(1); }

  let uploaded = false;
  try {
    const [chooser] = await Promise.all([
      page.waitForFileChooser({ timeout: 20000 }),
      page.evaluate(() => {
        const btn = [...document.querySelectorAll("a,button,span")].find((b) => /select files/i.test((b.innerText || "").trim()));
        if (btn) btn.click();
        return !!btn;
      }),
    ]);
    console.log("FILE CHOOSER 弹出 ✓,提交 zip...");
    await chooser.accept([zip]);
    uploaded = true;
    console.log("zip 已交给选择器: " + path.basename(zip));
  } catch (e) {
    console.log("fileChooser 路线失败: " + e.message);
    const inp = await page.$('input[type=file]');
    if (inp) {
      await inp.uploadFile(zip);
      uploaded = true;
      console.log("备选路线: uploadFile 到 input[type=file]");
    }
  }
  if (!uploaded) { console.log("两条上传路线都失败 —— 停止(未保存)。"); await browser.close(); process.exit(1); }

  // 轮询等 125-win64 出现(38MB 上传需 1-3 分钟)
  let zipShown = false;
  const waitStart = Date.now();
  while (Date.now() - waitStart < 30 * 60 * 1000) {
    await sleep(10000);
    zipShown = await page.evaluate(() => /1\.2\.5-win64/i.test(document.body ? document.body.innerText : ""));
    const mins = Math.round((Date.now() - waitStart) / 60000 * 10) / 10;
    console.log("  t=" + mins + "min zipShown=" + zipShown);
    if (zipShown) { console.log("  ✓ 1.2.5 zip 已出现在页面!"); break; }
  }
  if (!zipShown) { console.log("30 分钟内未检测到 1.2.5 zip —— 停止(未保存)。"); await browser.close(); process.exit(1); }

  // ---- 2. version 只写在新(含 125)行 ----
  await page.evaluate((v) => {
    const list = [...document.querySelectorAll('input[name="_sVersion"]')];
    let target = list[list.length - 1];
    for (const inp of list) {
      let el = inp;
      for (let i = 0; i < 6 && el; i++) {
        if (/1\.2\.5-win64/i.test(el.innerText || el.textContent || "")) { target = inp; el = null; i = 99; break; }
        el = el.parentElement;
      }
    }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(target, v);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
  }, NEW_VERSION);
  console.log("VERSIONS NOW:", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('input[name="_sVersion"]')].map((i) => i.value))));

  // ---- 3. 描述:双侧(view + textarea)写入并验证 ----
  const descId = await page.evaluate(() => {
    const tas = [...document.querySelectorAll("textarea")];
    const isDesc = (t) => {
      const v = t.value || "";
      if (/GNU LESSER|GNU GENERAL/i.test(v)) return false;
      return /Babel Tower/i.test(v) && v.length > 200;
    };
    const hit = tas.find(isDesc);
    return hit ? hit.id : null;
  });
  if (!descId) { console.log("DESC BOX NOT FOUND -- 停止。"); await browser.close(); process.exit(1); }
  console.log("DESC BOX:", descId);

  const applied = await page.evaluate((id, html) => {
    const view = document.getElementById(id + "_WysiwygView");
    const ta = document.getElementById(id);
    if (!view || !ta) return { ok: false, why: "view or textarea missing" };
    const inView = () => (view.innerText || view.textContent || "").indexOf("Real-time Chat Translator") !== -1;
    const fire = () => {
      view.dispatchEvent(new Event("input", { bubbles: true }));
      view.dispatchEvent(new Event("change", { bubbles: true }));
      document.dispatchEvent(new Event("input", { bubbles: true }));
    };
    view.focus();
    const r = document.createRange(); r.selectNodeContents(view);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    let via = "none";
    try { document.execCommand("insertHTML", false, html); via = "insertHTML"; } catch (e) {}
    if (!inView()) {
      try { document.execCommand("insertText", false, html); via = "insertText"; } catch (e) {}
    }
    if (!inView()) { view.innerHTML = html; via = "innerHTML"; }
    fire();
    return { ok: inView(), via };
  }, descId, desc);
  console.log("APPLY:", JSON.stringify(applied));
  if (!applied.ok) { console.log("描述写入失败 —— 停止(未保存)。"); await browser.close(); process.exit(1); }

  await sleep(2500);
  // 双侧同步:view 写好后强制 textarea 也带新文本(GB 提交时读哪个都正确)
  const dual = await page.evaluate((id, html) => {
    const ta = document.getElementById(id);
    if (!ta) return { ok: false };
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(ta, html);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: (ta.value || "").indexOf("Real-time Chat Translator") !== -1 };
  }, descId, desc);
  console.log("TEXTAREA SYNC:", JSON.stringify(dual));
  const final = await page.evaluate((id) => {
    const ta = document.getElementById(id);
    const view = document.getElementById(id + "_WysiwygView");
    return {
      taHasNew: ((ta ? ta.value : "") || "").indexOf("Real-time Chat Translator") !== -1,
      viewHasNew: ((view ? view.innerText : "") || "").indexOf("Real-time Chat Translator") !== -1,
      version: [...document.querySelectorAll('input[name="_sVersion"]')].map((i) => i.value).filter((v) => v === "1.2.5").length,
    };
  }, descId);
  console.log("FINAL:", JSON.stringify(final));
  if (!final.taHasNew || !final.viewHasNew || !final.version) {
    console.log("终检不过(描述双侧或版本行缺失)—— 停止(未保存)。");
    await browser.close();
    process.exit(1);
  }
  console.log("终检通过: zip ✓ 版本行 1.2.5 ✓ 描述双侧 ✓");

  // ---- 4. Save(全自动) ----
  if (!autoSave) {
    console.log("READY(--no-save): 请在窗口里点 Save。WATCHING 20 MIN...");
    for (let i = 0; i < 40; i++) {
      await sleep(30000);
      if (!/\/edit/i.test(page.url())) { console.log("SAVED, landed on:", page.url()); break; }
    }
    await browser.close();
    console.log("DONE");
    return;
  }
  console.log("自动保存中(38MB 先传 GB 服务器,需 1-5 分钟)...");
  const s0 = Date.now();
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "Save");
    if (b) b.click();
    return !!b;
  });
  let saved = false;
  for (let i = 0; i < 60; i++) {
    await sleep(10000);
    if (!/\/edit/i.test(page.url())) { saved = true; console.log("✓ SAVED (" + Math.round((Date.now() - s0) / 1000) + "s), landed on: " + page.url()); break; }
    if (i % 6 === 5) console.log("  t=" + Math.round((Date.now() - s0) / 1000) + "s 仍在保存...");
  }
  if (!saved) console.log("⚠ 10 分钟未离开 /edit —— 请人工检查窗口里的页面状态。");
  await browser.close();
  console.log(saved ? "DONE ✓" : "DONE(未确认)");
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
