// tools/analyze_chat_logs.js — key 分布调查:未命中堆残留抽样(只读,不写游戏目录,不改任何数据)
//
// 评审方法论(LEARNINGS 2026-09-17 ④b/⑦①):
//   1. 全量官方文本索引是伪命题——物品描述/UI 文案不会出现在聊天里,真正待查的是
//      quickchat 命名空间之外的聊天可见官方文本余量;
//   2. "覆盖率"有循环依赖(需要官方文本→渲染文本的反向索引,而那正是待决策要不要建的东西),
//      所以指标是【未命中堆里官方文本的残留比例】,方法是把样本分堆后对未命中堆做规则抽样;
//   3. 快照数字不写进 LEARNINGS——样本规模/命中率/残留比例以本脚本当次输出为准。
//
// 跑法: node tools/analyze_chat_logs.js
// 输出: 三行汇总(样本总数/命中率/未命中堆疑似官方残留比例) +
//       疑似官方文本候选清单 -> logs/analysis/official_residue_YYYYMMDD.json(供人工复核,不做自动决策)
"use strict";
const fs = require("fs");
const path = require("path");
const qc = require("../core/quickchat_match.js");

const ROOT = path.join(__dirname, "..");
const CHAT_DIR = path.join(ROOT, "logs", "chat");
const ANALYSIS_DIR = path.join(ROOT, "logs", "analysis");

// 开发测试消息特征(boot 自检/桥联调时灌入的样例,非真实玩家聊天)
const TEST_TEXT_RE = /^(hello|gg wp|hello team|hello world|push mid|retreat now|retreat please|enemy team|translate test|no settimeout)/i;

// ---------- 1. 读取并分组(按 matchId;去重;还原前先筛测试消息) ----------
function loadSamples() {
  if (!fs.existsSync(CHAT_DIR)) return [];
  const byMatch = new Map(); // matchId -> Set(去重 key)
  for (const f of fs.readdirSync(CHAT_DIR)) {
    if (!f.endsWith(".jsonl")) continue;
    const file = path.join(CHAT_DIR, f);
    let lines;
    try {
      lines = fs.readFileSync(file, "utf8").split("\n");
    } catch (e) {
      console.error("WARN: cannot read", f, e.message);
      continue;
    }
    for (const line of lines) {
      const s = line.trim();
      if (!s) continue;
      let obj;
      try { obj = JSON.parse(s); } catch (e) { continue; } // 跳过损坏行
      const text = String(obj.text || "").trim();
      if (!text || text.length < 2) continue;
      if (TEST_TEXT_RE.test(text)) continue; // 开发测试消息
      const matchId = String(obj.matchId || path.basename(f, ".jsonl"));
      if (!byMatch.has(matchId)) byMatch.set(matchId, new Set());
      // 去重键:文本 + 发送者(同一人重复说同一句只计一次;不同人同句各计一次)
      byMatch.get(matchId).add(String(obj.sender || "") + "\u0000" + text);
    }
  }
  const out = [];
  for (const [matchId, set] of byMatch) {
    for (const entry of set) {
      const idx = entry.indexOf("\u0000");
      out.push({ matchId: matchId, sender: entry.slice(0, idx), text: entry.slice(idx + 1) });
    }
  }
  return out;
}

// ---------- 2. 分堆:命中 quickchat 模板 / 未命中 ----------
function classify(samples) {
  const hit = [], miss = [];
  for (const s of samples) {
    (qc.matchesQuickTemplate(s.text) ? hit : miss).push(s);
  }
  return { hit: hit, miss: miss };
}

// ---------- 3. 未命中堆规则抽样:疑似官方文本特征 ----------
// 注意:这些规则只产生"候选",交人工复核;不自动扩语料(评审 ④b 步骤③④)
function looksOfficial(s) {
  const t = s.text;
  const reasons = [];
  // 系统播报格式:玩家 X 加入了队伍 / X 击杀了 Y / X 已离开 等含专名+固定动词句式
  if (/(加入|离开|击杀|被击杀|连杀|加入了我方|加入了敌方)/.test(t) && /[\u4e00-\u9fff]/.test(t) && t.length <= 30) {
    reasons.push("system-broadcast-like");
  }
  // 英雄/物品/能力专名 + 固定动词句式(X 不见了 / X 正在冷却 / 击败 X 类)
  if (/(不见了|正在冷却|冷却中|准备就绪|已就绪|快出了|正在推进|需要帮助|正在攻击)/.test(t) && t.length <= 24) {
    reasons.push("quickchat-verb-pattern");
  }
  // 纯指令短句(无个人语气词的祈使句,长度极短且以动词开头)——弱信号
  if (/^(小心|撤退|集合|推|守|回防|进攻|防守|辅助|打钱|升级|买活)/.test(t) && t.length <= 8) {
    reasons.push("imperative-short");
  }
  return reasons;
}

// ---------- 主流程 ----------
function main() {
  const samples = loadSamples();
  if (samples.length === 0) {
    console.log("samples: 0 (no chat logs found in " + CHAT_DIR + ")");
    return;
  }
  const { hit, miss } = classify(samples);

  const candidates = [];
  for (const s of miss) {
    const reasons = looksOfficial(s);
    if (reasons.length > 0) candidates.push({ text: s.text, sender: s.sender, matchId: s.matchId, reasons: reasons });
  }
  const residueRatio = miss.length > 0 ? candidates.length / miss.length : 0;

  // 三行汇总(决策依据;快照不写入 LEARNINGS)
  console.log("samples total: " + samples.length + " (hit " + hit.length + " / miss " + miss.length + ")");
  console.log("quickchat hit rate: " + ((hit.length / samples.length) * 100).toFixed(1) + "%");
  console.log("unmatched official residue ratio: " + (residueRatio * 100).toFixed(1) + "% (" + candidates.length + "/" + miss.length + " candidates, manual review required)");

  if (candidates.length > 0) {
    fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const out = path.join(ANALYSIS_DIR, "official_residue_" + stamp + ".json");
    fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), samples: samples.length, hit: hit.length, miss: miss.length, candidates: candidates }, null, 2) + "\n", "utf8");
    console.log("candidate list written: " + out);
  }
}

main();
