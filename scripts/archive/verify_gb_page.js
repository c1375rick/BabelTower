// verify_gb_page.js — 临时验证: GameBanana 页面是否已显示 1.0.6 更新与 UMM 前置
const puppeteer = require("puppeteer-core");
(async () => {
  const b = await puppeteer.launch({
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    headless: true, args: ["--no-sandbox", "--no-proxy-server"],
  });
  const p = await b.newPage();
  const target = process.argv[2] || "https://gamebanana.com/mods/700107";
  await p.goto(target, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));
  const txt = await p.evaluate(() => document.body.innerText);
  console.log("has 1.0.6:", txt.includes("1.0.6"));
  console.log("has UMM mention:", txt.includes("Universal Mod Manager") || txt.includes("UMM"));
  console.log("has 106 zip:", /BabelTower-1\.0\.6/i.test(txt));
  const upd = await p.evaluate(() => {
    const links = [...document.querySelectorAll("a")].map(a => a.innerText).filter(t => /UMM|1\.0\.6/.test(t || ""));
    return links.slice(0, 5);
  });
  console.log("update titles:", JSON.stringify(upd));
  await b.close();
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
