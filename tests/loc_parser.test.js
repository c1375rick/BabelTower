// 离线测试:公共本地化 parser(core/loc_parser.js)
// 合成用例必跑;真实本地化文件对账用例在 Deadlock 不存在时 skip+warning(禁止静默 pass)。
// 跑法: node tests/loc_parser.test.js
"use strict";
const fs = require("fs");
const path = require("path");
const { parseLocContent, parseLocFile } = require("../core/loc_parser.js");
const gameNames = require("../core/game_names.js");

let pass = 0, fail = 0, skipped = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  PASS |", label); }
  else { fail++; console.log("  FAIL |", label); }
}
function skip(label) {
  skipped++;
  console.log("  SKIP |", label, "(文件不存在;真实语料对账需要本地 Deadlock 安装)");
}

// ---------- 合成用例:转义引号(LEARNINGS 8-31 ⑤ 的实锤 bug 形态) ----------
console.log("--- parseLocContent 合成用例 ---");
const sample = [
  "\"ability_simple\"  \"简单技能\"",
  "\"ability_quoted\"  \"说 \\\"highlight\\\" 的话\"",
  "\"after\"           \"后续条目\"",
  "\"nested\" \"外\\\"内\\\"外\"",
].join("\n");
const parsed = parseLocContent(sample);
ok(parsed.ability_simple === "简单技能", "基本键值对解析");
ok(parsed.ability_quoted === "说 \"highlight\" 的话", "值内转义引号还原(\\\" -> \")");
ok(parsed.after === "后续条目", "内嵌引号条目后,后续条目不再被吞(旧朴素正则的丢 key 形态)");
ok(parsed.nested === "外\"内\"外", "多处转义引号");
ok(Object.keys(parsed).length === 4, "无多余/丢失 key(4/4)");

// 反斜杠转义
const bs = parseLocContent("\"k\"  \"反斜杠 \\\\ 测试\"");
ok(bs.k === "反斜杠 \\ 测试", "双反斜杠还原(\\\\ -> \\)");

// BOM 剥除 + 文件不存在
const tmp = path.join(__dirname, "tmp_loc_bom.txt");
fs.writeFileSync(tmp, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("\"bom_key\"  \"bom值\"", "utf8")]), "utf8");
ok(parseLocFile(tmp).bom_key === "bom值", "UTF-8 BOM 兼容");
fs.unlinkSync(tmp);
ok(Object.keys(parseLocFile(path.join(__dirname, "no_such_file.txt"))).length === 0, "文件不存在返回空对象(不抛)");

// ---------- 真实文件对账(需 Deadlock 安装) ----------
console.log("--- game_names.js 换用公共 parser 后的实文件对账 ---");
const root = gameNames.findDeadlockRoot();
if (!root) {
  skip("Deadlock 安装目录未找到(DEADLOCK_ROOT 可指定)");
} else {
  const r = gameNames.build();
  ok(r.ok === true, "game_names.build() 成功");
  ok(r.count >= 200, "英雄/物品名数量 >= 200(实际 " + r.count + ";朴素正则时代约丢名后应明显更全)");

  // key 数对账:公共 parser 应不少于旧朴素正则的解析结果
  // (旧正则在内嵌引号处错位,只会少 key,不会多 key —— 取同目录用旧正则跑一遍对照)
  const loc = path.join(root, "game", "citadel", "resource", "localization");
  const heroFile = path.join(loc, "citadel_gc_hero_names", "citadel_gc_hero_names_english.txt");
  if (fs.existsSync(heroFile)) {
    const text = fs.readFileSync(heroFile, "utf8").replace(/^﻿/, "");
    const oldRe = /"([^"]+)"\s+"([^"]*)"/g;
    let m, oldCount = 0;
    while ((m = oldRe.exec(text))) oldCount++;
    const newCount = Object.keys(require("../core/loc_parser.js").parseLocFile(heroFile)).length;
    ok(newCount >= oldCount, "公共 parser key 数(" + newCount + ") >= 旧朴素正则(" + oldCount + ")");
    if (newCount > oldCount) console.log("  INFO | 实锤找回被吞 key:", newCount - oldCount, "条(内嵌引号错位所致)");
  }

  // ability_guided_arrow(遥控夜枭)存在性 —— LEARNINGS 记录的实锤丢失 key,经 quickchat.buildExtraNames 路径验证
  const quickchat = require("../core/quickchat.js");
  const extra = quickchat.buildExtraNames(root);
  ok(extra.indexOf("遥控夜枭") >= 0, "能力名表含 遥控夜枭(ability_guided_arrow 实锤回归)");

  // 抽样:游戏主本地化的 citation 对账(citadel_main 含转义引号最多)
  const mainEn = path.join(loc, "citadel_main", "citadel_main_english.txt");
  if (fs.existsSync(mainEn)) {
    const mainKeys = Object.keys(require("../core/loc_parser.js").parseLocFile(mainEn));
    ok(mainKeys.length >= 3000, "citadel_main_english key 数 >= 3000(实际 " + mainKeys.length + ");阈值取实测量级下限,防 parser 整体失效");
  } else {
    skip("citadel_main_english.txt");
  }
}

console.log("RESULT: PASS " + pass + " / FAIL " + fail + " / SKIP " + skipped);
process.exit(fail > 0 ? 1 : 0);
