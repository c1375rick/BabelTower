const puppeteer = require("puppeteer-core");
const fs = require("fs");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const COOKIES_FILE = "F:\\BabelTower\\config\\gamebanana_cookies.txt";
const DESC_TEXTAREA = "bfc5b02d6f8165994dd9f4ec31a1129c";
const EDIT_URL = "https://gamebanana.com/mods/edit/700107";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const AI_DISCLOSURE = `
<hr>
<b>AI-Assisted Development Disclosure</b>

This project was developed with the help of an AI coding assistant (OpenClaw) for the following work:
- Code writing and debugging, including locating and fixing defects such as chat-row recycling and the serial-queue concurrency issue
- Writing the simulation test harness (lingua_chat_simtest.js) used to regression-test the translation feature in an environment without real teammates
- Writing and maintaining the build/release scripts

All code was reviewed and tested by the author before release; the author takes full responsibility for the project's functionality, quality, and compliance.
`;

(async () => {
  // 参数:probe(只打印) | publish(实际保存)
  const mode = process.argv[2] || "probe";

  const browser = await puppeteer.launch({
    executablePath: EDGE,
    userDataDir: PROFILE,
    headless: mode === "publish" ? false : "new",
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");

  const cookieStr = fs.readFileSync(COOKIES_FILE, "utf8").trim();
  await page.goto("https://gamebanana.com", { waitUntil: "domcontentloaded", timeout: 45000 });
  await sleep(1500);
  for (const p of cookieStr.split(";").map(s => s.trim()).filter(Boolean)) {
    const idx = p.indexOf("=");
    if (idx <= 0) continue;
    try { await page.setCookie({ name: p.slice(0, idx), value: p.slice(idx + 1), domain: ".gamebanana.com", path: "/", httpOnly: false, secure: false }); } catch (e) {}
  }

  await page.goto(EDIT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(4000);
  console.log("EDIT URL:", page.url());

  const ta = await page.$(`textarea[id="${DESC_TEXTAREA}"]`);
  if (!ta) { console.log("TEXTAREA NOT FOUND"); await browser.close(); process.exit(1); }

  const oldVal = await page.evaluate(id => document.querySelector(`textarea[id="${id}"]`).value, DESC_TEXTAREA);
  console.log("OLD LEN:", oldVal.length);

  // 检查是否已含 AI 声明
  const hasAI = /AI-Assisted Development Disclosure/i.test(oldVal);
  console.log("ALREADY HAS AI DISCLOSURE:", hasAI);

  if (mode === "probe") {
    // 只演示新值预览
    const newVal = hasAI ? oldVal : oldVal.replace(/<\/pre>\s*$/, "") + AI_DISCLOSURE + "</pre>";
    fs.writeFileSync("F:/BabelTower/tmp_gb_desc_new_preview.html", newVal);
    console.log("PREVIEW NEW LEN:", newVal.length);
    console.log("PREVIEW TAIL:", newVal.slice(-600));
    await browser.close();
    console.log("PROBE_DONE");
    return;
  }

  // ===== publish 模式 =====
  const newVal = hasAI ? oldVal : oldVal.replace(/<\/pre>\s*$/, "") + AI_DISCLOSURE + "</pre>";
  await page.evaluate(({ id, val }) => {
    const t = document.querySelector(`textarea[id="${id}"]`);
    t.value = val;
    t.dispatchEvent(new Event("input", { bubbles: true }));
    t.dispatchEvent(new Event("change", { bubbles: true }));
  }, { id: DESC_TEXTAREA, val: newVal });
  console.log("DESC UPDATED, new len:", newVal.length);

  // 找 Save 按钮并点击
  await sleep(1000);
  const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button, input[type=submit]")].filter(b => /^save$/i.test((b.innerText || b.value || "").trim()));
    if (btns.length) { btns[0].click(); return true; }
    return false;
  });
  console.log("SAVE CLICKED:", clicked);

  // 等待保存结果(页面跳转或成功提示)
  await sleep(8000);
  console.log("AFTER SAVE URL:", page.url());
  const bodyText = await page.evaluate(() => (document.body.innerText || "").slice(0, 400));
  console.log("BODY:", bodyText.replace(/\s+/g, " ").slice(0, 300));

  // 保存 cookies 更新
  const cookies = await page.cookies("https://gamebanana.com");
  const keep = ["sess", "rmc", "cf_clearance"];
  const parts = cookies.filter(c => keep.includes(c.name)).map(c => c.name + "=" + c.value);
  fs.writeFileSync(COOKIES_FILE, parts.join("; "));

  await browser.close();
  console.log("PUBLISH_DONE");
})().catch(e => { console.error("ERR:", e.message); process.exit(1); });
