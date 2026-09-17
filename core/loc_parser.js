// core/loc_parser.js — 公共 Valve 本地化 txt 解析器(单一数据源)
//
// 2026-09-17 抽取:此前 quickchat.js(parseLocFile,已修)与 game_names.js(parseLoc,朴素正则)
// 各持一份实现,后者因内嵌转义引号错位丢 key(LEARNINGS 8-31 ⑤ 实锤:ability_guided_arrow 遥控夜枭丢失)。
// 现在两处共用本文件:改一处生效一处,parser 漂移从结构上消失。
//
// 语法: "key" "value",值可含转义序列(\" 与 \\);UTF-8 BOM 兼容。
// 值正则 ((?:\\.|[^"\\])*) 容忍 \" 序列——朴素正则 "([^"]*)" 会在内嵌引号处断开,
// 配对错位后把后续条目整个吞进一个假"值",静默丢 key。
"use strict";
const fs = require("fs");

// 解析本地化文本内容 -> { key: value };value 内转义序列还原(\" -> "; \\ -> \)
function parseLocContent(text) {
  const out = {};
  const re = /"([^"\\]+)"\s+"((?:\\.|[^"\\])*)"/g;
  let m;
  while ((m = re.exec(text))) {
    out[m[1]] = m[2].replace(/\\(.)/g, "$1");
  }
  return out;
}

// 解析本地化文件(BOM 剥除后交 parseLocContent);文件不存在返回空对象
function parseLocFile(file) {
  if (!fs.existsSync(file)) return {};
  let buf = fs.readFileSync(file);
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.slice(3);
  return parseLocContent(buf.toString("utf8"));
}

module.exports = { parseLocFile, parseLocContent };
