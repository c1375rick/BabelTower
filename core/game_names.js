// 桥侧:扫描 Deadlock 本地化,生成 { 英文原名 -> 中文译名 } 映射
// 供客户端 /api/v1/gamenames 返回,替换硬编码 PROTECT_NAMES
"use strict";
const fs = require("fs");
const path = require("path");

// 定位 Deadlock 安装目录:优先环境变量,否则常见路径(Steam 库)
function findDeadlockRoot() {
  const candidates = [
    process.env.DEADLOCK_ROOT,
    "F:\\SteamLibrary\\steamapps\\common\\Deadlock",
    "D:\\SteamLibrary\\steamapps\\common\\Deadlock",
    "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Deadlock",
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, "game", "citadel", "resource", "localization"))) return c;
  }
  return null;
}

function readUtf8StripBom(file) {
  let buf = fs.readFileSync(file);
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) buf = buf.slice(3);
  return buf.toString("utf8");
}

// 解析 valve 本地化 txt: "key" "value"  (可能多行,这里逐行粗略匹配)
function parseLoc(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  const text = readUtf8StripBom(file);
  const re = /"([^"]+)"\s+"([^"]*)"/g;
  let m;
  while ((m = re.exec(text))) {
    out[m[1]] = m[2];
  }
  return out;
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
  const heroEn = parseLoc(path.join(loc, "citadel_gc_hero_names", "citadel_gc_hero_names_english.txt"));
  const heroZh = parseLoc(path.join(loc, "citadel_gc_hero_names", "citadel_gc_hero_names_schinese.txt"));
  const modEn = parseLoc(path.join(loc, "citadel_gc_mod_names", "citadel_gc_mod_names_english.txt"));
  const modZh = parseLoc(path.join(loc, "citadel_gc_mod_names", "citadel_gc_mod_names_schinese.txt"));

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

module.exports = { build, findDeadlockRoot, cleanZh };

// 直接运行:生成并落盘 config/gamenames.json(桥侧缓存,也可能打进 VPK)
if (require.main === module) {
  const r = build();
  if (!r.ok) { console.error("BUILD FAIL:", r.error); process.exit(1); }
  const out = path.join(__dirname, "..", "config", "gamenames.json");
  fs.writeFileSync(out, JSON.stringify(r.map, null, 2) + "\n", "utf8");
  console.log("wrote", out, "entries:", r.count);
  // 抽样验证
  for (const k of ["Holliday", "Hollow Point", "Abrams", "Infernus", "Lady Geist"]) {
    console.log(k, "->", r.map[k] || "(missing)");
  }
}
