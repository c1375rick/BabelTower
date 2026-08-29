// Contributor: Thirt927 (https://github.com/Thirt927/BabelTower), merged 2026-08-13 under GPL-3.0
﻿// Babel Tower - 常用短语词典(外置可配置 + 自适应学习)
//
// 设计:
//   - 词典按"目标语言"分组,任何语言用户都可受益(不偏袒中文)
//   - 空词典起步:不预猜词,随着游戏进行自动学习高频短语
//   - 学习规则:翻译成功的英文短文本进入统计,同一译文出现 >= 3 次固化进词典
//   - 防抖:译文==原文(未翻译成功)不记录;多种译文取众数,避免固化错误结果
//   - 用户表优先于学习表;用户可随时手动编辑词典文件
//
// 词典文件: config/dictionary.json
//   结构: {
//     "user":    { "<语言前缀>": { "原文": "译文" } },   // 用户手动编辑
//     "learned": { "<语言前缀>": { "原文": "译文" } }    // 自动学习,程序写入
//   }
//   语言键与目标语言前缀匹配(如 zh-Hans / zh-CN / zh-TW 都命中 "zh")
//   关闭词典: config/config.json 里设 "dictionary": { "enabled": false }
"use strict";

const fs = require("fs");
const path = require("path");
const heroNames = require("./hero_names");

// 学习参数
const LEARN_MIN_HITS = 3;        // 同一译文出现次数达到该值才固化
const LEARN_MAX_CHARS = 30;      // 超过该长度的文本不学习(避免整句固化)
const LEARN_MAX_TOKENS = 5;      // 超过该词数的文本不学习
const LEARN_MAX_ENTRIES = 5000;  // learned 段单语言前缀最大词条数,超过则淘汰最低频
const FLUSH_INTERVAL_MS = 60 * 1000; // 落盘间隔

let cache = null; // { user: {...}, learned: {...}, enabled, loadedAt }

function dictPath() {
  return path.join(__dirname, "..", "config", "dictionary.json");
}

// 从 config/config.json 读取 dictionary.enabled(默认 true)
function isEnabled() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "config.json"), "utf8"));
    if (cfg && typeof cfg === "object" && cfg.dictionary && typeof cfg.dictionary.enabled === "boolean") {
      return cfg.dictionary.enabled;
    }
  } catch (e) {}
  return true;
}

function langPrefix(targetLanguage) {
  return String(targetLanguage || "").toLowerCase().split("-")[0];
}

function normalizeKey(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// 游戏聊天常带句末问号/感叹号。先保留精确匹配，再用去掉首尾标点的
// 候选匹配短词，避免 "wtf?"、"lol!" 这类消息无意义地调用在线接口。
function lookupKeys(text) {
  const exact = normalizeKey(text);
  const stripped = exact
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped && stripped !== exact ? [exact, stripped] : [exact];
}

// 空文件结构(首次运行生成,用户可编辑 user 区)
function emptyFile() {
  return {
    user: {},
    learned: {},
  };
}

// 加载词典(带内存缓存,文件变更后重启桥生效)
function load() {
  if (cache) return cache;
  let data = emptyFile();
  try {
    if (fs.existsSync(dictPath())) {
      const raw = JSON.parse(fs.readFileSync(dictPath(), "utf8"));
      if (raw && typeof raw === "object") {
        data.user = (raw.user && typeof raw.user === "object") ? raw.user : {};
        data.learned = (raw.learned && typeof raw.learned === "object") ? raw.learned : {};
      }
    }
  } catch (e) {
    // 词典文件损坏(如旧版带注释的 JSON):备份后重建空表,避免学习结果无法读回
    try {
      fs.renameSync(dictPath(), dictPath() + ".bak");
    } catch (e2) {}
    ensureFile();
  }
  cache = { user: data.user, learned: data.learned, builtin: loadBuiltin(), enabled: isEnabled(), loadedAt: Date.now() };
  return cache;
}

// 首次运行:生成 config/dictionary.json(不覆盖已有文件)
function ensureFile() {
  try {
    if (fs.existsSync(dictPath())) return;
    fs.mkdirSync(path.dirname(dictPath()), { recursive: true });
    fs.writeFileSync(dictPath(), JSON.stringify(emptyFile(), null, 2) + "\n", "utf8");
  } catch (e) {}
}

// ---------- 自适应学习 ----------
// 统计表: key = lang|text -> { counts: { 译文: 次数 } }
const learnStats = new Map();

// 是否可以学习:英文短文本(纯 ASCII 即视为英文源,不信任 Bing 的检测——
// Bing 对短词检测不稳定,wp->pl / gank->lb 都见过)、译文非空且 != 原文
// 防误译:译文太短(单字符)而原文是多字母词,说明检测错语言/误译,不学
function isLearnable(text, translation, detectedLanguage) {
  const t = String(text || "").trim();
  if (!t || t.length < 2) return false;
  if (t.length > LEARN_MAX_CHARS) return false;
  if (String(t).split(/\s+/).length > LEARN_MAX_TOKENS) return false;
  if (!/^[\x20-\x7E]+$/.test(t)) return false; // 非纯 ASCII 不学(避免固化非英文原文)
  if (t.charAt(0) === "/") return false;       // 指令
  const tr = String(translation || "").trim();
  if (!tr || tr === t) return false;           // 没翻译成功不学
  // 原文是 2+ 字母单词但译文只有 1 个字符(如 gank->"去"),几乎必是误译,不学
  if (/^[A-Za-z]{2,}$/.test(t) && [...tr].length <= 1) return false;
  return true;
}

// 记录一次翻译结果(高频词统计;达到阈值立即固化落盘,实时生效)
function record(text, targetLanguage, translation, detectedLanguage) {
  const dict = load();
  if (!dict.enabled) return;
  if (!isLearnable(text, translation, detectedLanguage)) return;
  const prefix = langPrefix(targetLanguage);
  if (!prefix) return;
  const key = normalizeKey(text);
  // 已在 user/learned 表内的词不再重复学习
  if ((dict.user[prefix] && dict.user[prefix][key]) || (dict.builtin[prefix] && dict.builtin[prefix][key]) || (dict.learned[prefix] && dict.learned[prefix][key])) return;
  const statsKey = prefix + "\x00" + key;
  let entry = learnStats.get(statsKey);
  if (!entry) {
    entry = { counts: {} };
    learnStats.set(statsKey, entry);
  }
  const tr = String(translation).trim();
  entry.counts[tr] = (entry.counts[tr] || 0) + 1;
  // 取众数译文
  let best = null;
  let bestCount = 0;
  for (const cand of Object.keys(entry.counts)) {
    if (entry.counts[cand] > bestCount) {
      best = cand;
      bestCount = entry.counts[cand];
    }
  }
  // 达到阈值立即固化(不等定时器,第 4 次出现即查表秒回)
  if (best && bestCount >= LEARN_MIN_HITS) {
    if (!dict.learned[prefix]) dict.learned[prefix] = {};
    dict.learned[prefix][key] = best;
    learnStats.delete(statsKey);
    save();
    enforceLearnCap();
  }
}

// learned 段超过上限时,按频率(该词命中次数)保留高频词,淘汰最低频
// 频率数据来自 learnStats 仍在累积的条目;已固化但不再出现的词按 0 处理,优先被淘汰
function enforceLearnCap() {
  const dict = load();
  if (!dict.enabled) return;
  for (const prefix of Object.keys(dict.learned)) {
    const seg = dict.learned[prefix];
    if (!seg || typeof seg !== "object") continue;
    const keys = Object.keys(seg);
    if (keys.length <= LEARN_MAX_ENTRIES) continue;
    // 统计每个已固化词在当前 learnStats 的活跃次数(无则 0)
    const freq = {};
    for (const k of keys) {
      const sk = prefix + "\x00" + k;
      const e = learnStats.get(sk);
      const counts = e ? Object.values(e.counts) : [];
      freq[k] = counts.length ? Math.max.apply(null, counts) : 0;
    }
    // 按频率升序排序,淘汰最低频的直到回到上限内
    const toEvict = keys.slice().sort((a, b) => freq[a] - freq[b])
      .slice(0, keys.length - LEARN_MAX_ENTRIES);
    for (const k of toEvict) delete seg[k];
  }
  save();
}

// 固化:达到阈值的条目写入 learned 表并清统计
function flushLearned() {
  const dict = load();
  if (!dict.enabled) return;
  let changed = false;
  for (const [key, entry] of learnStats) {
    const sep = key.indexOf("\x00");
    const prefix = key.slice(0, sep);
    const text = key.slice(sep + 1);
    // 固化前再次确认不在表内(避免重复固化)
    if ((dict.learned[prefix] && dict.learned[prefix][text]) || (dict.builtin[prefix] && dict.builtin[prefix][text]) || (dict.user[prefix] && dict.user[prefix][text])) {
      learnStats.delete(key);
      continue;
    }
    // 取众数译文
    let best = null;
    let bestCount = 0;
    for (const tr of Object.keys(entry.counts)) {
      if (entry.counts[tr] > bestCount) {
        best = tr;
        bestCount = entry.counts[tr];
      }
    }
    if (!best || bestCount < LEARN_MIN_HITS) continue; // 未达阈值,继续积累
    if (!dict.learned[prefix]) dict.learned[prefix] = {};
    dict.learned[prefix][text] = best;
    changed = true;
    learnStats.delete(key);
  }
  if (changed) { save(); enforceLearnCap(); }
}

function startAutoFlush() {
  setInterval(flushLearned, FLUSH_INTERVAL_MS);
  // 进程退出时也落盘一次
  process.on("exit", flushLearned);
  process.on("SIGINT", () => { flushLearned(); process.exit(0); });
  process.on("SIGTERM", () => { flushLearned(); process.exit(0); });
}


// 内置词典(随发行附带,中文常用短句/游戏术语;查表顺序 user > builtin > learned)
// 返回对象按目标语言分组:{ zh: {英文->中文}, en: {中文->英文}, ... }
//
// 双向字典:内置文件只维护 zh 段(英文->中文)。为让"发送前翻译"(中文->英文)
// 也能享受同一批短语的直译,这里自动把 zh 段反转为 en 段(中文->英文)。
// 好处:只维护一份(zh),两个方向自动同步,无需手写/维护第二份。
// 注意:若内置文件已显式带 en 段,以文件为准(不覆盖手动维护的 en)。
function loadBuiltin() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "config", "dictionary.builtin.json"), "utf8"));
    if (raw && raw.user && typeof raw.user === "object") {
      const builtin = raw.user;
      // 自动生成双向 en 段(zh 段反转),仅当文件未自带 en 段时
      if (builtin.zh && typeof builtin.zh === "object" && !builtin.en) {
        const enSeg = {};
        for (const enKey of Object.keys(builtin.zh)) {
          const zhVal = builtin.zh[enKey];
          if (!zhVal) continue;
          // 反转:中文短语(原译文) -> 英文短语(原原文)
          // 多条英文映射到同一中文时,后者覆盖前者(可接受;常用短词几乎无此冲突)
          enSeg[String(zhVal)] = enKey;
        }
        if (Object.keys(enSeg).length) builtin.en = enSeg;
      }
      return builtin;
    }
  } catch (e) {}
  return {};
}

// 英雄简写组合:"abr mid" -> 亚伯兰 中路;
// 要求每个词都能查表(词典或英雄简写)且至少一个词是英雄简写,
// 避免抢走译服务商的工作
function lookupComposed(text, prefix, dict) {
  const t = String(text || "").trim();
  if (!t || t.length > 40) return null;
  const words = t.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean);
  if (!words.length || words.length > 6) return null;
  let anyHero = false;
  const parts = [];
  for (const w of words) {
    let tr = null;
    if (dict.user[prefix] && dict.user[prefix][w]) tr = dict.user[prefix][w];
    if (!tr && dict.builtin[prefix] && dict.builtin[prefix][w]) tr = dict.builtin[prefix][w];
    if (!tr && dict.learned[prefix] && dict.learned[prefix][w]) tr = dict.learned[prefix][w];
    if (!tr) tr = heroNames.lookupHeroAbbr(w);
    if (!tr) return null;
    if (heroNames.isHeroAbbr(w)) anyHero = true;
    parts.push(String(tr));
  }
  if (!anyHero) return null;
  return { translation: parts.join(" "), detectedLanguage: "en", viaDictionary: true, viaComposed: true };
}

// ---------- 查表 ----------
// 查表顺序: user 区 > builtin 区 > learned 区
function lookup(text, targetLanguage) {
  const dict = load();
  if (!dict.enabled) return null;
  const prefix = langPrefix(targetLanguage);
  if (!prefix) return null;
  const keys = lookupKeys(text);
  if (!keys[0] || keys[0].length > 40) return null;

  let hit = null;
  for (const key of keys) {
    if (dict.user[prefix] && typeof dict.user[prefix] === "object") {
      hit = dict.user[prefix][key];
    }
    if (!hit && dict.builtin[prefix] && typeof dict.builtin[prefix] === "object") {
      hit = dict.builtin[prefix][key];
    }
    if (!hit && dict.learned[prefix] && typeof dict.learned[prefix] === "object") {
      hit = dict.learned[prefix][key];
    }
    if (hit) {
      break;
    }
  }
  if (!hit) return lookupComposed(text, prefix, dict);
  return { translation: String(hit), detectedLanguage: "en", viaDictionary: true };
}

function save() {
  try {
    const dict = load();
    // 只写 user/learned 两区,不带内部缓存字段(enabled/loadedAt)
    const out = { user: dict.user, learned: dict.learned };
    fs.mkdirSync(path.dirname(dictPath()), { recursive: true });
    fs.writeFileSync(dictPath(), JSON.stringify(out, null, 2) + "\n", "utf8");
  } catch (e) {}
}

module.exports = {
  load,
  lookup,
  record,
  flushLearned,
  startAutoFlush,
  ensureFile,
  save,
  dictPath,
  isLearnable,
};
