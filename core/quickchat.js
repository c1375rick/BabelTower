// 桥侧:扫描 Deadlock 本地化,提取快捷语音/轮盘模板
// 供客户端 /api/v1/quickchat 拉取;命中模板的聊天行跳过翻译API
// (快捷语音由游戏本地化渲染,再翻译一遍只会产出质量差的重复译文)
//
// 2026-09-17 重构(屎山治理):废弃 253 条手搓正则白名单(v2)。
//   正则方案每一条都是一个漏网面:参数转义、量词(叠标点 {0,2} 漏了 "Venator不见了！！！")、
//   双语覆盖、新模板跟随……越往后堆越难处理。模板匹配本质不需要正则:
//   本地化模板 = 固定段 + {s:param}/{d:param} 参数段,渲染结果 = 参数值 + 固定段拼接。
//   v3 改为输出【原始模板串】,客户端用纯字符串分段比对(见 lingua_chat.js matchesQuickTemplate)。
//   正则转义/量词/漂移问题在源头消失;模板语料直接来自游戏文件,游戏更新自动跟随。
//
// 结构化识别(Ping class / PingLabel)在客户端保留,负责真正的 Ping/地图标记;
// 本模板字典只负责"以 Text 形态渲染的轮盘消息"。
"use strict";
const fs = require("fs");
const path = require("path");
const gameNames = require("./game_names.js");
const { parseLocFile } = require("./loc_parser.js");

// ---------- 内容指纹(FNV-1a 32 位,Panorama 兼容的几十行纯 JS;LEARNINGS 2026-09-17 ⑥b) ----------
// version 是手动递增整数,忘 bump 时握手形同虚设;内容指纹对"模板表有没有变"碰撞率足够。
// 格式: count+首条+末条+FNV-1a(全部模板) 拼接后再 FNV-1a 一次,防"改中间条目但首尾没变"的漏判。
function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function fingerprintTemplates(list) {
  const arr = Array.isArray(list) ? list : [];
  if (arr.length === 0) return null;
  const first = String(arr[0]);
  const last = String(arr[arr.length - 1]);
  const joined = arr.length + "|" + first + "|" + last + "|" + fnv1a32(arr.join("\u0000"));
  return "fnv1a-" + fnv1a32(joined);
}

// 从模板文本提取固定段(参数挖空)。返回字符串数组(空段已剔除),或 null(无实质内容)
// 例: "{s:param_1}不见了" -> ["不见了"]; "{s:1}还要冷却{s:2}秒" -> ["还要冷却","秒"]
// 例: "小心！" -> ["小心"]; "攻击{s:x}" -> ["攻击"]; "{s:a}{s:b}" -> [] (结构键,拒绝)
function splitTemplate(text) {
  const segs = String(text).split(/\{[sd]:[a-zA-Z0-9_]+\}/);
  const fixed = [];
  for (const s of segs) {
    const t = s.trim();
    if (t) fixed.push(t);
  }
  return fixed;
}

// 复审剔除(2026-09-17 新族过筛):高频手打短语,玩家自由输入同形概率高,
// 而轮盘渲染送 Bing 的译文质量无损(sorry/need heal 等短句),翻译优先于省请求。
// 且目标语言与渲染语言一致时,这些消息本就由 isTargetLanguageText 跳过,白名单条目在此场景纯增误杀面。
// 实车取证:837 样本中 sorry/抱歉/去商店/有什么计划 均有真实出现记录。
const REMOVE_KEYS = new Set([
  "citadel_chatwheel_sorry",        // 抱歉 / Sorry
  "citadel_chatwheel_youre_welcome",// 不客气 / You're Welcome
  "citadel_chatwheel_need_plan",    // 有什么计划 / What's the plan
  "citadel_chatwheel_have_heal",    // 有治疗 / Have Heal
  "citadel_chatwheel_heal_please",  // 请治疗 / Heal Please
  "citadel_chatwheel_need_heal",    // 需要治疗 / Need Heal
  "citadel_chatwheel_going_shop",   // 去商店 / Going to Shop
]);

// 收录某语言本地化文件中的快捷语音模板;返回 { templates, skipped }
// 命名空间(key 分布调查 2026-09-17 ④b 步骤④实锤后定点扩):除 ping_* 外,
//   citadel_chatwheel_ 整族(旧过滤只收 message_/label_ 后缀,漏了 push_yellow/can_heal/help_with_idol_label 等无后缀/词尾变体),
//   citadel_bot_objective_*(Bot 队友目标播报以英雄名义发进聊天,实车取证:"推进滑索" 13 个不同发送者重复)。
//   两族已核验无长描述值混入;发现新漏网模板的决策规则:先跑 tools/analyze_chat_logs.js 看未命中堆,
//   出现多发送者重复的固定句式 → 对账本地化文件 → 定点扩命名空间,不做全量索引。
//   新族收録后必须过"玩家可手打"筛查:高频手打短语进 REMOVE_KEYS,不盲收。
function collectFrom(raw, into, counter) {
  const keys = Object.keys(raw).filter((k) =>
    /^ping_/.test(k) || /^citadel_chatwheel_/.test(k) || /^citadel_bot_objective_/.test(k)
  );
  for (const k of keys) {
    if (REMOVE_KEYS.has(k)) { counter.skipped++; continue; }
    const text = String(raw[k] || "").trim();
    if (!text) continue;
    // 剥离值内嵌的 HTML 标签(实锤:citadel_chatwheel_push_yellow 英文值 "Push Yellow</span>",
    // 标签残进固定段后该条永不命中渲染文本);标签后再 trim,空则按结构键跳过
    const clean = text.replace(/<[^>]+>/g, "").trim();
    if (!clean) { counter.skipped++; continue; }
    const fixed = splitTemplate(clean);
    // 剥参数后无实质内容的结构键(ping_message={s:a}{s:b}、ping_they_are="他们")跳过:
    // 任何消息都能命中,只会误杀真人聊天
    if (fixed.length === 0) { counter.skipped++; continue; }
    // 纯符号段("!")无判别力,同样跳过
    const meaningful = fixed.filter((s) => s.replace(/[\s!！?？.。…⋯~〜]/g, "").length >= 2);
    if (meaningful.length === 0) { counter.skipped++; continue; }
    if (!into[k]) into[k] = [];
    // 尾部标点不收录(游戏渲染会追加/叠加感叹号,匹配时统一剥尾;语料只存去尾后的形式)
    const trimmed = clean.replace(/[\s!！?？.。…⋯~〜]+$/g, "").trim() || clean;
    if (into[k].indexOf(trimmed) < 0) into[k].push(trimmed);
    if (!counter.samples[k]) counter.samples[k] = clean;
  }
}

// schinese + english 双语模板;root 为 Deadlock 安装目录
// (网络上传输的是本地化 key+参数,每个客户端用自己的游戏语言渲染,
//  官方本地化层就是翻译本身——白名单必须双语收录,否则英文渲染的整句送翻译产垃圾)
function build(root) {
  const r = root || gameNames.findDeadlockRoot();
  if (!r) return { ok: false, error: "deadlock_not_found" };
  const locDir = path.join(r, "game", "citadel", "resource", "localization", "citadel_main");
  const counter = { skipped: 0, samples: {} };
  const templates = {};
  for (const lang of ["schinese", "english"]) {
    const file = path.join(locDir, "citadel_main_" + lang + ".txt");
    collectFrom(parseLocFile(file), templates, counter);
  }
  const count = Object.keys(templates).length;
  if (count === 0) return { ok: false, error: "no_templates" };
  // 双语模板扁平化后计算指纹(key 排序保证稳定,与 buildClientFallback 同序)
  const flat = [];
  for (const k of Object.keys(templates).sort()) {
    for (const t of templates[k]) flat.push(t);
  }
  return { ok: true, count: count, templates: templates, samples: counter.samples, skipped: counter.skipped, fingerprint: fingerprintTemplates(flat) };
}

// parseLocFile 已抽至 core/loc_parser.js(单一数据源,与 game_names.js 共用);
// 此处仅 re-export 维持旧 require 兼容。

// 生成客户端硬编码兜底语料(桥离线时的最后手段)。
// 与 v2 时代"凭印象手写"不同:直接从真实本地化文件生成,天然对账(LEARNINGS 8-31 ⑤ 教训)。
// 返回 { list, fingerprint }:fingerprint 与 quickchat.json 同源,客户端握手比对用。
function buildClientFallback(root) {
  const r = build(root);
  if (!r.ok) return null;
  // 双语语料一起给客户端;按 key 排序保证生成文件稳定(diff 友好)
  const flat = [];
  for (const k of Object.keys(r.templates).sort()) {
    for (const t of r.templates[k]) flat.push(t);
  }
  return { list: flat, fingerprint: r.fingerprint };
}

// 专名表(模板参数约束用):英雄名(en+zh)+ 物品/能力名(en+zh,来自 citadel_heroes/citadel_attributes)。
// 能力 ping 模板({s:param}准备就绪/还要冷却N秒)的参数是技能名,不在英雄/物品名表里,必须额外收录。
function buildExtraNames(root) {
  const r = root || gameNames.findDeadlockRoot();
  if (!r) return [];
  const loc = path.join(r, "game", "citadel", "resource", "localization");
  const sources = [
    path.join(loc, "citadel_heroes", "citadel_heroes_english.txt"),
    path.join(loc, "citadel_heroes", "citadel_heroes_schinese.txt"),
    path.join(loc, "citadel_attributes", "citadel_attributes_english.txt"),
    path.join(loc, "citadel_attributes", "citadel_attributes_schinese.txt"),
  ];
  const out = [];
  for (const f of sources) {
    const raw = parseLocFile(f);
    for (const k of Object.keys(raw)) {
      // 只收 ability/modifier/upgrade 名;跳过描述/台词条(含句读的不收)
      // 注意 key 形态有两族: citadel_ability_*(heroes 主文件)与 ability_*(部分条目,如 ability_guided_arrow)
      if (!/^(citadel_)?ability_|^modifier_|^upgrade_/.test(k)) continue;
      const v = String(raw[k] || "").trim();
      if (!v || v.length < 2 || v.length > 40) continue;
      if (/[。！？!?,，;；"“”]/.test(v)) continue; // 句子/描述不收
      if (out.indexOf(v) < 0) out.push(v);
    }
  }
  return out;
}

// 桥配置唯一写入口:bridge_server.js 启动与 name_protect.js watcher 重建都必须走这里,
// 严禁各自手写 JSON.stringify —— 漏带 fingerprint 会让客户端握手永远走告警路径
// (2026-09-25 实锢: watcher 路径漏写指纹,quickchat_handshake 测试间歇性红)。
function writeBridgeConfig(r) {
  const out = path.join(__dirname, "..", "config", "quickchat.json");
  fs.writeFileSync(out, JSON.stringify({ version: 3, fingerprint: r.fingerprint, langs: ["schinese", "english"], templates: r.templates }, null, 2) + "\n", "utf8");
  return out;
}

function main() {
  const r = build();
  if (!r.ok) { console.error("BUILD FAIL:", r.error); process.exit(1); }

  // 桥配置:模板字典(key -> [模板串]),客户端按渲染文本分段比对;fingerprint 供客户端握手校验
  const out = writeBridgeConfig(r);
  console.log("wrote", out, "keys:", r.count, "(skipped:", r.skipped, ") fingerprint:", r.fingerprint);

  // 客户端兜底语料:生成到 mod 源码目录(需随 VPK 编译;游戏更新后重跑本脚本+重编 VPK)
  // 语料仍是纯数组(客户端提取解析),指纹写在注释行,tests/quickchat_handshake.test.js 解析比对
  const fb = buildClientFallback();
  if (fb) {
    const outJs = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat_quickchat_fallback.js");
    const body = JSON.stringify(fb.list, null, 1);
    fs.writeFileSync(outJs,
      "// 自动生成 by core/quickchat.js —— 请勿手改;游戏更新后重跑 node core/quickchat.js 并重编 VPK\n" +
      "// 桥离线时的快捷语音模板兜底语料(双语,来自本地真实文件)。\n" +
      "// 指纹以全局变量暴露,客户端 syncQuickChat 握手用;旧兑底文件无此变量 → 客户端按指纹缺失路径处理\n" +
      "LCT_QUICKCHAT_FALLBACK_FINGERPRINT = " + JSON.stringify(fb.fingerprint) + ";\n" +
      "LCT_QUICKCHAT_FALLBACK_TEMPLATES = " + body + ";\n",
      "utf8");
    console.log("wrote", outJs, "templates:", fb.list.length, "fingerprint:", fb.fingerprint);
  }

  // 专名表兑底(客户端模板匹配的参数约束用):英雄/物品名 + 能力名
  try {
    const names = [];
    const gm = gameNames.build();
    if (gm && gm.ok && gm.map) {
      for (const en of Object.keys(gm.map)) {
        names.push(en);
        const zh = gm.map[en];
        if (zh && typeof zh === "string" && /[\u4e00-\u9fff]/.test(zh)) names.push(zh);
      }
    }
    for (const extra of buildExtraNames()) {
      if (names.indexOf(extra) < 0) names.push(extra);
    }
    const outNames = path.join(__dirname, "..", "mod", "panorama", "scripts", "lingua_chat_gamenames_fallback.js");
    fs.writeFileSync(outNames,
      "// 自动生成 by core/quickchat.js —— 请勿手改;游戏更新后重跑 node core/quickchat.js 并重编 VPK\n" +
      "// 模板参数约束用的专名表(英/中;多词英文名保留空格;含英雄/物品/能力名)。\n" +
      "LCT_GAMENAMES_FALLBACK = " + JSON.stringify(names.sort(), null, 1) + ";\n",
      "utf8");
    console.log("wrote", outNames, "names:", names.length);
  } catch (e) {
    console.log("gamenames fallback failed (non-fatal):", e.message);
  }

  for (const k of Object.keys(r.samples)) console.log("  ", k, "=", r.samples[k]);
}

if (require.main === module) main();
module.exports = { build, buildClientFallback, splitTemplate, buildExtraNames, parseLocFile, fingerprintTemplates, fnv1a32, writeBridgeConfig };
