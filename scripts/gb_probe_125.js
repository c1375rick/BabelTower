// GB 探针 125(2026-10-31):Files 区真实结构诊断——不上传、不保存。
// 目的:定位正确的上传锚点(#Files 容器/input[type=file]/各 Select files 按钮的所属区块)。
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
  console.log("TITLE:", (await page.title()).slice(0, 80));

  const info = await page.evaluate(() => {
    const out = {};
    // ① #Files 容器
    const files = document.getElementById("Files");
    out.hasFilesDiv = !!files;
    if (files) {
      out.filesDivDisplay = getComputedStyle(files).display;
      out.filesInputCount = files.querySelectorAll("input[type=file]").length;
      out.filesInputs = [...files.querySelectorAll("input[type=file]")].map((i) => ({
        name: i.name || "", accept: i.accept || "", multiple: i.multiple,
        hidden: getComputedStyle(i).display === "none" || i.type === "hidden",
        chain: (() => { let el = i, c = []; for (let k = 0; k < 5 && el; k++) { c.push(el.tagName + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className ? "." + el.className.split(" ").slice(0, 2).join(".") : "")); el = el.parentElement; } return c.join(" < "); })(),
      }));
      out.filesSelectBtns = [...files.querySelectorAll("a,button,span")].filter((b) => /select files/i.test((b.innerText || "").trim())).length;
      out.filesRows = [...files.querySelectorAll("li")].map((li) => (li.innerText || "").replace(/\s+/g, " ").trim().slice(0, 70)).slice(0, 16);
    }
    // ② 全部 input[type=file](整页)
    out.allFileInputs = [...document.querySelectorAll("input[type=file]")].map((i) => {
      let el = i, owner = "?";
      for (let k = 0; k < 8 && el; k++) { if (el.id) { owner = el.id; break; } el = el.parentElement; }
      return { owner, name: i.name || "", hidden: getComputedStyle(i).display === "none" };
    });
    // ③ 全部 Select files 按钮及所属区块
    out.selectBtns = [...document.querySelectorAll("a,button,span")]
      .filter((b) => /select files/i.test((b.innerText || "").trim()))
      .map((b) => {
        let el = b, owner = "?";
        for (let k = 0; k < 10 && el; k++) { if (el.id && el.id !== "Files") { owner = el.id; break; } if (el.id === "Files") { owner = "Files"; break; } el = el.parentElement; }
        return { owner, tag: b.tagName, text: (b.innerText || "").trim().slice(0, 30) };
      });
    // ④ 版本行数(登录态校验)
    out.versionRows = document.querySelectorAll('input[name="_sVersion"]').length;
    return out;
  });
  console.log(JSON.stringify(info, null, 1));
  await browser.close();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
