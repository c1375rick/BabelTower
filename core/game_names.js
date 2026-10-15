// 桥侧:扫描 Deadlock 本地化,生成 { 英文原名 -> 中文译名 } 映射
// 供客户端 /api/v1/gamenames 返回,替换硬编码 PROTECT_NAMES
"use strict";
const fs = require("fs");
const path = require("path");
// 2026-09-17: 解析改用公共 parser(与 quickchat.js 共用单一实现)。
// 旧本地 parseLoc 用朴素正则 "([^"]+)"\s+"([^"]*)",值含内嵌转义引号时配对错位,
// 后续条目被整个吞进假值静默丢 key(LEARNINGS 8-31 ⑤ 同款 bug)——由本次重构修复。
const { parseLocFile } = require("./loc_parser.js");
// 2026-10-03 与桥的 console.log 同款问题一并修:旧写死 F:/D:/C:\Program Files (x86)
// 三条,库在 E:/G: 或 Steam 装在自定义路径的用户,gamenames 静默为空(翻译出来的
// 只剩英文原名)。改走 steam_paths:注册表安装路径 → libraryfolders.vdf 全部库。
const steamPaths = require("./steam_paths.js");
// btipc07:客户端兜底名单的指纹要与桥端同源(sync_data 只依赖 zlib,不会与
// quickchat → game_names 形成循环依赖)
const syncData = require("./sync_data.js");

// 定位 Deadlock 安装目录:环境变量 > Steam 注册表+全部库 > 老写死路径兜底
function findDeadlockRoot() {
  let discovered = [];
  try {
    discovered = steamPaths.gameRoots("Deadlock");
  } catch (e) {
    discovered = []; // 发现模块绝不能带走桥
  }
  const candidates = [
    process.env.DEADLOCK_ROOT,
    ...discovered,
    "F:\\SteamLibrary\\steamapps\\common\\Deadlock",
    "D:\\SteamLibrary\\steamapps\\common\\Deadlock",
    // 2026-10-15:本机游戏迁到 C:\SteamLibrary(NVMe),旧 F: 行仅作历史兜底。
    "C:\\SteamLibrary\\steamapps\\common\\Deadlock",
    "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Deadlock",
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, "game", "citadel", "resource", "localization"))) return c;
  }
  return null;
}

// 清洗官方中文里的 "kongjian 空尖弹 zidan" 这种 拼音+汉字+拼音 噪声
// 规则:若含汉字,提取连续汉字部分;否则原样
function cleanZh(s) {
  const han = (s.match(/[\u4e00-\u9fff]+/g) || []).join("");
  return han || s.trim();
}

function build() {
  const root = findDeadlockRoot();
  if (!root) return { ok: false, error: "deadlock_not_found" };
  const loc = path.join(root, "game", "citadel", "resource", "localization");
  const heroEn = parseLocFile(path.join(loc, "citadel_gc_hero_names", "citadel_gc_hero_names_english.txt"));
  const heroZh = parseLocFile(path.join(loc, "citadel_gc_hero_names", "citadel_gc_hero_names_schinese.txt"));
  const modEn = parseLocFile(path.join(loc, "citadel_gc_mod_names", "citadel_gc_mod_names_english.txt"));
  const modZh = parseLocFile(path.join(loc, "citadel_gc_mod_names", "citadel_gc_mod_names_schinese.txt"));

  const map = {}; // 英文 -> 中文
  const add = (enTable, zhTable) => {
    for (const key of Object.keys(enTable)) {
      const en = enTable[key].trim();
      const zhRaw = zhTable[key];
      if (!en || !zhRaw) continue;
      if (key.endsWith("_search")) continue; // 跳过 search 别名变体(其值含拼音噪声)
      // 若同一英文名已映射(多 key 指向同英雄),保留首个干净译名,不覆盖
      if (map[en]) continue;
      const cleaned = cleanZh(zhRaw);
      if (!cleaned) continue;
      map[en] = cleaned;
    }
  };
  add(heroEn, heroZh);
  add(modEn, modZh);

  return { ok: true, count: Object.keys(map).length, map };
}

// 烘焙客户端兜底:btipc07 要做「指纹协商」,游戏侧必须自带一份桥认得的名单,
// 否则每次开局都要花 10+ 分钟把 292 条名字过一遍 12.6 B/s 的下行通道。
// 本文件与 config/gamenames.json 同源同批生成 → 指纹相同 → 握手 1 帧秒回 same。
function writeClientFallback(map, outPath) {
  const pairs = {};
  const keys = Object.keys(map || {}).filter((k) => k !== "english" && k !== "schinese").sort();
  for (const k of keys) pairs[k] = String(map[k]);
  const fp = syncData.namesFingerprint(pairs);
  const out = outPath || path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat_gamenames_pairs_fallback.js");
  const body =
    "// 自动生成 by core/game_names.js —— 请勿手改;游戏更新后重跑 node core/game_names.js 并重编 VPK\n" +
    "// 名称保护兜底名单(英文原名 -> 中文译名),桥离线时用;指纹供 btipc07 握手比对,\n" +
    "// 指纹相同 = 游戏侧这份与桥一致 → 一条数据都不用传。\n" +
    "LCT_GAMENAMES_PAIRS_FP = " + JSON.stringify(fp) + ";\n" +
    "LCT_GAMENAMES_PAIRS = " + JSON.stringify(pairs, null, 1) + ";\n";
  fs.writeFileSync(out, body, "utf8");
  return { path: out, fingerprint: fp, count: keys.length };
}

module.exports = { build, findDeadlockRoot, cleanZh, writeClientFallback };

// 直接运行:生成并落盘 config/gamenames.json(桥侧缓存)+ 客户端兜底名单
if (require.main === module) {
  const r = build();
  if (!r.ok) { console.error("BUILD FAIL:", r.error); process.exit(1); }
  const out = path.join(__dirname, "..", "config", "gamenames.json");
  fs.writeFileSync(out, JSON.stringify(r.map, null, 2) + "\n", "utf8");
  console.log("wrote", out, "entries:", r.count);
  const fb = writeClientFallback(r.map);
  console.log("wrote", fb.path, "entries:", fb.count, "fingerprint:", fb.fingerprint);
  // 抽样验证
  for (const k of ["Holliday", "Hollow Point", "Abrams", "Infernus", "Lady Geist"]) {
    console.log(k, "->", r.map[k] || "(missing)");
  }
}
