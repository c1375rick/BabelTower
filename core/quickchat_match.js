// core/quickchat_match.js — 免正则快捷语音模板匹配器【同源参考实现】
//
// 与 mod/panorama/scripts/lingua_chat.js 的 matchesQuickTemplate / isQuickChatTemplate 保持同步:
// 改任何一侧匹配逻辑,必须同步另一侧 + tests/quickchat_match.test.js,并三处重跑。
// 本文件是唯一可 require 的实现源;tests 与 tools/analyze_chat_logs.js 都从这里加载,
// 客户端因依赖 Panorama 全局无法 require,保留同步副本(先例:matchesQuickTemplate 提取复制)。
//
// 匹配原则(全部字符串操作,无模式串正则):
//   模板 = token 序列(param | fixed)。渲染消息 = 参数值与固定段按序拼接。
//   匹配 = 归一化(去空白/小写 + 剥尾部标点)后 token 走查:fixed 必须逐字命中,
//   param 消费 ≥1 字符且只允许「已知游戏名(英/中)」或「不含 CJK 的短 latin 连串」。
//
// 匹配缓存(2026-09-17 评审新增):
//   同一条文本在 HUD 顶栏与左下聊天栏两处渲染,各自 shouldSkip → 各调一次走查;
//   缓存按【走查自身归一化形式】记忆结果(非 makeTextKey——不依赖目标语言,
//   且 "Venator不见了" 与 "Venator不见了！！！" 剥尾后同键,叠标点变体并入同一缓存项)。
//   语料整体替换(桥同步/兑底更新)时必须 clearMatchCache(),否则旧判定残留。
//   走查计数 walkCount 供测试断言"同文本双通道只走查一次"。
"use strict";
const fs = require("fs");
const path = require("path");

// ---------- 语料加载(生成文件为 `X = [...];` 赋值语句,提取 JSON 字面量解析) ----------
function extractArray(file) {
  const src = fs.readFileSync(file, "utf8");
  const m = src.match(/=\s*(\[[\s\S]*\])\s*;/);
  if (!m) throw new Error("cannot extract array from " + file);
  return JSON.parse(m[1]);
}

const SCRIPTS_DIR = path.join(__dirname, "..", "mod", "panorama", "scripts");
let TEMPLATES = extractArray(path.join(SCRIPTS_DIR, "lingua_chat_quickchat_fallback.js"));
let NAMES = extractArray(path.join(SCRIPTS_DIR, "lingua_chat_gamenames_fallback.js"));

// ---------- 归一化 ----------
function norm(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, "");
}
// 走查缓存键:trim → 剥尾部标点(叠标点兼容) → 归一化;与匹配器内部处理完全一致
function normKey(text) {
  const msg0 = String(text || "").trim();
  if (!msg0) return null;
  return norm(msg0.replace(/[\s!！?？.。…⋯~〜]+$/g, "")) || null;
}

// ---------- 专名索引(长度降序,惰性构建) ----------
let NAME_SORTED = [];
let NAME_SET_NORM = null;
function buildNameIndex() {
  NAME_SORTED = [];
  for (let i = 0; i < NAMES.length; i++) NAME_SORTED.push(norm(NAMES[i]));
  NAME_SORTED.sort((a, b) => b.length - a.length);
  NAME_SET_NORM = null;
}
function isNameAt(msg, pos) {
  if (NAME_SET_NORM === null) NAME_SET_NORM = new Set(NAME_SORTED);
  for (let i = 0; i < NAME_SORTED.length; i++) {
    const n = NAME_SORTED[i];
    if (n && msg.startsWith(n, pos)) return n.length;
  }
  return 0;
}
// 西文/数字 token(兜底未知新英雄/数字参数):字母数字 + & '. -
function isTokenStart(c) {
  return (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "&" || c === "'" || c === "." || c === "-";
}
function tokenLenAt(msg, pos) {
  let len = 0;
  while (pos + len < msg.length && isTokenStart(msg.charAt(pos + len))) len++;
  return len;
}

// ---------- 模板 token 化 ----------
function tplTokens(tpl) {
  const parts = String(tpl || "").split(/(\{[sd]:[a-zA-Z0-9_]+\})/);
  const tokens = [];
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    if (/^\{[sd]:[a-zA-Z0-9_]+\}$/.test(parts[i])) tokens.push({ p: true });
    else {
      const v = norm(parts[i]);
      if (v) tokens.push({ p: false, v: v });
    }
  }
  return tokens;
}

// ---------- token 走查(msg 必须已归一化+剥尾) ----------
function walkTemplates(msg) {
  for (let ti = 0; ti < TEMPLATES.length; ti++) {
    const tokens = tplTokens(TEMPLATES[ti]);
    if (tokens.length === 0) continue;
    if (tokens.length === 1 && !tokens[0].p) {
      if (msg === tokens[0].v) return true; // 纯固定模板:整句相等
      continue;
    }
    // token 走查(不做回溯;param 在下一 fixed 锚点处停靠)
    let pos = 0;
    let ok = true;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (!tok.p) {
        if (!msg.startsWith(tok.v, pos)) { ok = false; break; }
        pos += tok.v.length;
      } else {
        // param:至少消费 1 字符
        const rest = msg.length - pos;
        const isLast = i === tokens.length - 1;
        if (isLast) {
          if (rest < 1) { ok = false; break; }
          // 末尾 param 只允许已知游戏名或单个 token(防任意 CJK 通配误杀)
          if (isNameAt(msg, pos) > 0 || tokenLenAt(msg, pos) === rest) {
            pos = msg.length;
          } else { ok = false; break; }
        } else {
          // 中间 param:在下一 fixed 锚点前找参数值(从 pos+1 起,保证 ≥1 字符)
          const nextFixed = tokens[i + 1].p ? null : tokens[i + 1].v;
          if (!nextFixed) { // 连续两个 param(结构键已在生成侧剔除,这里兜底拒绝)
            ok = false;
            break;
          }
          let found = -1;
          let search = pos + 1;
          while (true) {
            const idx = msg.indexOf(nextFixed, search);
            if (idx < 0) { ok = false; break; }
            // 参数段 = msg[pos..idx):已知名字,或不含 CJK 的短 latin 连串(≤24;
            // norm 粘接后 latin 段无法与固定段分开,如 "restorativelocket"+"isoncooldownfor")
            const segLen = idx - pos;
            const segVal = msg.slice(pos, idx);
            const latinRun = segLen >= 1 && segLen <= 24 && !/[\u3400-\u4dbf\u4e00-\u9fff]/.test(segVal);
            if (segLen >= 1 && (isNameAt(msg, pos) === segLen || latinRun)) {
              found = idx;
              break;
            }
            search = idx + 1; // 该锚点不合适,继续找下一处
          }
          if (!ok || found < 0) { ok = false; break; }
          pos = found;
        }
      }
    }
    if (!ok) continue;
    if (pos !== msg.length) continue; // 必须恰好走完整条消息
    return true;
  }
  return false;
}

// ---------- 匹配缓存 + 走查计数 ----------
const MATCH_CACHE_LIMIT = 500; // 防长会话膨胀;超限整体清空(缓存只省走查,清空不影响正确性)
const MATCH_CACHE = new Map();
let walkCount = 0;

function matchesQuickTemplate(text) {
  const key = normKey(text);
  if (!key || TEMPLATES.length === 0) return false;
  if (MATCH_CACHE.has(key)) return MATCH_CACHE.get(key);
  if (NAME_SORTED.length === 0) buildNameIndex();
  walkCount += 1;
  const hit = walkTemplates(key);
  if (MATCH_CACHE.size >= MATCH_CACHE_LIMIT) MATCH_CACHE.clear();
  MATCH_CACHE.set(key, hit);
  return hit;
}

function clearMatchCache() { MATCH_CACHE.clear(); }
function getWalkCount() { return walkCount; }
function resetWalkCount() { walkCount = 0; }
// 语料整体替换(桥同步场景):替换后必须清缓存,否则旧判定残留
function setCorpora(templates, names) {
  if (Array.isArray(templates)) TEMPLATES = templates;
  if (Array.isArray(names)) NAMES = names;
  NAME_SORTED = [];
  NAME_SET_NORM = null;
  MATCH_CACHE.clear();
}
function getCorpusSizes() { return { templates: TEMPLATES.length, names: NAMES.length }; }

module.exports = {
  matchesQuickTemplate,
  norm,
  normKey,
  tplTokens,
  clearMatchCache,
  getWalkCount,
  resetWalkCount,
  setCorpora,
  getCorpusSizes,
};
