// gb_update_edit_probe.js — 只读探测:GameBanana 更新条目(Update)的编辑入口在哪
// 场景: 需要把已发布的 update 460716 原地改成 1.0.7,但没有现成脚本;
//       先找出每条更新的 编辑/删除 控件及其 URL,再决定用哪条路。
// 用法: node scripts/gb_update_edit_probe.js
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const COOKIES_FILE = "F:\\BabelTower\\config\\gamebanana_cookies.txt";
const TARGET_ID = process.argv[2] || "460716";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadCookies(page) {
  if (!fs.existsSync(COOKIES_FILE)) return false;
  const raw = fs.readFileSync(COOKIES_FILE, "utf8").trim();
  if (!raw) return false;
  const merged = new Map();
  raw.split(";").map((s) => s.trim()).filter(Boolean).forEach((s) => {
    const i = s.indexOf("=");
    if (i > 0) merged.set(s.slice(0, i).trim(), s.slice(i + 1));
  });
  const cookies = [...merged.entries()].map(([name, value]) => ({
    name, value, domain: ".gamebanana.com", path: "/",
  }));
  page.setCookie(...cookies);
  return true;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, userDataDir: PROFILE, headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--ignore-certificate-errors", "--no-proxy-server"],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
    const ok = loadCookies(page);
    console.log("COOKIES:", ok ? "loaded" : "NONE");

    // 1) 更新列表页
    await page.goto("https://gamebanana.com/mods/updates/700107", { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(7000);

    const listDump = await page.evaluate((tid) => {
      const out = { buttons: [], links: [], targetRow: null, bodyHas: {} };
      document.querySelectorAll("button, a, [role=button], [class*=Edit], [class*=edit], [class*=Trash], [class*=pencil]").forEach((e) => {
        const t = (e.innerText || e.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
        const h = e.getAttribute ? e.getAttribute("href") : null;
        if (!t && !h) return;
        const rec = { tag: e.tagName, text: t.slice(0, 40), href: h };
        if (/^a$/i.test(e.tagName)) out.links.push(rec); else out.buttons.push(rec);
      });
      // 目标条目所在容器
      const anchors = [...document.querySelectorAll('a[href*="' + tid + '"]')];
      if (anchors.length) {
        const a = anchors[0];
        const box = a.closest("li, article, [class*=Update], tr, div");
        out.targetRow = {
          anchorHref: a.getAttribute("href"),
          rowText: box ? (box.innerText || "").replace(/\s+/g, " ").slice(0, 200) : null,
          rowControls: box ? [...box.querySelectorAll("a[href], button")].map((e) => ({
            t: (e.innerText || "").replace(/\s+/g, " ").trim().slice(0, 30),
            h: e.getAttribute("href"),
          })) : [],
        };
      }
      const b = document.body.innerText || "";
      ["Edit", "Delete", "Trash", "Add Update", "edit"].forEach((k) => { out.bodyHas[k] = b.includes(k); });
      return out;
    }, TARGET_ID);

    console.log("=== 目标条目 " + TARGET_ID + " ===");
    console.log(JSON.stringify(listDump.targetRow, null, 1));
    console.log("=== body 关键字 ===");
    console.log(JSON.stringify(listDump.bodyHas));
    console.log("=== 链接(去重前 40)===");
    listDump.links.slice(0, 40).forEach((l) => console.log("  " + l.href + "   |" + l.text + "|"));
    console.log("=== 按钮(前 30)===");
    listDump.buttons.slice(0, 30).forEach((l) => console.log("  [" + l.tag + "] " + l.text));

    // 2) 条目详情页 → 点 Edit → dump 编辑表单结构
    await page.goto("https://gamebanana.com/updates/" + TARGET_ID, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(5000);
    const before = await page.evaluate(() => ({
      hasEdit: [...document.querySelectorAll("a, button, [role=button]")].some((e) => /^edit$/i.test((e.innerText || "").trim())),
      url: location.href,
    }));
    console.log("=== 详情页 Edit 存在:", JSON.stringify(before));

    const clicked = await page.evaluate(() => {
      const el = [...document.querySelectorAll("a, button, [role=button]")].find((e) => /^edit$/i.test((e.innerText || "").trim()));
      if (!el) return "no-edit";
      el.click();
      return "clicked";
    });
    console.log("CLICK EDIT:", clicked);
    await sleep(8000);

    const form = await page.evaluate(() => {
      const out = { url: location.href, inputs: [], textareas: [], selects: [], buttons: [], textareasSample: [] };
      document.querySelectorAll("input, textarea, select").forEach((e) => {
        const r = {
          tag: e.tagName, type: e.type || "", id: e.id || "", name: e.name || "",
          cls: (e.className || "").toString().slice(0, 40),
          val: (e.value || "").toString().slice(0, 60),
        };
        if (e.tagName === "SELECT") {
          r.options = [...e.options].slice(0, 12).map((o) => o.value + "|" + o.text.slice(0, 20));
          out.selects.push(r);
        } else if (e.tagName === "TEXTAREA") { out.textareas.push(r); out.textareasSample.push((e.value || "").slice(0, 80)); }
        else out.inputs.push(r);
      });
      document.querySelectorAll("button, [type=submit]").forEach((e) => {
        out.buttons.push({ t: (e.innerText || "").replace(/\s+/g, " ").trim().slice(0, 30), type: e.type || "" });
      });
      out.bodyHead = (document.body.innerText || "").slice(0, 300).replace(/\s+/g, " ");
      return out;
    });
    console.log("=== 编辑表单 ===");
    console.log(JSON.stringify(form, null, 1));
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
