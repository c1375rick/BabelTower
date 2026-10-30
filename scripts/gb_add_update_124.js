// GameBanana 1.2.4 更新公告(Add Update 表单)—— 停给人工 Save。
// 表单知识来自 scripts/archive/gb_add_update.js(2026-10-16 实测):
//   _sName / _sVersion / Changelog(.ChangelogInput 行,Add Entry 逐条加) /
//   Blurb(ProseMirror 键入) / 文件勾选(input[type=checkbox],File_ 前缀)
// 运行: node scripts\gb_add_update_124.js [--save]
const puppeteer = require("puppeteer-core");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PROFILE = "F:\\BabelTower\\config\\gb_browser_profile";
const TITLE = "1.2.4 修复 10-29 更新导致的翻译失联(证书链/标题回程/hash 通道)";
const VERSION = "1.2.4";
const CHANGELOG = [
  ["Bugfix", "修复 10-29 游戏更新后翻译全面失联:CEF 拦截自签证书页面的 JS,证书改本地 CA 链签发(397 天叶子,启动器每次启动自动续期)"],
  ["Bugfix", "修复标题回程被砍:桥面板改用引擎原生 CitadelHTMLPanel 并绑定面板级标题事件(旧总线派发已失效)"],
  ["Bugfix", "修复探针永远超时:结算改事件驱动(旧路径读陈旧面板属性),开机秒级 ALIVE"],
  ["Bugfix", "修复 hash 快通道断线:hashBase 捕获/fragment 导航/作业 id/载荷解码四处 + 页面 onHash 未声明变量"],
  ["Improvement", "常驻漂移自愈:观察页与配置导航打断常驻后,下一作业自动整页恢复,翻译不丢"],
  ["Improvement", "新增离线模拟环境(真桥+真脚本全链自测,进测试套件),后续更新先模拟后实车"],
];
const BLURB = [
  "更新新的 BabelTower-1.2.4-win64.zip:修复 10-29 游戏更新导致的翻译全面失联(证书改本地 CA 链签发、标题回程改面板级事件、hash 快通道接线补全)。",
  "重要:解压后先运行一次 StartDeadlock.bat(自动签发并信任证书),然后完全退出并重启 Steam(托盘也退)——信任库由 Steam 宿主缓存,只重启游戏不生效。",
  "本版涉及游戏内组件改动,请用 Mod Manager 更新或替换 pak01_dir.vpk。详见 GitHub Release: https://github.com/c1375rick/BabelTower/releases/tag/v1.2.4",
].join("\n");

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE, userDataDir: PROFILE, headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");

  // Add Update 表单页
  await page.goto("https://gamebanana.com/mods/updates/700107", { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(5000);
  console.log("URL:", page.url().slice(0, 90));

  // 若落在列表页,点 Add Update
  const onForm = await page.evaluate(() => !!document.querySelector("#_sName"));
  if (!onForm) {
    const clicked = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("a,button")].find((b) => /add update/i.test((b.innerText || "").trim()));
      if (btn) { btn.click(); return btn.href || "(click)"; }
      return null;
    });
    console.log("ADD UPDATE 入口:", clicked);
    await sleep(5000);
    if (page.url().includes("/updates/700107") && !(await page.evaluate(() => !!document.querySelector("#_sName")))) {
      console.log("表单未出现 —— 可能未登录或入口变化,停止(未保存任何东西)");
      await browser.close();
      process.exit(1);
    }
  }
  console.log("FORM 页就绪:", (await page.title()).slice(0, 80));

  // ① 标题 + 版本
  const setInput = async (sel, value) => page.evaluate((s, v) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, sel, value);
  console.log("TITLE:", JSON.stringify(await setInput("#_sName", TITLE)));
  console.log("VERSION:", JSON.stringify(await setInput("#_sVersion", VERSION)));

  // ② Changelog 条目(Add Entry 逐条)
  for (let i = 0; i < CHANGELOG.length; i++) {
    await page.evaluate(() => {
      const cluster = [...document.querySelectorAll(".Cluster")].find((c) => /Add Entry/i.test(c.innerText || ""));
      const btn = cluster ? [...cluster.querySelectorAll("button")].find((b) => /Add Entry/i.test(b.innerText || "")) : null;
      if (btn) btn.click();
    });
    await sleep(700);
    const filled = await page.evaluate((t, txt) => {
      const rows = [...document.querySelectorAll(".ChangelogInput")];
      const row = rows[rows.length - 1];
      if (!row) return { ok: false };
      const input = row.querySelector("input[type=text]");
      const select = row.querySelector("select");
      if (!input || !select) return { ok: false };
      const sdesc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), "value");
      if (sdesc && sdesc.set) sdesc.set.call(select, t); else select.value = t;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      const idesc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");
      if (idesc && idesc.set) idesc.set.call(input, txt); else input.value = txt;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, type: select.value, len: input.value.length };
    }, CHANGELOG[i][0], CHANGELOG[i][1]);
    console.log("  entry " + (i + 1) + " [" + CHANGELOG[i][0] + "]:", JSON.stringify(filled));
    await sleep(400);
  }

  // ③ Blurb:ProseMirror 键入(隐藏 _sText 由组件同步)
  const pm = await page.$(".ProseMirror");
  if (pm) {
    await pm.click();
    await sleep(600);
    await page.keyboard.type(BLURB, { delay: 0 });
    await sleep(1200);
    const st = await page.evaluate(() => {
      const h = document.querySelector("#_sText");
      return h ? h.value.length : "NO_HIDDEN";
    });
    console.log("BLURB 长度(隐藏域):", st);
  } else {
    console.log("NO PROSEMIRROR —— Blurb 需手动粘贴(见 gamebanana/UPDATE_TEMPLATE.md 的 1.2.4 blurb)");
  }

  // ④ 勾选 1.2.4 zip
  const fileChecked = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll("input[type=checkbox]")];
    const target = boxes.find((b) => {
      const label = b.closest(".RadioCheckWrapper") || b.parentElement;
      return label && /124-win64/i.test(label.innerText || "");
    });
    if (!target) {
      const all = boxes.filter((b) => b.id && /^File_/.test(b.id));
      const t2 = all[all.length - 1];
      if (t2) { t2.click(); return { ok: true, id: t2.id, note: "fallback last" }; }
      return { ok: false };
    }
    target.click();
    return { ok: true, id: target.id };
  });
  console.log("FILE CHECK:", JSON.stringify(fileChecked));
  await sleep(1000);

  // ⑤ 终检 + 停给人工 Save
  const final = await page.evaluate(() => ({
    name: (document.querySelector("#_sName") || {}).value || "",
    ver: (document.querySelector("#_sVersion") || {}).value || "",
    changelogLen: document.querySelectorAll(".ChangelogInput").length,
    blurbLen: ((document.querySelector("#_sText") || {}).value || "").length,
  }));
  console.log("FINAL:", JSON.stringify(final));
  if (!final.name || !final.ver || final.changelogLen < CHANGELOG.length) {
    console.log("字段不齐 —— 停止(未提交)。请检查浏览器里的表单。");
    console.log("WATCHING 20 MIN (你可以手动补齐后自己点 Save)...");
    for (let i = 0; i < 40; i++) {
      await sleep(30000);
      if (!/updates\/700107/i.test(page.url())) { console.log("SAVED, landed on:", page.url()); break; }
    }
    await browser.close();
    return;
  }
  console.log("READY: 标题/版本/Changelog×" + CHANGELOG.length + "/Blurb/文件勾选 已填。请在窗口里核对后点 Save。");
  console.log("WATCHING 20 MIN FOR YOU TO SAVE...");
  for (let i = 0; i < 40; i++) {
    await sleep(30000);
    if (!/updates\/700107/i.test(page.url())) { console.log("SAVED, landed on:", page.url()); break; }
  }
  await browser.close();
  console.log("DONE");
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
