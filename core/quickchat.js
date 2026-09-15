// 桥侧:扫描 Deadlock 本地化,提取快捷语音/轮盘模板,编译成正则白名单
// 供客户端 /api/v1/quickchat 拉取;命中白名单的聊天行跳过翻译API
// (快捷语音由游戏本地化渲染,再翻译一遍只会产出质量差的重复译文)
"use strict";
const fs = require("fs");
const path = require("path");
const gameNames = require("./game_names.js");

// 从模板文本编译正则:
// 1. 去掉 {s:xxx} / {d:xxx} 等参数占位 → 通配段([^\s,.!?:;，。！？；：]*) 参数内无分隔符
// 2. 其余字符按字面匹配(正则转义);空格处允许任意空白;末尾标点可省略
// 返回 RegExp 或 null(无法编译)
function compileTemplate(text) {
  if (!text || typeof text !== "string") return null;
  // 参数占位(如 {s:param_1})替换为通配段;先把参数剥出来再转义其余部分
  const segs = String(text).split(/\{[sd]:[a-zA-Z0-9_]+\}/);
  let re = "^";
  for (let i = 0; i < segs.length; i++) {
    re += escapeRe(segs[i]).replace(/\\ /g, "\\s+").replace(/\s+/g, "\\s*");
    if (i < segs.length - 1) re += "\\s*[^\\s,.!?:;，。！？；：]*\\s*"; // 参数两侧允许可选空格(游戏渲染可能加/不加)
  }
  // 末尾标点可省略(游戏渲染可能带/不带标点)
  re = re.replace(/([！!？?。.…⋯]+)\\s\*$/, "$1").replace(/([！!？?。.…⋯]+)$/, "$1") + "[！!？?。.…⋯]{0,2}$";
  try {
    return new RegExp(re, "i");
  } catch (e) {
    return null;
  }
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// schinese 或用户目标语言对应的本地化文件(按目标语言选文件,便于将来支持其他语言跳过)
function build(root) {
  const r = root || gameNames.findDeadlockRoot();
  if (!r) return { ok: false, error: "deadlock_not_found" };
  const file = path.join(r, "game", "citadel", "resource", "localization", "citadel_main", "citadel_main_schinese.txt");
  const raw = parseLocFile(file);
  const keys = Object.keys(raw).filter((k) =>
    /^ping_/.test(k) || /^citadel_chatwheel_message_/.test(k) || /^citadel_chatwheel_label_/.test(k)
  );
  const patterns = [];
  const samples = {};
  for (const k of keys) {
    let text = String(raw[k] || "").trim();
    if (!text) continue;
    // 结构键(ping_message = 纯参数拼接、ping_they_are = "他们"等)编译后是裸通配符,
    // 会把任意聊天误判为快捷语音 → 跳过:剥掉参数后无实质内容的模板不入选
    const withoutParams = text.replace(/\{[sd]:[a-zA-Z0-9_]+\}/g, "").trim();
    if (withoutParams.length < 2) continue;
    const re = compileTemplate(text);
    if (!re) continue;
    patterns.push(re.source);
    if (Object.keys(samples).length < 8) samples[k] = text;
  }
  if (patterns.length === 0) return { ok: false, error: "no_templates" };
  return { ok: true, count: patterns.length, patterns: patterns, samples: samples };
}

// 解析 valve 本地化 txt: "key" "value"(与 game_names.parseLoc 相同逻辑,独立实现避免耦合)
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
  fs.writeFileSync(out, JSON.stringify({ version: 1, patterns: r.patterns }, null, 2) + "\n", "utf8");
  console.log("wrote", out, "patterns:", r.count);
  for (const k of Object.keys(r.samples)) console.log("  ", k, "=", r.samples[k]);
}

if (require.main === module) main();
module.exports = { build, compileTemplate, parseLocFile };
