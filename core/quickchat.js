// 桥侧:扫描 Deadlock 本地化,提取快捷语音/轮盘模板,编译成正则白名单
// 供客户端 /api/v1/quickchat 拉取;命中白名单的聊天行跳过翻译API
// (快捷语音由游戏本地化渲染,再翻译一遍只会产出质量差的重复译文)
//
// 2026-09-17 双语化修正:快捷语音无论渲染成中文还是英文都不需要 mod 翻译——
// 网络上传输的是本地化 key+参数,每个客户端用自己的语言渲染,官方本地化层就是翻译本身。
// 因此白名单同时收录 english 与 schinese 模板(推翻 LEARNINGS 9-15 ② "只收目标语言"结论)。
//
// 2026-09-17 参数通配修正:参数段不再用 [^\s,.!?:;]* 裸通配,改为
//   "已知游戏专名(英雄名 en+zh,长度降序交替)" | "单个无空格西文 token"(兜底未来新英雄)。
// 修复两类问题:
//   ① 漏杀:多词英文名(Lady Geist / Mo & Krill / Grey Talon)填进参数后,旧通配不含空格 → 整条失配;
//   ② 误杀:"固定前缀+可选空通配"模板(如 攻击{s:x})让真人消息"攻击中路"被吞 → 参数段必须至少消费 1 个 token。
"use strict";
const fs = require("fs");
const path = require("path");
const gameNames = require("./game_names.js");

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 快捷语音模板参数段的匹配体:
// 已知专名(按长度降序交替,大小写不敏感) 或 单个无空格西文 token(兜底未知新英雄,不含空白/句读)
let PARAM_ALT_SOURCE = null;
function buildParamPattern() {
  if (PARAM_ALT_SOURCE) return PARAM_ALT_SOURCE;
  let names = [];
  try {
    const map = gameNames.build && gameNames.build();
    if (map && map.ok && map.map) {
      for (const en of Object.keys(map.map)) {
        const zh = map.map[en];
        if (en && en.length >= 2) names.push(en);
        if (zh && typeof zh === "string" && zh.length >= 2 && /[\u4e00-\u9fff]/.test(zh)) names.push(zh);
      }
    }
  } catch (e) { /* gamenames 构建失败不致命,退化为纯 token 兜底 */ }
  names = names.slice().sort((a, b) => b.length - a.length).map(escapeRe);
  PARAM_ALT_SOURCE = names.length > 0
    ? "(?:" + names.join("|") + "|[A-Za-z][A-Za-z&'.\\-]*)"
    : "[A-Za-z][A-Za-z&'.\\-]*";
  return PARAM_ALT_SOURCE;
}

// 从模板文本编译正则:
// 1. {s:xxx} 参数 → buildParamPattern()(专名交替+单token兜底);{d:xxx} 数字参数 → \d+
// 2. 其余字符按字面匹配(正则转义);空格处允许任意空白;末尾标点可省略
// 返回 RegExp 或 null(无法编译)
function compileTemplate(text) {
  if (!text || typeof text !== "string") return null;
  const segs = String(text).split(/(\{[sd]:[a-zA-Z0-9_]+\})/);
  let re = "^\\s*";
  for (const seg of segs) {
    if (/^\{[sd]:[a-zA-Z0-9_]+\}$/.test(seg)) {
      // 参数两侧允许可选空白(游戏渲染 {s:param} 前后空格不固定)
      re += seg.startsWith("{d:") ? "\\s*\\d+\\s*" : "\\s*" + buildParamPattern() + "\\s*";
    } else if (seg) {
      re += escapeRe(seg).replace(/\s+/g, "\\s*");
    }
  }
  // 末尾标点可省略(游戏渲染可能带/不带标点)
  re += "\\s*[！!？?。.…⋯]{0,2}\\s*$";
  try {
    return new RegExp(re, "i");
  } catch (e) {
    return null;
  }
}

// 收录某语言本地化文件中的快捷语音模板;返回 { patterns, samples, skipped }
function collectFrom(raw, into, counter) {
  const keys = Object.keys(raw).filter((k) =>
    /^ping_/.test(k) || /^citadel_chatwheel_message_/.test(k) || /^citadel_chatwheel_label_/.test(k)
  );
  for (const k of keys) {
    let text = String(raw[k] || "").trim();
    if (!text) continue;
    // 纯符号模板("!"/"！")与结构键(ping_message={s:a}{s:b}、ping_they_are="他们")跳过:
    // 剥参数后无实质内容 → 编译出的模式要么匹配不了要么裸通配误杀
    const withoutParams = text.replace(/\{[sd]:[a-zA-Z0-9_]+\}/g, "").replace(/[\s!！?？.。…⋯~〜]/g, "");
    if (withoutParams.length < 2) { counter.skipped++; continue; }
    const re = compileTemplate(text);
    if (!re) { counter.skipped++; continue; }
    into.push(re.source);
    if (Object.keys(counter.samples).length < 12) counter.samples[k] = text;
  }
}

// schinese + english 双语模板;root 为 Deadlock 安装目录
function build(root) {
  const r = root || gameNames.findDeadlockRoot();
  if (!r) return { ok: false, error: "deadlock_not_found" };
  const locDir = path.join(r, "game", "citadel", "resource", "localization", "citadel_main");
  const counter = { skipped: 0, samples: {} };
  const patterns = [];
  for (const lang of ["schinese", "english"]) {
    const file = path.join(locDir, "citadel_main_" + lang + ".txt");
    collectFrom(parseLocFile(file), patterns, counter);
  }
  // 去重(同一 key 双语模板文本可能相同)
  const seen = new Set();
  const uniq = [];
  for (const p of patterns) {
    if (seen.has(p)) continue;
    seen.add(p);
    uniq.push(p);
  }
  if (uniq.length === 0) return { ok: false, error: "no_templates" };
  return { ok: true, count: uniq.length, patterns: uniq, samples: counter.samples, skipped: counter.skipped };
}

// 解析 valve 本地化 txt: "key" "value"(UTF-8 BOM 兼容;与 game_names.parseLoc 相同逻辑,独立实现避免耦合)
function parseLocFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  let buf = fs.readFileSync(file);
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.slice(3);
  const text = buf.toString("utf8");
  const re = /"([^"]+)"\s+"([^"]*)"/g;
  let m;
  while ((m = re.exec(text))) out[m[1]] = m[2];
  return out;
}

function main() {
  const r = build();
  if (!r.ok) { console.error("BUILD FAIL:", r.error); process.exit(1); }
  const out = path.join(__dirname, "..", "config", "quickchat.json");
  fs.writeFileSync(out, JSON.stringify({ version: 2, langs: ["schinese", "english"], patterns: r.patterns }, null, 2) + "\n", "utf8");
  console.log("wrote", out, "patterns:", r.count, "(skipped:", r.skipped + ")");
  for (const k of Object.keys(r.samples)) console.log("  ", k, "=", r.samples[k]);
}

if (require.main === module) main();
module.exports = { build, compileTemplate, parseLocFile };
