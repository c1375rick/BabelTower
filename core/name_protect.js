// 桥侧:英雄/物品名占位符保护
// 翻译前把游戏专有名词(英雄名/物品名)替换成 [[G_i]] 占位符,
// 翻译后再还原成目标语言译名,避免被翻译 API 意译/乱译。
//
// 数据来源:Deadlock 游戏自带本地化(game/citadel/resource/localization 下
//   citadel_gc_hero_names + citadel_gc_mod_names 的 english/schinese txt),
// 由 core/game_names.js 扫描生成 config/gamenames.json ({ 英文原名->中文译名 })。
// 比客户端硬编码的 18 英雄名单全量(285 条)且随游戏更新自动刷新。
"use strict";
const fs = require("fs");
const path = require("path");
const gameNames = require("./game_names");

const CONFIG_PATH = path.join(__dirname, "..", "config", "gamenames.json");

let NAME_MAP = [];      // [{ en, zh }]
let PROTECT_RE = null;  // 匹配英文原名的正则(按长度降序,避免子串误匹配)
let loaded = false;

// 占位符 token 与客户端 lingua_chat.js 保持一致
function token(i) { return "LCTPH" + i; }

function buildRegex(names) {
  // names: 英文原名数组,按长度降序排列
  const sorted = names.slice().sort((a, b) => b.length - a.length);
  const escaped = sorted.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp("\\b(?:" + escaped.join("|") + ")\\b", "gi");
}

function load() {
  // 1. 优先读缓存的 gamenames.json
  let map = null;
  if (fs.existsSync(CONFIG_PATH)) {
    try { map = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); } catch (e) { map = null; }
  }
  // 2. 没有或读坏,现场生成
  if (!map || typeof map !== "object" || Object.keys(map).length === 0) {
    const built = gameNames.build();
    if (built.ok) {
      map = built.map;
      try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(map, null, 2) + "\n", "utf8"); } catch (e) {}
    }
  }
  if (!map) { loaded = true; NAME_MAP = []; PROTECT_RE = null; return; }

  // 构建 { en->zh } 表,并抽取英文名列表建正则
  const enList = [];
  for (const en of Object.keys(map)) {
    const zh = map[en];
    if (!en || !zh) continue;
    enList.push(en);
  }
  // 按 (英文名 -> 序号) 建立查表,序号 = 首次出现顺序
  const enToIdx = new Map();
  NAME_MAP = enList.map((en, i) => { enToIdx.set(en.toLowerCase(), i); return { en, zh: map[en] }; });
  PROTECT_RE = buildRegex(enList);
  loaded = true;
  console.log("[name_protect] loaded", NAME_MAP.length, "game names");
}

// 翻译前占位:把文本中的英雄/物品名替换成 [[G_i]]
// 返回 { text, nameMap } 其中 nameMap 是 [[G_i]] 对应的 {en,zh} 数组(按 i 索引)
function protect(text) {
  if (!loaded) load();
  if (!PROTECT_RE || NAME_MAP.length === 0) return { text: text, nameMap: null };
  const nameMap = [];
  const replaced = text.replace(PROTECT_RE, function (match) {
    const idx = NAME_MAP.findIndex(e => e.en.toLowerCase() === match.toLowerCase());
    if (idx < 0) return match;
    nameMap.push(NAME_MAP[idx]);
    return token(nameMap.length - 1);
  });
  return nameMap.length > 0 ? { text: replaced, nameMap } : { text: text, nameMap: null };
}

// 翻译后还原:把 [[G_i]] 还原成目标语言译名
// toZh=true -> 用中文译名(zh),用于出站(中文玩家看中文);false -> 用英文原名(入站/队友视角)
function restore(text, nameMap, toZh) {
  if (!text || !nameMap) return text;
  for (let i = 0; i < nameMap.length; i++) {
    const rep = toZh ? nameMap[i].zh : nameMap[i].en;
    if (!rep) continue;
    // 精确匹配优先
    text = text.split(token(i)).join(rep);
    // 兜底:API 可能插入空格/大小写变化,如 [[ G0 ]] 或 [[g0]]
    const fallback = new RegExp("\\[\\[\\s*G" + i + "\\s*\\]\\]", "gi");
    text = text.replace(fallback, rep);
  }
  return text;
}

// 监听游戏本地化目录:游戏更新后本地化文件变化,自动重建映射表
let watcher = null;
function watchLocalization() {
  const root = gameNames.findDeadlockRoot();
  if (!root) return;
  const loc = path.join(root, "game", "citadel", "resource", "localization");
  if (!fs.existsSync(loc)) return;
  try {
    watcher = fs.watch(loc, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      if (/citadel_gc_(hero_names|mod_names)_(english|schinese)\.txt$/.test(filename)) {
        console.log("[name_protect] localization changed:", filename, "-> rebuilding map");
        const built = gameNames.build();
        if (built.ok) {
          try {
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(built.map, null, 2) + "\n", "utf8");
            // 重新载入内存
            load();
          } catch (e) {}
        }
      }
    });
    console.log("[name_protect] watching localization for auto-update:", loc);
  } catch (e) {
    console.log("[name_protect] watch failed (non-fatal):", e.message);
  }
}

module.exports = { load, protect, restore, watchLocalization, get count() { return NAME_MAP.length; } };
