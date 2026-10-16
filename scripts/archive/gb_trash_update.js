// gb_trash_update.js —— 把指定的 GameBanana 更新条目移进回收站。
// 2026-10-03: /updates/admin/trash/<id> 是**表单页(Reason 必填)**,不是一键删;
//             先 dump 表单结构,再填理由并提交,最后用列表复核。
// 用法: node scripts/gb_trash_update.js <updateId> [<updateId2> ...]
const puppeteer = require("puppeteer-core");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const COOKIES_FILE = "F:\\BabelTower\\config\\gamebanana_cookies.txt";
const LIST_URL = "https://gamebanana.com/mods/updates/700107";
const REASON = process.env.GB_TRASH_REASON || "Duplicate version entry left over from a mis-numbered release.";

const ids = process.argv.slice(2);
if (!ids.length) { console.error("USAGE: node gb_trash_update.js <id> [id2 ...]"); process.exit(1); }

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
    httpOnly: name === "sess", secure: true,
  }));
  if (cookies.length) page.setCookie(...cookies);
  return cookies.length > 0;
}

async function listIds(page) {
  await page.goto(LIST_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(6000);
  return page.evaluate(() =>
    [...document.querySelectorAll('a[href*="/updates/"]')]
      .map((a) => (a.getAttribute("href") || "").match(/\/updates\/(\d+)$/))
      .filter(Boolean).map((m) => m[1])
  );
}

function dumpForm(page) {
  return page.evaluate(() => {
    const out = { inputs: [], selects: [], textareas: [], buttons: [] };
    document.querySelectorAll("input").forEach((e) => out.inputs.push({
      type: e.type, id: e.id, name: e.name, cls: (e.className || "").toString().slice(0, 40),
      ph: e.placeholder || "", val: (e.value || "").toString().slice(0, 40),
      label: ((e.closest("label") || e.parentElement || {}).innerText || "").replace(/\s+/g, " ").slice(0, 50),
    }));
    document.querySelectorAll("select").forEach((e) => out.selects.push({
      id: e.id, name: e.name, cls: (e.className || "").toString().slice(0, 40),
      opts: [...e.options].map((o) => o.value + "|" + o.text.slice(0, 30)),
      label: ((e.closest("label") || e.parentElement || {}).innerText || "").replace(/\s+/g, " ").slice(0, 50),
    }));
    document.querySelectorAll("textarea").forEach((e) => out.textareas.push({
      id: e.id, name: e.name, cls: (e.className || "").toString().slice(0, 40),
      ph: e.placeholder || "", len: (e.value || "").length,
    }));
    document.querySelectorAll("button, input[type=submit], a.btn, [class*=Btn], [class*=button]").forEach((e) => out.buttons.push({
      t: (e.innerText || e.value || "").replace(/\s+/g, " ").trim().slice(0, 40),
      type: e.type || e.tagName, cls: (e.className || "").toString().slice(0, 40),
    }));
    return out;
  });
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, userDataDir: PROFILE, headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled",
           "--ignore-certificate-errors", "--no-proxy-server"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");

  let dialogs = 0;
  page.on("dialog", async (d) => { dialogs++; console.log("  DIALOG:", d.type(), "|", d.message().slice(0, 60)); try { await d.accept(); } catch (_) {} });

  if (!loadCookies(page)) { console.error("COOKIES MISSING"); process.exit(1); }

  try {
    const before = await listIds(page);
    console.log("BEFORE ids:", before.join(","));

    for (const id of ids) {
      console.log("--- trash " + id + " ---");
      await page.goto("https://gamebanana.com/updates/admin/trash/" + id, {
        waitUntil: "domcontentloaded", timeout: 60000,
      });
      await sleep(5000);

      const form = await dumpForm(page);
      console.log("  FORM:", JSON.stringify(form));

      // 填理由:select 优先选含 no reason 的,其次 textarea/input
      const filled = await page.evaluate((reason) => {
        const res = { select: null, text: null };
        const sel = document.querySelector("select");
        if (sel) {
          const opt = [...sel.options].find((o) => /no reason/i.test(o.text)) || sel.options[0];
          const proto = Object.getPrototypeOf(sel);
          const d = Object.getOwnPropertyDescriptor(proto, "value");
          if (d && d.set) d.set.call(sel, opt.value); else sel.value = opt.value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          res.select = opt.text.slice(0, 30);
        }
        const ta = document.querySelector("textarea");
        const ti = document.querySelector('input[type=text], input[type=hidden]');
        const target = ta || ti;
        if (target) {
          const proto = Object.getPrototypeOf(target);
          const d = Object.getOwnPropertyDescriptor(proto, "value");
          if (d && d.set) d.set.call(target, reason); else target.value = reason;
          target.dispatchEvent(new Event("input", { bubbles: true }));
          target.dispatchEvent(new Event("change", { bubbles: true }));
          res.text = (target.tagName + "#" + (target.id || target.name || "?"));
        }
        return res;
      }, REASON);
      console.log("  FILLED:", JSON.stringify(filled));
      await sleep(1200);

      const submitted = await page.evaluate(() => {
        const btn = [...document.querySelectorAll("button, input[type=submit], a")].find((e) =>
          /^(trash|submit|confirm|delete|save|移入回收站|确认)$/i.test((e.innerText || e.value || "").trim())
        );
        if (!btn) return { ok: false };
        btn.click();
        return { ok: true, text: (btn.innerText || btn.value || "").trim().slice(0, 30) };
      });
      console.log("  SUBMIT:", JSON.stringify(submitted));
      await sleep(7000);
      console.log("  dialogs:", dialogs, "| url:", await page.url());
      const head = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 200));
      console.log("  body:", head);
    }

    const after = await listIds(page);
    console.log("AFTER  ids:", after.join(","));
    const still = ids.filter((i) => after.includes(i));
    console.log("STILL PRESENT:", still.join(",") || "(none)");
    console.log(still.length === 0 ? "DONE OK" : "DONE PARTIAL");
  } catch (e) {
    console.error("ERR:", e.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
