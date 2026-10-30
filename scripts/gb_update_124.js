// GameBanana 1.2.4 update(编辑页:传文件 + 版本行 + 描述)-- 默认停在 Save 前,加 --save 才提交。
// Rationale (2026-10-16): publishing is irreversible from the bot's side;
// the browser stays visible and the user clicks Save.
//
// Two wrong-target bugs from the first attempt (caught in the log, nothing was
// saved -- Save was never pressed):
//   1. version: wrote 1.2.1 over the LAST existing row (1.1.0) instead of a new
//      row. The hidden file input does not add a row; the page's own
//      "Select files" button (fileChooser) does.
//   2. description: picked the LARGEST textarea, which is the GNU LGPL license
//      box (8492 chars), not the description (8252). Now matched by content.
//
// Run:  node scripts\gb_update_124.js [entryId] [--save]
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const ROOT = path.join(__dirname, "..");
const NEW_VERSION = "1.2.4";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findZip() {
  const dist = path.join(ROOT, "dist");
  const files = fs.readdirSync(dist).filter((f) => /^BabelTower-.*-win64\.zip$/.test(f));
  if (!files.length) throw new Error("no release zip in dist");
  files.sort((a, b) => fs.statSync(path.join(dist, b)).mtimeMs - fs.statSync(path.join(dist, a)).mtimeMs);
  return path.join(dist, files[0]);
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
  const doSave = process.argv.includes("--save");
  const zip = findZip();
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
  // The edit FORM (version rows, Select files) only renders when authenticated.
  // Unauthenticated GB serves the page shell with "Log In Signup" and no form --
  // that is why an earlier run saw 0 version rows and no file selector.
  let rows0 = await page.evaluate(() => document.querySelectorAll('input[name="_sVersion"]').length);
  if (rows0 === 0) {
    console.log("NOT LOGGED IN (edit form absent). Opening the login page -- it will NOT reload.");
    await page.goto("https://gamebanana.com/members/account/login", { waitUntil: "domcontentloaded", timeout: 60000 });
    let ok = false;
    for (let i = 0; i < 120; i++) { // 10 minutes
      await sleep(5000);
      if (!/\/login/i.test(page.url())) {
        await page.goto("https://gamebanana.com/mods/edit/" + entryId, { waitUntil: "domcontentloaded", timeout: 30000 });
        await sleep(3000);
        rows0 = await page.evaluate(() => document.querySelectorAll('input[name="_sVersion"]').length);
        if (rows0 > 0) { ok = true; console.log("LOGIN OK after " + (i + 1) * 5 + "s (" + rows0 + " version rows)"); break; }
      }
    }
    if (!ok) { console.log("LOGIN_TIMEOUT / STILL NO FORM"); await browser.close(); process.exit(1); }
  }
  const title = await page.title();
  if (!/Edit\s*:/i.test(title)) { console.log("NOT_EDIT_PAGE:", title); await browser.close(); process.exit(1); }
  console.log("EDIT PAGE:", title);

  const setVal = async (sel, value) => page.evaluate((s, v) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, sel, value);

  // ---- 1. 人工挂 zip(2026-10-30:自动三路线全静默失败,GB 组件行为变化)----
  const rowsBefore = await page.evaluate(() => document.querySelectorAll('input[name="_sVersion"]').length);
  console.log("VERSION ROWS BEFORE: " + rowsBefore);
  console.log("");
  console.log(">>> 人工步骤:在 Edge 窗口里滚动到 Files 区,点该区的 Select files,");
  console.log(">>>          选择 dist\\BabelTower-1.2.4-win64.zip,等新行出现(上传约 1-2 分钟)。");
  console.log(">>>          脚本每 10 秒自动检测新行,最长等 15 分钟。");
  console.log("");
  let rowsAfter = rowsBefore;
  let zipShownOnce = false;
  const waitStart = Date.now();
  while (Date.now() - waitStart < 30 * 60 * 1000) {
    await sleep(10000);
    rowsAfter = await page.evaluate(() => document.querySelectorAll('input[name="_sVersion"]').length);
    zipShownOnce = await page.evaluate(() => /124-win64/i.test(document.body.innerText));
    const mins = Math.round((Date.now() - waitStart) / 60000 * 10) / 10;
    console.log("  t=" + mins + "min rows=" + rowsAfter + " zipShown=" + zipShownOnce);
    if (zipShownOnce) { console.log("  ✓ 1.2.4 zip 已出现在页面!"); break; }
  }
  if (!zipShownOnce) { console.log("30 分钟内未检测到 1.2.4 zip —— 停止(未保存任何东西)。"); await browser.close(); process.exit(1); }

  // ---- 2. version ONLY on the new (last) row ----
  await page.evaluate((v) => {
    const list = [...document.querySelectorAll('input[name="_sVersion"]')];
    // 找包含 1.2.4 zip 文件名的那一行(LI 祖先文本),没有就退回最后一行
    let target = list[list.length - 1];
    for (const inp of list) {
      let el = inp;
      for (let i = 0; i < 6 && el; i++) {
        if (/124-win64/i.test(el.innerText || el.textContent || "")) { target = inp; el = null; i = 99; break; }
        el = el.parentElement;
      }
    }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(target, v);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
  }, NEW_VERSION);
  console.log("VERSIONS NOW:", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('input[name="_sVersion"]')].map((i) => i.value))));

  // ---- 3. description: write through the WYSIWYG view, then verify BOTH sides ----
  // GB's RichText widget is a textarea + a paired contenteditable
  // "<id>_WysiwygView". Setting the textarea's value alone changes nothing on
  // screen and (worse) is not what the widget submits -- that is exactly what
  // the first attempt did, and the page still showed the old long text.
  const descId = await page.evaluate(() => {
    const tas = [...document.querySelectorAll("textarea")];
    const isDesc = (t) => {
      const v = t.value || "";
      if (/GNU LESSER|GNU GENERAL/i.test(v)) return false;      // license boxes
      return /Babel Tower/i.test(v) && v.length > 200;
    };
    const hit = tas.find(isDesc);
    return hit ? hit.id : null;
  });
  if (!descId) { console.log("DESC BOX NOT FOUND -- stopping before Save."); await browser.close(); process.exit(1); }
  console.log("DESC BOX:", descId, "| was:", (await page.evaluate((id) => (document.getElementById(id).value || "").slice(0, 50), descId)).replace(/\s+/g, " "));

  const marker = "Real-time Chat Translator";
  const applied = await page.evaluate((id, html, marker) => {
    const view = document.getElementById(id + "_WysiwygView");
    const ta = document.getElementById(id);
    if (!view || !ta) return { ok: false, why: "view or textarea missing" };
    const inTa = () => (ta.value || "").indexOf(marker) !== -1;
    const inView = () => (view.innerText || view.textContent || "").indexOf(marker) !== -1;
    const fire = () => {
      view.dispatchEvent(new Event("input", { bubbles: true }));
      view.dispatchEvent(new Event("change", { bubbles: true }));
      for (const k of ["keydown", "keypress", "keyup"]) {
        view.dispatchEvent(new KeyboardEvent(k, { bubbles: true, key: "a" }));
      }
      // GB's RichText widget may listen on document, not the view
      document.dispatchEvent(new Event("input", { bubbles: true }));
      document.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const selectAll = () => {
      const r = document.createRange();
      r.selectNodeContents(view);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    };
    const attempts = [];

    view.focus(); selectAll();
    try { document.execCommand("insertHTML", false, html); } catch (e) { attempts.push("insertHTML threw " + e.message); }
    fire();
    attempts.push("insertHTML -> ta=" + inTa() + " view=" + inView());

    if (!inView()) {
      view.focus(); selectAll();
      try { document.execCommand("insertText", false, html); } catch (e) { attempts.push("insertText threw " + e.message); }
      fire();
      attempts.push("insertText -> ta=" + inTa() + " view=" + inView());
    }

    if (!inView()) {
      view.focus(); selectAll();
      view.innerHTML = html;
      fire();
      attempts.push("innerHTML -> ta=" + inTa() + " view=" + inView());
    }

    if (!inView()) {
      // last resort: clear then append text nodes (no HTML parsing at all)
      view.focus();
      view.textContent = "";
      view.appendChild(document.createTextNode(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")));
      fire();
      attempts.push("textContent -> ta=" + inTa() + " view=" + inView());
    }

    return {
      ok: inView(), attempts,
      taLen: (ta.value || "").length,
      viewLen: (view.innerText || "").length,
      viewHead: (view.innerText || "").replace(/\s+/g, " ").slice(0, 90),
    };
  }, descId, desc, marker);
  console.log("APPLY:", JSON.stringify(applied, null, 1));

  const check = await page.evaluate((id) => {
    const ta = document.getElementById(id);
    const view = document.getElementById(id + "_WysiwygView");
    const t = ta ? (ta.value || "") : "";
    const v = view ? (view.innerText || "") : "";
    return {
      taLen: t.length,
      taHasNew: /Real-time Chat Translator|队友外语秒翻/.test(t),
      viewLen: v.length,
      viewHasNew: /Real-time Chat Translator|队友外语秒翻/.test(v),
      viewHead: v.replace(/\s+/g, " ").slice(0, 90),
    };
  }, descId);
  await sleep(2500); // give any debounced widget sync a chance before judging
  const check2 = await page.evaluate((id) => {
    const ta = document.getElementById(id);
    const view = document.getElementById(id + "_WysiwygView");
    const t = ta ? (ta.value || "") : "";
    const v = view ? (view.innerText || "") : "";
    return {
      taLen: t.length,
      taHasNew: /Real-time Chat Translator|队友外语秒翻/.test(t),
      viewLen: v.length,
      viewHasNew: /Real-time Chat Translator|队友外语秒翻/.test(v),
      viewHead: v.replace(/\s+/g, " ").slice(0, 90),
    };
  }, descId);
  console.log("VERIFY(+2.5s):", JSON.stringify(check2));
  // The widget keeps two copies: the contenteditable view (what we just wrote)
  // and the textarea (still old). It does NOT sync view -> textarea on
  // synthetic events, and we do not know which one the form submits -- so make
  // BOTH sides carry the new text. Whichever GB reads at submit time is then
  // correct, and neither side can revert the other.
  const dual = await page.evaluate((id, html) => {
    const ta = document.getElementById(id);
    if (!ta) return { ok: false };
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(ta, html);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.dispatchEvent(new Event("change", { bubbles: true }));
    return {
      ok: /Real-time Chat Translator|队友外语秒翻/.test(ta.value || ""),
      taLen: (ta.value || "").length,
    };
  }, descId, desc);
  console.log("TEXTAREA SYNC:", JSON.stringify(dual));
  await sleep(1500);
  const final = await page.evaluate((id) => {
    const ta = document.getElementById(id);
    const view = document.getElementById(id + "_WysiwygView");
    const t = (ta ? ta.value : "") || "";
    const v = (view ? view.innerText : "") || "";
    return {
      taHasNew: /Real-time Chat Translator|队友外语秒翻/.test(t),
      viewHasNew: /Real-time Chat Translator|队友外语秒翻/.test(v),
      taLen: t.length, viewLen: v.length,
    };
  }, descId);
  console.log("FINAL:", JSON.stringify(final));
  if (!final.taHasNew || !final.viewHasNew) {
    console.log("STILL NOT SYNCED ON BOTH SIDES -- stopping before Save.");
    await browser.close();
    process.exit(1);
  }
  console.log("DESCRIPTION CONFIRMED ON BOTH SIDES");

  if (!doSave) {
    console.log("READY: zip + version + description are filled. Click Save in the window.");
    console.log("WATCHING 20 MIN FOR YOU TO SAVE...");
    for (let i = 0; i < 40; i++) {
      await sleep(30000);
      if (!/\/edit/i.test(page.url())) { console.log("SAVED, landed on:", page.url()); break; }
    }
    await browser.close();
    console.log("DONE");
    return;
  }
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.innerText || "").trim() === "Save"); if (b) b.click(); });
  await sleep(8000);
  console.log("AFTER SAVE:", page.url());
  await browser.close();
  console.log("DONE");
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });