// GB 探针二(2026-10-30):版本行藏在哪?Files UI 现在在哪个标签下?
const puppeteer = require("puppeteer-core");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    userDataDir: "F:\\BabelTower\\config\\gb_browser_profile", headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
  await page.goto("https://gamebanana.com/mods/edit/700107", { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(6000);

  // ① 版本行的藏身之处:可见性 + 最近可见祖先 + 所属区块标题
  const where = await page.evaluate(() => {
    const out = [];
    [...document.querySelectorAll('input[name="_sVersion"]')].slice(0, 3).forEach((inp) => {
      let el = inp, chain = [];
      for (let i = 0; i < 8 && el; i++) {
        const cs = getComputedStyle(el);
        chain.push(el.tagName + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.split(" ").slice(0, 2).join(".") : "") + (cs.display === "none" ? "[hidden]" : ""));
        el = el.parentElement;
      }
      const row = inp.closest("tr,li,.FormRow,div");
      out.push({ value: inp.value, rowText: row ? (row.innerText || "").replace(/\s+/g, " ").slice(0, 60) : null, chain });
    });
    // 它们共同的容器
    const first = document.querySelector('input[name="_sVersion"]');
    const box = first ? first.closest("section,fieldset,div[class*='row'],table") : null;
    return { samples: out, boxHtml: box ? box.outerHTML.slice(0, 300) : null };
  });
  console.log("版本行藏身处: " + JSON.stringify(where, null, 1));

  // ② 找页面上所有子标签/区块链接(Main/Media/Technical/Development...)
  const tabs = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("a,button,[role='tab']").forEach((e) => {
      const s = (e.innerText || "").trim();
      if (/^(Main|Ownership|Media|Technical|Development|Settings|Admin|Updates|Files)$/.test(s)) {
        out.push(s + " -> " + (e.href || "(click)") );
      }
    });
    return [...new Set(out)];
  });
  console.log("子标签: " + JSON.stringify(tabs, null, 1));

  // ③ Media 子标签是否有独立 URL?试直接点击导航
  const mediaLink = await page.evaluate(() => {
    const links = [...document.querySelectorAll("a")].filter((e) => (e.innerText || "").trim() === "Media");
    return links.map((l) => l.href);
  });
  console.log("Media 链接: " + JSON.stringify(mediaLink));

  // ④ 如果 Media 是独立页 → 打开看;否则点(单页切换)
  if (mediaLink.length && /http/.test(mediaLink[0])) {
    await page.goto(mediaLink[0], { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(5000);
  } else {
    await page.evaluate(() => {
      const t = [...document.querySelectorAll("a,button,[role='tab']")].find((e) => (e.innerText || "").trim() === "Media");
      if (t) t.click();
    });
    await sleep(4000);
  }
  await page.screenshot({ path: "dist/gb_media_tab.png" });
  const mediaState = await page.evaluate(() => ({
    url: location.href.slice(0, 100),
    rows: document.querySelectorAll('input[name="_sVersion"]').length,
    selectFiles: [...document.querySelectorAll("button")].filter((x) => /select files/i.test(x.innerText || "")).length,
    head: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 300),
  }));
  console.log("Media 标签态: " + JSON.stringify(mediaState, null, 1));
  await browser.close();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
