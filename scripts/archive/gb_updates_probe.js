// gb_updates_probe.js — 只读列出 GameBanana mod 的更新日志条目(发布后验证用)
// 场景: gb_add_update2.js 提交后只回吐页面导航文本,无法证明条目真的创建成功;
//       本脚本读 /mods/updates/:id 列出条目标题/版本/时间,用于核对。
// 用法: node scripts/gb_updates_probe.js [要找的关键词]   默认 1.0.7
const puppeteer = require("puppeteer-core");

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const UPDATES_URL = "https://gamebanana.com/mods/updates/700107";
const KEY = (process.argv[2] || "1.0.7").toLowerCase();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    userDataDir: PROFILE,
    headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--ignore-certificate-errors", "--no-proxy-server"],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    );
    await page.goto(UPDATES_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(8000);

    const dump = await page.evaluate(() => {
      const body = document.body.innerText || "";
      const lines = body
        .split("\n")
        .map((l) => l.replace(/\s+/g, " ").trim())
        .filter((l) => l);
      // 全文落盘用:条目级锚点(每条更新的标题行 + 版本 + 日期 + 下载指向)
      const cards = [...document.querySelectorAll("[class*=Update], article, li")].map((e) => {
        const t = (e.innerText || "").replace(/\s+/g, " ").trim();
        const a = e.querySelector("a[href]");
        return { text: t.slice(0, 400), href: a ? a.getAttribute("href") : null };
      }).filter((c) => /\b\d+\.\d+\.\d+\b/.test(c.text) && c.text.length > 40);
      // 条目卡片常见结构:标题 + Version + 时间戳;退而求其次抓含 "v" 版本串的行
      const versionish = lines.filter((l) => /\b\d+\.\d+\.\d+\b|^\d+\.\d+$/.test(l));
      const chlog = lines.filter((l) => /^(Feature|Improvement|Bugfix|Note|Warning)\b/.test(l));
      const hasAddBtn = !![...document.querySelectorAll("button")].find((b) => /add update/i.test(b.innerText || ""));
      // 逐条正文锚点:核对本次 4 条 changelog + blurb + 绑定文件是否真的落页
      // 口径(2026-10-03): 桥/通信层在前,HUD 气泡修复是次要项
      const markers = {
        title: "本地桥与通信层更新",
        entry1: "bridge_server.js 由 37,809B 增至 57,524B",
        entry2: "配置操作返回 ok:false",
        entry3: "HUD 顶栏气泡不挂译文",
        entry4: "10 项常用设置直接改",
        blurb: "本版的主要改动在",
        file: "babeltower-107-win64",
      };
      const hit = {};
      for (const k in markers) hit[k] = body.indexOf(markers[k]) >= 0;
      return { total: lines.length, versionish: versionish.slice(0, 40), chlog: chlog.slice(0, 30), hasAddBtn, markers: hit, head: lines.slice(0, 12), cards, allLines: lines };
    });

    console.log("HAS 'Add Update' BUTTON:", dump.hasAddBtn, "(登录态佐证)");
    console.log("--- 正文锚点逐条核对 ---");
    let missing = [];
    for (const k in dump.markers) {
      const v = dump.markers[k];
      console.log("  " + (v ? "OK  " : "MISS") + " | " + k);
      if (!v) missing.push(k);
    }
    console.log("--- 版本串行 ---");
    dump.versionish.forEach((l) => console.log("  " + l));
    console.log("--- changelog 类型行 ---");
    dump.chlog.forEach((l) => console.log("  " + l.slice(0, 150)));

    const hay = JSON.stringify(dump).toLowerCase();
    console.log("---- 判定 ----");
    console.log("  含 [" + KEY + "]:", hay.includes(KEY));
    console.log("  含 changelog 类型:", dump.chlog.length > 0);
    if (dump.chlog.length > 0 && missing.length === 0) console.log("  => PUBLISH_OK (4 条 changelog + blurb + 绑定文件全部落页)");
    else if (dump.chlog.length > 0) console.log("  => PUBLISH_PARTIAL,缺: " + missing.join(", "));
    else console.log("  => 未能证实,请人工打开页面确认");

    // 全文落盘(控制台中文会乱码,导 UTF-8 再读)
    const fs = require("fs");
    const outPath = "C:/Users/kali1/AppData/Local/Temp/opencode/gb_updates_full.txt";
    let buf = "=== CARDS (含版本号的条目) ===\n";
    dump.cards.forEach((c, i) => { buf += `[${i}] href=${c.href}\n${c.text}\n\n`; });
    buf += "=== ALL LINES ===\n" + dump.allLines.map((l) => l).join("\n") + "\n";
    fs.writeFileSync(outPath, buf, "utf8");
    console.log("WROTE " + outPath + "  cards=" + dump.cards.length + "  lines=" + dump.allLines.length);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
