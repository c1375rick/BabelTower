// GameBanana 主文件修复:归档旧文件(010/011),只留 012-beta1 未归档 → 成为主下载
const puppeteer = require("puppeteer-core");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const EDIT_URL = "https://gamebanana.com/mods/edit/700107";
const MOD_URL = "https://gamebanana.com/mods/700107";
const TARGET = "012"; // 保留未归档的文件标识
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, userDataDir: PROFILE, headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");

  await page.goto(EDIT_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
  let ok = false;
  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    ok = await page.evaluate(() => !!document.getElementById("Files") && document.querySelectorAll("input[name=_sVersion]").length > 0);
    if (ok) break;
    console.log(`[${(i + 1) * 3}s] waiting form...`);
  }
  if (!ok) { console.log("FORM_NOT_RENDERED"); await browser.close(); process.exit(1); }
  console.log("FORM OK");

  // 打印当前行状态
  const before = await page.evaluate(() => {
    return [...document.querySelectorAll("#Files li")].map(li => {
      const name = li.querySelector("a[href*='.zip']") ? li.querySelector("a[href*='.zip']").innerText.trim() : "?";
      const arch = li.querySelector("input[name=_bIsArchived]");
      return { name, archived: arch ? arch.checked : null, rowId: li.querySelector("input[name=_idFileRow]") ? li.querySelector("input[name=_idFileRow]").value : "?" };
    });
  });
  console.log("BEFORE:", JSON.stringify(before, null, 1));

  // 归档所有非 012 文件,012 确保未归档
  const res = await page.evaluate((target) => {
    const changed = [];
    [...document.querySelectorAll("#Files li")].forEach(li => {
      const nameEl = li.querySelector("a[href*='.zip']");
      const name = nameEl ? nameEl.innerText.trim() : "";
      const arch = li.querySelector("input[name=_bIsArchived]");
      if (!arch) return;
      const wantArchived = !name.includes(target);
      if (arch.checked !== wantArchived) {
        arch.click(); // 触发 Vue change
        changed.push({ name, from: arch.checked, to: wantArchived });
      }
    });
    return changed;
  }, TARGET);
  console.log("CHANGED:", JSON.stringify(res, null, 1));
  await sleep(1500);

  // 确认最终状态
  const after = await page.evaluate(() => {
    return [...document.querySelectorAll("#Files li")].map(li => {
      const name = li.querySelector("a[href*='.zip']") ? li.querySelector("a[href*='.zip']").innerText.trim() : "?";
      const arch = li.querySelector("input[name=_bIsArchived]");
      return { name, archived: arch ? arch.checked : null };
    });
  });
  console.log("AFTER:", JSON.stringify(after, null, 1));

  // Save
  const saved = await page.evaluate(() => {
    const btn = document.querySelector("fieldset.Submit button[type=submit]");
    if (!btn) return { ok: false };
    btn.click();
    return { ok: true };
  });
  console.log("SAVE:", JSON.stringify(saved));
  await sleep(12000);

  // 验证公开页
  try { await page.goto(MOD_URL, { waitUntil: "domcontentloaded", timeout: 60000 }); } catch (e) {}
  await sleep(4000);
  const verify = await page.evaluate(() => {
    const hs = [...document.querySelectorAll("h2")];
    const filesH = hs.find(h => /^Files$/.test((h.innerText || "").trim()));
    if (!filesH) return { found: false };
    let c = filesH.parentElement;
    for (let i = 0; i < 3 && c; i++) c = c.parentElement;
    const text = (c ? c.innerText : "").replace(/\s+/g, " ").trim();
    const m = text.match(/Files\s+(.*?)(?:Updates|Reviews|Comments|$)/);
    return { found: true, filesText: text.slice(0, 300) };
  });
  console.log("VERIFY:", JSON.stringify(verify, null, 1));

  await browser.close();
  console.log("DONE");
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });
